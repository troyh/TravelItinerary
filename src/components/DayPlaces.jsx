import { useState, useEffect, useRef } from "react";
import NoteMarkdown from "./NoteMarkdown.jsx";
import { setOptions, importLibrary } from "@googlemaps/js-api-loader";
import { loadMapKit, appleAutocomplete, appleFetchPlaceDetails,
         applePlaceMapsUrl, getStoredProviderSettings } from "../lib/mapkit.js";

// ── Module-level singletons ──────────────────────────────────────────────────
let placesPromise = null;
let applePromise  = null;

function getStoredMapsKey() {
  try { const s = localStorage.getItem("travelSettings"); return (s ? JSON.parse(s) : {}).googleMapsKey ?? ""; }
  catch { return ""; }
}

function loadPlaces() {
  if (!placesPromise) {
    const key = getStoredMapsKey();
    setOptions({ key, version: "weekly" });
    placesPromise = key ? importLibrary("places") : Promise.reject(new Error("no-key"));
  }
  return placesPromise;
}

function loadAppleMaps() {
  if (!applePromise) {
    const { appleMapKitToken } = getStoredProviderSettings();
    applePromise = loadMapKit(appleMapKitToken);
  }
  return applePromise;
}

// ── Constants ────────────────────────────────────────────────────────────────
export const CATEGORIES = [
  { key: "restaurant",    label: "Restaurants",      color: "#e83870" },
  { key: "marina",        label: "Marinas & Fuel",   color: "#4a9eff" },
  { key: "accommodation", label: "Hotels & Lodging", color: "#8338e8" },
  { key: "provisioning",  label: "Provisioning",     color: "#38a8e8" },
  { key: "activity",      label: "Activities",       color: "#5cb85c" },
  { key: "other",         label: "Other",            color: "#6b8fa8" },
];

// Location bias: central Salish Sea / Victoria BC
const LOCATION_LAT = 48.4284;
const LOCATION_LNG = -123.3656;
const BIAS_RADIUS_M = 500_000;

const PLACE_TYPE_MAP = {
  restaurant: "restaurant", food: "restaurant", cafe: "restaurant",
  bar: "restaurant", meal_takeaway: "restaurant", meal_delivery: "restaurant",
  marina: "marina", boat_slip: "marina", gas_station: "marina",
  lodging: "accommodation",
  grocery_or_supermarket: "provisioning", supermarket: "provisioning",
  convenience_store: "provisioning",
};

function detectCategory(types = []) {
  for (const t of types) if (PLACE_TYPE_MAP[t]) return PLACE_TYPE_MAP[t];
  return "other";
}

// ── Component ────────────────────────────────────────────────────────────────
export default function DayPlaces({ dayNum, places, onAdd, onUpdate, onDelete, readOnly = false }) {
  const { provider } = getStoredProviderSettings();
  // Maps API lifecycle
  const [apiReady, setApiReady] = useState(false);
  const [apiError, setApiError] = useState(null); // null | "missing-key" | "load-failed"
  const placesLibRef    = useRef(null); // resolved places library
  const sessionTokenRef = useRef(null);
  const debounceRef     = useRef(null);

  // Search panel
  const [isSearching, setIsSearching]               = useState(false);
  const [searchQuery, setSearchQuery]               = useState("");
  const [predictions, setPredictions]               = useState([]);
  const [loadingPredictions, setLoadingPredictions] = useState(false);
  const [pendingPlace, setPendingPlace]             = useState(null);

  // Saved-place edit
  const [editingId, setEditingId] = useState(null);
  const [noteDraft, setNoteDraft] = useState("");

  // Display filter
  const [activeFilter, setActiveFilter] = useState("all");

  // ── Load Maps library once ────────────────────────────────────────────────
  useEffect(() => {
    if (provider === "apple") {
      const { appleMapKitToken } = getStoredProviderSettings();
      if (!appleMapKitToken) { setApiError("missing-key"); return; }
      loadAppleMaps()
        .then(mk => { placesLibRef.current = mk; setApiReady(true); })
        .catch(() => setApiError("load-failed"));
    } else {
      const key = getStoredMapsKey();
      if (!key) { setApiError("missing-key"); return; }
      loadPlaces()
        .then(lib => {
          placesLibRef.current = lib;
          window.gm_authFailure = () => setApiError("load-failed");
          setApiReady(true);
        })
        .catch(() => setApiError("load-failed"));
    }
  }, []);

  // ── Search helpers ────────────────────────────────────────────────────────
  function openSearch() {
    if (provider === "google") {
      const { AutocompleteSessionToken } = placesLibRef.current;
      sessionTokenRef.current = new AutocompleteSessionToken();
    }
    setIsSearching(true);
  }

  function resetSearch() {
    clearTimeout(debounceRef.current);
    setIsSearching(false);
    setSearchQuery("");
    setPredictions([]);
    setPendingPlace(null);
    sessionTokenRef.current = null;
  }

  function handleSearchInput(value) {
    setSearchQuery(value);
    setPredictions([]);
    setPendingPlace(null);
    clearTimeout(debounceRef.current);
    if (!value.trim() || !apiReady) return;
    setLoadingPredictions(true);
    debounceRef.current = setTimeout(async () => {
      try {
        if (provider === "apple") {
          const results = await appleAutocomplete(
            placesLibRef.current, value, { lat: LOCATION_LAT, lng: LOCATION_LNG }
          );
          setLoadingPredictions(false);
          setPredictions(results);
        } else {
          const { AutocompleteSuggestion } = placesLibRef.current;
          const { suggestions } = await AutocompleteSuggestion.fetchAutocompleteSuggestions({
            input: value,
            sessionToken: sessionTokenRef.current,
            locationBias: { lat: LOCATION_LAT, lng: LOCATION_LNG },
          });
          setLoadingPredictions(false);
          setPredictions(
            suggestions.filter(s => s.placePrediction).slice(0, 5).map(s => ({
              name:     s.placePrediction.mainText.text,
              subtitle: s.placePrediction.secondaryText?.text ?? "",
              _data:    s,
            }))
          );
        }
      } catch {
        setLoadingPredictions(false);
      }
    }, 350);
  }

  async function selectPrediction(pred) {
    setPredictions([]);
    setSearchQuery(pred.name);
    setLoadingPredictions(true);
    try {
      if (provider === "apple") {
        const details = await appleFetchPlaceDetails(placesLibRef.current, pred._data);
        sessionTokenRef.current = null;
        setLoadingPredictions(false);
        setPendingPlace({
          id: crypto.randomUUID(),
          name: details.name,
          address: details.address,
          phone: "",
          website: "",
          placeId: details.placeId,
          category: details.category,
          lat: details.lat ?? null,
          lng: details.lng ?? null,
          notes: "",
          addedAt: new Date().toISOString(),
          mapsProvider: "apple",
        });
      } else {
        const place = pred._data.placePrediction.toPlace();
        await place.fetchFields({
          fields: ["displayName", "formattedAddress", "nationalPhoneNumber", "websiteURI", "id", "types", "location"],
        });
        sessionTokenRef.current = null;
        setLoadingPredictions(false);
        setPendingPlace({
          id: crypto.randomUUID(),
          name: place.displayName ?? "",
          address: place.formattedAddress ?? "",
          phone: place.nationalPhoneNumber ?? "",
          website: place.websiteURI ?? "",
          placeId: place.id ?? "",
          category: detectCategory(place.types ?? []),
          lat: place.location?.lat() ?? null,
          lng: place.location?.lng() ?? null,
          notes: "",
          addedAt: new Date().toISOString(),
          mapsProvider: "google",
        });
      }
    } catch {
      setLoadingPredictions(false);
    }
  }

  function handleSave() {
    if (!pendingPlace?.name.trim()) return;
    onAdd(pendingPlace);
    resetSearch();
  }

  // ── Derived ───────────────────────────────────────────────────────────────
  const usedCategoryKeys = [...new Set(places.map(p => p.category))];
  const visibleCategories = CATEGORIES.filter(c =>
    places.some(p => p.category === c.key) &&
    (activeFilter === "all" || activeFilter === c.key)
  );

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
    sectionLabel: { fontSize: ".62rem", letterSpacing: ".1em", textTransform: "uppercase",
      fontFamily: "sans-serif" },
  };

  const borderAccent = "3px solid #4a9eff66";

  if (readOnly && places.length === 0) return null;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ marginTop: "1rem" }}>
      {/* ── Section header ── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
        padding: ".75rem 1rem", background: "#0a1a2a", borderLeft: borderAccent,
        borderRadius: "0 4px 0 0" }}>
        <div style={{ display: "flex", alignItems: "center", gap: ".5rem" }}>
          <span style={{ ...S.sectionLabel, color: "#4a9eff" }}>Places</span>
          {places.length > 0 && (
            <span style={{ background: "#4a9eff22", color: "#4a9eff", border: "1px solid #4a9eff44",
              borderRadius: 10, padding: "1px 7px", fontSize: ".6rem", fontFamily: "sans-serif" }}>
              {places.length}
            </span>
          )}
        </div>
        {!isSearching && !apiError && !readOnly && (
          <button onClick={openSearch} disabled={!apiReady}
            style={{ ...S.btnGhost, opacity: apiReady ? 1 : 0.45, fontSize: ".7rem",
              padding: ".25rem .65rem" }}>
            {apiReady ? "+ Add Place" : "Loading…"}
          </button>
        )}
        {isSearching && (
          <button onClick={resetSearch}
            style={{ ...S.btnGhost, fontSize: ".7rem", padding: ".25rem .65rem" }}>
            Cancel
          </button>
        )}
      </div>

      {/* ── API error banner ── */}
      {apiError && (
        <div style={{ padding: ".6rem 1rem", background: "#0a1a2a", borderLeft: borderAccent,
          fontSize: ".75rem", color: "#4e7a9e", fontFamily: "sans-serif" }}>
          {apiError === "missing-key"
            ? provider === "apple"
              ? "Configure your Apple MapKit JS token in Settings (⚙) to enable place search."
              : "Configure your Google Maps API key in Settings (⚙) to enable place search."
            : provider === "apple"
              ? "Apple Maps failed to load — check your MapKit JS token in Settings (⚙)."
              : "Google Maps failed to load — check your API key in Settings (⚙)."}
        </div>
      )}

      {/* ── Search panel ── */}
      {isSearching && (
        <div style={{ background: "#0a1a2a", borderLeft: borderAccent, padding: ".75rem 1rem" }}>
          <input
            autoFocus
            value={searchQuery}
            onChange={e => handleSearchInput(e.target.value)}
            onKeyDown={e => e.key === "Escape" && resetSearch()}
            placeholder="Search for a restaurant, marina, hotel…"
            style={S.input}
          />

          {/* Predictions dropdown */}
          {(predictions.length > 0 || loadingPredictions) && (
            <div style={{ marginTop: ".35rem", border: "1px solid #2e5070", borderRadius: 4,
              background: "#0d1f33", overflow: "hidden" }}>
              {loadingPredictions && predictions.length === 0 && (
                <div style={{ padding: ".5rem .75rem", fontSize: ".78rem", color: "#4e7a9e",
                  fontFamily: "sans-serif" }}>Searching…</div>
              )}
              {predictions.map((pred, i) => (
                <div key={i} onClick={() => selectPrediction(pred)}
                  style={{ padding: ".5rem .75rem", cursor: "pointer",
                    borderBottom: "1px solid #1e3a5230", fontFamily: "sans-serif" }}
                  onMouseEnter={e => e.currentTarget.style.background = "#1a3352"}
                  onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                  <div style={{ fontSize: ".83rem", color: "#e8dcc8" }}>{pred.name}</div>
                  <div style={{ fontSize: ".72rem", color: "#4e7a9e", marginTop: 1 }}>{pred.subtitle}</div>
                </div>
              ))}
            </div>
          )}

          {/* Pre-fill form — shown after place details are fetched */}
          {pendingPlace && (
            <div style={{ marginTop: ".75rem", display: "flex", flexDirection: "column", gap: ".5rem" }}>
              <div style={{ display: "flex", gap: ".5rem" }}>
                <div style={{ flex: 1 }}>
                  <div style={{ ...S.sectionLabel, color: "#6b8fa8", marginBottom: 3 }}>Name</div>
                  <input value={pendingPlace.name}
                    onChange={e => setPendingPlace(p => ({ ...p, name: e.target.value }))}
                    style={S.input} />
                </div>
                <div style={{ width: 160 }}>
                  <div style={{ ...S.sectionLabel, color: "#6b8fa8", marginBottom: 3 }}>Category</div>
                  <select value={pendingPlace.category}
                    onChange={e => setPendingPlace(p => ({ ...p, category: e.target.value }))}
                    style={{ ...S.input, cursor: "pointer" }}>
                    {CATEGORIES.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <div style={{ ...S.sectionLabel, color: "#6b8fa8", marginBottom: 3 }}>Address</div>
                <div style={{ fontSize: ".78rem", color: "#6b8fa8", fontFamily: "sans-serif",
                  padding: ".35rem .65rem", background: "#071218", borderRadius: 4,
                  border: "1px solid #1e3040" }}>
                  {pendingPlace.address || "—"}
                </div>
                {provider === "apple" && (
                  <div style={{ fontSize: ".68rem", color: "#3d5060", fontFamily: "sans-serif",
                    fontStyle: "italic", marginTop: 4 }}>
                    Phone and website not available from Apple Maps — add manually in notes.
                  </div>
                )}
              </div>

              <div>
                <div style={{ ...S.sectionLabel, color: "#6b8fa8", marginBottom: 3 }}>Notes</div>
                <textarea value={pendingPlace.notes}
                  onChange={e => setPendingPlace(p => ({ ...p, notes: e.target.value }))}
                  placeholder="Reservation confirmation, hours, contact details…"
                  rows={3}
                  style={{ ...S.input, resize: "vertical", minHeight: 60 }} />
              </div>

              <div style={{ display: "flex", gap: ".5rem" }}>
                <button onClick={handleSave} style={S.btnPrimary}>Save</button>
                <button onClick={resetSearch} style={S.btnGhost}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Category filter pills (only when 2+ categories in use) ── */}
      {places.length > 0 && usedCategoryKeys.length > 1 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5, padding: ".5rem 1rem",
          background: "#071520", borderLeft: borderAccent }}>
          {[{ key: "all", label: "All", color: "#6b8fa8" },
            ...CATEGORIES.filter(c => usedCategoryKeys.includes(c.key))
          ].map(c => (
            <button key={c.key} onClick={() => setActiveFilter(c.key)}
              style={{ background: activeFilter === c.key ? c.color + "33" : "transparent",
                border: `1px solid ${activeFilter === c.key ? c.color : c.color + "44"}`,
                color: activeFilter === c.key ? c.color : c.color + "99",
                borderRadius: 10, padding: "2px 9px", fontSize: ".62rem", letterSpacing: ".07em",
                fontFamily: "sans-serif", cursor: "pointer", textTransform: "uppercase" }}>
              {c.label}
            </button>
          ))}
        </div>
      )}

      {/* ── Saved places grouped by category ── */}
      {visibleCategories.map(cat => (
        <div key={cat.key} style={{ borderLeft: borderAccent, background: "#0a1a2a" }}>
          <div style={{ ...S.sectionLabel, color: cat.color, padding: ".45rem 1rem .3rem",
            display: "flex", alignItems: "center", gap: ".4rem" }}>
            <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%",
              background: cat.color, flexShrink: 0 }} />
            {cat.label}
          </div>

          {places.filter(p => p.category === cat.key).map((place, idx, arr) => (
            <div key={place.id}
              style={{ padding: ".65rem 1rem",
                borderTop: "1px solid #1e3a5230",
                borderBottom: idx < arr.length - 1 ? "1px solid #1e3a5220" : "none" }}>

              <div style={{ display: "flex", justifyContent: "space-between",
                alignItems: "flex-start", gap: ".5rem" }}>
                <span style={{ fontSize: ".88rem", color: "#e8dcc8", fontFamily: "sans-serif",
                  fontWeight: 600, lineHeight: 1.3 }}>
                  {place.name}
                </span>
                <div style={{ display: "flex", gap: ".5rem", flexShrink: 0, alignItems: "center" }}>
                  {place.placeId && (
                    <a href={
                        (place.mapsProvider ?? "google") === "apple"
                          ? applePlaceMapsUrl(place)
                          : `https://www.google.com/maps/place/?q=place_id:${place.placeId}`
                      }
                      target="_blank" rel="noopener noreferrer"
                      style={{ fontSize: ".7rem", color: "#4a9eff", fontFamily: "sans-serif",
                        textDecoration: "none" }}>
                      Maps ↗
                    </a>
                  )}
                  {!readOnly && (
                    <button onClick={() => onDelete(place.id)}
                      style={{ background: "none", border: "none", color: "#3d5060",
                        cursor: "pointer", fontSize: ".85rem", lineHeight: 1, padding: 0 }}>
                      ×
                    </button>
                  )}
                </div>
              </div>

              {place.address && (
                <div style={{ fontSize: ".75rem", color: "#4e7a9e", fontFamily: "sans-serif",
                  marginTop: 2 }}>
                  {place.address}
                </div>
              )}

              <div style={{ display: "flex", gap: "1rem",
                marginTop: place.phone || place.website ? 4 : 0 }}>
                {place.phone && (
                  <a href={`tel:${place.phone}`}
                    style={{ fontSize: ".75rem", color: "#6b8fa8", fontFamily: "sans-serif",
                      textDecoration: "none" }}>
                    {place.phone}
                  </a>
                )}
                {place.website && (
                  <a href={place.website} target="_blank" rel="noopener noreferrer"
                    style={{ fontSize: ".75rem", color: "#6b8fa8", fontFamily: "sans-serif",
                      textDecoration: "none", overflow: "hidden", textOverflow: "ellipsis",
                      whiteSpace: "nowrap", maxWidth: 260 }}>
                    {place.website.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                  </a>
                )}
              </div>

              {/* Notes — click to edit inline */}
              {editingId === place.id && !readOnly ? (
                <div style={{ marginTop: ".5rem" }}>
                  <textarea value={noteDraft} rows={3} autoFocus
                    onChange={e => setNoteDraft(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === "Escape") setEditingId(null);
                      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                        onUpdate(place.id, { notes: noteDraft });
                        setEditingId(null);
                      }
                    }}
                    style={{ ...S.input, resize: "vertical", minHeight: 56 }} />
                  <div style={{ display: "flex", gap: ".4rem", marginTop: ".4rem" }}>
                    <button onClick={() => { onUpdate(place.id, { notes: noteDraft }); setEditingId(null); }}
                      style={S.btnPrimary}>Save</button>
                    <button onClick={() => setEditingId(null)} style={S.btnGhost}>Cancel</button>
                  </div>
                </div>
              ) : (
                <div onClick={() => !readOnly && (setEditingId(place.id), setNoteDraft(place.notes))}
                  style={{ marginTop: ".45rem", cursor: readOnly ? "default" : "pointer" }}>
                  {place.notes
                    ? <NoteMarkdown>{place.notes}</NoteMarkdown>
                    : !readOnly && <span style={{ fontSize:".8rem", color:"#2e4a5e", fontFamily:"sans-serif", fontStyle:"italic" }}>Add notes…</span>}
                </div>
              )}
            </div>
          ))}
        </div>
      ))}

      {/* Bottom cap */}
      {(places.length > 0 || isSearching || apiError) && (
        <div style={{ height: 1, background: "#4a9eff22", borderLeft: borderAccent }} />
      )}
    </div>
  );
}
