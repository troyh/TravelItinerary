import { useEffect, useRef } from "react";
import "leaflet/dist/leaflet.css";
import L from "leaflet";

function pin(n, amber) {
  const fill = amber ? "#f5b544" : "#0b3d6b";
  return L.divIcon({
    className: "", iconAnchor: [13, 13], iconSize: [26, 26],
    html: `<svg width="26" height="26" viewBox="0 0 26 26" xmlns="http://www.w3.org/2000/svg">
      <circle cx="13" cy="13" r="11.5" fill="${fill}" stroke="#fff" stroke-width="2"/>
      <text x="13" y="17.5" text-anchor="middle" font-size="10"
        font-family="-apple-system,sans-serif" font-weight="700" fill="#fff">${n}</text>
    </svg>`,
  });
}

export default function TravelRouteMap({ fromLat, fromLng, fromName, toLat, toLng, toName, routePath, height = 160 }) {
  const elRef = useRef(null);
  const mapRef = useRef(null);

  useEffect(() => {
    const el = elRef.current;
    if (!el || !fromLat || !fromLng || !toLat || !toLng) return;

    if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }

    const map = L.map(el, { zoomControl: true, attributionControl: true });
    mapRef.current = map;

    L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
      attribution: "© <a href='https://openstreetmap.org'>OpenStreetMap</a> © <a href='https://carto.com'>CARTO</a>",
      maxZoom: 19,
    }).addTo(map);

    const bounds = L.latLngBounds([]);

    if (routePath?.length >= 2) {
      L.polyline(routePath, { color: "#0b3d6b", weight: 3, opacity: 0.85, dashArray: "6 5" }).addTo(map);
      routePath.forEach(p => bounds.extend(p));
    }

    L.marker([fromLat, fromLng], { icon: pin(1, false) })
      .bindTooltip(fromName || "From", { direction: "top", offset: [0, -10], className: "" })
      .addTo(map);
    bounds.extend([fromLat, fromLng]);

    L.marker([toLat, toLng], { icon: pin(2, true) })
      .bindTooltip(toName || "To", { direction: "top", offset: [0, -10], className: "" })
      .addTo(map);
    bounds.extend([toLat, toLng]);

    if (bounds.isValid()) map.fitBounds(bounds.pad(0.25));

    return () => { if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; } };
  }, [fromLat, fromLng, toLat, toLng, JSON.stringify(routePath)]);

  if (!fromLat || !fromLng || !toLat || !toLng) return null;

  return <div ref={elRef} style={{ height, width: "100%", borderRadius: 10, overflow: "hidden" }} />;
}
