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

// ── Marker icon ───────────────────────────────────────────────────────────────

function markerIcon(n) {
  return L.divIcon({
    className: "",
    iconAnchor: [13, 13],
    iconSize:   [26, 26],
    html: `<svg width="26" height="26" viewBox="0 0 26 26" xmlns="http://www.w3.org/2000/svg">
      <circle cx="13" cy="13" r="11.5" fill="#1a3352" stroke="#c9a84c" stroke-width="1.5"/>
      <text x="13" y="17.5" text-anchor="middle" font-size="${n > 9 ? 8 : 10}"
        font-family="sans-serif" font-weight="bold" fill="#c9a84c">${n}</text>
    </svg>`,
  });
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function ItineraryMap({ days, savedFlights, savedDirections }) {
  const mapElRef   = useRef(null);
  const leafletRef = useRef(null);
  const [open,   setOpen]   = useState(true);
  const [coords, setCoords] = useState({});       // { "overnight text": { lat, lng } }
  const [geocoding, setGeocoding] = useState(false);

  // Collect overnight strings that need geocoding
  const stopsWithOvernight = days.filter(d => d.overnight?.trim());
  const uniqueOvernights   = [...new Set(stopsWithOvernight.map(d => d.overnight.trim()))];

  // Geocode any uncached overnight locations on mount / when days change
  useEffect(() => {
    if (!uniqueOvernights.length) return;
    // Filter to only uncached
    let cache = {};
    try { cache = JSON.parse(localStorage.getItem("geocodeCache") || "{}"); } catch {}
    const uncached = uniqueOvernights.filter(q => !cache[q]);
    // Seed state with what we already have cached
    if (Object.keys(cache).length) {
      const known = {};
      uniqueOvernights.forEach(q => { if (cache[q]) known[q] = cache[q]; });
      if (Object.keys(known).length) setCoords(known);
    }
    if (!uncached.length) return;
    setGeocoding(true);
    geocodeAll(uncached, partial => {
      setCoords(prev => ({ ...prev, ...partial }));
    }).finally(() => setGeocoding(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days.map(d => d.overnight).join("|")]);

  // Build / rebuild Leaflet map whenever coords or open changes
  useEffect(() => {
    const el = mapElRef.current;
    if (!el || !open) return;

    // Destroy old instance before rebuilding
    if (leafletRef.current) {
      leafletRef.current.remove();
      leafletRef.current = null;
    }

    // Need at least 2 stops with coords
    const stops = stopsWithOvernight
      .map(d => ({ day: d.day, overnight: d.overnight.trim() }))
      .filter(s => coords[s.overnight]);

    if (stops.length < 2) return;

    const map = L.map(el, { zoomControl: true, attributionControl: true });
    leafletRef.current = map;

    L.tileLayer(
      "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
      { attribution: "© <a href='https://openstreetmap.org'>OpenStreetMap</a> © <a href='https://carto.com'>CARTO</a>", maxZoom: 19 }
    ).addTo(map);

    const bounds = L.latLngBounds([]);

    // Draw connectors between consecutive stops
    for (let i = 0; i < stops.length - 1; i++) {
      const from = stops[i];
      const to   = stops[i + 1];
      const fromC = coords[from.overnight];
      const toC   = coords[to.overnight];
      if (!fromC || !toC) continue;

      // Check if the "to" day had a flight
      const flights = savedFlights?.[to.day] ?? [];
      const hasFlight = flights.length > 0;
      const flightWithCoords = flights.find(f =>
        f.departureLat && f.departureLng && f.arrivalLat && f.arrivalLng
      );

      if (hasFlight) {
        if (flightWithCoords) {
          // Draw actual airport-to-airport arc using stored coords
          const arcPoints = greatCirclePoints(
            flightWithCoords.departureLat, flightWithCoords.departureLng,
            flightWithCoords.arrivalLat,   flightWithCoords.arrivalLng
          );
          L.polyline(arcPoints, {
            color: "#8338e8", weight: 1.5, opacity: 0.7, dashArray: "5,6",
          }).addTo(map);
          // Thin dotted connectors from overnight to airport and from airport to overnight
          L.polyline([[fromC.lat, fromC.lng], [flightWithCoords.departureLat, flightWithCoords.departureLng]],
            { color: "#4e7a9e", weight: 1, opacity: 0.4, dashArray: "2,4" }).addTo(map);
          L.polyline([[flightWithCoords.arrivalLat, flightWithCoords.arrivalLng], [toC.lat, toC.lng]],
            { color: "#4e7a9e", weight: 1, opacity: 0.4, dashArray: "2,4" }).addTo(map);
        } else {
          // No stored airport coords — draw arc between overnights
          const arcPoints = greatCirclePoints(fromC.lat, fromC.lng, toC.lat, toC.lng);
          L.polyline(arcPoints, {
            color: "#8338e8", weight: 1.5, opacity: 0.7, dashArray: "5,6",
          }).addTo(map);
        }
      } else {
        // Ground travel — straight line
        L.polyline([[fromC.lat, fromC.lng], [toC.lat, toC.lng]], {
          color: "#4e7a9e", weight: 2, opacity: 0.6,
        }).addTo(map);
      }
    }

    // Draw driving direction routes
    Object.entries(savedDirections ?? {}).forEach(([, dirList]) => {
      (dirList ?? []).forEach(dir => {
        if (dir.overviewPolyline) {
          const pts = decodePolyline(dir.overviewPolyline);
          L.polyline(pts, { color: "#43a047", weight: 3, opacity: 0.75 }).addTo(map);
          pts.forEach(p => bounds.extend(p));
        } else if (dir.originLat && dir.originLng && dir.destinationLat && dir.destinationLng) {
          const pts = [[dir.originLat, dir.originLng], [dir.destinationLat, dir.destinationLng]];
          L.polyline(pts, { color: "#43a047", weight: 3, opacity: 0.75 }).addTo(map);
          pts.forEach(p => bounds.extend(p));
        }
      });
    });

    // Add markers
    stops.forEach((s, i) => {
      const c = coords[s.overnight];
      if (!c) return;
      L.marker([c.lat, c.lng], { icon: markerIcon(s.day) })
        .bindTooltip(s.overnight, { direction: "top", offset: [0, -10],
          className: "leaflet-tooltip-dark" })
        .addTo(map);
      bounds.extend([c.lat, c.lng]);
    });

    if (bounds.isValid()) map.fitBounds(bounds.pad(0.2));

    return () => {
      if (leafletRef.current) { leafletRef.current.remove(); leafletRef.current = null; }
    };
  // Rebuild when open toggles or coords change
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, coords, JSON.stringify(savedFlights), JSON.stringify(savedDirections)]);

  // Don't render if fewer than 2 days have overnight locations
  if (stopsWithOvernight.length < 2) return null;

  return (
    <div style={{ marginBottom: "1.25rem" }}>
      {/* Header bar */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
        padding: ".45rem .75rem", background: "#071520", borderLeft: "3px solid #4e7a9e44",
        borderRadius: open ? "0 4px 0 0" : "0 4px 4px 0" }}>
        <div style={{ display: "flex", alignItems: "center", gap: ".5rem" }}>
          <span style={{ fontSize: ".62rem", letterSpacing: ".1em", textTransform: "uppercase",
            fontFamily: "sans-serif", color: "#4e7a9e" }}>
            Overview Map
          </span>
          {geocoding && (
            <span style={{ fontSize: ".62rem", color: "#3d5060", fontFamily: "sans-serif",
              fontStyle: "italic" }}>
              loading…
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          style={{ background: "none", border: "none", color: "#4e7a9e",
            cursor: "pointer", fontSize: ".72rem", fontFamily: "sans-serif",
            padding: "0 .2rem" }}>
          {open ? "▲ hide" : "▼ show"}
        </button>
      </div>

      {/* Map container — always mounted, hidden when collapsed to avoid remount */}
      <div
        ref={mapElRef}
        style={{
          height: 260,
          borderLeft: "3px solid #4e7a9e44",
          borderBottom: open ? "1px solid #1e3a52" : "none",
          display: open ? "block" : "none",
          background: "#0b1929",
        }}
      />
    </div>
  );
}
