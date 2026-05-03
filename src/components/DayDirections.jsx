import { useState, useEffect, useRef } from "react";
import NoteMarkdown from "./NoteMarkdown.jsx";
import { setOptions, importLibrary } from "@googlemaps/js-api-loader";
import { loadMapKit, appleAutocomplete, appleFetchDirections,
         appleDirectionsMapsUrl, getStoredProviderSettings } from "../lib/mapkit.js";

// ── Module-level singletons ────────────────────────────────────────────────
let routesPromise      = null;
let appleRoutesPromise = null;

function getStoredMapsKey() {
  try { const s = localStorage.getItem("travelSettings"); return (s ? JSON.parse(s) : {}).googleMapsKey ?? ""; }
  catch { return ""; }
}

function loadRoutes() {
  if (!routesPromise) {
    const key = getStoredMapsKey();
    try { setOptions({ key, version: "weekly" }); } catch {}
    routesPromise = key
      ? Promise.all([importLibrary("places"), importLibrary("routes")])
          .then(([places, routes]) => ({ ...places, ...routes }))
      : Promise.reject(new Error("no-key"));
  }
  return routesPromise;
}

function loadAppleRoutes() {
  if (!appleRoutesPromise) {
    const { appleMapKitToken } = getStoredProviderSettings();
    appleRoutesPromise = loadMapKit(appleMapKitToken);
  }
  return appleRoutesPromise;
}

// ── Helpers ───────────────────────────────────────────────────────────────
const MODES = [
  { key: "DRIVING",   label: "🚗 Drive"   },
  { key: "WALKING",   label: "🚶 Walk"    },
  { key: "BICYCLING", label: "🚴 Cycle"   },
  { key: "TRANSIT",   label: "🚌 Transit" },
];

const TRAVELMODE_PARAM = { DRIVING: "driving", WALKING: "walking", BICYCLING: "bicycling", TRANSIT: "transit" };
const APPLE_MODES = MODES.filter(m => m.key === "DRIVING" || m.key === "WALKING");

function stripHtml(html) { return html.replace(/<[^>]+>/g, ""); }

// ── Style tokens ──────────────────────────────────────────────────────────
const S = {
  input: { width: "100%", background: "#0a1a2a", border: "1px solid #2e5070", color: "#e8dcc8",
    borderRadius: 4, padding: ".4rem .65rem", fontSize: ".82rem", fontFamily: "sans-serif",
    outline: "none", boxSizing: "border-box" },
  btnPrimary: { background: "#1a3352", border: "1px solid #2e5070", color: "#c9a84c",
    borderRadius: 4, padding: ".35rem .8rem", fontSize: ".75rem", fontFamily: "sans-serif",
    cursor: "pointer", whiteSpace: "nowrap" },
  btnGhost: { background: "none", border: "1px solid #2e3a4a", color: "#4e7a9e",
    borderRadius: 4, padding: ".35rem .8rem", fontSize: ".75rem", fontFamily: "sans-serif",
    cursor: "pointer", whiteSpace: "nowrap" },
  label: { fontSize: ".62rem", letterSpacing: ".1em", textTransform: "uppercase", fontFamily: "sans-serif" },
};

const borderAccent = "3px solid #5cb85c66";

// ── Component ─────────────────────────────────────────────────────────────
export default function DayDirections({ directions, onAdd, onUpdate, onDelete, readOnly = false }) {
  const { provider } = getStoredProviderSettings();
  const [apiReady,  setApiReady]  = useState(false);
  const [apiError,  setApiError]  = useState(null);
  const [isAdding,  setIsAdding]  = useState(false);

  // Form state
  const [originQuery,      setOriginQuery]      = useState("");
  const [destQuery,        setDestQuery]        = useState("");
  const [originPreds,      setOriginPreds]      = useState([]);
  const [destPreds,        setDestPreds]        = useState([]);
  const [origin,           setOrigin]           = useState(null); // { name, placeId }
  const [destination,      setDestination]      = useState(null);
  const [travelMode,       setTravelMode]       = useState("DRIVING");
  const [fetching,         setFetching]         = useState(false);
  const [routeError,       setRouteError]       = useState(null);

  // Card state
  const [editingId,  setEditingId]  = useState(null);
  const [noteDraft,  setNoteDraft]  = useState("");
  const [expandedId, setExpandedId] = useState(null);

  const libRef         = useRef(null);
  const originTokenRef = useRef(null);
  const destTokenRef   = useRef(null);
  const debounceOrigin = useRef(null);
  const debounceDest   = useRef(null);

  // ── Load API ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (provider === "apple") {
      const { appleMapKitToken } = getStoredProviderSettings();
      if (!appleMapKitToken) { setApiError("missing-key"); return; }
      loadAppleRoutes()
        .then(mk => { libRef.current = mk; setApiReady(true); })
        .catch(() => setApiError("load-failed"));
    } else {
      if (!getStoredMapsKey()) { setApiError("missing-key"); return; }
      loadRoutes()
        .then(lib => { libRef.current = lib; setApiReady(true); })
        .catch(() => setApiError("load-failed"));
    }
  }, []);

  // Reset travel mode if Apple is active and an unsupported mode is selected
  useEffect(() => {
    if (provider === "apple" && (travelMode === "BICYCLING" || travelMode === "TRANSIT")) {
      setTravelMode("DRIVING");
    }
  }, []);

  // ── Autocomplete ─────────────────────────────────────────────────────
  function openForm() {
    if (!apiReady) return;
    if (provider === "google") {
      const { AutocompleteSessionToken } = libRef.current;
      originTokenRef.current = new AutocompleteSessionToken();
      destTokenRef.current   = new AutocompleteSessionToken();
    }
    setIsAdding(true);
  }

  function resetForm() {
    clearTimeout(debounceOrigin.current);
    clearTimeout(debounceDest.current);
    setIsAdding(false);
    setOriginQuery(""); setDestQuery("");
    setOriginPreds([]); setDestPreds([]);
    setOrigin(null); setDestination(null);
    setRouteError(null);
    originTokenRef.current = null;
    destTokenRef.current   = null;
  }

  function makeSuggestHandler(setQuery, setPreds, tokenRef) {
    return function handleInput(value) {
      setQuery(value);
      setPreds([]);
      if (!value.trim() || !apiReady) return;
      const debounceRef = tokenRef === originTokenRef ? debounceOrigin : debounceDest;
      clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(async () => {
        try {
          if (provider === "apple") {
            const results = await appleAutocomplete(libRef.current, value, null);
            setPreds(results);
          } else {
            const { AutocompleteSuggestion } = libRef.current;
            const { suggestions } = await AutocompleteSuggestion.fetchAutocompleteSuggestions({
              input: value,
              sessionToken: tokenRef.current,
            });
            setPreds(
              suggestions.filter(s => s.placePrediction).slice(0, 5).map(s => ({
                name:     s.placePrediction.mainText.text,
                subtitle: s.placePrediction.secondaryText?.text ?? "",
                _data:    s,
              }))
            );
          }
        } catch { setPreds([]); }
      }, 350);
    };
  }

  const handleOriginInput = makeSuggestHandler(setOriginQuery, setOriginPreds, originTokenRef);
  const handleDestInput   = makeSuggestHandler(setDestQuery,   setDestPreds,   destTokenRef);

  function selectOrigin(pred) {
    setOrigin({ name: pred.name, _data: pred._data });
    setOriginQuery(pred.name);
    setOriginPreds([]);
  }

  function selectDest(pred) {
    setDestination({ name: pred.name, _data: pred._data });
    setDestQuery(pred.name);
    setDestPreds([]);
  }

  // ── Fetch Directions ─────────────────────────────────────────────────
  async function fetchDirections() {
    if (!origin || !destination) return;
    setFetching(true);
    setRouteError(null);
    try {
      if (provider === "apple") {
        const result = await appleFetchDirections(
          libRef.current, origin._data, destination._data, travelMode
        );
        onAdd({
          id:          crypto.randomUUID(),
          origin:      { name: origin.name },
          destination: { name: destination.name },
          travelMode,
          ...result,
          notes:        "",
          addedAt:      new Date().toISOString(),
          mapsProvider: "apple",
        });
      } else {
        const { DirectionsService, TravelMode } = libRef.current;
        const result = await new DirectionsService().route({
          origin:      { placeId: origin._data?.placePrediction?.placeId },
          destination: { placeId: destination._data?.placePrediction?.placeId },
          travelMode:  TravelMode[travelMode],
        });
        const leg   = result.routes[0].legs[0];
        const route = result.routes[0];
        onAdd({
          id:             crypto.randomUUID(),
          origin:         { name: origin.name, placeId: origin._data?.placePrediction?.placeId },
          destination:    { name: destination.name, placeId: destination._data?.placePrediction?.placeId },
          travelMode,
          distance:       leg.distance.text,
          duration:       leg.duration.text,
          summary:        route.summary || "",
          originLat:      leg.start_location.lat(),
          originLng:      leg.start_location.lng(),
          destinationLat: leg.end_location.lat(),
          destinationLng: leg.end_location.lng(),
          overviewPolyline: route.overview_polyline?.points ?? null,
          steps:          leg.steps.map(s => ({
                            instruction: stripHtml(s.instructions),
                            distance:    s.distance?.text ?? "",
                            duration:    s.duration?.text ?? "",
                          })),
          notes:        "",
          addedAt:      new Date().toISOString(),
          mapsProvider: "google",
        });
      }
      resetForm();
    } catch {
      setRouteError("Could not get directions — check that both locations are valid.");
    } finally {
      setFetching(false);
    }
  }

  if (readOnly && directions.length === 0) return null;

  // ── Derived ──────────────────────────────────────────────────────────
  const canFetch = origin && destination && !fetching;

  // ── Render helpers ───────────────────────────────────────────────────
  function Predictions({ preds, onSelect }) {
    if (!preds.length) return null;
    return (
      <div style={{ marginTop: ".3rem", border: "1px solid #2e5070", borderRadius: 4,
        background: "#0d1f33", overflow: "hidden" }}>
        {preds.map((pred, i) => (
          <div key={i} onClick={() => onSelect(pred)}
            style={{ padding: ".45rem .65rem", cursor: "pointer",
              borderBottom: i < preds.length - 1 ? "1px solid #1e3a5230" : "none",
              fontFamily: "sans-serif" }}
            onMouseEnter={e => e.currentTarget.style.background = "#1a3352"}
            onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
            <div style={{ fontSize: ".82rem", color: "#e8dcc8" }}>{pred.name}</div>
            <div style={{ fontSize: ".72rem", color: "#4e7a9e", marginTop: 1 }}>{pred.subtitle}</div>
          </div>
        ))}
      </div>
    );
  }

  // ── JSX ──────────────────────────────────────────────────────────────
  return (
    <div style={{ marginTop: "1rem" }}>

      {/* Section header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
        padding: ".75rem 1rem", background: "#0a1a2a", borderLeft: borderAccent,
        borderRadius: "0 4px 0 0" }}>
        <div style={{ display: "flex", alignItems: "center", gap: ".5rem" }}>
          <span style={{ ...S.label, color: "#5cb85c" }}>Directions</span>
          {directions.length > 0 && (
            <span style={{ background: "#5cb85c22", color: "#5cb85c", border: "1px solid #5cb85c44",
              borderRadius: 10, padding: "1px 7px", fontSize: ".6rem", fontFamily: "sans-serif" }}>
              {directions.length}
            </span>
          )}
        </div>
        {!isAdding && !apiError && !readOnly && (
          <button onClick={openForm} disabled={!apiReady}
            style={{ ...S.btnGhost, opacity: apiReady ? 1 : 0.45,
              fontSize: ".7rem", padding: ".25rem .65rem" }}>
            {apiReady ? "+ Add Directions" : "Loading…"}
          </button>
        )}
        {isAdding && (
          <button onClick={resetForm}
            style={{ ...S.btnGhost, fontSize: ".7rem", padding: ".25rem .65rem" }}>
            Cancel
          </button>
        )}
      </div>

      {/* API error */}
      {apiError && (
        <div style={{ padding: ".6rem 1rem", background: "#0a1a2a", borderLeft: borderAccent,
          fontSize: ".75rem", color: "#4e7a9e", fontFamily: "sans-serif" }}>
          {apiError === "missing-key"
            ? provider === "apple"
              ? "Configure your Apple MapKit JS token in Settings (⚙) to add directions."
              : "Configure your Google Maps API key in Settings (⚙) to add directions."
            : provider === "apple"
              ? "Apple Maps failed to load — check your MapKit JS token in Settings (⚙)."
              : "Google Maps failed to load — check your API key in Settings (⚙)."}
        </div>
      )}

      {/* Add form */}
      {isAdding && (
        <div style={{ background: "#0a1a2a", borderLeft: borderAccent, padding: ".75rem 1rem" }}>

          {/* From */}
          <div style={{ marginBottom: ".5rem" }}>
            <div style={{ ...S.label, color: "#6b8fa8", marginBottom: 3 }}>From</div>
            <input autoFocus value={originQuery}
              onChange={e => { setOrigin(null); handleOriginInput(e.target.value); }}
              onKeyDown={e => e.key === "Escape" && resetForm()}
              placeholder="Starting location…"
              style={{ ...S.input, borderColor: origin ? "#5cb85c66" : "#2e5070" }} />
            <Predictions preds={originPreds} onSelect={selectOrigin} />
          </div>

          {/* To */}
          <div style={{ marginBottom: ".65rem" }}>
            <div style={{ ...S.label, color: "#6b8fa8", marginBottom: 3 }}>To</div>
            <input value={destQuery}
              onChange={e => { setDestination(null); handleDestInput(e.target.value); }}
              onKeyDown={e => e.key === "Escape" && resetForm()}
              placeholder="Destination…"
              style={{ ...S.input, borderColor: destination ? "#5cb85c66" : "#2e5070" }} />
            <Predictions preds={destPreds} onSelect={selectDest} />
          </div>

          {/* Travel mode */}
          <div style={{ display: "flex", gap: ".35rem", marginBottom: ".75rem", flexWrap: "wrap" }}>
            {(provider === "apple" ? APPLE_MODES : MODES).map(m => (
              <button key={m.key} onClick={() => setTravelMode(m.key)}
                style={{ background: travelMode === m.key ? "#1a3352" : "none",
                  border: `1px solid ${travelMode === m.key ? "#5cb85c66" : "#2e3a4a"}`,
                  color: travelMode === m.key ? "#5cb85c" : "#4e7a9e",
                  borderRadius: 4, padding: ".25rem .65rem", fontSize: ".72rem",
                  fontFamily: "sans-serif", cursor: "pointer" }}>
                {m.label}
              </button>
            ))}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: ".5rem" }}>
            <button onClick={fetchDirections} disabled={!canFetch}
              style={{ ...S.btnPrimary, opacity: canFetch ? 1 : 0.45 }}>
              {fetching ? "Getting directions…" : "Get Directions"}
            </button>
            {routeError && (
              <span style={{ fontSize: ".72rem", color: "#e87878", fontFamily: "sans-serif" }}>
                {routeError}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Direction cards */}
      {directions.map(dir => {
        const modeLabel = MODES.find(m => m.key === dir.travelMode)?.label ?? dir.travelMode;
        const mapsUrl = (dir.mapsProvider ?? "google") === "apple"
          ? appleDirectionsMapsUrl(dir)
          : `https://www.google.com/maps/dir/?api=1` +
            `&origin=${encodeURIComponent(dir.origin.name)}` +
            `&destination=${encodeURIComponent(dir.destination.name)}` +
            `&travelmode=${TRAVELMODE_PARAM[dir.travelMode] ?? "driving"}`;
        const isExpanded = expandedId === dir.id;

        return (
          <div key={dir.id} style={{ borderLeft: borderAccent, background: "#0a1a2a" }}>
            <div style={{ padding: ".65rem 1rem", borderTop: "1px solid #1e3a5230" }}>

              {/* Header row */}
              <div style={{ display: "flex", justifyContent: "space-between",
                alignItems: "flex-start", gap: ".5rem", marginBottom: ".3rem" }}>
                <span style={{ fontSize: ".85rem", color: "#e8dcc8", fontFamily: "sans-serif",
                  fontWeight: 600, lineHeight: 1.3, flex: 1 }}>
                  {modeLabel} &nbsp;
                  <span style={{ fontWeight: 400, color: "#c8daea" }}>
                    {dir.origin.name} → {dir.destination.name}
                  </span>
                </span>
                <div style={{ display: "flex", gap: ".5rem", flexShrink: 0, alignItems: "center" }}>
                  <a href={mapsUrl} target="_blank" rel="noopener noreferrer"
                    style={{ fontSize: ".7rem", color: "#5cb85c", fontFamily: "sans-serif",
                      textDecoration: "none" }}>
                    Maps ↗
                  </a>
                  {!readOnly && (
                    <button onClick={() => onDelete(dir.id)}
                      style={{ background: "none", border: "none", color: "#3d6050",
                        cursor: "pointer", fontSize: ".85rem", lineHeight: 1, padding: 0 }}>
                      ×
                    </button>
                  )}
                </div>
              </div>

              {/* Summary row */}
              <div style={{ fontSize: ".75rem", color: "#4e7a9e", fontFamily: "sans-serif",
                marginBottom: ".4rem" }}>
                {dir.summary && <span>{dir.summary} · </span>}
                <span>{dir.distance}</span>
                {dir.duration && <span> · {dir.duration}</span>}
              </div>

              {/* Steps toggle */}
              {dir.steps?.length > 0 && (
                <>
                  <button onClick={() => setExpandedId(isExpanded ? null : dir.id)}
                    style={{ background: "none", border: "none", color: "#4e7a9e",
                      cursor: "pointer", fontSize: ".72rem", fontFamily: "sans-serif",
                      padding: 0, marginBottom: isExpanded ? ".5rem" : ".35rem" }}>
                    {isExpanded ? "Hide steps ▴" : `Show steps ▾ (${dir.steps.length})`}
                  </button>
                  {isExpanded && (
                    <ol style={{ margin: "0 0 .4rem", padding: "0 0 0 1.25rem" }}>
                      {dir.steps.map((step, i) => (
                        <li key={i} style={{ fontSize: ".75rem", color: "#8fb0cc",
                          fontFamily: "sans-serif", lineHeight: 1.5, marginBottom: ".2rem" }}>
                          {step.instruction}
                          {(step.distance || step.duration) && (
                            <span style={{ color: "#4e7a9e", marginLeft: ".4rem" }}>
                              {[step.distance, step.duration].filter(Boolean).join(" · ")}
                            </span>
                          )}
                        </li>
                      ))}
                    </ol>
                  )}
                </>
              )}

              {/* Notes */}
              {editingId === dir.id && !readOnly ? (
                <div style={{ marginTop: ".4rem" }}>
                  <textarea value={noteDraft} rows={2} autoFocus
                    onChange={e => setNoteDraft(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === "Escape") setEditingId(null);
                      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                        onUpdate(dir.id, { notes: noteDraft }); setEditingId(null);
                      }
                    }}
                    style={{ ...S.input, resize: "vertical", minHeight: 48 }} />
                  <div style={{ display: "flex", gap: ".4rem", marginTop: ".35rem" }}>
                    <button onClick={() => { onUpdate(dir.id, { notes: noteDraft }); setEditingId(null); }}
                      style={S.btnPrimary}>Save</button>
                    <button onClick={() => setEditingId(null)} style={S.btnGhost}>Cancel</button>
                  </div>
                </div>
              ) : (
                <div onClick={() => !readOnly && (setEditingId(dir.id), setNoteDraft(dir.notes))}
                  style={{ marginTop: ".35rem", cursor: readOnly ? "default" : "pointer" }}>
                  {dir.notes
                    ? <NoteMarkdown>{dir.notes}</NoteMarkdown>
                    : !readOnly && <span style={{ fontSize:".78rem", color:"#2e4a5e", fontFamily:"sans-serif", fontStyle:"italic" }}>Add notes…</span>}
                </div>
              )}
            </div>
          </div>
        );
      })}

      {/* Bottom cap */}
      {(directions.length > 0 || isAdding || apiError) && (
        <div style={{ height: 1, background: "#5cb85c22", borderLeft: borderAccent }} />
      )}
    </div>
  );
}
