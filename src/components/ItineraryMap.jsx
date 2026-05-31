import { useEffect, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";
import L from "leaflet";

// ── Google encoded polyline decoder ──────────────────────────────────────────

function decodePolyline(encoded) {
  const pts = [];
  let idx = 0, lat = 0, lng = 0;
  while (idx < encoded.length) {
    let b, shift = 0, result = 0;
    do { b = encoded.charCodeAt(idx++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lat += (result & 1) ? ~(result >> 1) : (result >> 1);
    shift = 0; result = 0;
    do { b = encoded.charCodeAt(idx++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lng += (result & 1) ? ~(result >> 1) : (result >> 1);
    pts.push([lat / 1e5, lng / 1e5]);
  }
  return pts;
}

// ── Geocoding (overnight text strings → lat/lng) ──────────────────────────────

async function geocodeOne(query) {
  const cache = (() => { try { return JSON.parse(localStorage.getItem("geocodeCache") || "{}"); } catch { return {}; } })();
  if (cache[query]) return cache[query];
  try {
    const res  = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`,
      { headers: { "Accept-Language": "en" } }
    );
    const data = await res.json();
    if (!data.length) return null;
    const result = { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
    cache[query] = result;
    try { localStorage.setItem("geocodeCache", JSON.stringify(cache)); } catch {}
    return result;
  } catch { return null; }
}

async function geocodeAll(queries, onProgress) {
  const results = {};
  for (const q of queries) {
    results[q] = await geocodeOne(q);
    onProgress({ ...results });
    await new Promise(r => setTimeout(r, 120)); // respect Nominatim 1 req/sec
  }
  return results;
}

// ── Great-circle arc ──────────────────────────────────────────────────────────

function greatCirclePoints(lat1, lng1, lat2, lng2, steps = 48) {
  const toR = d => d * Math.PI / 180;
  const toD = r => r * 180 / Math.PI;
  const φ1 = toR(lat1), λ1 = toR(lng1), φ2 = toR(lat2), λ2 = toR(lng2);
  const d = 2 * Math.asin(Math.sqrt(
    Math.sin((φ2 - φ1) / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin((λ2 - λ1) / 2) ** 2
  ));
  if (d < 0.0001) return [[lat1, lng1], [lat2, lng2]];
  return Array.from({ length: steps + 1 }, (_, i) => {
    const f = i / steps;
    const A = Math.sin((1 - f) * d) / Math.sin(d);
    const B = Math.sin(f * d) / Math.sin(d);
    const x = A * Math.cos(φ1) * Math.cos(λ1) + B * Math.cos(φ2) * Math.cos(λ2);
    const y = A * Math.cos(φ1) * Math.sin(λ1) + B * Math.cos(φ2) * Math.sin(λ2);
    const z = A * Math.sin(φ1)                 + B * Math.sin(φ2);
    return [toD(Math.atan2(z, Math.sqrt(x * x + y * y))), toD(Math.atan2(y, x))];
  });
}

// ── Place category colours (match DayPlaces) ─────────────────────────────────

const CATEGORY_COLOR = {
  restaurant:    "#e83870",
  marina:        "#2563eb",
  accommodation: "#8338e8",
  provisioning:  "#38a8e8",
  activity:      "#16a34a",
  other:         "#5c6470",
};

function placeIcon(category) {
  const color = CATEGORY_COLOR[category] ?? CATEGORY_COLOR.other;
  return L.divIcon({
    className: "",
    iconAnchor: [6, 6],
    iconSize:   [12, 12],
    html: `<svg width="12" height="12" viewBox="0 0 12 12" xmlns="http://www.w3.org/2000/svg">
      <circle cx="6" cy="6" r="5" fill="${color}" stroke="#ffffff" stroke-width="1.5"/>
    </svg>`,
  });
}

// ── Marker icon ───────────────────────────────────────────────────────────────

function markerIcon(n) {
  return L.divIcon({
    className: "",
    iconAnchor: [13, 13],
    iconSize:   [26, 26],
    html: `<svg width="26" height="26" viewBox="0 0 26 26" xmlns="http://www.w3.org/2000/svg">
      <circle cx="13" cy="13" r="11.5" fill="#e8f1f9" stroke="#0b3d6b" stroke-width="1.5"/>
      <text x="13" y="17.5" text-anchor="middle" font-size="${n > 9 ? 8 : 10}"
        font-family="sans-serif" font-weight="bold" fill="#0b3d6b">${n}</text>
    </svg>`,
  });
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function ItineraryMap({ days, savedFlights, savedDirections, savedPlaces, savedRoutes, dark, onSetDayLocation, onAddDayAndSetLocation }) {
  const mapElRef    = useRef(null);
  const leafletRef  = useRef(null);
  const dragRef     = useRef(null);  // { startY, startH }
  const savedViewRef = useRef(null); // { center, zoom } — preserved across rebuilds
  const setLocRef    = useRef(onSetDayLocation);
  const addDayRef    = useRef(onAddDayAndSetLocation);
  const daysRef      = useRef(days);
  useEffect(() => { setLocRef.current = onSetDayLocation; }, [onSetDayLocation]);
  useEffect(() => { addDayRef.current = onAddDayAndSetLocation; }, [onAddDayAndSetLocation]);
  useEffect(() => { daysRef.current = days; }, [days]);
  const [open,      setOpen]      = useState(true);
  const [mapHeight, setMapHeight] = useState(() => {
    const h = parseInt(localStorage.getItem("mapHeight"));
    return h > 0 ? h : 260;
  });
  const [coords, setCoords] = useState({});       // { key: { lat, lng } }
  const [geocoding, setGeocoding] = useState(false);

  // Collect overnight strings that need geocoding
  const stopsWithOvernight = days.filter(d => d.overnight?.trim());
  const uniqueOvernights   = [...new Set(stopsWithOvernight.map(d => d.overnight.trim()))];

  // Flatten all places; extract Apple coords directly, collect addresses for geocoding
  const allPlaces = Object.values(savedPlaces ?? {}).flat();
  const placesWithCoords = allPlaces.map(p => {
    if (p.placeId?.startsWith("ll:")) {
      const [lat, lng] = p.placeId.slice(3).split(",").map(Number);
      if (!isNaN(lat) && !isNaN(lng)) return { ...p, _lat: lat, _lng: lng };
    }
    return { ...p, _lat: null, _lng: null };
  });
  const placeAddressesToGeocode = [
    ...new Set(
      placesWithCoords
        .filter(p => !p._lat && p.address?.trim())
        .map(p => p.address.trim())
    ),
  ];

  // Geocode overnight locations + place addresses
  useEffect(() => {
    const queries = [...uniqueOvernights, ...placeAddressesToGeocode];
    if (!queries.length) return;
    let cache = {};
    try { cache = JSON.parse(localStorage.getItem("geocodeCache") || "{}"); } catch {}
    const uncached = queries.filter(q => !cache[q]);
    const known = {};
    queries.forEach(q => { if (cache[q]) known[q] = cache[q]; });
    if (Object.keys(known).length) setCoords(prev => ({ ...prev, ...known }));
    if (!uncached.length) return;
    setGeocoding(true);
    geocodeAll(uncached, partial => {
      setCoords(prev => ({ ...prev, ...partial }));
    }).finally(() => setGeocoding(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days.map(d => d.overnight).join("|"), placeAddressesToGeocode.join("|")]);

  // Inject theme styles for Leaflet tooltips and popups (updates when dark changes)
  useEffect(() => {
    let s = document.getElementById("leaflet-dark-styles");
    if (!s) { s = document.createElement("style"); s.id = "leaflet-dark-styles"; document.head.appendChild(s); }
    const bg = dark ? "#15181e" : "#ffffff";
    const border = dark ? "#262a33" : "#e2e5ea";
    const text = dark ? "#f2f3f5" : "#0e1014";
    const close = dark ? "#5c6470" : "#9ba1ac";
    s.textContent = `
      .leaflet-tooltip-dark { background:${bg}; border:1px solid ${border}; color:${text};
        font-family:inherit; font-size:.75rem; padding:3px 8px; border-radius:6px;
        box-shadow:0 2px 8px rgba(0,0,0,0.08); }
      .leaflet-tooltip-dark::before { display:none; }
      .leaflet-popup-dark .leaflet-popup-content-wrapper { background:${bg};
        border:1px solid ${border}; color:${text}; font-family:inherit;
        font-size:.78rem; line-height:1.5; border-radius:8px; box-shadow:0 4px 16px rgba(0,0,0,0.1); }
      .leaflet-popup-dark .leaflet-popup-tip { background:${bg}; }
      .leaflet-popup-dark .leaflet-popup-close-button { color:${close}; }
    `;
  }, [dark]);

  // Build / rebuild Leaflet map whenever coords or open changes
  useEffect(() => {
    const el = mapElRef.current;
    if (!el || !open) return;

    // Destroy old instance before rebuilding
    if (leafletRef.current) {
      leafletRef.current.remove();
      leafletRef.current = null;
    }

    // Build stops: prefer geocoded overnight text; fall back to day centroid for days without overnight
    const overnightStops = stopsWithOvernight
      .map(d => ({ day: d.day, label: d.overnight.trim(), lat: coords[d.overnight.trim()]?.lat, lng: coords[d.overnight.trim()]?.lng }))
      .filter(s => s.lat && s.lng);
    const centroidStops = days
      .filter(d => !d.overnight?.trim())
      .map(d => {
        // Prefer user-set coords; fall back to computed centroid
        if (d.centerLat && d.centerLng) {
          return { day: d.day, label: d.centerName || `Day ${d.day}`, lat: d.centerLat, lng: d.centerLng };
        }
        const pts = [];
        (savedPlaces[d.day]     ?? []).forEach(p => { if (p.lat    && p.lng)    pts.push([p.lat,    p.lng]);    });
        (savedFlights[d.day]    ?? []).forEach(f => { if (f.arrivalLat  && f.arrivalLng)  pts.push([f.arrivalLat,  f.arrivalLng]);  });
        (savedDirections[d.day] ?? []).forEach(x => { if (x.destinationLat && x.destinationLng) pts.push([x.destinationLat, x.destinationLng]); });
        (savedRoutes[d.day]     ?? []).forEach(r => { if (r.endLat  && r.endLng)  pts.push([r.endLat,  r.endLng]);  });
        if (!pts.length) return null;
        return { day: d.day, label: d.centerName || `Day ${d.day}`,
          lat: pts.reduce((s,c) => s+c[0], 0)/pts.length,
          lng: pts.reduce((s,c) => s+c[1], 0)/pts.length };
      })
      .filter(Boolean);
    // Merge and sort by day number
    const stops = [...overnightStops, ...centroidStops].sort((a, b) => a.day - b.day);

    if (stops.length < 2) return;

    const map = L.map(el, { zoomControl: true, attributionControl: true });
    leafletRef.current = map;

    const tileUrl = dark
      ? "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
      : "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png";
    L.tileLayer(tileUrl, {
      attribution: "© <a href='https://openstreetmap.org'>OpenStreetMap</a> © <a href='https://carto.com'>CARTO</a>",
      maxZoom: 19,
    }).addTo(map);

    const bounds = L.latLngBounds([]);

    // Sequential spectrum colors for route lines using golden-angle hue steps
    let _routeIdx = 0;
    function nextRouteColor() {
      const hue = (_routeIdx++ * 137.508) % 360;
      // Lighten in dark mode, darken yellow-range in light mode
      const lightness = dark
        ? 65
        : (hue > 45 && hue < 80) ? 34 : 44;
      return `hsl(${Math.round(hue)}, 70%, ${lightness}%)`;
    }

    // Draw connectors between consecutive stops
    for (let i = 0; i < stops.length - 1; i++) {
      const from  = stops[i];
      const to    = stops[i + 1];
      const fromC = from;   // stops now carry lat/lng directly
      const toC   = to;
      if (!fromC?.lat || !toC?.lat) continue;

      // Check both departure day (from) and arrival day (to) for flights on this leg
      const legFlights = [
        ...(savedFlights?.[from.day] ?? []),
        ...(savedFlights?.[to.day]   ?? []),
      ];
      const hasFlight = legFlights.length > 0;
      const flightWithCoords = legFlights.find(f =>
        f.departureLat && f.departureLng && f.arrivalLat && f.arrivalLng
      );

      if (hasFlight) {
        const flightPopup = f => [
          `<strong>Day ${from.day}</strong>`,
          [f.flightNumber, f.airline].filter(Boolean).join(" · ") || "Flight",
          f.departureName && f.arrivalName ? `${f.departureName} → ${f.arrivalName}` : null,
          f.departure && f.arrival ? `${f.departure} → ${f.arrival}` : null,
          f.distance ? f.distance : null,
          f.aircraft ? f.aircraft : null,
        ].filter(Boolean).join("<br>");

        if (flightWithCoords) {
          const arcPoints = greatCirclePoints(
            flightWithCoords.departureLat, flightWithCoords.departureLng,
            flightWithCoords.arrivalLat,   flightWithCoords.arrivalLng
          );
          L.polyline(arcPoints, { color: nextRouteColor(), weight: 1.5, opacity: 0.7, dashArray: "5,6" })
            .bindPopup(flightPopup(flightWithCoords), { className: "leaflet-popup-dark" })
            .addTo(map);
          L.polyline([[fromC.lat, fromC.lng], [flightWithCoords.departureLat, flightWithCoords.departureLng]],
            { color: "#6b7a8a", weight: 1, opacity: 0.4, dashArray: "2,4" }).addTo(map);
          L.polyline([[flightWithCoords.arrivalLat, flightWithCoords.arrivalLng], [toC.lat, toC.lng]],
            { color: "#6b7a8a", weight: 1, opacity: 0.4, dashArray: "2,4" }).addTo(map);
        } else {
          const arcPoints = greatCirclePoints(fromC.lat, fromC.lng, toC.lat, toC.lng);
          const anyFlight = legFlights[0];
          L.polyline(arcPoints, { color: nextRouteColor(), weight: 1.5, opacity: 0.7, dashArray: "5,6" })
            .bindPopup(anyFlight ? flightPopup(anyFlight) : "Flight", { className: "leaflet-popup-dark" })
            .addTo(map);
        }
      } else {
        // Skip straight line if a boating route with GPS coords covers this leg
        const legRoutes = [
          ...(savedRoutes?.[from.day] ?? []),
          ...(savedRoutes?.[to.day]   ?? []),
        ];
        const hasGpsRoute = legRoutes.some(r => r.startLat && r.startLng && r.endLat && r.endLng);
        const legDirs = [
          ...(savedDirections?.[from.day] ?? []),
          ...(savedDirections?.[to.day]   ?? []),
        ];
        const hasGpsDir = legDirs.some(d =>
          d.overviewPolyline || d.routePath?.length >= 2 ||
          (d.originLat && d.originLng && d.destinationLat && d.destinationLng)
        );
        if (!hasGpsRoute && !hasGpsDir) {
          L.polyline([[fromC.lat, fromC.lng], [toC.lat, toC.lng]], {
            color: "#6b7a8a", weight: 2, opacity: 0.6,
          }).addTo(map);
        }
      }
    }

    // Draw driving direction routes
    Object.entries(savedDirections ?? {}).forEach(([dayKey, dirList]) => {
      const dirDayNum = parseInt(dayKey);
      (dirList ?? []).forEach(dir => {
        const dirPopup = [
          `<strong>Day ${dirDayNum}</strong>`,
          dir.origin?.name && dir.destination?.name ? `${dir.origin.name} → ${dir.destination.name}` : null,
          dir.distance ? dir.distance : null,
          dir.duration ? dir.duration : null,
        ].filter(Boolean).join("<br>") || "Drive";

        if (dir.overviewPolyline) {
          const pts = decodePolyline(dir.overviewPolyline);
          L.polyline(pts, { color: nextRouteColor(), weight: 3, opacity: 0.85 })
            .bindPopup(dirPopup, { className: "leaflet-popup-dark" }).addTo(map);
          pts.forEach(p => bounds.extend(p));
        } else if (dir.routePath?.length >= 2) {
          L.polyline(dir.routePath, { color: "#43a047", weight: 3, opacity: 0.75 })
            .bindPopup(dirPopup, { className: "leaflet-popup-dark" }).addTo(map);
          dir.routePath.forEach(p => bounds.extend(p));
        } else if (dir.originLat && dir.originLng && dir.destinationLat && dir.destinationLng) {
          const pts = [[dir.originLat, dir.originLng], [dir.destinationLat, dir.destinationLng]];
          L.polyline(pts, { color: nextRouteColor(), weight: 3, opacity: 0.85 })
            .bindPopup(dirPopup, { className: "leaflet-popup-dark" }).addTo(map);
          pts.forEach(p => bounds.extend(p));
        }
      });
    });

    // Draw boating routes
    Object.entries(savedRoutes ?? {}).forEach(([dayKey, routeList]) => {
      const dayNum = parseInt(dayKey);
      (routeList ?? []).forEach(r => {
        if (!r.startLat || !r.startLng || !r.endLat || !r.endLng) return;
        const hasGpx = r.routePath?.length >= 2;
        const pts = hasGpx ? r.routePath : [[r.startLat, r.startLng], [r.endLat, r.endLng]];
        const routeLabel = [
          `<strong>Day ${dayNum}</strong>`,
          r.name || (r.startName && r.endName ? `${r.startName} → ${r.endName}` : "Route"),
          r.nm > 0 ? `${r.nm} NM` : null,
          r.hrs > 0 ? `~${(() => { const h=Math.floor(r.hrs),m=Math.round((r.hrs-h)*60); return h===0?`${m}m`:m===0?`${h}h`:`${h}h ${m}m`; })()}` + (r.cruisingSpeed ? ` @ ${r.cruisingSpeed} kn` : "") : null,
          r.time ? `Departs ${(() => { const [h,m]=r.time.split(':').map(Number); return `${h%12||12}:${String(m).padStart(2,'0')} ${h<12?'AM':'PM'}`; })()}` : null,
        ].filter(Boolean).join('<br>');

        L.polyline(pts, { color: nextRouteColor(), weight: 4, opacity: 0.85,
          dashArray: hasGpx ? null : "6,5" })
          .bindPopup(routeLabel, { className: "leaflet-popup-dark" })
          .addTo(map);
        pts.forEach(p => bounds.extend(p));
        L.marker([r.endLat, r.endLng], { icon: markerIcon(dayNum) })
          .bindTooltip(r.endName || `Day ${dayNum}`, { direction: "top", offset: [0, -10], className: "leaflet-tooltip-dark" })
          .addTo(map);
      });
    });

    // Add markers (draggable when onSetDayLocation is provided)
    stops.forEach(s => {
      if (!s.lat || !s.lng) return;
      const marker = L.marker([s.lat, s.lng], {
        icon: markerIcon(s.day),
        draggable: !!setLocRef.current,
      });
      marker.bindTooltip(s.label, { direction: "top", offset: [0, -10], className: "leaflet-tooltip-dark" });
      if (setLocRef.current) {
        marker.on("dragend", e => {
          const { lat, lng } = e.target.getLatLng();
          setLocRef.current(s.day, lat, lng);
        });
      }
      marker.addTo(map);
      bounds.extend([s.lat, s.lng]);
    });

    // Draw place markers
    placesWithCoords.forEach(p => {
      const lat = p._lat ?? coords[p.address?.trim()]?.lat;
      const lng = p._lng ?? coords[p.address?.trim()]?.lng;
      if (!lat || !lng) return;
      L.marker([lat, lng], { icon: placeIcon(p.category) })
        .bindTooltip(p.name || p.address || "", {
          direction: "top", offset: [0, -8], className: "leaflet-tooltip-dark",
        })
        .addTo(map);
      bounds.extend([lat, lng]);
    });

    if (savedViewRef.current) {
      map.setView(savedViewRef.current.center, savedViewRef.current.zoom, { animate: false });
    } else if (bounds.isValid()) {
      map.fitBounds(bounds.pad(0.2));
    }

    // Tap on empty map → day picker popup
    map.on("click", e => {
      if (!setLocRef.current) return;
      const d = daysRef.current;
      const options = d.map(day =>
        `<option value="${day.day}">Day ${day.day}${day.leg ? ": " + day.leg : ""}</option>`
      ).join("");
      const addDayOption = addDayRef.current
        ? `<option disabled style="color:var(--border)">──────────</option>
           <option value="__new__">+ Add new day at end</option>`
        : "";
      const uid = "slp-" + Date.now();
      const content = `<div style="padding:4px 2px;min-width:180px;font-family:inherit;">
        <div style="font-size:11px;font-weight:600;letter-spacing:.04em;color:var(--text-muted);margin-bottom:6px;">SET LOCATION FOR</div>
        <select id="${uid}-sel" style="width:100%;padding:5px 8px;border:1px solid var(--border);border-radius:6px;font-family:inherit;font-size:13px;margin-bottom:10px;background:var(--surface);color:var(--text);">${options}${addDayOption}</select>
        <button id="${uid}-btn" style="width:100%;padding:5px 10px;background:var(--accent);color:#fff;border:none;border-radius:6px;font-family:inherit;font-size:13px;font-weight:600;cursor:pointer;">Set location</button>
      </div>`;
      const popup = L.popup({ closeButton: true, maxWidth: 220 })
        .setLatLng(e.latlng)
        .setContent(content);
      popup.on("add", () => {
        const btn = document.getElementById(`${uid}-btn`);
        const sel = document.getElementById(`${uid}-sel`);
        if (btn && sel) {
          L.DomEvent.on(btn, "click", () => {
            if (sel.value === "__new__") {
              addDayRef.current?.(e.latlng.lat, e.latlng.lng);
            } else {
              setLocRef.current(parseInt(sel.value, 10), e.latlng.lat, e.latlng.lng);
            }
            map.closePopup();
          });
        }
      });
      popup.openOn(map);
    });

    return () => {
      if (leafletRef.current) {
        savedViewRef.current = { center: leafletRef.current.getCenter(), zoom: leafletRef.current.getZoom() };
        leafletRef.current.remove();
        leafletRef.current = null;
      }
    };
  // Rebuild when open toggles or coords change
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mapHeight, coords, JSON.stringify(savedFlights), JSON.stringify(savedDirections), JSON.stringify(savedPlaces), JSON.stringify(savedRoutes), JSON.stringify(days.map(d => [d.day, d.centerLat, d.centerLng]))]);

  // Don't render if fewer than 2 locatable days (overnight text, explicit center coords, or GPS centroid)
  const locatableDays = days.filter(d => {
    if (d.overnight?.trim()) return true;
    if (d.centerLat && d.centerLng) return true;
    const hasCentroid = [
      ...(savedPlaces[d.day]     ?? []).filter(p => p.lat && p.lng),
      ...(savedFlights[d.day]    ?? []).filter(f => f.arrivalLat && f.arrivalLng),
      ...(savedDirections[d.day] ?? []).filter(x => x.destinationLat && x.destinationLng),
      ...(savedRoutes[d.day]     ?? []).filter(r => r.endLat && r.endLng),
    ].length > 0;
    return hasCentroid;
  });
  if (locatableDays.length < 2) return null;

  return (
    <div style={{ position: "relative" }}>
      {/* Map container */}
      <div
        ref={mapElRef}
        style={{
          height: open ? mapHeight : 0,
          display: open ? "block" : "none",
          background: "#f8f9fb",
        }}
      />

      {/* Floating controls — top-right corner of the map */}
      <div style={{ position: "absolute", top: 10, right: 10, zIndex: 800,
        display: "flex", gap: 6, alignItems: "center" }}>
        {geocoding && (
          <span style={{ fontSize: 11, color: "#5c6470", background: "rgba(255,255,255,0.9)",
            padding: "3px 8px", borderRadius: 6, fontFamily: "inherit" }}>
            Locating…
          </span>
        )}
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          style={{ background: "rgba(255,255,255,0.92)", border: "1px solid #e2e5ea",
            color: "#5c6470", cursor: "pointer", fontSize: 11, fontFamily: "inherit",
            padding: "3px 10px", borderRadius: 6, backdropFilter: "blur(4px)" }}>
          {open ? "Hide map" : "Show map"}
        </button>
      </div>

      {/* Drag handle to resize */}
      {open && (
        <div
          onPointerDown={e => {
            e.preventDefault();
            dragRef.current = { startY: e.clientY, startH: mapHeight };
            const onMove = ev => {
              const delta = ev.clientY - dragRef.current.startY;
              const newH = Math.max(100, Math.min(700, dragRef.current.startH + delta));
              setMapHeight(newH);
              try { localStorage.setItem("mapHeight", String(Math.round(newH))); } catch {}
            };
            const onUp = () => {
              window.removeEventListener("pointermove", onMove);
              window.removeEventListener("pointerup", onUp);
              if (leafletRef.current) leafletRef.current.invalidateSize();
            };
            window.addEventListener("pointermove", onMove);
            window.addEventListener("pointerup", onUp);
          }}
          style={{ height: 6, background: "#f0f4f8", cursor: "ns-resize",
            touchAction: "none", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ width: 32, height: 2, borderRadius: 1, background: "#d1d5db" }} />
        </div>
      )}
    </div>
  );
}
