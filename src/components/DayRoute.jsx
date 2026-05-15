import { useState, useEffect, useRef } from "react";
import NoteMarkdown from "./NoteMarkdown.jsx";
import { setOptions, importLibrary } from "@googlemaps/js-api-loader";
import { loadMapKit, appleAutocomplete, appleFetchPlaceDetails,
         getStoredProviderSettings } from "../lib/mapkit.js";

// ── Module-level singletons ────────────────────────────────────────────────
let routePlacesPromise = null;
let routeApplePromise  = null;

function getStoredMapsKey() {
  try { const s = localStorage.getItem("travelSettings"); return (s ? JSON.parse(s) : {}).googleMapsKey ?? ""; }
  catch { return ""; }
}
function loadRoutePlaces() {
  if (!routePlacesPromise) {
    const key = getStoredMapsKey();
    try { setOptions({ key, version: "weekly" }); } catch {}
    routePlacesPromise = key ? importLibrary("places") : Promise.reject(new Error("no-key"));
  }
  return routePlacesPromise;
}
function loadRouteApple() {
  if (!routeApplePromise) {
    const { appleMapKitToken } = getStoredProviderSettings();
    routeApplePromise = loadMapKit(appleMapKitToken);
  }
  return routeApplePromise;
}

const borderAccent = "3px solid #c9a84c66";

const S = {
  input: { background: "#0a1a2a", border: "1px solid #2e5070", color: "#e8dcc8",
    borderRadius: 4, padding: ".4rem .65rem", fontSize: ".82rem", fontFamily: "sans-serif",
    outline: "none", boxSizing: "border-box" },
  btnPrimary: { background: "#1a3352", border: "1px solid #2e5070", color: "#c9a84c",
    borderRadius: 4, padding: ".35rem .8rem", fontSize: ".75rem", fontFamily: "sans-serif",
    cursor: "pointer", whiteSpace: "nowrap", touchAction: "manipulation" },
  btnGhost: { background: "none", border: "1px solid #2e3a4a", color: "#4e7a9e",
    borderRadius: 4, padding: ".35rem .8rem", fontSize: ".75rem", fontFamily: "sans-serif",
    cursor: "pointer", whiteSpace: "nowrap", touchAction: "manipulation" },
  label: { fontSize: ".62rem", letterSpacing: ".1em", textTransform: "uppercase",
    fontFamily: "sans-serif" },
};

const BLANK = { name: "", nm: "", speedKts: 15, time: "",
                startName: "", startLat: null, startLng: null,
                endName: "",   endLat: null,   endLng: null };

function gpxPathToNM(path) {
  const R = 3440.065; // Earth radius in nautical miles
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    const [lat1, lon1] = path[i - 1], [lat2, lon2] = path[i];
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
    total += 2 * R * Math.asin(Math.sqrt(a));
  }
  return Math.round(total * 10) / 10;
}

async function fetchGpxRoute(serverUrl, startLat, startLng, endLat, endLng) {
  const res = await fetch(`${serverUrl.replace(/\/$/, "")}/route`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ start: `${startLat}, ${startLng}`, end: `${endLat}, ${endLng}` }),
  });
  if (!res.ok) throw new Error(`Route server: ${res.status}`);
  return res.text();
}

function parseGpxToPath(gpxText) {
  try {
    const doc = new DOMParser().parseFromString(gpxText, "text/xml");
    // getElementsByTagName is namespace-agnostic; try trkpt, then rtept, then wpt
    let els = doc.getElementsByTagName("trkpt");
    if (!els.length) els = doc.getElementsByTagName("rtept");
    if (!els.length) els = doc.getElementsByTagName("wpt");
    const pts = Array.from(els).map(pt => [
      parseFloat(pt.getAttribute("lat")),
      parseFloat(pt.getAttribute("lon")),
    ]).filter(([lat, lon]) => !isNaN(lat) && !isNaN(lon));
    return pts.length >= 2 ? pts : null;
  } catch { return null; }
}

function downloadGpx(gpxText, name) {
  const blob = new Blob([gpxText], { type: "application/gpx+xml" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `${name || "route"}.gpx`;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
}

function fmtHrs(hrs) {
  const h = Math.floor(hrs);
  const m = Math.round((hrs - h) * 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function fmtTime(hhmm) {
  if (!hhmm) return "";
  const [h, m] = hhmm.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

const timeInputStyle = {
  background: "none", border: "none", color: "#c9a84c",
  fontSize: ".75rem", fontFamily: "sans-serif",
  cursor: "pointer", padding: 0, outline: "none", colorScheme: "dark",
};

export default function DayRoute({ routes, onAdd, onUpdate, onDelete, onApplyToDay, readOnly = false, routeServerUrl = "" }) {
  const [isAdding,       setIsAdding]       = useState(false);
  const [fetchingRoute,  setFetchingRoute]  = useState(false);
  const [draft,          setDraft]          = useState(BLANK);
  const [editingId,      setEditingId]      = useState(null);
  const [noteDraft,      setNoteDraft]      = useState("");
  const [editingRouteId, setEditingRouteId] = useState(null);
  const [editDraft,      setEditDraft]      = useState(BLANK);
  const setE = (k, v) => setEditDraft(p => ({ ...p, [k]: v }));

  const set = (k, v) => setDraft(p => ({ ...p, [k]: v }));

  // Location search state
  const [mapsLib,     setMapsLib]     = useState(null);
  const [startQuery,  setStartQuery]  = useState("");
  const [endQuery,    setEndQuery]    = useState("");
  const [startPreds,  setStartPreds]  = useState([]);
  const [endPreds,    setEndPreds]    = useState([]);
  const [startCoords, setStartCoords] = useState(null);
  const [endCoords,   setEndCoords]   = useState(null);
  const debStart = useRef(null);
  const debEnd   = useRef(null);

  useEffect(() => {
    const { provider, appleMapKitToken, googleMapsKey } = getStoredProviderSettings();
    if (provider === "apple" && appleMapKitToken) {
      loadRouteApple().then(mk => setMapsLib({ provider: "apple", mk })).catch(() => {});
    } else if (googleMapsKey) {
      loadRoutePlaces().then(lib => setMapsLib({ provider: "google", lib })).catch(() => {});
    }
  }, []);

  const computedHrs = draft.nm && draft.speedKts
    ? Math.round((parseFloat(draft.nm) / parseFloat(draft.speedKts)) * 10) / 10
    : null;

  // Can add if NM is set, OR if coordinates + route server are available (NM computed from GPX)
  const hasCoords = !!(startCoords?.lat && endCoords?.lat);
  const canAddRoute = (parseFloat(draft.nm) > 0) || (hasCoords && !!routeServerUrl);

  const genId = () =>
    typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  function makeHandler(setQuery, setPreds, setCoords, debRef) {
    return function(value) {
      setQuery(value);
      setCoords(null);
      setPreds([]);
      if (!value.trim() || !mapsLib) return;
      clearTimeout(debRef.current);
      debRef.current = setTimeout(async () => {
        try {
          if (mapsLib.provider === "apple") {
            setPreds(await appleAutocomplete(mapsLib.mk, value, null));
          } else {
            const { AutocompleteSuggestion } = mapsLib.lib;
            const { suggestions } = await AutocompleteSuggestion.fetchAutocompleteSuggestions({ input: value });
            setPreds(suggestions.filter(s => s.placePrediction).slice(0, 5).map(s => ({
              name: s.placePrediction.mainText.text,
              subtitle: s.placePrediction.secondaryText?.text ?? "",
              _data: s,
            })));
          }
        } catch {}
      }, 350);
    };
  }

  async function selectPred(pred, setQuery, setPreds, setCoords) {
    setQuery(pred.name);
    setPreds([]);
    try {
      let lat, lng;
      if (mapsLib.provider === "apple") {
        const details = await appleFetchPlaceDetails(mapsLib.mk, pred._data);
        lat = details.lat ?? null; lng = details.lng ?? null;
      } else {
        const place = pred._data.placePrediction.toPlace();
        await place.fetchFields({ fields: ["location"] });
        lat = place.location?.lat() ?? null;
        lng = place.location?.lng() ?? null;
      }
      setCoords({ name: pred.name, lat, lng });
    } catch {}
  }

  async function handleAdd() {
    if (!canAddRoute) return;
    let nm = parseFloat(draft.nm) || 0;
    const speedKts = parseFloat(draft.speedKts) || 15;
    const record = {
      id:        genId(),
      name:      draft.name.trim(),
      nm:        Math.round(nm * 10) / 10,
      speedKts,
      hrs:       Math.round((nm / speedKts) * 10) / 10,
      time:      draft.time,
      startName: startCoords?.name ?? "",
      startLat:  startCoords?.lat ?? null,
      startLng:  startCoords?.lng ?? null,
      endName:   endCoords?.name ?? "",
      endLat:    endCoords?.lat ?? null,
      endLng:    endCoords?.lng ?? null,
      routePath: null,
      notes:     "",
      addedAt:   new Date().toISOString(),
    };
    if (routeServerUrl && record.startLat && record.endLat) {
      setFetchingRoute(true);
      try {
        const gpxText = await fetchGpxRoute(routeServerUrl, record.startLat, record.startLng, record.endLat, record.endLng);
        record.routePath = parseGpxToPath(gpxText);
        // Compute NM from GPX if not manually entered
        if (!nm && record.routePath) {
          const computedNM = gpxPathToNM(record.routePath);
          if (computedNM > 0) {
            record.nm  = computedNM;
            record.hrs = Math.round(computedNM / speedKts * 10) / 10;
          }
        }
      } catch { /* fall back to straight line */ }
      setFetchingRoute(false);
    }
    onAdd(record);
    setIsAdding(false);
    setDraft(BLANK);
    setStartQuery(""); setEndQuery("");
    setStartCoords(null); setEndCoords(null);
    setStartPreds([]); setEndPreds([]);
  }

  function handleCancel() {
    setIsAdding(false);
    setDraft(BLANK);
    setStartQuery(""); setEndQuery("");
    setStartCoords(null); setEndCoords(null);
    setStartPreds([]); setEndPreds([]);
  }

  if (readOnly && routes.length === 0) return null;

  return (
    <div style={{ marginTop: "1rem" }}>

      {/* Section header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
        padding: ".75rem 1rem", background: "#0a1a2a", borderLeft: borderAccent,
        borderRadius: "0 4px 0 0" }}>
        <div style={{ display: "flex", alignItems: "center", gap: ".5rem" }}>
          <span style={{ ...S.label, color: "#c9a84c" }}>Boating Routes</span>
          {routes.length > 0 && (
            <span style={{ background: "#c9a84c22", color: "#c9a84c", border: "1px solid #c9a84c44",
              borderRadius: 10, padding: "1px 7px", fontSize: ".6rem", fontFamily: "sans-serif" }}>
              {routes.length}
            </span>
          )}
        </div>
        {!isAdding && !readOnly && (
          <button type="button"
            onClick={() => setIsAdding(true)}
            onTouchEnd={e => { e.preventDefault(); setIsAdding(true); }}
            style={{ ...S.btnGhost, fontSize: ".7rem", padding: ".25rem .65rem" }}>
            + Add Route
          </button>
        )}
        {isAdding && (
          <button type="button"
            onClick={handleCancel}
            onTouchEnd={e => { e.preventDefault(); handleCancel(); }}
            style={{ ...S.btnGhost, fontSize: ".7rem", padding: ".25rem .65rem" }}>
            Cancel
          </button>
        )}
      </div>

      {/* Add form */}
      {isAdding && (
        <div style={{ background: "#0a1a2a", borderLeft: borderAccent, padding: ".75rem 1rem" }}>
          <div style={{ display: "flex", gap: ".5rem", flexWrap: "wrap", marginBottom: ".5rem" }}>
            <div style={{ flex: 2, minWidth: 160 }}>
              <div style={{ ...S.label, color: "#6b8fa8", marginBottom: 3 }}>Route Name (optional)</div>
              <input value={draft.name}
                onChange={e => set("name", e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleAdd()}
                placeholder="e.g. Anacortes → Friday Harbor"
                style={{ ...S.input, width: "100%" }} />
            </div>
            <div style={{ width: 90 }}>
              <div style={{ ...S.label, color: "#6b8fa8", marginBottom: 3 }}>Distance</div>
              <input type="text" inputMode="decimal" value={draft.nm}
                onChange={e => set("nm", e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleAdd()}
                placeholder="NM"
                style={{ ...S.input, width: "100%" }} />
            </div>
            <div style={{ width: 80 }}>
              <div style={{ ...S.label, color: "#6b8fa8", marginBottom: 3 }}>Speed</div>
              <input type="text" inputMode="decimal" value={draft.speedKts}
                onChange={e => set("speedKts", e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleAdd()}
                placeholder="kts"
                style={{ ...S.input, width: "100%" }} />
            </div>
            <div style={{ width: 90 }}>
              <div style={{ ...S.label, color: "#6b8fa8", marginBottom: 3 }}>Depart</div>
              <input type="time" value={draft.time}
                onChange={e => set("time", e.target.value)}
                style={{ ...S.input, width: "100%", colorScheme: "dark" }} />
            </div>
          </div>
          {/* Location search — only when maps API is loaded */}
          {mapsLib && (
            <div style={{ marginBottom: ".5rem" }}>
              {[
                { label: "From", query: startQuery, preds: startPreds, coords: startCoords,
                  setQ: setStartQuery, setP: setStartPreds, setC: setStartCoords, deb: debStart },
                { label: "To",   query: endQuery,   preds: endPreds,   coords: endCoords,
                  setQ: setEndQuery,   setP: setEndPreds,   setC: setEndCoords,   deb: debEnd   },
              ].map(({ label, query, preds, coords, setQ, setP, setC, deb }) => (
                <div key={label} style={{ marginBottom: ".4rem" }}>
                  <div style={{ ...S.label, color: "#6b8fa8", marginBottom: 3 }}>
                    {label} <span style={{ color: "#3d5060", fontStyle: "italic",
                      textTransform: "none", letterSpacing: 0 }}>(optional)</span>
                  </div>
                  <input value={query}
                    onChange={e => makeHandler(setQ, setP, setC, deb)(e.target.value)}
                    placeholder="Search for a location…"
                    style={{ ...S.input, width: "100%",
                      borderColor: coords ? "#c9a84c66" : "#2e5070" }} />
                  {coords && (
                    <div style={{ fontSize: ".68rem", color: "#c9a84c", fontFamily: "sans-serif",
                      marginTop: 2 }}>
                      ✓ {coords.name}
                    </div>
                  )}
                  {preds.length > 0 && (
                    <div style={{ border: "1px solid #2e5070", borderRadius: 4,
                      background: "#0d1f33", overflow: "hidden", marginTop: ".25rem" }}>
                      {preds.map((pred, i) => (
                        <div key={i} onClick={() => selectPred(pred, setQ, setP, setC)}
                          style={{ padding: ".4rem .65rem", cursor: "pointer",
                            borderBottom: i < preds.length - 1 ? "1px solid #1e3a5230" : "none",
                            fontFamily: "sans-serif" }}
                          onMouseEnter={e => e.currentTarget.style.background = "#1a3352"}
                          onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                          <div style={{ fontSize: ".8rem", color: "#e8dcc8" }}>{pred.name}</div>
                          {pred.subtitle && <div style={{ fontSize: ".7rem", color: "#4e7a9e", marginTop: 1 }}>{pred.subtitle}</div>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          <div style={{ display: "flex", alignItems: "center", gap: ".75rem" }}>
            <button type="button"
              onClick={handleAdd}
              onTouchEnd={e => { e.preventDefault(); handleAdd(); }}
              disabled={!canAddRoute || fetchingRoute}
              style={{ ...S.btnPrimary, opacity: (!canAddRoute || fetchingRoute) ? 0.45 : 1 }}>
              {fetchingRoute ? "Getting route…" : "Add"}
            </button>
            {computedHrs !== null && (
              <span style={{ fontSize: ".78rem", color: "#c9a84c", fontFamily: "sans-serif" }}>
                ~{fmtHrs(computedHrs)} at {draft.speedKts} kts
              </span>
            )}
          </div>
        </div>
      )}

      {/* Route cards */}
      {routes.map(route => (
        <div key={route.id} style={{ borderLeft: borderAccent, background: "#0a1a2a" }}>
          <div style={{ padding: ".65rem 1rem", borderTop: "1px solid #1e3a5230" }}>

            {/* Header row */}
            <div style={{ display: "flex", justifyContent: "space-between",
              alignItems: "flex-start", gap: ".5rem", marginBottom: ".3rem" }}>
              <span style={{ fontSize: ".88rem", color: "#e8dcc8", fontFamily: "sans-serif",
                fontWeight: 600, lineHeight: 1.3, flex: 1 }}>
                🚢 {route.name || "Unnamed Route"}
              </span>
              {!readOnly && (
                <div style={{ display: "flex", gap: ".4rem", flexShrink: 0, alignItems: "center" }}>
                  <button type="button"
                    onClick={() => {
                      setEditingRouteId(route.id);
                      setEditDraft({ name: route.name, nm: String(route.nm), speedKts: String(route.speedKts), time: route.time || "" });
                      setStartQuery(route.startName || ""); setEndQuery(route.endName || "");
                      setStartCoords(route.startLat ? { name: route.startName, lat: route.startLat, lng: route.startLng } : null);
                      setEndCoords(route.endLat   ? { name: route.endName,   lat: route.endLat,   lng: route.endLng   } : null);
                      setStartPreds([]); setEndPreds([]);
                    }}
                    style={{ background: "none", border: "none", color: "#4e7a9e",
                      cursor: "pointer", fontSize: ".7rem", fontFamily: "sans-serif", padding: 0 }}>
                    Edit
                  </button>
                  <button type="button" onClick={() => onDelete(route.id)}
                    style={{ background: "none", border: "none", color: "#5a4a20",
                      cursor: "pointer", fontSize: ".85rem", lineHeight: 1, padding: 0 }}>
                    ×
                  </button>
                </div>
              )}
            </div>

            {editingRouteId === route.id ? (
              /* Inline edit form */
              <div style={{ marginTop: ".5rem" }}>
                <div style={{ display: "flex", gap: ".5rem", flexWrap: "wrap", marginBottom: ".5rem" }}>
                  <div style={{ flex: 2, minWidth: 140 }}>
                    <div style={{ ...S.label, color: "#6b8fa8", marginBottom: 3 }}>Route Name</div>
                    <input value={editDraft.name} onChange={e => setE("name", e.target.value)}
                      style={{ ...S.input, width: "100%" }} />
                  </div>
                  <div style={{ width: 80 }}>
                    <div style={{ ...S.label, color: "#6b8fa8", marginBottom: 3 }}>Distance</div>
                    <input type="text" inputMode="decimal" value={editDraft.nm}
                      onChange={e => setE("nm", e.target.value)} placeholder="NM"
                      style={{ ...S.input, width: "100%" }} />
                  </div>
                  <div style={{ width: 80 }}>
                    <div style={{ ...S.label, color: "#6b8fa8", marginBottom: 3 }}>Speed</div>
                    <input type="text" inputMode="decimal" value={editDraft.speedKts}
                      onChange={e => setE("speedKts", e.target.value)} placeholder="kts"
                      style={{ ...S.input, width: "100%" }} />
                  </div>
                  <div style={{ width: 90 }}>
                    <div style={{ ...S.label, color: "#6b8fa8", marginBottom: 3 }}>Depart</div>
                    <input type="time" value={editDraft.time} onChange={e => setE("time", e.target.value)}
                      style={{ ...S.input, width: "100%", colorScheme: "dark" }} />
                  </div>
                </div>
                {(() => { const nm = parseFloat(editDraft.nm); const spd = parseFloat(editDraft.speedKts); const h = nm > 0 && spd > 0 ? Math.round(nm/spd*10)/10 : null; return h ? <span style={{ fontSize:".78rem", color:"#c9a84c", fontFamily:"sans-serif" }}>~{fmtHrs(h)} at {editDraft.speedKts} kts</span> : null; })()}

                {/* Location search in edit form */}
                {mapsLib && (
                  <div style={{ marginTop: ".5rem" }}>
                    {[
                      { label: "From", query: startQuery, preds: startPreds, coords: startCoords,
                        setQ: setStartQuery, setP: setStartPreds, setC: setStartCoords, deb: debStart },
                      { label: "To",   query: endQuery,   preds: endPreds,   coords: endCoords,
                        setQ: setEndQuery,   setP: setEndPreds,   setC: setEndCoords,   deb: debEnd   },
                    ].map(({ label, query, preds, coords, setQ, setP, setC, deb }) => (
                      <div key={label} style={{ marginBottom: ".4rem" }}>
                        <div style={{ ...S.label, color: "#6b8fa8", marginBottom: 3 }}>{label}</div>
                        <input value={query} onChange={e => makeHandler(setQ, setP, setC, deb)(e.target.value)}
                          placeholder="Search for a location…"
                          style={{ ...S.input, width: "100%", borderColor: coords ? "#c9a84c66" : "#2e5070" }} />
                        {coords && <div style={{ fontSize: ".68rem", color: "#c9a84c", fontFamily: "sans-serif", marginTop: 2 }}>✓ {coords.name}</div>}
                        {preds.length > 0 && (
                          <div style={{ border: "1px solid #2e5070", borderRadius: 4, background: "#0d1f33", overflow: "hidden", marginTop: ".25rem" }}>
                            {preds.map((pred, i) => (
                              <div key={i} onClick={() => selectPred(pred, setQ, setP, setC)}
                                style={{ padding: ".4rem .65rem", cursor: "pointer",
                                  borderBottom: i < preds.length - 1 ? "1px solid #1e3a5230" : "none", fontFamily: "sans-serif" }}
                                onMouseEnter={e => e.currentTarget.style.background = "#1a3352"}
                                onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                                <div style={{ fontSize: ".8rem", color: "#e8dcc8" }}>{pred.name}</div>
                                {pred.subtitle && <div style={{ fontSize: ".7rem", color: "#4e7a9e", marginTop: 1 }}>{pred.subtitle}</div>}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                <div style={{ display: "flex", gap: ".4rem", marginTop: ".5rem" }}>
                  <button type="button" onClick={async () => {
                    let nm = parseFloat(editDraft.nm) || 0;
                    const speedKts = parseFloat(editDraft.speedKts) || 15;
                    const sLat = startCoords?.lat ?? route.startLat ?? null;
                    const sLng = startCoords?.lng ?? route.startLng ?? null;
                    const eLat = endCoords?.lat   ?? route.endLat   ?? null;
                    const eLng = endCoords?.lng   ?? route.endLng   ?? null;
                    const hasEditCoords = !!(sLat && eLat);
                    if (!nm && !hasEditCoords) return; // need either NM or coords
                    const updates = {
                      name: editDraft.name.trim(), nm: Math.round(nm*10)/10, speedKts, hrs: Math.round(nm/speedKts*10)/10, time: editDraft.time,
                      startName: startCoords?.name ?? route.startName ?? "", startLat: sLat, startLng: sLng,
                      endName:   endCoords?.name   ?? route.endName   ?? "", endLat:   eLat, endLng:   eLng,
                      routePath: route.routePath ?? null,
                    };
                    if (routeServerUrl && sLat && eLat) {
                      setFetchingRoute(true);
                      try {
                        const gpxText = await fetchGpxRoute(routeServerUrl, sLat, sLng, eLat, eLng);
                        updates.routePath = parseGpxToPath(gpxText);
                        if (!nm && updates.routePath) {
                          const computedNM = gpxPathToNM(updates.routePath);
                          if (computedNM > 0) {
                            updates.nm  = computedNM;
                            updates.hrs = Math.round(computedNM / speedKts * 10) / 10;
                          }
                        }
                      } catch {}
                      setFetchingRoute(false);
                    }
                    if (nm > 0 && !updates.nm) {
                      updates.nm  = Math.round(nm * 10) / 10;
                      updates.hrs = Math.round(nm / speedKts * 10) / 10;
                    }
                    onUpdate(route.id, updates);
                    setEditingRouteId(null);
                    setStartQuery(""); setEndQuery(""); setStartCoords(null); setEndCoords(null);
                  }} disabled={fetchingRoute}
                  style={{ ...S.btnPrimary, opacity: fetchingRoute ? 0.45 : 1 }}>
                    {fetchingRoute ? "Getting route…" : "Save"}
                  </button>
                  <button type="button" onClick={() => { setEditingRouteId(null); setStartQuery(""); setEndQuery(""); setStartCoords(null); setEndCoords(null); }} style={S.btnGhost}>Cancel</button>
                </div>
              </div>
            ) : (
              <>
                {/* Stats row */}
                <div style={{ fontSize: ".75rem", color: "#4e7a9e", fontFamily: "sans-serif",
                  marginBottom: ".4rem", display: "flex", alignItems: "center", gap: ".5rem", flexWrap: "wrap" }}>
                  <span>{route.nm} NM · ~{fmtHrs(route.hrs)} at {route.speedKts} kts</span>
                  {!readOnly
                    ? <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
                        <input type="time" value={route.time || ""}
                          onChange={e => onUpdate(route.id, { time: e.target.value })}
                          style={{ ...timeInputStyle, color: route.time ? "#c9a84c" : "#2e4a5e" }} />
                        {route.time && (
                          <button type="button" onClick={() => onUpdate(route.id, { time: "" })}
                            style={{ background: "none", border: "none", color: "#2e4a5e",
                              cursor: "pointer", fontSize: ".75rem", padding: "0 2px", lineHeight: 1 }}>
                            ×
                          </button>
                        )}
                      </div>
                    : route.time
                      ? <span style={{ color: "#c9a84c" }}>{fmtTime(route.time)}</span>
                      : null}
                </div>

                {/* Location display */}
                {(route.startName || route.endName) && (
                  <div style={{ fontSize: ".72rem", color: "#8fb0cc", fontFamily: "sans-serif",
                    marginBottom: ".35rem" }}>
                    {route.startName && route.endName
                      ? `${route.startName} → ${route.endName}`
                      : route.startName || route.endName}
                  </div>
                )}

                {/* Use these values + Download GPX */}
                <div style={{ display: "flex", gap: ".4rem", marginBottom: ".45rem", flexWrap: "wrap" }}>
                  <button type="button" onClick={() => onApplyToDay({ nm: route.nm, hrs: route.hrs })}
                    style={{ ...S.btnGhost, fontSize: ".68rem", padding: ".2rem .55rem" }}>
                    Use these values
                  </button>
                  {routeServerUrl && route.startLat && route.endLat && (
                    <button type="button" onClick={async () => {
                      try {
                        const gpxText = await fetchGpxRoute(routeServerUrl, route.startLat, route.startLng, route.endLat, route.endLng);
                        downloadGpx(gpxText, route.name);
                      } catch { alert("Could not fetch route from server."); }
                    }} style={{ ...S.btnGhost, fontSize: ".68rem", padding: ".2rem .55rem" }}>
                      Download GPX
                    </button>
                  )}
                </div>
              </>
            )}

            {/* Notes inline edit */}
            {editingId === route.id && !readOnly ? (
              <div style={{ marginTop: ".35rem" }}>
                <textarea value={noteDraft} rows={2} autoFocus
                  onChange={e => setNoteDraft(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === "Escape") setEditingId(null);
                    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                      onUpdate(route.id, { notes: noteDraft }); setEditingId(null);
                    }
                  }}
                  style={{ ...S.input, width: "100%", resize: "vertical", minHeight: 48 }} />
                <div style={{ display: "flex", gap: ".4rem", marginTop: ".35rem" }}>
                  <button type="button" onClick={() => { onUpdate(route.id, { notes: noteDraft }); setEditingId(null); }}
                    style={S.btnPrimary}>Save</button>
                  <button type="button" onClick={() => setEditingId(null)} style={S.btnGhost}>Cancel</button>
                </div>
              </div>
            ) : (
              <div onClick={() => !readOnly && (setEditingId(route.id), setNoteDraft(route.notes))}
                style={{ cursor: readOnly ? "default" : "pointer" }}>
                {route.notes
                  ? <NoteMarkdown>{route.notes}</NoteMarkdown>
                  : !readOnly && <span style={{ fontSize: ".78rem", color: "#2e4a5e", fontFamily: "sans-serif",
                      fontStyle: "italic" }}>Add notes…</span>}
              </div>
            )}
          </div>
        </div>
      ))}

      {/* Bottom cap */}
      {(routes.length > 0 || isAdding) && (
        <div style={{ height: 1, background: "#c9a84c22", borderLeft: borderAccent }} />
      )}
    </div>
  );
}
