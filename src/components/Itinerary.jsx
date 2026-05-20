import React, { useState, useEffect, useRef } from "react";
import NoteMarkdown from "./NoteMarkdown.jsx";
import { days as initialDays, tagConfig, fuelStops, fuelSummary, tideWarnings } from "../data/itinerary.js";
import DayPlaces, { CATEGORIES as PLACE_CATEGORIES } from "./DayPlaces.jsx";
import DayDirections from "./DayDirections.jsx";
import DayRoute from "./DayRoute.jsx";
import DayFlights from "./DayFlights.jsx";
import DayRentalCar from "./DayRentalCar.jsx";
import ClaudePrompt from "./ClaudePrompt.jsx";
import ItineraryMap from "./ItineraryMap.jsx";
import Settings from "./Settings.jsx";
import { loadFromGitHub, saveToGitHub, deleteFromGitHub, ITINERARIES_FOLDER, inferRepo } from "../lib/github.js";
import ItineraryPicker from "./ItineraryPicker.jsx";
import HistoryPanel from "./HistoryPanel.jsx";
import TravelRouteMap from "./TravelRouteMap.jsx";
import { setOptions, importLibrary } from "@googlemaps/js-api-loader";
import { loadMapKit, appleAutocomplete, appleFetchPlaceDetails, appleFetchDirections, getStoredProviderSettings } from "../lib/mapkit.js";

// ── Location autocomplete singletons ──────────────────────────────────────────
let locGooglePromise = null;
let locApplePromise  = null;

function loadLocGoogle() {
  if (!locGooglePromise) {
    try { const s = localStorage.getItem("travelSettings"); const k = (s ? JSON.parse(s) : {}).googleMapsKey ?? ""; setOptions({ key: k, version: "weekly" }); locGooglePromise = k ? importLibrary("places") : Promise.reject(new Error("no-key")); } catch { locGooglePromise = Promise.reject(new Error("no-key")); }
  }
  return locGooglePromise;
}
function loadLocApple() {
  if (!locApplePromise) { const { appleMapKitToken } = getStoredProviderSettings(); locApplePromise = loadMapKit(appleMapKitToken); }
  return locApplePromise;
}

function sanitizeFilename(name) {
  return name.trim().replace(/[^\w\s-]/g, "").replace(/\s+/g, " ").trim().slice(0, 80);
}

// Migrate old scattered keys → single travelItinerary key, or return null for fresh start
const _db = (() => {
  try {
    const s = localStorage.getItem("travelItinerary");
    if (s) return JSON.parse(s);
    const oldKeys = ["travelDays","travelPlaces","travelHighlights","travelNotes","travelStartDate","travelOpenDay"];
    if (!oldKeys.some(k => localStorage.getItem(k) !== null)) return null;
    const dy = localStorage.getItem("travelDays");
    const migrated = {
      days:       (() => { try { const p = JSON.parse(dy); return Array.isArray(p) && p.length > 0 && typeof p[0].day === "number" ? p : null; } catch { return null; } })(),
      places:     (() => { try { return JSON.parse(localStorage.getItem("travelPlaces"))     ?? {}; } catch { return {}; } })(),
      highlights: (() => { try { return JSON.parse(localStorage.getItem("travelHighlights")) ?? {}; } catch { return {}; } })(),
      notes:      (() => { try { return JSON.parse(localStorage.getItem("travelNotes"))      ?? {}; } catch { return {}; } })(),
      startDate:  localStorage.getItem("travelStartDate") ?? "",
      openDay:    null,
    };
    localStorage.setItem("travelItinerary", JSON.stringify(migrated));
    oldKeys.forEach(k => localStorage.removeItem(k));
    return migrated;
  } catch { return null; }
})();

// Handles both old format (top-level keyed dicts) and new format (per-day arrays embedded in each day).
function extractPerDayState(data) {
  if (!data) return { days: [], places: {}, directions: {}, routes: {}, flights: {}, rentalCars: {}, highlights: {}, notes: {} };
  const rawDays = data.days ?? [];
  if ("places" in data || "directions" in data) {
    // Old format: top-level keyed dicts
    return {
      days:       rawDays.map((d, i) => ({ day: i + 1, ...d })),
      places:     data.places     ?? {},
      directions: data.directions ?? {},
      routes:     data.routes     ?? {},
      flights:    data.flights    ?? {},
      rentalCars: data.rentalCars ?? {},
      highlights: data.highlights ?? {},
      notes:      data.notes      ?? {},
    };
  }
  // New format: per-day data embedded; `day` derived from array position if absent
  const daysArr = rawDays.map((d, i) => ({ day: i + 1, ...d }));
  return {
    days: daysArr.map(({ places, directions, routes, flights, rentalCars, highlights: _h, note: _n, ...rest }) => ({
      ...rest, highlights: [], note: "", centerName: rest.centerName ?? "", centerLat: rest.centerLat ?? null, centerLng: rest.centerLng ?? null,
    })),
    places:     Object.fromEntries(daysArr.map(d => [String(d.day), d.places     ?? []])),
    directions: Object.fromEntries(daysArr.map(d => [String(d.day), d.directions ?? []])),
    routes:     Object.fromEntries(daysArr.map(d => [String(d.day), d.routes     ?? []])),
    flights:    Object.fromEntries(daysArr.map(d => [String(d.day), d.flights    ?? []])),
    rentalCars: Object.fromEntries(daysArr.map(d => [String(d.day), d.rentalCars ?? []])),
    highlights: Object.fromEntries(daysArr.map(d => [String(d.day), d.highlights ?? []])),
    notes:      Object.fromEntries(daysArr.map(d => [String(d.day), d.note       ?? ""])),
  };
}

const _extracted = extractPerDayState(_db);

function remapKeys(obj, pivot, delta) {
  const result = {};
  for (const [k, v] of Object.entries(obj)) {
    const n = Number(k);
    if (delta === -1 && n === pivot) continue;
    const shifted = (delta === +1 && n >= pivot) || (delta === -1 && n > pivot);
    result[shifted ? n + delta : n] = v;
  }
  return result;
}

const BLANK_DAY = {
  leg: "New Day", nm: 0, hrs: 0, overnight: "",
  tags: ["layover"], fuelStop: false, tideWarning: false,
  highlights: [], note: "", centerName: "", centerLat: null, centerLng: null,
};

// ── Per-day centroid helpers ───────────────────────────────────────────────

function computeDayCentroid(dayNum, savedPlaces, savedFlights, savedDirections, savedRoutes) {
  const coords = [];
  (savedPlaces[dayNum]     ?? []).forEach(p => { if (p.lat    && p.lng)    coords.push([p.lat,    p.lng]);    });
  (savedFlights[dayNum]    ?? []).forEach(f => { if (f.arrivalLat  && f.arrivalLng)  coords.push([f.arrivalLat,  f.arrivalLng]);  });
  (savedDirections[dayNum] ?? []).forEach(d => { if (d.destinationLat && d.destinationLng) coords.push([d.destinationLat, d.destinationLng]); });
  (savedRoutes[dayNum]     ?? []).forEach(r => { if (r.endLat  && r.endLng)  coords.push([r.endLat,  r.endLng]);  });
  if (!coords.length) return null;
  return {
    lat: coords.reduce((s, c) => s + c[0], 0) / coords.length,
    lng: coords.reduce((s, c) => s + c[1], 0) / coords.length,
  };
}

async function reverseGeocode(lat, lng) {
  const key = `rev:${lat.toFixed(2)},${lng.toFixed(2)}`;
  const cache = (() => { try { return JSON.parse(localStorage.getItem("geocodeCache") || "{}"); } catch { return {}; } })();
  if (cache[key]) return cache[key];
  try {
    const res  = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`,
      { headers: { "Accept-Language": "en" } }
    );
    const data = await res.json();
    const a    = data.address ?? {};
    const name = [a.city || a.town || a.village || a.county, a.country].filter(Boolean).join(", ") || "";
    cache[key] = name;
    try { localStorage.setItem("geocodeCache", JSON.stringify(cache)); } catch {}
    return name;
  } catch { return ""; }
}


async function forwardGeocode(query) {
  if (!query.trim()) return null;
  const cache = (() => { try { return JSON.parse(localStorage.getItem("geocodeCache") || "{}"); } catch { return {}; } })();
  if (cache[query]?.lat) return cache[query];
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

// ── Add-item SVG glyphs ────────────────────────────────────────────────────
const AddGlyph = {
  flight: <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 9.5l5 .5 2.5 3.5 1 .3 0-3.6 4-1.6c.5-.2.7-.7.5-1.2l-.1-.2c-.2-.5-.7-.7-1.2-.5l-3.7 1.5L7 5l-.4-1.1 1-.4-.7-.7L4.4 3.6 4 4.8 2.5 6.3 1.2 6.8c-.4.2-.6.5-.5.8l.1.3c.1.4.5.5.9.4L2 9.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/></svg>,
  pin:    <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 1.5C5.5 1.5 3.5 3.5 3.5 6c0 3 4.5 8 4.5 8s4.5-5 4.5-8c0-2.5-2-4.5-4.5-4.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/><circle cx="8" cy="6" r="1.5" stroke="currentColor" strokeWidth="1.3"/></svg>,
  note:   <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 2.5h7L13 5.5v8a1 1 0 01-1 1H3a1 1 0 01-1-1v-10a1 1 0 011-1z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/><path d="M10 2.5V5h3M5 8h6M5 10.5h6M5 5.5h2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>,
  hotel:  <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="1.5" y="3" width="13" height="9.5" rx="1" stroke="currentColor" strokeWidth="1.3"/><path d="M1.5 9h13M4.5 6.5h2M4.5 6.5a1 1 0 011-1h0a1 1 0 011 1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>,
  eat:    <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4 2v6a2 2 0 002 2v4M4 2v3a1 1 0 001 1h0a1 1 0 001-1V2M11 2c-1 0-2 1-2 3.5S10 9 11 9v5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>,
  ticket: <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2.5 5.5a1 1 0 011-1h9a1 1 0 011 1v.5a1 1 0 100 2v1.5a1 1 0 01-1 1h-9a1 1 0 01-1-1V8a1 1 0 100-2v-.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/><line x1="9" y1="5" x2="9" y2="10" stroke="currentColor" strokeWidth="1.3" strokeDasharray="1 1.4"/></svg>,
  more:   <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="3.5" cy="8" r="1" fill="currentColor"/><circle cx="8" cy="8" r="1" fill="currentColor"/><circle cx="12.5" cy="8" r="1" fill="currentColor"/></svg>,
  search: <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.5"/><path d="M13.5 13.5L10.2 10.2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>,
  plus:   <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>,
  close:  <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>,
  bookmark: <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3 2h8v11l-4-2.5L3 13V2z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/></svg>,
  forward: <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 4h12v8a1 1 0 01-1 1H3a1 1 0 01-1-1V4z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/><path d="M2 4l6 5 6-5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>,
};

const PLACE_KINDS = [
  { id:"stay", label:"Stay",  glyph: AddGlyph.hotel,  cat:"accommodation" },
  { id:"eat",  label:"Eat",   glyph: AddGlyph.eat,    cat:"restaurant" },
  { id:"see",  label:"See",   glyph: AddGlyph.pin,    cat:"activity" },
  { id:"do",   label:"Do",    glyph: AddGlyph.ticket, cat:"activity" },
  { id:"note", label:"Note",  glyph: AddGlyph.note,   cat:null },
];

// ── Add-type button (used in button bar and empty state) ──────────────────
function AddTypeBtn({ glyph, label, sub, onClick, accent = false }) {
  return (
    <button onClick={onClick} style={{
      display:"flex", alignItems:"center", gap:7, padding:"7px 10px",
      background: accent ? "#0b3d6b" : "#ffffff",
      border: accent ? "none" : "1px solid #e2e5ea",
      borderRadius:8, cursor:"pointer", fontFamily:"inherit", textAlign:"left", flex:1, minWidth:0,
    }}>
      <span style={{
        width:22, height:22, borderRadius:5, flexShrink:0,
        background: accent ? "rgba(255,255,255,0.18)" : "#e8f1f9",
        color: accent ? "#fff" : "#0b3d6b",
        display:"flex", alignItems:"center", justifyContent:"center",
      }}>{glyph}</span>
      <span style={{ fontSize:12, fontWeight:600, color: accent ? "#fff" : "#0e1014", letterSpacing:-0.1 }}>{label}</span>
    </button>
  );
}

// ── Insert gap (hover affordance between timeline items) ───────────────────
function InsertGap({ onInsert, suggestedTime }) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      style={{ height: hovered ? 40 : 10, position:"relative", display:"flex", alignItems:"center" }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {hovered ? (
        <>
          <div style={{ flex:1, height:1, background:"#0b3d6b", opacity:0.35 }}/>
          <button onMouseDown={e => { e.stopPropagation(); onInsert?.(suggestedTime); }} style={{
            display:"inline-flex", alignItems:"center", gap:6, padding:"5px 11px",
            borderRadius:999, background:"#0b3d6b", color:"#fff", border:"none",
            cursor:"pointer", fontFamily:"inherit", fontSize:11.5, fontWeight:600,
            boxShadow:"0 2px 8px rgba(11,61,107,0.33)", whiteSpace:"nowrap", flexShrink:0,
          }}>
            {AddGlyph.plus} Insert here{suggestedTime ? ` · ${suggestedTime}` : ""}
          </button>
          <div style={{ flex:1, height:1, background:"#0b3d6b", opacity:0.35 }}/>
        </>
      ) : (
        <div style={{ position:"absolute", inset:"50% 0 auto 0", height:1, background:"transparent" }}/>
      )}
    </div>
  );
}

// ── Timeline time helpers ──────────────────────────────────────────────────

function timeToSortKey(str) {
  if (!str) return "";
  if (/^\d{1,2}:\d{2}$/.test(str)) {
    const [h, m] = str.split(":").map(Number);
    return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`;
  }
  const match = str.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (match) {
    let h = parseInt(match[1]);
    const ampm = match[3].toUpperCase();
    if (ampm === "PM" && h !== 12) h += 12;
    if (ampm === "AM" && h === 12) h = 0;
    return `${String(h).padStart(2,"0")}:${match[2]}`;
  }
  return "";
}

function fmtTime12(str) {
  if (!str) return "";
  if (/AM|PM/i.test(str)) return str;
  const [h, m] = str.split(":").map(Number);
  if (isNaN(h) || isNaN(m)) return "";
  return `${h % 12 || 12}:${String(m).padStart(2,"0")} ${h < 12 ? "AM" : "PM"}`;
}

// ── AddPlacePanel ─────────────────────────────────────────────────────────────
// Self-contained "Add Place" side panel. Not yet wired into the layout — define
// only. Wire-up happens separately.

const APP_PANEL_KINDS = [
  { id: "stay", label: "Stay",  glyph: AddGlyph.hotel  },
  { id: "eat",  label: "Eat",   glyph: AddGlyph.eat    },
  { id: "see",  label: "See",   glyph: AddGlyph.pin    },
  { id: "do",   label: "Do",    glyph: AddGlyph.ticket },
  { id: "note", label: "Note",  glyph: AddGlyph.note   },
];

const DO_QUICK_PICKS = [
  "Cooking class", "Sunset drinks", "Day hike", "Live music", "Market visit", "Spa",
];

// Shared style tokens
const AP = {
  accent:     "#0b3d6b",
  accentSoft: "#e8f1f9",
  surface2:   "#f8f9fb",
  border:     "#e2e5ea",
  muted:      "#9ba1ac",
  text:       "#0e1014",
  amber:      "#f5b544",
  input: {
    width: "100%", background: "#fff", border: "1px solid #e2e5ea",
    color: "#0e1014", borderRadius: 6, padding: "10px 12px",
    fontSize: 13, fontFamily: "inherit", outline: "none",
    boxSizing: "border-box",
  },
  textarea: {
    width: "100%", background: "#f8f9fb", border: "1px solid #e2e5ea",
    color: "#0e1014", borderRadius: 6, padding: "10px 12px",
    fontSize: 13, fontFamily: "inherit", outline: "none",
    boxSizing: "border-box", resize: "vertical", minHeight: 56,
    lineHeight: 1.5,
  },
};

function EditorSection({ label, children }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{
        fontSize: 10.5, fontWeight: 600, textTransform: "uppercase",
        letterSpacing: 1, color: AP.muted, marginBottom: 8,
      }}>{label}</div>
      {children}
    </div>
  );
}

function FieldRow({ label, value, onChange, placeholder, mono, half, type = "text" }) {
  return (
    <div style={{ flex: half ? "0 0 calc(50% - 4px)" : "1 1 100%" }}>
      <div style={{ fontSize: 9.5, textTransform: "uppercase", color: AP.muted, marginBottom: 4, letterSpacing: 0.5 }}>
        {label}
      </div>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        style={{ ...AP.input, fontFamily: mono ? "monospace" : "inherit" }}
      />
    </div>
  );
}

function PlaceSearchField({ search, setSearch, preds, onSelect, selected, onClear, locationBias, loadLocGoogle, loadLocApple, getStoredProviderSettings: getProvSettings, appleAutocomplete: appleAC, appleFetchPlaceDetails: appleFPD }) {
  const debRef  = useRef(null);
  const libRef  = useRef(null);
  const [loading, setLoading] = useState(false);

  function handleInput(val) {
    setSearch(val);
    onClear();
    clearTimeout(debRef.current);
    if (!val.trim()) return;
    setLoading(true);
    debRef.current = setTimeout(async () => {
      try {
        const { provider } = getProvSettings();
        if (provider === "apple") {
          const mk = await loadLocApple();
          libRef.current = mk;
          // Use text search so category queries ("Restaurants") work and results are location-biased
          const opts = locationBias
            ? { region: new mk.CoordinateRegion(new mk.Coordinate(locationBias.lat, locationBias.lng), new mk.CoordinateSpan(0.2, 0.2)) }
            : {};
          const results = await new Promise(resolve => {
            new mk.Search(opts).search(val, (err, data) => {
              if (err || !data?.places?.length) { resolve([]); return; }
              resolve(data.places.slice(0, 20).map(p => ({
                name:     p.name ?? "",
                subtitle: p.formattedAddress ?? "",
                lat:      p.coordinate?.latitude  ?? null,
                lng:      p.coordinate?.longitude ?? null,
              })));
            });
          });
          setLoading(false);
          if (typeof onSelect._setPreds === "function") onSelect._setPreds(results);
        } else {
          const lib = await loadLocGoogle();
          libRef.current = lib;
          // Place.searchByText handles category searches properly and supports location bias
          const { Place } = lib;
          const searchOpts = {
            textQuery: val,
            fields: ["displayName", "formattedAddress", "location"],
            maxResultCount: 20,
          };
          if (locationBias) {
            searchOpts.locationBias = { circle: { center: { latitude: locationBias.lat, longitude: locationBias.lng }, radius: 10000 } };
          }
          const { places } = await Place.searchByText(searchOpts);
          setLoading(false);
          const mapped = (places ?? []).slice(0, 20).map(p => ({
            name:     p.displayName ?? "",
            subtitle: p.formattedAddress ?? "",
            lat:      p.location?.lat() ?? null,
            lng:      p.location?.lng() ?? null,
          }));
          if (typeof onSelect._setPreds === "function") onSelect._setPreds(mapped);
        }
      } catch { setLoading(false); }
    }, 350);
  }

  return (
    <div style={{ position: "relative" }}>
      <div style={{ position: "relative" }}>
        <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: AP.muted, pointerEvents: "none", display: "flex" }}>
          {AddGlyph.search}
        </span>
        <input
          type="text"
          value={search}
          onChange={e => handleInput(e.target.value)}
          placeholder="Search for a place…"
          style={{ ...AP.input, paddingLeft: 34, paddingRight: selected ? 80 : 12 }}
        />
        {selected && (
          <span style={{
            position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)",
            background: AP.accentSoft, color: AP.accent, fontSize: 10.5, fontWeight: 600,
            borderRadius: 99, padding: "2px 8px", display: "inline-flex", alignItems: "center", gap: 4,
            cursor: "pointer",
          }} onClick={onClear}>
            ✨ matched ×
          </span>
        )}
        {loading && !selected && (
          <span style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", color: AP.muted, fontSize: 11 }}>…</span>
        )}
      </div>
      {preds.length > 0 && !selected && (
        <div style={{
          position: "absolute", zIndex: 50, top: "calc(100% + 4px)", left: 0, right: 0,
          background: "#fff", border: "1px solid " + AP.border, borderRadius: 8,
          boxShadow: "0 4px 16px rgba(0,0,0,0.10)", overflow: "hidden",
        }}>
          {preds.map((p, i) => (
            <div key={i} onClick={() => { setSearch(p.name); onSelect(p); }} style={{
              padding: "9px 12px", cursor: "pointer", borderBottom: i < preds.length - 1 ? "1px solid " + AP.border : "none",
              background: "#fff",
            }}
              onMouseEnter={e => e.currentTarget.style.background = AP.surface2}
              onMouseLeave={e => e.currentTarget.style.background = "#fff"}
            >
              <div style={{ fontSize: 13, fontWeight: 600, color: AP.text }}>{p.name}</div>
              {p.subtitle && <div style={{ fontSize: 11.5, color: AP.muted, marginTop: 1 }}>{p.subtitle}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AddPlacePanel({
  day, dayLabel, onAdd, onUpdate, onClose, readOnly,
  locationBias, editItem,
  loadLocGoogle, loadLocApple, getStoredProviderSettings: getProvSettings,
  appleAutocomplete: appleAC, appleFetchPlaceDetails: appleFPD,
  initialKind,
}) {
  const ei = editItem; // shorthand
  const [kind, setKind]               = useState(ei?.placeKind || initialKind || "eat");
  // Place search (Stay/Eat/See) — pre-fill from editItem if editing
  const [search, setSearch]           = useState(ei?.name || "");
  const [preds, setPreds]             = useState([]);
  const [selected, setSelected]       = useState(ei && ei.name ? { name: ei.name, address: ei.address || "", lat: ei.lat || null, lng: ei.lng || null } : null);
  // Do optional place
  const [doAttached, setDoAttached]   = useState(false);
  const [doSearch, setDoSearch]       = useState("");
  const [doPreds, setDoPreds]         = useState([]);
  const [doSelected, setDoSelected]   = useState(null);
  // Per-kind fields — pre-fill from editItem
  const [time, setTime]               = useState(ei?.time || "");
  const [duration, setDuration]       = useState(ei?.duration || "");
  const [notes, setNotes]             = useState(ei?.notes || "");
  const [tags, setTags]               = useState(ei?.tags || []);
  const [tagInput, setTagInput]       = useState("");
  const [confirmation, setConfirm]    = useState(ei?.confirmation || "");
  const [partySize, setPartySize]     = useState(ei?.partySize || "");
  const [bookedVia, setBookedVia]     = useState(ei?.bookedVia || "");
  const [dietary, setDietary]         = useState(ei?.dietary || "");
  const [room, setRoom]               = useState(ei?.room || "");
  const [guests, setGuests]           = useState(ei?.guests || "");
  const [stayLength, setStayLength]   = useState(ei?.stayLength || "");
  const [entry, setEntry]             = useState(ei?.entry || "");
  const [tickets, setTickets]         = useState(ei?.tickets || "");
  const [activity, setActivity]       = useState(ei?.activity || "");
  const [operator, setOperator]       = useState(ei?.operator || "");
  const [cost, setCost]               = useState(ei?.cost || "");
  const [partyDo, setPartyDo]         = useState(ei?.partyDo || "");
  const [noteText, setNoteText]       = useState(ei?.noteText || "");

  // Reset place search only on explicit kind tab change (not on initial mount)
  function changeKind(newKind) {
    setKind(newKind);
    setSearch(""); setPreds([]); setSelected(null);
    setDoSearch(""); setDoPreds([]); setDoSelected(null);
    setDoAttached(false);
  }

  // Default times per kind
  useEffect(() => {
    if (kind === "stay" && !time) setTime("15:00");
    if (kind === "eat"  && !time) setTime("12:30");
    if (kind === "see"  && !time) setTime("10:00");
  }, [kind]); // eslint-disable-line react-hooks/exhaustive-deps

  // Resolve a prediction to a place detail object
  async function resolvePred(pred, setPredsFn, setSelectedFn) {
    setPredsFn([]);
    // Text-search results already carry lat/lng — use them directly
    if (pred.lat != null && pred.lng != null) {
      setSelectedFn({ name: pred.name, address: pred.subtitle ?? "", lat: pred.lat, lng: pred.lng });
      return;
    }
    // Fallback for legacy autocomplete results that need an extra geocoding step
    try {
      const { provider } = getProvSettings();
      if (provider === "apple" && pred._data) {
        const mk = await loadLocApple();
        const details = await appleFPD(mk, pred._data);
        setSelectedFn({ name: details.name, address: details.address, lat: details.lat ?? null, lng: details.lng ?? null });
      } else if (pred._data?.placePrediction) {
        const lib = await loadLocGoogle();
        const place = pred._data.placePrediction.toPlace();
        await place.fetchFields({ fields: ["displayName", "formattedAddress", "location"] });
        setSelectedFn({
          name: place.displayName ?? pred.name,
          address: place.formattedAddress ?? "",
          lat: place.location?.lat() ?? null,
          lng: place.location?.lng() ?? null,
        });
      }
    } catch { /* ignore */ }
  }

  // Attach _setPreds so PlaceSearchField can bubble autocomplete results up
  const mainOnSelect = (pred) => resolvePred(pred, setPreds, setSelected);
  mainOnSelect._setPreds = setPreds;
  const doOnSelect = (pred) => resolvePred(pred, setDoPreds, setDoSelected);
  doOnSelect._setPreds = setDoPreds;

  function clearSelected() { setSelected(null); setPreds([]); }
  function clearDoSelected() { setDoSelected(null); setDoPreds([]); }

  function handleAdd() {
    const item = {
      id: ei?.id || crypto.randomUUID(),
      name:         kind === "do" ? (activity || "Activity") : (selected?.name || search || ""),
      address:      kind === "do" ? (doSelected?.address ?? "") : (selected?.address ?? ""),
      lat:          kind === "do" ? (doSelected?.lat ?? null)   : (selected?.lat ?? null),
      lng:          kind === "do" ? (doSelected?.lng ?? null)   : (selected?.lng ?? null),
      category:     kind === "stay" ? "accommodation" : kind === "eat" ? "restaurant" : kind === "see" ? "activity" : kind === "do" ? "activity" : "other",
      placeKind:    kind,
      time, duration, notes: kind === "note" ? noteText : notes,
      confirmation, partySize, bookedVia, dietary, room, guests, stayLength,
      operator, cost, entry, tickets, activity,
      addedAt: ei?.addedAt || new Date().toISOString(),
    };
    if (ei && onUpdate) {
      onUpdate(ei.id, item);
    } else {
      onAdd(item);
    }
    onClose();
  }

  const isNote = kind === "note";
  const isDo   = kind === "do";


  // Notes & tags section (shared across Stay/Eat/See/Do)
  function NotesAndTags() {
    return (
      <EditorSection label="Notes & tags">
        <textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          placeholder="Add any notes…"
          style={{ ...AP.textarea }}
        />
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8, alignItems: "center" }}>
          {tags.map((t, i) => (
            <span key={i} style={{
              background: AP.accentSoft, color: AP.accent, borderRadius: 99,
              padding: "3px 10px", fontSize: 11.5, fontWeight: 500, display: "inline-flex", alignItems: "center", gap: 4,
            }}>
              {t}
              <span style={{ cursor: "pointer", fontSize: 10 }} onClick={() => setTags(tags.filter((_, j) => j !== i))}>×</span>
            </span>
          ))}
          <input
            value={tagInput}
            onChange={e => setTagInput(e.target.value)}
            onKeyDown={e => {
              if ((e.key === "Enter" || e.key === ",") && tagInput.trim()) {
                e.preventDefault();
                setTags([...tags, tagInput.trim()]);
                setTagInput("");
              }
            }}
            placeholder="+ tag"
            style={{
              background: "none", border: "1px dashed " + AP.border, borderRadius: 99,
              padding: "3px 10px", fontSize: 11.5, color: AP.muted, fontFamily: "inherit",
              outline: "none", minWidth: 60, cursor: "text",
            }}
          />
        </div>
      </EditorSection>
    );
  }

  // ── Per-kind body forms ────────────────────────────────────────────────────

  function StayBody() {
    return (
      <>
        <EditorSection label="Place">
          <PlaceSearchField
            search={search} setSearch={setSearch}
            preds={preds} onSelect={mainOnSelect}
            selected={selected} onClear={clearSelected}
            locationBias={locationBias}
            loadLocGoogle={loadLocGoogle} loadLocApple={loadLocApple}
            getStoredProviderSettings={getProvSettings}
            appleAutocomplete={appleAC} appleFetchPlaceDetails={appleFPD}
          />
          {selected?.address && (
            <div style={{ fontSize: 11.5, color: AP.muted, marginTop: 6 }}>{selected.address}</div>
          )}
        </EditorSection>
        <EditorSection label="When">
          <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
            <FieldRow label="Check-in" value={time} onChange={setTime} placeholder="15:00" half />
            <FieldRow label="Stay length" value={stayLength} onChange={setStayLength} placeholder="3 nights" half />
          </div>
          {stayLength && (
            <div style={{
              background: AP.surface2, border: "1px solid #f5e0a0", borderRadius: 6,
              padding: "8px 12px", display: "flex", alignItems: "center", gap: 8,
            }}>
              <span style={{ fontSize: 14, color: AP.amber }}>✨</span>
              <span style={{ fontSize: 12, color: AP.muted, lineHeight: 1.4 }}>
                Spans Day {day} → Day {day + (parseInt(stayLength) || 0)}. Will appear on each day header.
              </span>
            </div>
          )}
        </EditorSection>
        <EditorSection label="Booking details (optional)">
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <FieldRow label="Room" value={room} onChange={setRoom} placeholder="Suite 204" half />
            <FieldRow label="Guests" value={guests} onChange={setGuests} placeholder="2 adults" half />
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <FieldRow label="Booked via" value={bookedVia} onChange={setBookedVia} placeholder="Booking.com" half />
            <FieldRow label="Confirmation #" value={confirmation} onChange={setConfirm} placeholder="ABC123" mono half />
          </div>
        </EditorSection>
        {NotesAndTags()}
      </>
    );
  }

  function EatBody() {
    return (
      <>
        <EditorSection label="Place">
          <PlaceSearchField
            search={search} setSearch={setSearch}
            preds={preds} onSelect={mainOnSelect}
            selected={selected} onClear={clearSelected}
            locationBias={locationBias}
            loadLocGoogle={loadLocGoogle} loadLocApple={loadLocApple}
            getStoredProviderSettings={getProvSettings}
            appleAutocomplete={appleAC} appleFetchPlaceDetails={appleFPD}
          />
          {selected?.address && (
            <div style={{ fontSize: 11.5, color: AP.muted, marginTop: 6 }}>{selected.address}</div>
          )}
        </EditorSection>
        <EditorSection label="When">
          <div style={{ display: "flex", gap: 8 }}>
            <FieldRow label="Time" value={time} onChange={setTime} placeholder="12:30" half />
            <FieldRow label="Duration" value={duration} onChange={setDuration} placeholder="90 min" half />
          </div>
        </EditorSection>
        <EditorSection label="Reservation details (optional)">
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <FieldRow label="Party size" value={partySize} onChange={setPartySize} placeholder="4" half />
            <FieldRow label="Booked via" value={bookedVia} onChange={setBookedVia} placeholder="OpenTable" half />
          </div>
          <div style={{ marginBottom: 8 }}>
            <FieldRow label="Confirmation" value={confirmation} onChange={setConfirm} placeholder="RES-1234" mono />
          </div>
          <FieldRow label="Dietary / requests" value={dietary} onChange={setDietary} placeholder="Vegetarian, window seat…" />
        </EditorSection>
        {NotesAndTags()}
      </>
    );
  }

  function SeeBody() {
    return (
      <>
        <EditorSection label="Place">
          <PlaceSearchField
            search={search} setSearch={setSearch}
            preds={preds} onSelect={mainOnSelect}
            selected={selected} onClear={clearSelected}
            locationBias={locationBias}
            loadLocGoogle={loadLocGoogle} loadLocApple={loadLocApple}
            getStoredProviderSettings={getProvSettings}
            appleAutocomplete={appleAC} appleFetchPlaceDetails={appleFPD}
          />
          {selected?.address && (
            <div style={{ fontSize: 11.5, color: AP.muted, marginTop: 6 }}>{selected.address}</div>
          )}
        </EditorSection>
        <EditorSection label="When">
          <div style={{ display: "flex", gap: 8 }}>
            <FieldRow label="Time" value={time} onChange={setTime} placeholder="10:00" half />
            <FieldRow label="Duration" value={duration} onChange={setDuration} placeholder="1h" half />
          </div>
        </EditorSection>
        <EditorSection label="See details">
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <FieldRow label="Entry" value={entry} onChange={setEntry} placeholder="Free / €12" half />
            <FieldRow label="Tickets" value={tickets} onChange={setTickets} placeholder="Booked" half />
          </div>
          <FieldRow label="Confirmation" value={confirmation} onChange={setConfirm} placeholder="TKT-5678" mono />
        </EditorSection>
        {NotesAndTags()}
      </>
    );
  }

  function DoBody() {
    return (
      <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 6, marginBottom: 20 }}>
        {APP_PANEL_KINDS.map(k => (
          <button key={k.id} onClick={() => changeKind(k.id)} style={{
            display: "flex", flexDirection: "column", alignItems: "center", gap: 6,
            padding: "12px 4px", borderRadius: 8, cursor: "pointer", fontFamily: "inherit",
            fontSize: 12, fontWeight: 600, border: "1px solid",
            background:   kind === k.id ? AP.accent      : "#fff",
            color:        kind === k.id ? "#fff"          : AP.text,
            borderColor:  kind === k.id ? AP.accent       : AP.border,
            boxShadow:    kind === k.id ? `0 0 0 3px ${AP.accentSoft}` : "none",
          }}>
            <span style={{ opacity: kind === k.id ? 1 : 0.6 }}>{k.glyph}</span>
            {k.label}
          </button>
        ))}
      </div>
        <EditorSection label="Activity">
          <input
            type="text"
            value={activity}
            onChange={e => setActivity(e.target.value)}
            placeholder="What are you doing?"
            autoFocus
            style={{
              ...AP.input,
              fontSize: 14, fontWeight: 500,
              border: activity ? `1px solid ${AP.accent}` : `1px solid ${AP.border}`,
              boxShadow: activity ? `0 0 0 3px ${AP.accentSoft}` : "none",
              transition: "border-color 0.15s, box-shadow 0.15s",
            }}
          />
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
            {DO_QUICK_PICKS.map(pick => (
              <button key={pick} onClick={() => setActivity(pick)} style={{
                background: activity === pick ? AP.accentSoft : AP.surface2,
                border: "1px solid " + (activity === pick ? AP.accent : AP.border),
                color: activity === pick ? AP.accent : AP.muted,
                borderRadius: 99, padding: "4px 12px", fontSize: 12, fontFamily: "inherit",
                cursor: "pointer", fontWeight: 500,
              }}>{pick}</button>
            ))}
          </div>
        </EditorSection>
        <EditorSection label="When">
          <div style={{ display: "flex", gap: 8 }}>
            <FieldRow label="Time" value={time} onChange={setTime} placeholder="—" half />
            <FieldRow label="Duration" value={duration} onChange={setDuration} placeholder="—" half />
          </div>
        </EditorSection>
        <EditorSection label="Place (optional)">
          {!doAttached ? (
            <button onClick={() => setDoAttached(true)} style={{
              display: "flex", alignItems: "center", gap: 8, width: "100%",
              background: AP.surface2, border: "1px dashed " + AP.border, borderRadius: 8,
              padding: "10px 14px", cursor: "pointer", fontFamily: "inherit", color: AP.muted,
              fontSize: 13,
            }}>
              <span style={{ color: AP.accent, fontWeight: 700, fontSize: 16 }}>+</span>
              Attach a meeting point or venue
            </button>
          ) : (
            <div>
              <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                <div style={{ flex: 1 }}>
                  <PlaceSearchField
                    search={doSearch} setSearch={setDoSearch}
                    preds={doPreds} onSelect={doOnSelect}
                    selected={doSelected} onClear={clearDoSelected}
                    locationBias={locationBias}
                    loadLocGoogle={loadLocGoogle} loadLocApple={loadLocApple}
                    getStoredProviderSettings={getProvSettings}
                    appleAutocomplete={appleAC} appleFetchPlaceDetails={appleFPD}
                  />
                </div>
                <button onClick={() => { setDoAttached(false); clearDoSelected(); setDoSearch(""); }} style={{
                  flexShrink: 0, background: "none", border: "1px solid " + AP.border, borderRadius: 6,
                  padding: "10px 10px", cursor: "pointer", color: AP.muted, display: "flex", alignItems: "center",
                }}>
                  {AddGlyph.close}
                </button>
              </div>
              {doSelected?.address && (
                <div style={{ fontSize: 11.5, color: AP.muted, marginTop: 6 }}>{doSelected.address}</div>
              )}
              <div style={{ fontSize: 11.5, color: AP.muted, marginTop: 6, fontStyle: "italic" }}>
                Optional — skip if there's no specific spot
              </div>
            </div>
          )}
        </EditorSection>
        <EditorSection label="Details (optional)">
          <div style={{ marginBottom: 8 }}>
            <FieldRow label="Operator / host" value={operator} onChange={setOperator} placeholder="Name or company" />
          </div>
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <FieldRow label="Cost" value={cost} onChange={setCost} placeholder="€45/person" half />
            <FieldRow label="Party / tickets" value={partyDo} onChange={setPartyDo} placeholder="2 people" half />
          </div>
          <FieldRow label="Confirmation" value={confirmation} onChange={setConfirm} placeholder="CONF-9999" mono />
        </EditorSection>
        {NotesAndTags()}
      </>
    );
  }

  function NoteBody() {
    return (
      <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 6, marginBottom: 20 }}>
        {APP_PANEL_KINDS.map(k => (
          <button key={k.id} onClick={() => changeKind(k.id)} style={{
            display: "flex", flexDirection: "column", alignItems: "center", gap: 6,
            padding: "12px 4px", borderRadius: 8, cursor: "pointer", fontFamily: "inherit",
            fontSize: 12, fontWeight: 600, border: "1px solid",
            background:   kind === k.id ? AP.accent      : "#fff",
            color:        kind === k.id ? "#fff"          : AP.text,
            borderColor:  kind === k.id ? AP.accent       : AP.border,
            boxShadow:    kind === k.id ? `0 0 0 3px ${AP.accentSoft}` : "none",
          }}>
            <span style={{ opacity: kind === k.id ? 1 : 0.6 }}>{k.glyph}</span>
            {k.label}
          </button>
        ))}
      </div>
        <EditorSection label="Note">
          <textarea
            value={noteText}
            onChange={e => setNoteText(e.target.value)}
            placeholder="What do you want to remember?"
            autoFocus
            style={{ ...AP.textarea, minHeight: 120 }}
          />
        </EditorSection>
      </>
    );
  }

  // ── Panel chrome ──────────────────────────────────────────────────────────

  // Icon for header
  const kindMeta = APP_PANEL_KINDS.find(k => k.id === kind) ?? APP_PANEL_KINDS[0];
  const headerTitle = ei ? (isDo ? "Edit activity" : "Edit place") : (isDo ? "Add activity" : "Add place");

  return (
    <div style={{
      display: "flex", flexDirection: "column", height: "100%",
      fontFamily: "inherit", color: AP.text, background: "#fff",
    }}>
      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center", gap: 12,
        padding: "16px 20px", borderBottom: "1px solid " + AP.border, flexShrink: 0,
      }}>
        <div style={{
          width: 32, height: 32, borderRadius: 8, background: AP.accentSoft, color: AP.accent,
          display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
        }}>
          {kindMeta.glyph}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: AP.text, lineHeight: 1.2 }}>{headerTitle}</div>
          <div style={{ fontSize: 11.5, color: AP.muted, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {dayLabel}
          </div>
        </div>
        <button onClick={onClose} style={{
          width: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center",
          background: "none", border: "1px solid " + AP.border, borderRadius: 6,
          cursor: "pointer", color: AP.muted, flexShrink: 0,
        }}>
          {AddGlyph.close}
        </button>
      </div>

      {/* Forward strip */}
      <div style={{
        display: "flex", alignItems: "center", gap: 10,
        padding: "12px 20px", background: AP.surface2, borderBottom: "1px solid " + AP.border,
        flexShrink: 0,
      }}>
        <span style={{ color: AP.muted, display: "flex", flexShrink: 0 }}>{AddGlyph.forward}</span>
        <span style={{ fontSize: 12, color: AP.muted, lineHeight: 1.4 }}>
          Have a confirmation email? Forward to{" "}
          <span style={{ color: AP.accent, fontWeight: 500 }}>you@in.travelitinerary.app</span>
        </span>
      </div>

      {/* Scrollable body */}
      <div style={{ flex: 1, overflowY: "auto", padding: "20px 20px 8px" }}>
        {/* Kind tabs shown at top for Stay/Eat/See; Do/Note include them inline */}
        {!isDo && !isNote && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 6, marginBottom: 20 }}>
            {APP_PANEL_KINDS.map(k => (
              <button key={k.id} onClick={() => changeKind(k.id)} style={{
                display: "flex", flexDirection: "column", alignItems: "center", gap: 6,
                padding: "12px 4px", borderRadius: 8, cursor: "pointer", fontFamily: "inherit",
                fontSize: 12, fontWeight: 600, border: "1px solid",
                background:   kind === k.id ? AP.accent : "#fff",
                color:        kind === k.id ? "#fff"    : AP.text,
                borderColor:  kind === k.id ? AP.accent : AP.border,
                boxShadow:    kind === k.id ? `0 0 0 3px ${AP.accentSoft}` : "none",
              }}>
                <span style={{ opacity: kind === k.id ? 1 : 0.6 }}>{k.glyph}</span>
                {k.label}
              </button>
            ))}
          </div>
        )}

        {kind === "stay" && StayBody()}
        {kind === "eat"  && EatBody()}
        {kind === "see"  && SeeBody()}
        {kind === "do"   && DoBody()}
        {kind === "note" && NoteBody()}
      </div>

      {/* Footer */}
      {!readOnly && (
        <div style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: "14px 20px", borderTop: "1px solid " + AP.border,
          background: AP.surface2, flexShrink: 0,
        }}>
          <button onClick={onClose} style={{
            background: "none", border: "1px solid " + AP.border, color: AP.muted,
            borderRadius: 8, padding: "8px 16px", fontSize: 13, fontFamily: "inherit",
            cursor: "pointer", fontWeight: 500,
          }}>
            Cancel
          </button>
          <div style={{ flex: 1 }} />
          {!isNote && (
            <button style={{
              display: "flex", alignItems: "center", gap: 6,
              background: AP.surface2, border: "1px solid " + AP.border, color: AP.text,
              borderRadius: 8, padding: "8px 14px", fontSize: 13, fontFamily: "inherit",
              cursor: "pointer", fontWeight: 500,
            }}>
              {AddGlyph.bookmark}
              {isDo ? "Save for later" : "Save to Places"}
            </button>
          )}
          <button onClick={handleAdd} style={{
            display: "flex", alignItems: "center", gap: 6,
            background: AP.accent, border: "none", color: "#fff",
            borderRadius: 8, padding: "8px 16px", fontSize: 13, fontFamily: "inherit",
            cursor: "pointer", fontWeight: 600,
          }}>
            {AddGlyph.plus}
            {ei ? "Save changes" : `Add to Day ${day}`}
          </button>
        </div>
      )}
    </div>
  );
}

// ── End AddPlacePanel ─────────────────────────────────────────────────────────

// ── AddTravelPanel ────────────────────────────────────────────────────────────

const TRAVEL_MODES = [
  {
    id: "flight", label: "Flight",
    glyph: AddGlyph.flight,
  },
  {
    id: "car", label: "Drive",
    glyph: <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2.5 11V8.5l1.2-3a1 1 0 011-.7h6.6a1 1 0 011 .7l1.2 3V11" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/><rect x="1.5" y="9.5" width="13" height="3" rx="1" stroke="currentColor" strokeWidth="1.3"/><circle cx="4.5" cy="13" r="1" stroke="currentColor" strokeWidth="1.3"/><circle cx="11.5" cy="13" r="1" stroke="currentColor" strokeWidth="1.3"/></svg>,
  },
  {
    id: "walk", label: "Walk",
    glyph: <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="2.5" r="1.2" stroke="currentColor" strokeWidth="1.3"/><path d="M8 4l-1.5 3.5 2 1.5-1 3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/><path d="M6.5 7.5l-2 1M9 8.5l2 1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>,
  },
  {
    id: "train", label: "Train",
    glyph: <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="3" y="2" width="10" height="10" rx="2" stroke="currentColor" strokeWidth="1.3"/><line x1="3" y1="7" x2="13" y2="7" stroke="currentColor" strokeWidth="1.3"/><path d="M5 13l-1 1.5M11 13l1 1.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/><circle cx="5.5" cy="10" r=".8" fill="currentColor"/><circle cx="10.5" cy="10" r=".8" fill="currentColor"/></svg>,
  },
  {
    id: "ferry", label: "Ferry",
    glyph: <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M1.5 11h13l-1.6 2.7a1 1 0 01-.86.5H4a1 1 0 01-.87-.5L1.5 11z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/><path d="M3.5 11V7.5a1 1 0 011-1h7a1 1 0 011 1V11" stroke="currentColor" strokeWidth="1.3"/><rect x="5.5" y="4" width="2" height="2.5" rx=".5" stroke="currentColor" strokeWidth="1.2"/><rect x="8.5" y="4" width="2" height="2.5" rx=".5" stroke="currentColor" strokeWidth="1.2"/><path d="M8 6.5V4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>,
  },
  {
    id: "boat", label: "Boat",
    glyph: <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 2.2L11.6 9.8H8z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/><line x1="8" y1="2" x2="8" y2="10" stroke="currentColor" strokeWidth="1.2"/><path d="M2 11.5h12l-1.3 1.9a1 1 0 01-.83.45H4.13a1 1 0 01-.83-.45L2 11.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/></svg>,
  },
  {
    id: "other", label: "Other",
    glyph: <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.3"/><path d="M8 5v3.5l2 2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  },
];

const ATP = {
  accent:     "#0b3d6b",
  accentSoft: "#e8f1f9",
  border:     "#e2e5ea",
  borderSoft: "#eef0f3",
  surface:    "#ffffff",
  surface2:   "#f8f9fb",
  text:       "#0e1014",
  textMuted:  "#5c6470",
  textFaint:  "#9ba1ac",
  amber:      "#f5b544",
};

const ATP_INPUT = {
  width: "100%", background: "#fff", border: "1px solid #e2e5ea",
  color: "#0e1014", borderRadius: 7, padding: "9px 11px",
  fontSize: 13, fontFamily: "inherit", outline: "none",
  boxSizing: "border-box",
};

const ATP_LABEL = {
  fontSize: 10, fontWeight: 500, textTransform: "uppercase",
  letterSpacing: 0.8, color: "#5c6470", marginBottom: 4, display: "block",
};

function AddTravelPanel({
  day, dayLabel, onAdd, onUpdate, onClose, readOnly,
  loadLocGoogle, loadLocApple, getStoredProviderSettings,
  appleAutocomplete, appleFetchPlaceDetails,
  routeServerUrl, aeroDataBoxKey, calendarDate,
  distanceUnit,
  editItem,
}) {
  const [mode, setMode] = useState(editItem?.mode || "flight");
  const [fromName, setFromName] = useState(editItem?.from?.name || "");
  const [fromCode, setFromCode] = useState(editItem?.from?.code || "");
  const [fromAddr, setFromAddr] = useState(editItem?.from?.address || "");
  const [fromLat, setFromLat]   = useState(editItem?.from?.lat || null);
  const [fromLng, setFromLng]   = useState(editItem?.from?.lng || null);
  const [fromPreds, setFromPreds] = useState([]);
  const [toName, setToName]   = useState(editItem?.to?.name || "");
  const [toCode, setToCode]   = useState(editItem?.to?.code || "");
  const [toAddr, setToAddr]   = useState(editItem?.to?.address || "");
  const [toLat, setToLat]     = useState(editItem?.to?.lat || null);
  const [toLng, setToLng]     = useState(editItem?.to?.lng || null);
  const [toPreds, setToPreds] = useState([]);
  const [departDate, setDepartDate] = useState(editItem?.departDate || calendarDate || "");
  const [departTime, setDepartTime] = useState(editItem?.departTime || "");
  const [arriveDate, setArriveDate] = useState(editItem?.arriveDate || editItem?.departDate || calendarDate || "");
  const [arriveTime, setArriveTime] = useState(editItem?.arriveTime || "");
  const [notes, setNotes] = useState(editItem?.notes || "");
  const [repeatReturn, setRepeatReturn] = useState(false);
  // Flight fields
  const [airline, setAirline]       = useState(editItem?.airline || "");
  const [aircraft, setAircraft]     = useState(editItem?.aircraft || "");
  const [flightNum, setFlightNum]   = useState(editItem?.flightNum || "");
  const [seat, setSeat]             = useState(editItem?.seat || "");
  const [confirmation, setConfirm]  = useState(editItem?.confirmation || "");
  const [terminal, setTerminal]     = useState(editItem?.terminal || "");
  const [bags, setBags]             = useState(editItem?.bags || "");
  // Car fields
  const [vehicle, setVehicle]       = useState(editItem?.vehicle || "");
  const [plate, setPlate]           = useState(editItem?.plate || "");
  const [parking, setParking]       = useState(editItem?.parking || "");
  // Train/Ferry common
  const [operator, setOperator]     = useState(editItem?.operator || "");
  const [trainNum, setTrainNum]     = useState(editItem?.trainNum || "");
  const [carSeat, setCarSeat]       = useState(editItem?.carSeat || "");
  const [platform, setPlatform]     = useState(editItem?.platform || "");
  const [vessel, setVessel]         = useState(editItem?.vessel || "");
  const [travelClass, setTravelClass] = useState(editItem?.travelClass || "");
  const [ticket, setTicket]         = useState(editItem?.ticket || "");
  // Boat
  const [boatVessel, setBoatVessel] = useState(editItem?.boatVessel || "");
  const [cruisingSpeed, setCruisingSpeed] = useState(editItem?.cruisingSpeed || "5.5");
  const [editingSpeed, setEditingSpeed] = useState(false);
  // Other
  const [description, setDescription] = useState(editItem?.description || "");

  // Route result
  const [routeDuration, setRouteDuration] = useState(editItem?.routeDuration || "");
  const [routeDistance, setRouteDistance] = useState(editItem?.routeDistance || "");
  const [routePath,     setRoutePath]     = useState(editItem?.routePath || null);
  const [routeLoading,  setRouteLoading]  = useState(false);

  const fromDebounce = useRef(null);
  const toDebounce   = useRef(null);
  const [departTimeFocused, setDepartTimeFocused] = useState(false);
  const [arriveTimeFocused, setArriveTimeFocused] = useState(false);

  function convertDist(str) {
    if (!str) return str;
    const km = str.match(/^([\d.]+)\s*km$/i);
    if (km && distanceUnit === "mi") return `${(parseFloat(km[1]) * 0.621371).toFixed(1)} mi`;
    const mi = str.match(/^([\d.]+)\s*mi(les)?$/i);
    if (mi && distanceUnit === "km") return `${(parseFloat(mi[1]) * 1.60934).toFixed(1)} km`;
    return str;
  }

  function durToMins(str) {
    if (!str) return 0;
    let total = 0;
    const hm = str.match(/(\d+)\s*h/i); const mm = str.match(/(\d+)\s*m/i);
    if (hm) total += +hm[1] * 60; if (mm) total += +mm[1];
    return total;
  }

  function addMinsToTime(hhmm, mins) {
    if (!hhmm || !mins) return null;
    const [h, m] = hhmm.split(":").map(Number);
    const total = h * 60 + m + mins;
    const ah = Math.floor(total / 60) % 24;
    const am = total % 60;
    return { time: `${String(ah).padStart(2, "0")}:${String(am).padStart(2, "0")}`, nextDay: total >= 1440 };
  }

  function applyEta(dur, explicitDepartTime) {
    const dt = explicitDepartTime ?? departTime;
    const mins = durToMins(dur);
    if (dt && mins) {
      const eta = addMinsToTime(dt, mins);
      if (eta) {
        setArriveTime(eta.time);
        if (eta.nextDay && departDate) {
          const [y, mo, d] = departDate.split("-").map(Number);
          const next = new Date(y, mo - 1, d + 1);
          setArriveDate(`${next.getFullYear()}-${String(next.getMonth()+1).padStart(2,"0")}-${String(next.getDate()).padStart(2,"0")}`);
          return;
        }
      }
    }
    if (departDate) setArriveDate(departDate);
  }

  function searchPlace(query, setPreds, bias) {
    if (!query.trim()) { setPreds([]); return; }
    const { provider } = getStoredProviderSettings();
    if (provider === "apple") {
      loadLocApple().then(mk =>
        appleAutocomplete(mk, query, bias).then(results => setPreds(results))
      ).catch(() => {});
    } else {
      loadLocGoogle().then(lib => {
        const { AutocompleteSessionToken, AutocompleteSuggestion } = lib;
        if (!searchPlace._token) searchPlace._token = new AutocompleteSessionToken();
        return AutocompleteSuggestion.fetchAutocompleteSuggestions({
          input: query,
          sessionToken: searchPlace._token,
          ...(bias ? { locationBias: bias } : {}),
        });
      }).then(({ suggestions }) => {
        const mapped = (suggestions || []).filter(s => s.placePrediction).slice(0, 5).map(s => ({
          name:     s.placePrediction.mainText.text,
          subtitle: s.placePrediction.secondaryText?.text ?? "",
          _data:    s,
        }));
        setPreds(mapped);
      }).catch(() => {});
    }
  }

  async function resolvePred(pred, setName, setCode, setAddr, setLat, setLng, setPreds) {
    setPreds([]);
    try {
      const { provider } = getStoredProviderSettings();
      if (provider === "apple") {
        const mk = await loadLocApple();
        const details = await appleFetchPlaceDetails(mk, pred._data);
        setName(details.name || "");
        setAddr(details.address || "");
        setLat(details.lat ?? null);
        setLng(details.lng ?? null);
      } else {
        const lib = await loadLocGoogle();
        const place = pred._data.placePrediction.toPlace();
        await place.fetchFields({ fields: ["displayName", "formattedAddress", "location"] });
        setName(place.displayName ?? pred.name ?? "");
        setAddr(place.formattedAddress ?? "");
        setLat(place.location?.lat() ?? null);
        setLng(place.location?.lng() ?? null);
      }
    } catch { /* ignore */ }
  }

  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupErr,     setLookupErr]     = useState(null);
  const [lookupResults, setLookupResults] = useState(null); // null | array

  function applyFlightResult(flight) {
    const dep = flight.departure?.airport;
    const arr = flight.arrival?.airport;
    const parseLocalTime = s => {
      if (!s) return "";
      const t = s.includes("T") ? s.split("T")[1] : s.split(" ")[1];
      if (!t) return "";
      return t.slice(0, 5);
    };
    setFromName((dep?.municipalityName ?? dep?.iata) || fromName);
    setFromCode(dep?.iata ?? fromCode);
    setToName((arr?.municipalityName ?? arr?.iata) || toName);
    setToCode(arr?.iata ?? toCode);
    const depLat = dep?.location?.lat, depLng = dep?.location?.lon;
    const arrLat = arr?.location?.lat, arrLng = arr?.location?.lon;
    setFromLat(depLat ?? fromLat);
    setFromLng(depLng ?? fromLng);
    setToLat(arrLat ?? toLat);
    setToLng(arrLng ?? toLng);
    setDepartTime(parseLocalTime(flight.departure?.scheduledTime?.local ?? ""));
    setArriveTime(parseLocalTime(flight.arrival?.scheduledTime?.local ?? ""));
    setAirline(flight.airline?.name ?? airline);
    setAircraft(flight.aircraft?.model ?? "");
    // Auto-compute great-circle distance from the coordinates the API just gave us
    if (depLat && depLng && arrLat && arrLng) {
      const toRad = d => d * Math.PI / 180;
      const R = 3959;
      const dLat = toRad(arrLat - depLat), dLng = toRad(arrLng - depLng);
      const a = Math.sin(dLat/2)**2 + Math.cos(toRad(depLat)) * Math.cos(toRad(arrLat)) * Math.sin(dLng/2)**2;
      const mi = 2 * R * Math.asin(Math.sqrt(a));
      const hrs = mi / 500 + 0.75;
      const h = Math.floor(hrs), m = Math.round((hrs - h) * 60);
      setRouteDistance(`${Math.round(mi).toLocaleString()} mi`);
      if (!routeDuration) setRouteDuration(h > 0 ? `${h}h ${m}m` : `${m}m`);
    }
    setLookupResults(null);
    setLookupErr(null);
  }

  async function lookupFlight() {
    const fn = flightNum.trim().replace(/\s+/g, "");
    if (!fn) return;
    if (!aeroDataBoxKey) { setLookupErr("Add your AeroDataBox API key in Settings → Connections."); return; }
    const date = calendarDate || departDate;
    if (!date) { setLookupErr("Set the itinerary departure date first."); return; }
    setLookupLoading(true); setLookupErr(null); setLookupResults(null);
    try {
      const res = await fetch(
        `https://aerodatabox.p.rapidapi.com/flights/number/${encodeURIComponent(fn)}/${date}`,
        { headers: { "X-RapidAPI-Key": aeroDataBoxKey, "X-RapidAPI-Host": "aerodatabox.p.rapidapi.com" } }
      );
      if (!res.ok) { setLookupErr(`Flight not found for ${fn} on ${date}.`); return; }
      const data = await res.json();
      const results = (Array.isArray(data) ? data : [data]).filter(Boolean);
      if (!results.length) { setLookupErr("No results."); return; }
      if (results.length === 1) { applyFlightResult(results[0]); }
      else { setLookupResults(results); }
    } catch { setLookupErr("Lookup failed — check your API key."); }
    finally { setLookupLoading(false); }
  }

  function handleSwap() {
    const tmpName = fromName, tmpCode = fromCode, tmpAddr = fromAddr;
    const tmpLat  = fromLat,  tmpLng  = fromLng;
    setFromName(toName); setFromCode(toCode); setFromAddr(toAddr);
    setFromLat(toLat);   setFromLng(toLng);
    setToName(tmpName);  setToCode(tmpCode);  setToAddr(tmpAddr);
    setToLat(tmpLat);    setToLng(tmpLng);
  }

  async function fetchRoute() {
    if (!fromName && !fromLat) return;
    if (!toName   && !toLat)   return;
    setRouteLoading(true);
    setRouteDuration(""); setRouteDistance(""); setRoutePath(null);
    try {
      const { provider } = getStoredProviderSettings();
      const distUnit = provider === "apple" ? "mi" : "km"; // approximate; we'll convert below

      if (mode === "flight") {
        // Great-circle distance (Haversine)
        const toRad = d => d * Math.PI / 180;
        const R = 3959; // miles
        const dLat = toRad((toLat || 0) - (fromLat || 0));
        const dLng = toRad((toLng || 0) - (fromLng || 0));
        const a = Math.sin(dLat/2)**2 + Math.cos(toRad(fromLat||0)) * Math.cos(toRad(toLat||0)) * Math.sin(dLng/2)**2;
        const mi = 2 * R * Math.asin(Math.sqrt(a));
        const hrs = mi / 500 + 0.75; // rough 500mph cruise + boarding buffer
        const h = Math.floor(hrs), m = Math.round((hrs - h) * 60);
        setRouteDistance(`${Math.round(mi).toLocaleString()} mi`);
        setRouteDuration(h > 0 ? `${h}h ${m}m` : `${m}m`);

      } else if (mode === "boat") {
        if (!fromLat || !toLat) {
          setRouteDuration("Select From/To locations to get route");
        } else if (!routeServerUrl) {
          setRouteDuration("No route server configured");
        } else {
          const res = await fetch(`${routeServerUrl.replace(/\/$/, "")}/route`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ start: `${fromLat}, ${fromLng}`, end: `${toLat}, ${toLng}` }),
          });
          if (res.ok) {
            const gpxText = await res.text();
            const doc = new DOMParser().parseFromString(gpxText, "text/xml");

            // Extract waypoints (used for both nm calculation and route path)
            const ptEls = [...doc.getElementsByTagName("rtept"), ...doc.getElementsByTagName("trkpt")];
            const path = ptEls
              .map(p => [parseFloat(p.getAttribute("lat")), parseFloat(p.getAttribute("lon"))])
              .filter(([a, b]) => !isNaN(a) && !isNaN(b));
            if (path.length >= 2) setRoutePath(path);

            // Extract nm from <desc> first, fall back to computing from path
            const desc = doc.getElementsByTagName("desc")[0]?.textContent || "";
            const descMatch = desc.match(/([\d.]+)\s*nm/i);
            let nm = descMatch ? parseFloat(descMatch[1]) : null;
            if (nm == null && path.length >= 2) {
              const R = 3440.065;
              let total = 0;
              for (let i = 1; i < path.length; i++) {
                const [lat1, lon1] = path[i-1], [lat2, lon2] = path[i];
                const dLat = (lat2-lat1)*Math.PI/180, dLon = (lon2-lon1)*Math.PI/180;
                const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
                total += 2*R*Math.asin(Math.sqrt(a));
              }
              nm = Math.round(total * 10) / 10;
            }
            if (nm != null) {
              const spd = parseFloat(cruisingSpeed) || 5.5;
              const hrs = nm / spd;
              const h = Math.floor(hrs), mn = Math.round((hrs - h) * 60);
              setRouteDistance(`${nm} nm`);
              setRouteDuration(h > 0 ? `~${h}h ${mn}m` : `~${mn}m`);
            }
          } else {
            setRouteDuration(`Route server error (${res.status})`);
          }
        }

      } else if (provider === "apple") {
        const appleModeMap = { car:"DRIVING", walk:"WALKING", train:"TRANSIT", ferry:"TRANSIT", other:"DRIVING" };
        const mk = await loadLocApple();
        const result = await appleFetchDirections(mk, fromAddr || fromName, toAddr || toName, appleModeMap[mode] || "DRIVING");
        // appleFetchDirections returns pre-formatted distance/duration strings + routePath
        if (result?.distance) setRouteDistance(convertDist(result.distance));
        if (result?.duration) {
          setRouteDuration(result.duration);
          applyEta(result.duration);
        }
        if (result?.routePath?.length >= 2) setRoutePath(result.routePath);

      } else {
        // Google Directions — load routes library
        const k = (() => { try { return JSON.parse(localStorage.getItem("travelSettings") || "{}").googleMapsKey ?? ""; } catch { return ""; } })();
        setOptions({ key: k, version: "weekly" });
        const routesLib = await importLibrary("routes");
        const { DirectionsService, TravelMode } = routesLib;
        const googleModeMap = { car:"DRIVING", walk:"WALKING", train:"TRANSIT", ferry:"TRANSIT", other:"DRIVING" };
        const origin      = fromLat ? { lat: fromLat, lng: fromLng } : fromAddr || fromName;
        const destination = toLat   ? { lat: toLat,   lng: toLng   } : toAddr   || toName;
        const result = await new DirectionsService().route({ origin, destination, travelMode: TravelMode[googleModeMap[mode] || "DRIVING"] });
        const leg = result.routes[0]?.legs[0];
        if (leg) {
          setRouteDistance(convertDist(leg.distance.text));
          const dur = leg.duration.text;
          setRouteDuration(dur);
          applyEta(dur);
          // Extract path from step geometry
          const path = [];
          (leg.steps || []).forEach(step => {
            (step.path || []).forEach(pt => {
              const lat = typeof pt.lat === "function" ? pt.lat() : pt.lat;
              const lng = typeof pt.lng === "function" ? pt.lng() : pt.lng;
              if (lat != null && lng != null) path.push([lat, lng]);
            });
          });
          if (path.length >= 2) setRoutePath(path);
        }
      }
    } catch (e) {
      console.warn("fetchRoute error:", e?.message || e);
    } finally {
      setRouteLoading(false);
    }
  }

  function handleAdd() {
    const item = {
      _origType: editItem?._origType,
      id: editItem?.id || crypto.randomUUID(),
      mode,
      from: { name: fromName, code: fromCode, address: fromAddr, lat: fromLat, lng: fromLng },
      to:   { name: toName,   code: toCode,   address: toAddr,   lat: toLat,   lng: toLng   },
      departDate, departTime, arriveDate, arriveTime, notes,
      airline, aircraft, flightNum, seat, confirmation, terminal, bags,
      vehicle, plate, parking, operator, trainNum, carSeat, platform, vessel, travelClass, ticket,
      boatVessel, cruisingSpeed, description,
      routeDistance, routeDuration, routePath,
      addedAt: editItem?.addedAt || new Date().toISOString(),
    };
    if (editItem && onUpdate) {
      onUpdate(item);
    } else {
      onAdd(item);
    }
    onClose();
  }

  const currentMode = TRAVEL_MODES.find(m => m.id === mode) ?? TRAVEL_MODES[0];
  const modeName = currentMode.label;

  return (
    <div style={{
      display: "flex", flexDirection: "column", height: "100%",
      background: ATP.surface, color: ATP.text, fontFamily: "inherit",
    }}>

      {/* ── Header ── */}
      <div style={{
        display: "flex", alignItems: "center", gap: 12,
        padding: "16px 20px", borderBottom: "1px solid " + ATP.border, flexShrink: 0,
      }}>
        <div style={{
          width: 32, height: 32, borderRadius: 8, flexShrink: 0,
          background: ATP.accentSoft, color: ATP.accent,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          {currentMode.glyph}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: ATP.text, lineHeight: 1.2 }}>Add travel</div>
          <div style={{
            fontSize: 11.5, color: ATP.textMuted, marginTop: 2,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>{dayLabel}</div>
        </div>
        <button onClick={onClose} style={{
          width: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center",
          background: "none", border: "1px solid " + ATP.border, borderRadius: 6,
          cursor: "pointer", color: ATP.textMuted, flexShrink: 0,
        }}>
          {AddGlyph.close}
        </button>
      </div>

      {/* ── Forwarding strip ── */}
      <div className="add-panel-fwd-strip" style={{
        display: "flex", alignItems: "center", gap: 10,
        padding: "12px 20px", background: ATP.surface2, borderBottom: "1px solid " + ATP.border,
        flexShrink: 0,
      }}>
        <span style={{ color: ATP.textMuted, display: "flex", flexShrink: 0 }}>{AddGlyph.forward}</span>
        <span style={{ fontSize: 12, color: ATP.textMuted, lineHeight: 1.4 }}>
          Have a confirmation email? Forward to{" "}
          <span style={{ color: ATP.accent, fontWeight: 500 }}>you@in.travelitinerary.app</span>{" "}
          <button style={{
            background: "none", border: "none", color: ATP.accent, fontSize: 12,
            fontFamily: "inherit", cursor: "pointer", padding: 0, fontWeight: 500,
          }} onClick={() => {
            try { navigator.clipboard.writeText("you@in.travelitinerary.app"); } catch {}
          }}>Copy</button>
        </span>
      </div>

      {/* ── Scrollable body ── */}
      <div style={{ flex: 1, overflowY: "auto" }}>

        {/* ── Mode section ── */}
        <div style={{ padding: "18px 20px", borderBottom: "1px solid " + ATP.border }}>
          <div style={{ ...ATP_LABEL, marginBottom: 10 }}>MODE</div>
          <div style={{
            display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 6,
          }}>
            {TRAVEL_MODES.map(m => (
              <button key={m.id} onClick={() => setMode(m.id)} style={{
                display: "flex", flexDirection: "column", alignItems: "center", gap: 5,
                padding: "10px 4px", borderRadius: 8, cursor: "pointer", fontFamily: "inherit",
                fontSize: 11, fontWeight: 600, border: "1px solid",
                background:  mode === m.id ? ATP.accent      : ATP.surface,
                color:       mode === m.id ? "#fff"           : ATP.text,
                borderColor: mode === m.id ? ATP.accent       : ATP.border,
                boxShadow:   mode === m.id ? `0 0 0 3px ${ATP.accentSoft}` : "none",
              }}>
                <span style={{ opacity: mode === m.id ? 1 : 0.55 }}>{m.glyph}</span>
                {m.label}
              </button>
            ))}
          </div>
        </div>

        {/* ── Route section ── */}
        <div style={{ padding: "18px 20px", borderBottom: "1px solid " + ATP.border }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <div style={ATP_LABEL}>ROUTE</div>
            <button onClick={handleSwap} style={{
              background: "none", border: "none", color: ATP.accent, fontSize: 12,
              fontFamily: "inherit", cursor: "pointer", fontWeight: 500, padding: 0,
            }}>↺ Reverse</button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "20px 1fr 28px", gap: "0 8px" }}>

            {/* Spine */}
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", paddingTop: 36 }}>
              <div style={{
                width: 9, height: 9, borderRadius: "50%",
                border: "2px solid currentColor", background: "#fff", flexShrink: 0,
                color: ATP.text,
              }} />
              <div style={{ flex: 1, width: 1.5, background: ATP.border, minHeight: 16, margin: "4px 0" }} />
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ color: ATP.accent }}>
                <path d="M8 2C5.24 2 3 4.24 3 7c0 3.75 5 9 5 9s5-5.25 5-9c0-2.76-2.24-5-5-5z" fill="#0b3d6b"/>
                <circle cx="8" cy="7" r="1.8" fill="#fff"/>
              </svg>
            </div>

            {/* Inputs */}
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {/* From */}
              <div>
                <label style={ATP_LABEL}>From</label>
                <div style={{ position: "relative" }}>
                  <input
                    type="text"
                    value={fromCode ? `${fromCode}  ${fromName}` : fromName}
                    placeholder="City, airport, or address"
                    style={{ ...ATP_INPUT, fontFamily: fromCode ? "ui-monospace,SFMono-Regular,Menlo,monospace" : "inherit" }}
                    onChange={e => {
                      const val = e.target.value;
                      setFromName(val); setFromCode(""); setFromAddr(""); setFromLat(null); setFromLng(null);
                      clearTimeout(fromDebounce.current);
                      fromDebounce.current = setTimeout(() => searchPlace(val, setFromPreds, null), 300);
                    }}
                    onFocus={e => {
                      if (!fromName) return;
                      clearTimeout(fromDebounce.current);
                      fromDebounce.current = setTimeout(() => searchPlace(fromName, setFromPreds, null), 300);
                    }}
                  />
                  {fromPreds.length > 0 && (
                    <div style={{
                      position: "absolute", zIndex: 50, top: "calc(100% + 4px)", left: 0, right: 0,
                      background: "#fff", border: "1px solid " + ATP.border, borderRadius: 8,
                      boxShadow: "0 4px 16px rgba(0,0,0,0.10)", overflow: "hidden",
                    }}>
                      {fromPreds.map((p, i) => (
                        <div key={i}
                          onMouseDown={e => {
                            e.preventDefault();
                            resolvePred(p, setFromName, setFromCode, setFromAddr, setFromLat, setFromLng, setFromPreds);
                          }}
                          style={{
                            padding: "9px 12px", cursor: "pointer",
                            borderBottom: i < fromPreds.length - 1 ? "1px solid " + ATP.border : "none",
                          }}
                          onMouseEnter={e => e.currentTarget.style.background = ATP.surface2}
                          onMouseLeave={e => e.currentTarget.style.background = "#fff"}
                        >
                          <div style={{ fontSize: 13, fontWeight: 600, color: ATP.text }}>{p.name}</div>
                          {p.subtitle && <div style={{ fontSize: 11.5, color: ATP.textFaint, marginTop: 1 }}>{p.subtitle}</div>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* To */}
              <div>
                <label style={ATP_LABEL}>To</label>
                <div style={{ position: "relative" }}>
                  <input
                    type="text"
                    value={toCode ? `${toCode}  ${toName}` : toName}
                    placeholder="City, airport, or address"
                    style={{ ...ATP_INPUT, fontFamily: toCode ? "ui-monospace,SFMono-Regular,Menlo,monospace" : "inherit" }}
                    onChange={e => {
                      const val = e.target.value;
                      setToName(val); setToCode(""); setToAddr(""); setToLat(null); setToLng(null);
                      clearTimeout(toDebounce.current);
                      toDebounce.current = setTimeout(() => searchPlace(val, setToPreds, null), 300);
                    }}
                    onFocus={e => {
                      if (!toName) return;
                      clearTimeout(toDebounce.current);
                      toDebounce.current = setTimeout(() => searchPlace(toName, setToPreds, null), 300);
                    }}
                  />
                  {toPreds.length > 0 && (
                    <div style={{
                      position: "absolute", zIndex: 50, top: "calc(100% + 4px)", left: 0, right: 0,
                      background: "#fff", border: "1px solid " + ATP.border, borderRadius: 8,
                      boxShadow: "0 4px 16px rgba(0,0,0,0.10)", overflow: "hidden",
                    }}>
                      {toPreds.map((p, i) => (
                        <div key={i}
                          onMouseDown={e => {
                            e.preventDefault();
                            resolvePred(p, setToName, setToCode, setToAddr, setToLat, setToLng, setToPreds);
                          }}
                          style={{
                            padding: "9px 12px", cursor: "pointer",
                            borderBottom: i < toPreds.length - 1 ? "1px solid " + ATP.border : "none",
                          }}
                          onMouseEnter={e => e.currentTarget.style.background = ATP.surface2}
                          onMouseLeave={e => e.currentTarget.style.background = "#fff"}
                        >
                          <div style={{ fontSize: 13, fontWeight: 600, color: ATP.text }}>{p.name}</div>
                          {p.subtitle && <div style={{ fontSize: 11.5, color: ATP.textFaint, marginTop: 1 }}>{p.subtitle}</div>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Swap column */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", paddingTop: 36 }}>
              <button onClick={handleSwap} style={{
                width: 28, height: 28, borderRadius: "50%", border: "1px solid " + ATP.border,
                background: ATP.surface2, cursor: "pointer", display: "flex",
                alignItems: "center", justifyContent: "center", color: ATP.textMuted,
                fontSize: 14, fontFamily: "inherit",
              }}>↕</button>
            </div>

          </div>
        </div>

        {/* ── When section ── */}
        <div style={{ padding: "18px 20px", borderBottom: "1px solid " + ATP.border }}>
          <div style={{ ...ATP_LABEL, marginBottom: 12 }}>WHEN</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {/* Depart */}
            <div>
              <label style={ATP_LABEL}>
                {mode === "boat" ? "Plan to depart · flexible" : "Depart"}
              </label>
              <input type="date" value={departDate} onChange={e => setDepartDate(e.target.value)}
                style={{
                  width: "100%", border: "none", borderBottom: "1px solid " + ATP.border,
                  background: "transparent", fontSize: 13, fontFamily: "inherit",
                  color: ATP.text, outline: "none", padding: "4px 0", boxSizing: "border-box",
                  marginBottom: 4,
                }}
              />
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <div style={{ position: "relative", flex: 1 }}>
                  <input type="time" value={departTime}
                    onChange={e => {
                      const v = e.target.value;
                      setDepartTime(v);
                      if (v && routeDuration) applyEta(routeDuration, v);
                    }}
                    onFocus={() => setDepartTimeFocused(true)}
                    onBlur={() => setDepartTimeFocused(false)}
                    style={{
                      width: "100%", border: "none", borderBottom: "1px solid " + ATP.border,
                      background: "transparent", fontSize: 13, fontFamily: "inherit",
                      color: (departTime || departTimeFocused) ? ATP.text : "transparent",
                      outline: "none", padding: "4px 0", boxSizing: "border-box", cursor: "pointer",
                    }}
                  />
                  {!departTime && !departTimeFocused && <span style={{ position:"absolute", inset:0, display:"flex", alignItems:"center", color:ATP.textFaint, fontSize:13, pointerEvents:"none" }}>—</span>}
                </div>
                {departTime && <button onClick={() => setDepartTime("")} style={{ background:"none", border:"none", color:ATP.textFaint, cursor:"pointer", fontSize:14, padding:"0 2px", lineHeight:1 }}>×</button>}
                <span style={{ fontSize: 11, color: ATP.textFaint }}>local</span>
              </div>
            </div>
            {/* Arrive */}
            <div>
              <label style={ATP_LABEL}>
                {mode === "flight" ? "Arrive" :
                 mode === "boat"   ? `ETA · at ${cruisingSpeed} kn cruise` :
                 "Arrive · estimated"}
              </label>
              <input type="date" value={arriveDate} onChange={e => setArriveDate(e.target.value)}
                style={{
                  width: "100%", border: "none", borderBottom: "1px solid " + ATP.border,
                  background: "transparent", fontSize: 13, fontFamily: "inherit",
                  color: ATP.text, outline: "none", padding: "4px 0", boxSizing: "border-box",
                  marginBottom: 4,
                }}
              />
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <div style={{ position: "relative", flex: 1 }}>
                  <input type="time" value={arriveTime} onChange={e => setArriveTime(e.target.value)}
                    onFocus={() => setArriveTimeFocused(true)}
                    onBlur={() => setArriveTimeFocused(false)}
                    style={{
                      width: "100%", border: "none", borderBottom: "1px solid " + ATP.border,
                      background: "transparent", fontSize: 13, fontFamily: "inherit",
                      color: (arriveTime || arriveTimeFocused) ? ATP.text : "transparent",
                      outline: "none", padding: "4px 0", boxSizing: "border-box", cursor: "pointer",
                    }}
                  />
                  {!arriveTime && !arriveTimeFocused && <span style={{ position:"absolute", inset:0, display:"flex", alignItems:"center", color:ATP.textFaint, fontSize:13, pointerEvents:"none" }}>—</span>}
                </div>
                {arriveTime && <button onClick={() => setArriveTime("")} style={{ background:"none", border:"none", color:ATP.textFaint, cursor:"pointer", fontSize:14, padding:"0 2px", lineHeight:1 }}>×</button>}
                <span style={{ fontSize: 11, color: ATP.textFaint }}>local</span>
              </div>
            </div>
          </div>
          {/* Metadata strip */}
          <div style={{
            marginTop: 10, background: ATP.surface2, border: "1px solid " + ATP.border,
            borderRadius: 7, padding: "8px 12px",
            display: "flex", alignItems: "center", gap: 10,
          }}>
            <span style={{ fontSize: 12, color: ATP.textMuted, flex: 1, fontVariantNumeric: "tabular-nums" }}>
              {routeLoading ? "Getting route…" : (routeDuration || routeDistance)
                ? <><strong style={{ color: ATP.text }}>{routeDuration}</strong>{routeDuration && routeDistance ? " · " : ""}<strong style={{ color: ATP.text }}>{routeDistance}</strong></>
                : <span style={{ color: ATP.textFaint }}>—</span>}
            </span>
            {mode === "flight" && aeroDataBoxKey && (
              <button
                onClick={lookupFlight}
                disabled={lookupLoading || !flightNum.trim()}
                style={{
                  background: ATP.accentSoft, border: "1px solid " + ATP.accent, borderRadius: 6,
                  fontSize: 11.5, fontFamily: "inherit", padding: "4px 10px", cursor: "pointer",
                  fontWeight: 600, whiteSpace: "nowrap", color: ATP.accent,
                  opacity: !flightNum.trim() ? 0.45 : 1,
                }}>
                {lookupLoading ? "Looking up…" : "🔍 Look up flight"}
              </button>
            )}
            <button
              onClick={fetchRoute}
              disabled={routeLoading || (!fromName && !fromLat) || (!toName && !toLat)}
              style={{
                background: "none", border: "1px solid " + ATP.border, borderRadius: 6,
                fontSize: 11.5, fontFamily: "inherit", padding: "4px 10px", cursor: "pointer",
                fontWeight: 500, whiteSpace: "nowrap",
                color: routeLoading ? ATP.textFaint : ATP.accent,
                opacity: (!fromName && !fromLat) || (!toName && !toLat) ? 0.45 : 1,
              }}>
              {mode === "flight" ? "📐 Get distance"
                : mode === "boat" ? "📍 Get route"
                : mode === "walk" ? "🚶 Get directions"
                : mode === "train" || mode === "ferry" ? "🚉 Get directions"
                : "🗺 Get directions"}
            </button>
          </div>
          {/* Lookup error / multi-result picker */}
          {lookupErr && (
            <div style={{ marginTop: 6, fontSize: 11.5, color: ATP.red }}>{lookupErr}</div>
          )}
          {lookupResults && (
            <div style={{ marginTop: 8, border: "1px solid " + ATP.border, borderRadius: 7, overflow: "hidden" }}>
              <div style={{ ...ATP_LABEL, padding: "6px 10px", borderBottom: "1px solid " + ATP.border }}>
                Multiple flights found — pick one
              </div>
              {lookupResults.map((f, i) => {
                const dep = f.departure?.airport;
                const arr = f.arrival?.airport;
                const fmtT = s => { if (!s) return null; const p = s.includes("T") ? s.split("T")[1] : s.split(" ")[1]; return p?.slice(0,5) ?? null; };
                const depTime = fmtT(f.departure?.scheduledTime?.local);
                const arrTime = fmtT(f.arrival?.scheduledTime?.local);
                const airline = f.airline?.name;
                const status = f.status;
                return (
                  <button key={i} onClick={() => applyFlightResult(f)} style={{
                    display: "block", width: "100%", padding: "10px 14px", background: "none",
                    border: "none", borderBottom: i < lookupResults.length - 1 ? "1px solid " + ATP.border : "none",
                    cursor: "pointer", fontFamily: "inherit", textAlign: "left",
                  }}
                    onMouseEnter={e => e.currentTarget.style.background = ATP.surface2}
                    onMouseLeave={e => e.currentTarget.style.background = "none"}
                  >
                    {/* Route line */}
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                      <div>
                        <span style={{ fontSize: 14, fontWeight: 700, fontFamily: "ui-monospace,monospace" }}>{dep?.iata}</span>
                        {dep?.municipalityName && <span style={{ fontSize: 12, color: ATP.textMuted, marginLeft: 4 }}>{dep.municipalityName}</span>}
                      </div>
                      <span style={{ color: ATP.textFaint, fontSize: 12 }}>→</span>
                      <div>
                        <span style={{ fontSize: 14, fontWeight: 700, fontFamily: "ui-monospace,monospace" }}>{arr?.iata}</span>
                        {arr?.municipalityName && <span style={{ fontSize: 12, color: ATP.textMuted, marginLeft: 4 }}>{arr.municipalityName}</span>}
                      </div>
                      {status && status !== "Unknown" && (
                        <span style={{ marginLeft: "auto", fontSize: 10.5, fontWeight: 600,
                          padding: "1px 7px", borderRadius: 4,
                          background: status === "Arrived" ? "#f0fdf4" : status === "Departed" ? "#eff6ff" : ATP.surface2,
                          color: status === "Arrived" ? "#16a34a" : status === "Departed" ? "#2563eb" : ATP.textMuted }}>
                          {status}
                        </span>
                      )}
                    </div>
                    {/* Details line */}
                    <div style={{ display: "flex", gap: 12, fontSize: 11.5, color: ATP.textMuted }}>
                      {depTime && <span>Departs {depTime}</span>}
                      {arrTime && <span>Arrives {arrTime}</span>}
                      {airline && <span>· {airline}</span>}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Route preview map ── */}
        {(fromLat && fromLng && toLat && toLng) && (
          <div style={{ padding: "14px 20px", borderBottom: "1px solid " + ATP.border }}>
            <div style={{ ...ATP_LABEL, marginBottom: 10 }}>ROUTE PREVIEW</div>
            <div style={{ borderRadius: 10, overflow: "hidden", border: "1px solid " + ATP.border }}>
              <TravelRouteMap
                fromLat={fromLat} fromLng={fromLng} fromName={fromName}
                toLat={toLat}     toLng={toLng}     toName={toName}
                routePath={routePath}
                height={160}
              />
            </div>
          </div>
        )}

        {/* ── Details section ── */}
        <div style={{ padding: "18px 20px", borderBottom: "1px solid " + ATP.border }}>
          <div style={{ ...ATP_LABEL, marginBottom: 12 }}>{modeName} details</div>

          {/* flight details */}
          {mode === "flight" && (
            <div>
              <div style={{ display: "flex", gap: 10, marginBottom: 8 }}>
                <div style={{ flex: 1 }}>
                  <label style={ATP_LABEL}>Airline</label>
                  <input type="text" value={airline} onChange={e => setAirline(e.target.value)}
                    placeholder="e.g. TAP Air Portugal" style={ATP_INPUT} />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={ATP_LABEL}>Flight #</label>
                  <input type="text" value={flightNum} onChange={e => setFlightNum(e.target.value)}
                    placeholder="TP 123" style={{ ...ATP_INPUT, fontFamily: "ui-monospace,SFMono-Regular,Menlo,monospace" }} />
                </div>
              </div>
              <div style={{ display: "flex", gap: 10, marginBottom: 8 }}>
                <div style={{ flex: 1 }}>
                  <label style={ATP_LABEL}>Seat</label>
                  <input type="text" value={seat} onChange={e => setSeat(e.target.value)}
                    placeholder="22A" style={{ ...ATP_INPUT, fontFamily: "ui-monospace,SFMono-Regular,Menlo,monospace" }} />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={ATP_LABEL}>Confirmation</label>
                  <input type="text" value={confirmation} onChange={e => setConfirm(e.target.value)}
                    placeholder="ABCDEF" style={{ ...ATP_INPUT, fontFamily: "ui-monospace,SFMono-Regular,Menlo,monospace" }} />
                </div>
              </div>
              <div style={{ display: "flex", gap: 10, marginBottom: 10 }}>
                <div style={{ flex: 1 }}>
                  <label style={ATP_LABEL}>Terminal / Gate</label>
                  <input type="text" value={terminal} onChange={e => setTerminal(e.target.value)}
                    placeholder="T2 · B12" style={ATP_INPUT} />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={ATP_LABEL}>Bags</label>
                  <input type="text" value={bags} onChange={e => setBags(e.target.value)}
                    placeholder="1 checked" style={ATP_INPUT} />
                </div>
              </div>
              <button style={{
                width: "100%", border: "1px dashed " + ATP.border, borderRadius: 7,
                background: "none", color: ATP.textMuted, fontSize: 12,
                fontFamily: "inherit", padding: "9px 12px", cursor: "pointer",
              }}>+ Add connection</button>
            </div>
          )}

          {/* car details */}
          {mode === "car" && (
            <div>
              <div style={{ display: "flex", gap: 10, marginBottom: 8 }}>
                <div style={{ flex: 1 }}>
                  <label style={ATP_LABEL}>Vehicle</label>
                  <input type="text" value={vehicle} onChange={e => setVehicle(e.target.value)}
                    placeholder="e.g. Toyota RAV4" style={ATP_INPUT} />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={ATP_LABEL}>Plate</label>
                  <input type="text" value={plate} onChange={e => setPlate(e.target.value)}
                    placeholder="AB-1234" style={{ ...ATP_INPUT, fontFamily: "ui-monospace,SFMono-Regular,Menlo,monospace" }} />
                </div>
              </div>
              <div style={{ marginBottom: 8 }}>
                <label style={ATP_LABEL}>Confirmation</label>
                <input type="text" value={confirmation} onChange={e => setConfirm(e.target.value)}
                  placeholder="CONF-5678" style={{ ...ATP_INPUT, fontFamily: "ui-monospace,SFMono-Regular,Menlo,monospace" }} />
              </div>
              <div>
                <label style={ATP_LABEL}>Parking</label>
                <input type="text" value={parking} onChange={e => setParking(e.target.value)}
                  placeholder="Return to Hertz Terminal 1" style={ATP_INPUT} />
                <div style={{ fontSize: 11, color: ATP.textFaint, marginTop: 4 }}>
                  Where to drop off or park at destination
                </div>
              </div>
            </div>
          )}

          {/* walk details */}
          {mode === "walk" && (
            <div style={{
              background: ATP.surface2, border: "1px solid " + ATP.borderSoft,
              borderRadius: 8, padding: "12px 14px", fontSize: 12,
              color: ATP.textMuted, lineHeight: 1.5,
            }}>
              Route notes and conditions…
            </div>
          )}

          {/* train details */}
          {mode === "train" && (
            <div>
              <div style={{ display: "flex", gap: 10, marginBottom: 8 }}>
                <div style={{ flex: 1 }}>
                  <label style={ATP_LABEL}>Operator</label>
                  <input type="text" value={operator} onChange={e => setOperator(e.target.value)}
                    placeholder="e.g. Renfe" style={ATP_INPUT} />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={ATP_LABEL}>Train #</label>
                  <input type="text" value={trainNum} onChange={e => setTrainNum(e.target.value)}
                    placeholder="AVE 2093" style={{ ...ATP_INPUT, fontFamily: "ui-monospace,SFMono-Regular,Menlo,monospace" }} />
                </div>
              </div>
              <div style={{ display: "flex", gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <label style={ATP_LABEL}>Car / Seat</label>
                  <input type="text" value={carSeat} onChange={e => setCarSeat(e.target.value)}
                    placeholder="Car 5, Seat 22A" style={ATP_INPUT} />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={ATP_LABEL}>Platform</label>
                  <input type="text" value={platform} onChange={e => setPlatform(e.target.value)}
                    placeholder="Posted day-of" style={ATP_INPUT} />
                </div>
              </div>
            </div>
          )}

          {/* ferry details */}
          {mode === "ferry" && (
            <div>
              <div style={{ display: "flex", gap: 10, marginBottom: 8 }}>
                <div style={{ flex: 1 }}>
                  <label style={ATP_LABEL}>Operator</label>
                  <input type="text" value={operator} onChange={e => setOperator(e.target.value)}
                    placeholder="e.g. Brittany Ferries" style={ATP_INPUT} />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={ATP_LABEL}>Vessel</label>
                  <input type="text" value={vessel} onChange={e => setVessel(e.target.value)}
                    placeholder="MV Armorique" style={ATP_INPUT} />
                </div>
              </div>
              <div style={{ display: "flex", gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <label style={ATP_LABEL}>Class</label>
                  <input type="text" value={travelClass} onChange={e => setTravelClass(e.target.value)}
                    placeholder="Economy / Cabin" style={ATP_INPUT} />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={ATP_LABEL}>Ticket / Confirmation</label>
                  <input type="text" value={ticket} onChange={e => setTicket(e.target.value)}
                    placeholder="FRY-9923" style={{ ...ATP_INPUT, fontFamily: "ui-monospace,SFMono-Regular,Menlo,monospace" }} />
                </div>
              </div>
            </div>
          )}

          {/* boat details */}
          {mode === "boat" && (
            <div>
              <div style={{ marginBottom: 10 }}>
                <label style={ATP_LABEL}>Vessel</label>
                <input type="text" value={boatVessel} onChange={e => setBoatVessel(e.target.value)}
                  placeholder="S/V Name or Charter · Sunsail 38" style={ATP_INPUT} />
              </div>
              <div style={{ marginBottom: 6 }}>
                <label style={ATP_LABEL}>Cruising speed</label>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {editingSpeed ? (
                    <input
                      type="text"
                      value={cruisingSpeed}
                      autoFocus
                      onChange={e => setCruisingSpeed(e.target.value)}
                      onBlur={() => setEditingSpeed(false)}
                      style={{ ...ATP_INPUT, width: 80 }}
                    />
                  ) : (
                    <button onClick={() => setEditingSpeed(true)} style={{
                      background: "none", border: "none", fontSize: 13,
                      color: ATP.text, fontFamily: "inherit", cursor: "text",
                      padding: 0,
                    }}>{cruisingSpeed} kn</button>
                  )}
                </div>
              </div>
              <button disabled style={{
                background: "none", border: "none", color: ATP.textFaint,
                fontSize: 11.5, fontFamily: "inherit", cursor: "default", padding: 0,
                marginBottom: 12,
              }}>+ Save this vessel — coming with logbook</button>
              <div style={{
                border: "1px solid " + ATP.border, borderRadius: 8, padding: "14px 16px",
              }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: ATP.text, marginBottom: 4 }}>
                  ⛵ Vessel logbook — coming soon
                </div>
                <div style={{ fontSize: 12, color: ATP.textMuted, lineHeight: 1.5 }}>
                  Tide · wind · swell at your departure marina, vessel profiles, and engine/fuel tracking.
                </div>
                <a href="#" style={{
                  fontSize: 12, color: ATP.accent, fontWeight: 500, marginTop: 8,
                  display: "inline-block", textDecoration: "none",
                }}>Join the beta →</a>
              </div>
            </div>
          )}

          {/* other details */}
          {mode === "other" && (
            <div>
              <label style={ATP_LABEL}>Describe this leg</label>
              <input type="text" value={description} onChange={e => setDescription(e.target.value)}
                placeholder="e.g. tuk-tuk, bike, horseback…" style={ATP_INPUT} />
            </div>
          )}
        </div>

        {/* ── Extras section ── */}
        <div style={{ padding: "18px 20px", borderBottom: "1px solid " + ATP.border }}>
          <div style={{ ...ATP_LABEL, marginBottom: 12 }}>EXTRAS</div>
          <div style={{ marginBottom: 12 }}>
            <label style={ATP_LABEL}>Notes</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Add any notes…"
              style={{
                width: "100%", background: ATP.surface, border: "1px solid " + ATP.border,
                color: ATP.text, borderRadius: 7, padding: "10px 12px",
                fontSize: 12.5, fontFamily: "inherit", outline: "none",
                boxSizing: "border-box", resize: "vertical", minHeight: 56, lineHeight: 1.5,
              }}
            />
          </div>
          <div style={{ marginBottom: 12 }}>
            <button style={{
              display: "flex", alignItems: "center", gap: 8,
              background: ATP.surface2, border: "1px dashed " + ATP.border,
              borderRadius: 7, padding: "9px 12px", cursor: "pointer",
              fontFamily: "inherit", color: ATP.textMuted, fontSize: 12,
            }}>📎 Attach file</button>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
            <div style={{ display: "flex" }}>
              {[
                { initials: "SH", bg: "linear-gradient(135deg,#4a90d9,#0b3d6b)" },
                { initials: "JY", bg: "linear-gradient(135deg,#f5a623,#e07b2b)" },
              ].map((av, i) => (
                <div key={i} style={{
                  width: 28, height: 28, borderRadius: "50%", background: av.bg,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  color: "#fff", fontSize: 10, fontWeight: 700,
                  marginLeft: i === 0 ? 0 : -8, border: "2px solid #fff",
                  zIndex: 2 - i, position: "relative",
                }}>{av.initials}</div>
              ))}
            </div>
            <span style={{ fontSize: 12, color: ATP.textMuted, flex: 1 }}>Sam + Jules · all trip travelers</span>
            <button style={{
              background: "none", border: "none", color: ATP.accent,
              fontSize: 12, fontFamily: "inherit", cursor: "pointer", fontWeight: 500,
            }}>Change</button>
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
            <div
              onClick={() => setRepeatReturn(r => !r)}
              style={{
                width: 16, height: 16, borderRadius: 4, flexShrink: 0,
                border: "1.5px solid " + (repeatReturn ? ATP.accent : ATP.border),
                background: repeatReturn ? ATP.accent : "#fff",
                display: "flex", alignItems: "center", justifyContent: "center",
                cursor: "pointer",
              }}
            >
              {repeatReturn && (
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                  <path d="M1.5 5l2.5 2.5 4.5-4" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              )}
            </div>
            <span style={{ fontSize: 12.5, color: ATP.textMuted }}>Repeat for return trip</span>
          </label>
        </div>

      </div>
      {/* ── Footer ── */}
      <div style={{
        padding: "14px 20px", borderTop: "1px solid " + ATP.border,
        background: ATP.surface2, flexShrink: 0,
        display: "flex", alignItems: "center", gap: 10,
      }}>
        <button onClick={onClose} style={{
          background: "none", border: "1px solid " + ATP.border, color: ATP.textMuted,
          borderRadius: 8, padding: "8px 16px", fontSize: 13, fontFamily: "inherit",
          cursor: "pointer", fontWeight: 500,
        }}>Cancel</button>
        <div style={{ flex: 1, textAlign: "center" }}>
          <span style={{ fontSize: 11.5, color: ATP.textFaint }}>
            <span style={{ color: ATP.accent }}>●</span> Saving as draft
          </span>
        </div>
        {!readOnly && (
          <button onClick={handleAdd} style={{
            background: ATP.accent, border: "none", color: "#fff",
            borderRadius: 8, padding: "8px 18px", fontSize: 13, fontFamily: "inherit",
            cursor: "pointer", fontWeight: 600,
          }}>{editItem ? "Save changes" : "Add to itinerary"}</button>
        )}
      </div>
    </div>
  );
}

// ── End AddTravelPanel ────────────────────────────────────────────────────────

export default function Itinerary() {
  const [activeTab,        setActiveTab]        = useState("itinerary");
  const [startDate,        setStartDate]        = useState(() => _db?.startDate ?? "");
  const [customNotes,      setCustomNotes]      = useState(() => _extracted.notes);
  const [editingNoteDay,   setEditingNoteDay]   = useState(null);
  const [noteDraft,        setNoteDraft]        = useState("");
  const [savedPlaces,      setSavedPlaces]      = useState(() => _extracted.places);
  const [savedDirections,  setSavedDirections]  = useState(() => _extracted.directions);
  const [savedRoutes,      setSavedRoutes]      = useState(() => _extracted.routes);
  const [savedFlights,     setSavedFlights]     = useState(() => _extracted.flights);
  const [savedRentalCars,  setSavedRentalCars]  = useState(() => _extracted.rentalCars);
  const [days,             setDays]             = useState(() => _extracted.days);
  const [editingCoreDay,   setEditingCoreDay]   = useState(null);
  const [coreDraft,        setCoreDraft]        = useState({});
  const [confirmDeleteDay, setConfirmDeleteDay] = useState(null);
  const [settings,         setSettings]         = useState(() => {
    try {
      let p = {};
      const s = localStorage.getItem("travelSettings");
      if (s) {
        p = JSON.parse(s);
        // Migrate old flat githubToken/Repo/Branch into databases array
        if ((p.githubToken || p.githubRepo || p.githubBranch) && !p.databases) {
          p.databases = [{ id: crypto.randomUUID(), label: "Default",
            githubToken: p.githubToken ?? "", githubRepo: p.githubRepo ?? "", githubBranch: p.githubBranch ?? "" }];
          delete p.githubToken; delete p.githubRepo; delete p.githubBranch;
        }
      }
      // Auto-configure from URL when hosted on GitHub Pages and no databases set yet
      if (!p.databases?.length) {
        const repo = inferRepo();
        if (repo) {
          p.databases = [{ id: crypto.randomUUID(), label: "Personal",
            githubToken: "", githubRepo: repo, githubBranch: "data" }];
        }
      }
      if (p.databases?.length) localStorage.setItem("travelSettings", JSON.stringify(p));
      return p;
    } catch { return {}; }
  });
  const [showSettings,     setShowSettings]     = useState(false);
  const [showHistory,      setShowHistory]      = useState(false);
  const [showCommitForm,   setShowCommitForm]   = useState(false);
  const [commitDraft,      setCommitDraft]      = useState("");
  const [showCloseWarn,    setShowCloseWarn]    = useState(false);
  const [syncStatus,       setSyncStatus]       = useState("idle");
  const [syncError,        setSyncError]        = useState("");
  const [title,            setTitle]            = useState(() => _db?.title    ?? "");
  const [subtitle,         setSubtitle]         = useState(() => _db?.subtitle ?? "Princess Louisa Inlet · Vancouver · Salt Spring · Desolation Sound · Johnstone Strait · Broughtons · Gulf Islands");
  const [itineraryNotes,   setItineraryNotes]   = useState(() => _db?.itineraryNotes ?? "");
  const [editingHeader,    setEditingHeader]    = useState(false);
  const [headerDraft,      setHeaderDraft]      = useState({});
  const [editingNotes,     setEditingNotes]     = useState(false);
  const [currentFile,      setCurrentFile]      = useState(() => localStorage.getItem("travelCurrentFile"));
  const [currentDbId,      setCurrentDbId]      = useState(() => localStorage.getItem("travelCurrentDb") ?? null);
  const [urlLoad,          setUrlLoad]          = useState(() => {
    const params = new URLSearchParams(window.location.search);
    const name  = params.get("i");
    const dbId  = params.get("db") ?? null;
    if (!name) return null;
    const file = `${ITINERARIES_FOLDER}/${name}.json`;
    if (file === localStorage.getItem("travelCurrentFile")) return null;
    return { file, status: "loading", dbId };
  });
  const [saveAsName,       setSaveAsName]       = useState("");
  const [copiedICS,        setCopiedICS]        = useState(false);
  const [pickerKey,        setPickerKey]        = useState(0);
  const [showMenu,         setShowMenu]         = useState(false);
  const [confirmDelete,    setConfirmDelete]    = useState(false);
  const [menuWorking,      setMenuWorking]      = useState(false);
  const [moveToDbId,       setMoveToDbId]       = useState(null);
  const [lockedFiles,      setLockedFiles]      = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem("itineraryLocked") || "[]")); }
    catch { return new Set(); }
  });
  const [addPanel,         setAddPanel]         = useState(null);
  const [mobileSheet,      setMobileSheet]      = useState(null);
  const [geocodingDay,     setGeocodingDay]     = useState(null);
  const [locPreds,         setLocPreds]         = useState([]);
  const [locActiveDay,     setLocActiveDay]     = useState(null);
  const locDebounceRef    = useRef(null);
  const inputRef          = useRef(null);
  const syncTimerRef       = useRef(null);
  const dirtyRef           = useRef(false);
  const skipNextLoadRef    = useRef(false);
  const saveImmediatelyRef = useRef(false);

  const databases     = settings.databases ?? [];
  const currentDb     = databases.find(db => db.id === currentDbId) ?? databases[0] ?? {};
  const effectiveRepo   = currentDb.githubRepo   || inferRepo() || "";
  const effectiveBranch = currentDb.githubBranch || "data";
  const appBase = (() => {
    if (!effectiveRepo) return null;
    const [user, repo] = effectiveRepo.split("/");
    return user && repo ? `https://${user}.github.io/${repo}/` : null;
  })();
  const isLocked = !!(currentFile && currentFile !== "__local__" && lockedFiles.has(currentFile));
  const readOnly = !currentDb.githubToken || isLocked;
  const ghSettings = { githubToken: currentDb.githubToken ?? "", githubRepo: effectiveRepo, githubBranch: effectiveBranch };

  useEffect(() => {
    setEditingNoteDay(null);
    setEditingCoreDay(null); setConfirmDeleteDay(null);
  }, []);

  // Save to localStorage immediately on every change; GitHub is manual only.
  useEffect(() => {
    if (!currentFile) return;
    const data = {
      startDate, title, subtitle, itineraryNotes,
      days: days.map(d => {
        const { day: _, ...rest } = d;
        return {
          ...rest,
          note:       customNotes[String(d.day)]       ?? d.note       ?? "",
          places:     savedPlaces[String(d.day)]        ?? [],
          directions: savedDirections[String(d.day)]    ?? [],
          routes:     savedRoutes[String(d.day)]         ?? [],
          flights:    savedFlights[String(d.day)]        ?? [],
          rentalCars: savedRentalCars[String(d.day)]     ?? [],
        };
      }),
    };
    localStorage.setItem("travelItinerary", JSON.stringify(data));
    if (currentFile !== "__local__") {
      try {
        const meta = JSON.parse(localStorage.getItem("itineraryMetadata") || "{}");
        const overnights = days.map(d => d.overnight).filter(Boolean);
        const legs       = days.map(d => d.leg).filter(Boolean);
        const locations  = overnights.length >= 2 ? `${overnights[0]} → ${overnights[overnights.length - 1]}`
                         : overnights[0] ?? legs[0] ?? null;
        const todoLines = line => line.split("\n").filter(l => /^TODO:/i.test(l.trim())).map(l => l.trim().replace(/^TODO:\s*/i, ""));
        const todos = [
          ...todoLines(itineraryNotes || ""),
          ...days.flatMap(d => todoLines((customNotes[d.day] !== undefined ? customNotes[d.day] : d.note) || "")),
        ];
        let drivingKm = 0;
        Object.values(savedDirections).forEach(dirs => (dirs ?? []).forEach(d => {
          const km = d.distance?.match(/^([\d.]+)\s*km/i);
          const mi = d.distance?.match(/^([\d.]+)\s*mi/i);
          const m  = d.distance?.match(/^(\d+)\s*m\b/i);
          if (km) drivingKm += parseFloat(km[1]);
          else if (mi) drivingKm += parseFloat(mi[1]) * 1.60934;
          else if (m)  drivingKm += parseFloat(m[1]) / 1000;
        }));
        meta[`${currentDbId}:${currentFile}`] = { title, startDate, dayCount: days.length, locations, todos, drivingKm: drivingKm > 0 ? Math.round(drivingKm) : null };
        localStorage.setItem("itineraryMetadata", JSON.stringify(meta));
      } catch {}
    }
    if (dirtyRef.current && ghSettings.githubToken && effectiveRepo && currentFile !== "__local__") {
      setSyncStatus("unsaved");
    }
    dirtyRef.current = true;
  }, [currentFile, days, savedPlaces, savedDirections, savedRoutes, savedFlights, savedRentalCars, customNotes, startDate, title, subtitle, itineraryNotes]);

  useEffect(() => { localStorage.setItem("travelSettings", JSON.stringify(settings)); }, [settings]);

  useEffect(() => { document.title = title || "Travel Itinerary"; }, [title]);

  // Auto-populate centerName for days that have GPS data but no name yet
  const lastCentroidRef = useRef({});
  useEffect(() => {
    if (!days.length) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      for (const d of days) {
        if (cancelled) break;
        const centroid = computeDayCentroid(d.day, savedPlaces, savedFlights, savedDirections, savedRoutes);
        if (!centroid) continue;
        const last = lastCentroidRef.current[d.day];
        const moved = !last || Math.abs(last.lat - centroid.lat) > 0.01 || Math.abs(last.lng - centroid.lng) > 0.01;
        if (!moved) continue;
        lastCentroidRef.current[d.day] = centroid;
        if (d.centerLat !== null) continue; // user has manually set coords — don't overwrite
        const name = await reverseGeocode(centroid.lat, centroid.lng);
        if (cancelled || !name) continue;
        setDays(prev => prev.map(x => x.day === d.day
          ? { ...x, centerName: x.centerName || name, centerLat: centroid.lat, centerLng: centroid.lng }
          : x));
        await new Promise(r => setTimeout(r, 1100)); // Nominatim rate limit
      }
    }, 1000);
    return () => { cancelled = true; clearTimeout(timer); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedPlaces, savedFlights, savedDirections, savedRoutes]);

  useEffect(() => { if (!currentFile) setPickerKey(k => k + 1); }, [currentFile]);


  useEffect(() => {
    const url = new URL(window.location.href);
    if (currentFile && currentFile !== "__local__") {
      url.searchParams.set("i", currentFile.replace(/^.*\//, "").replace(/\.json$/i, ""));
      if (currentDbId) url.searchParams.set("db", currentDbId);
      else url.searchParams.delete("db");
    } else {
      url.searchParams.delete("i");
      url.searchParams.delete("db");
    }
    history.replaceState(null, "", url);
  }, [currentFile, currentDbId]);

  // Verify and load a file that arrived via ?i= URL param (tries ?db= database first, then all others)
  useEffect(() => {
    if (!urlLoad || urlLoad.status !== "loading") return;
    const dbs = settings.databases ?? [];
    const candidates = urlLoad.dbId
      ? [...dbs.filter(db => db.id === urlLoad.dbId), ...dbs.filter(db => db.id !== urlLoad.dbId)]
      : dbs;
    if (!candidates.length) { setUrlLoad(s => ({ ...s, status: "notfound" })); return; }
    (async () => {
      for (const db of candidates) {
        const repo = db.githubRepo || inferRepo() || "";
        if (!repo) continue;
        const ghs = { githubToken: db.githubToken ?? "", githubRepo: repo, githubBranch: db.githubBranch || "data" };
        const data = await loadFromGitHub({ ...ghs, githubFile: urlLoad.file }).catch(() => null);
        if (!data) continue;
        applyData(data);
        localStorage.setItem("travelCurrentFile", urlLoad.file);
        localStorage.setItem("travelCurrentDb", db.id);
        skipNextLoadRef.current = true;
        setCurrentDbId(db.id);
        setCurrentFile(urlLoad.file);
        setUrlLoad(null);
        setSyncStatus("synced");
        const urlDay = parseInt(new URLSearchParams(window.location.search).get("day"));
        const dayCount = data.days?.length ?? 0;
        if (Number.isInteger(urlDay) && urlDay >= 1 && urlDay <= dayCount) ;
        return;
      }
      setUrlLoad(s => ({ ...s, status: "notfound" }));
    })();
  }, [urlLoad?.status]);

  // Load from GitHub on mount (localStorage already loaded synchronously above)
  useEffect(() => {
    if (!effectiveRepo || !currentFile || currentFile === "__local__") return;
    if (skipNextLoadRef.current) { skipNextLoadRef.current = false; return; }
    setSyncStatus("loading");
    loadFromGitHub({ ...ghSettings, githubFile: currentFile })
      .then(data => {
        if (!data) {
          setCurrentFile(null);
          localStorage.removeItem("travelCurrentFile");
          return;
        }
        applyData(data);
        setSyncStatus("synced");
      })
      .catch(() => setSyncStatus("offline"));
  }, []);

  function startEditNote(dayNum, current) {
    setEditingNoteDay(dayNum);
    setNoteDraft(current);
    setEditingCoreDay(null);
  }

  function saveNote(dayNum) {
    dirtyRef.current = true;
    setCustomNotes(prev => ({ ...prev, [dayNum]: noteDraft }));
    setEditingNoteDay(null);
  }

  function cancelEditNote() {
    setEditingNoteDay(null);
  }

  function addPlace(dayNum, place) {
    setSavedPlaces(prev => ({ ...prev, [dayNum]: [...(prev[dayNum] ?? []), place] }));
  }

  function updatePlace(dayNum, id, updates) {
    setSavedPlaces(prev => ({
      ...prev,
      [dayNum]: (prev[dayNum] ?? []).map(p => p.id === id ? { ...p, ...updates } : p),
    }));
  }

  function deletePlace(dayNum, id) {
    setSavedPlaces(prev => ({
      ...prev,
      [dayNum]: (prev[dayNum] ?? []).filter(p => p.id !== id),
    }));
  }

  function updateDayFields(dayNum, updates) {
    setDays(prev => prev.map(d => d.day === dayNum ? { ...d, ...updates } : d));
  }

  function addFlight(dayNum, flight) {
    setSavedFlights(prev => ({ ...prev, [dayNum]: [...(prev[dayNum] ?? []), flight] }));
  }
  function updateFlight(dayNum, id, updates) {
    setSavedFlights(prev => ({
      ...prev,
      [dayNum]: (prev[dayNum] ?? []).map(f => f.id === id ? { ...f, ...updates } : f),
    }));
  }
  function deleteFlight(dayNum, id) {
    setSavedFlights(prev => ({
      ...prev,
      [dayNum]: (prev[dayNum] ?? []).filter(f => f.id !== id),
    }));
  }

  function addRentalCar(dayNum, car) {
    setSavedRentalCars(prev => ({ ...prev, [dayNum]: [...(prev[dayNum] ?? []), car] }));
  }
  function updateRentalCar(dayNum, id, updates) {
    setSavedRentalCars(prev => ({
      ...prev,
      [dayNum]: (prev[dayNum] ?? []).map(c => c.id === id ? { ...c, ...updates } : c),
    }));
  }
  function deleteRentalCar(dayNum, id) {
    setSavedRentalCars(prev => ({
      ...prev,
      [dayNum]: (prev[dayNum] ?? []).filter(c => c.id !== id),
    }));
  }

  function addRoute(dayNum, route) {
    setSavedRoutes(prev => ({ ...prev, [dayNum]: [...(prev[dayNum] ?? []), route] }));
  }
  function updateRoute(dayNum, id, updates) {
    setSavedRoutes(prev => ({
      ...prev,
      [dayNum]: (prev[dayNum] ?? []).map(r => r.id === id ? { ...r, ...updates } : r),
    }));
  }
  function deleteRoute(dayNum, id) {
    setSavedRoutes(prev => ({
      ...prev,
      [dayNum]: (prev[dayNum] ?? []).filter(r => r.id !== id),
    }));
  }

  function addDirection(dayNum, dir) {
    setSavedDirections(prev => ({ ...prev, [dayNum]: [...(prev[dayNum] ?? []), dir] }));
  }
  function updateDirection(dayNum, id, updates) {
    setSavedDirections(prev => ({
      ...prev,
      [dayNum]: (prev[dayNum] ?? []).map(d => d.id === id ? { ...d, ...updates } : d),
    }));
  }
  function deleteDirection(dayNum, id) {
    setSavedDirections(prev => ({
      ...prev,
      [dayNum]: (prev[dayNum] ?? []).filter(d => d.id !== id),
    }));
  }

  function duplicateDay(dayNum) {
    const newNum = dayNum + 1;
    setDays(prev => {
      const idx = prev.findIndex(d => d.day === dayNum);
      const orig = prev[idx];
      const copy = { ...orig, day: newNum, tags: [...orig.tags] };
      return [...prev.slice(0, idx + 1), copy, ...prev.slice(idx + 1).map(d => ({ ...d, day: d.day + 1 }))];
    });
    setCustomNotes(prev => { const s = remapKeys(prev, newNum, +1); if (prev[dayNum] !== undefined) s[newNum] = prev[dayNum]; return s; });
    setSavedPlaces(prev => remapKeys(prev, newNum, +1));
    setSavedDirections(prev => remapKeys(prev, newNum, +1));
    setSavedRoutes(prev => remapKeys(prev, newNum, +1));
    setSavedFlights(prev => remapKeys(prev, newNum, +1));
    setSavedRentalCars(prev => remapKeys(prev, newNum, +1));
  }

  function addBlankDay(afterDayNum) {
    const newNum = afterDayNum + 1;
    setDays(prev => {
      const idx = prev.findIndex(d => d.day === afterDayNum);
      return [...prev.slice(0, idx + 1), { ...BLANK_DAY, day: newNum }, ...prev.slice(idx + 1).map(d => ({ ...d, day: d.day + 1 }))];
    });
    setCustomHighlights(prev => remapKeys(prev, newNum, +1));
    setCustomNotes(prev => remapKeys(prev, newNum, +1));
    setSavedPlaces(prev => remapKeys(prev, newNum, +1));
    setSavedDirections(prev => remapKeys(prev, newNum, +1));
    setSavedRoutes(prev => remapKeys(prev, newNum, +1));
    setSavedFlights(prev => remapKeys(prev, newNum, +1));
    setSavedRentalCars(prev => remapKeys(prev, newNum, +1));
    setEditingCoreDay(newNum);
    setCoreDraft({ leg: "New Day", overnight: "", nm: 0, hrs: 0 });
  }

  function removeDay(dayNum) {
    if (days.length <= 1) return;
    setDays(prev => prev.filter(d => d.day !== dayNum).map((d, i) => ({ ...d, day: i + 1 })));
    setCustomHighlights(prev => remapKeys(prev, dayNum, -1));
    setCustomNotes(prev => remapKeys(prev, dayNum, -1));
    setSavedPlaces(prev => remapKeys(prev, dayNum, -1));
    setSavedDirections(prev => remapKeys(prev, dayNum, -1));
    setSavedRoutes(prev => remapKeys(prev, dayNum, -1));
    setSavedFlights(prev => remapKeys(prev, dayNum, -1));
    setSavedRentalCars(prev => remapKeys(prev, dayNum, -1));
    setConfirmDeleteDay(null);
    setEditingCoreDay(null);
  }

  function moveDay(dayIdx, direction) {
    const otherIdx = direction === "up" ? dayIdx - 1 : dayIdx + 1;
    if (otherIdx < 0 || otherIdx >= days.length) return;
    const kA = days[dayIdx].day;
    const kB = days[otherIdx].day;
    const swapArr = (obj, empty) => {
      const c = { ...obj };
      const tmp = c[kA];
      c[kA] = c[kB] ?? empty;
      c[kB] = tmp   ?? empty;
      return c;
    };
    setSavedPlaces(     p => swapArr(p, []));
    setSavedDirections( p => swapArr(p, []));
    setSavedRoutes(     p => swapArr(p, []));
    setSavedFlights(    p => swapArr(p, []));
    setSavedRentalCars( p => swapArr(p, []));
    setCustomHighlights(p => swapArr(p, []));
    setCustomNotes(     p => swapArr(p, ""));
    setDays(prev => {
      const arr = [...prev];
      [arr[dayIdx], arr[otherIdx]] = [arr[otherIdx], arr[dayIdx]];
      return arr.map((d, i) => ({ ...d, day: i + 1 }));
    });
  }

  function startEditCore(dayNum, d) {
    setEditingCoreDay(dayNum);
    setCoreDraft({ leg: d.leg });
    setEditingNoteDay(null);
  }

  function saveCore(dayNum) {
    setDays(prev => prev.map(d =>
      d.day === dayNum
        ? { ...d, leg: coreDraft.leg.trim() || d.leg }
        : d
    ));
    setEditingCoreDay(null);
  }

  function applyClaudeFullItinerary(data) {
    if (data.title)     setTitle(data.title);
    if (data.subtitle)  setSubtitle(data.subtitle);
    if (data.startDate) setStartDate(data.startDate);
    if (data.days?.length) {
      setDays(data.days.map(d => ({
        day: d.day, leg: d.leg ?? "", overnight: d.overnight ?? "",
        nm: 0, hrs: 0, highlights: [], tags: [], note: "",
      })));
    }
    if (data.places) {
      setSavedPlaces(
        Object.fromEntries(Object.entries(data.places).map(([k, arr]) => [
          Number(k),
          arr.map(p => ({
            id: crypto.randomUUID(), name: p.name ?? "", address: "", phone: "",
            website: "", placeId: "", category: p.category ?? "activity",
            notes: p.notes ?? "", addedAt: new Date().toISOString(), mapsProvider: null,
          })),
        ]))
      );
    }
    dirtyRef.current = true;
    if (data.days?.length) ;
  }

  function applyClaudeDaySuggestions(dayNum, data) {
    if (data.places?.length) {
      setSavedPlaces(prev => ({
        ...prev,
        [dayNum]: [...(prev[dayNum] ?? []), ...data.places.map(p => ({
          id: crypto.randomUUID(), name: p.name ?? "", address: "", phone: "",
          website: "", placeId: "", category: p.category ?? "activity",
          notes: p.notes ?? "", addedAt: new Date().toISOString(), mapsProvider: null,
        }))],
      }));
    }
    if (data.highlights?.length) {
      setCustomHighlights(prev => ({
        ...prev,
        [dayNum]: [...(prev[dayNum] ?? []), ...data.highlights],
      }));
    }
  }

  function applyData(data) {
    const x = extractPerDayState(data);
    setDays(x.days.length ? x.days : []);
    setSavedPlaces(x.places);
    setSavedDirections(x.directions);
    setSavedRoutes(x.routes);
    setSavedFlights(x.flights);
    setSavedRentalCars(x.rentalCars);
    setCustomNotes(x.notes);
    setStartDate(data?.startDate ?? "");
    setTitle(data?.title ?? "New Itinerary");
    setSubtitle(data?.subtitle ?? "");
    setItineraryNotes(data?.itineraryNotes ?? "");
  }

  function handleLoad(path, data, dbId) {
    dirtyRef.current = false;
    if (data) {
      applyData(data);
      localStorage.setItem("travelItinerary", JSON.stringify(data));
    }
    const resolvedDbId = dbId ?? databases[0]?.id ?? null;
    setCurrentDbId(resolvedDbId);
    if (resolvedDbId) localStorage.setItem("travelCurrentDb", resolvedDbId);
    setCurrentFile(path);
    if (path === "__local__") localStorage.removeItem("travelCurrentFile");
    else localStorage.setItem("travelCurrentFile", path);
    setSyncStatus(path === "__local__" ? "idle" : "synced");
  }

  function handleCreate(name, dbId) {
    const path = `${ITINERARIES_FOLDER}/it-${crypto.randomUUID().slice(0, 8)}.json`;
    dirtyRef.current = false;
    setDays([]); setSavedPlaces({}); setSavedDirections({}); setSavedRoutes({}); setSavedFlights({}); setSavedRentalCars({});
    setCustomHighlights({}); setCustomNotes({});
    setStartDate(""); ;
    setTitle(name); setSubtitle(""); setItineraryNotes("");
    localStorage.removeItem("travelItinerary");
    const resolvedDbId = dbId ?? databases[0]?.id ?? null;
    setCurrentDbId(resolvedDbId);
    if (resolvedDbId) localStorage.setItem("travelCurrentDb", resolvedDbId);
    setCurrentFile(path);
    localStorage.setItem("travelCurrentFile", path);
    setSyncStatus("idle");
  }

  function handleClose() {
    // Don't cancel the pending save — let it complete in the background
    // so any unsaved changes (e.g. direction times) are not lost
    setCurrentFile(null);
    localStorage.removeItem("travelCurrentFile");
    localStorage.removeItem("travelItinerary");
    setSyncStatus("idle");
  }

  function toggleLock() {
    setLockedFiles(prev => {
      const next = new Set(prev);
      next.has(currentFile) ? next.delete(currentFile) : next.add(currentFile);
      try { localStorage.setItem("itineraryLocked", JSON.stringify([...next])); } catch {}
      return next;
    });
    setShowMenu(false);
  }

  async function handleDuplicate() {
    setMenuWorking(true);
    try {
      const newPath = `${ITINERARIES_FOLDER}/it-${crypto.randomUUID().slice(0, 8)}.json`;
      const data = {
        startDate, subtitle, itineraryNotes, title: `Copy of ${title}`,
        days: days.map(d => {
          const { day: _, ...rest } = d;
          return {
            ...rest,
            note:       customNotes[String(d.day)]       ?? d.note       ?? "",
            places:     savedPlaces[String(d.day)]        ?? [],
            directions: savedDirections[String(d.day)]    ?? [],
            routes:     savedRoutes[String(d.day)]         ?? [],
            flights:    savedFlights[String(d.day)]        ?? [],
            rentalCars: savedRentalCars[String(d.day)]     ?? [],
          };
        }),
      };
      await saveToGitHub(data, { ...ghSettings, githubFile: newPath });
      const overnights = days.map(d => d.overnight).filter(Boolean);
      const legs       = days.map(d => d.leg).filter(Boolean);
      const locations  = overnights.length >= 2 ? `${overnights[0]} → ${overnights[overnights.length - 1]}`
                       : overnights[0] ?? legs[0] ?? null;
      try {
        const meta = JSON.parse(localStorage.getItem("itineraryMetadata") || "{}");
        meta[newPath] = { title: data.title, startDate, dayCount: days.length, locations };
        localStorage.setItem("itineraryMetadata", JSON.stringify(meta));
      } catch {}
      // Navigate to the duplicate
      applyData(data);
      setCurrentFile(newPath);
      localStorage.setItem("travelCurrentFile", newPath);
      localStorage.setItem("travelItinerary", JSON.stringify(data));
      dirtyRef.current = false;
      setSyncStatus("saved");
      setShowMenu(false);
    } catch {
      setShowMenu(false);
    } finally {
      setMenuWorking(false);
    }
  }

  async function handleMoveItinerary(toDbId) {
    setMenuWorking(true);
    try {
      const toDb  = databases.find(d => d.id === toDbId);
      const toGhs = { githubToken: toDb.githubToken ?? "", githubRepo: toDb.githubRepo || inferRepo() || "", githubBranch: toDb.githubBranch || "data" };
      const newPath = `${ITINERARIES_FOLDER}/it-${crypto.randomUUID().slice(0, 8)}.json`;
      const data = {
        startDate, title, subtitle, itineraryNotes,
        days: days.map(d => ({
          ...d,
          note:       customNotes[String(d.day)]       ?? d.note       ?? "",
          places:     savedPlaces[String(d.day)]        ?? [],
          directions: savedDirections[String(d.day)]    ?? [],
          routes:     savedRoutes[String(d.day)]         ?? [],
          flights:    savedFlights[String(d.day)]        ?? [],
          rentalCars: savedRentalCars[String(d.day)]     ?? [],
        })),
      };
      await saveToGitHub(data, { ...toGhs, githubFile: newPath });
      await deleteFromGitHub({ ...ghSettings, githubFile: currentFile });
      try { await deleteFromGitHub({ ...ghSettings, githubFile: currentFile.replace(/\.json$/i, ".ics") }); } catch {}
      try {
        const meta = JSON.parse(localStorage.getItem("itineraryMetadata") || "{}");
        const newKey = `${toDbId}:${newPath}`;
        meta[newKey] = { title, startDate, dayCount: days.length };
        delete meta[`${currentDbId}:${currentFile}`];
        localStorage.setItem("itineraryMetadata", JSON.stringify(meta));
        const deleted = new Set(JSON.parse(localStorage.getItem("itineraryDeletedPaths") || "[]"));
        deleted.add(`${currentDbId}:${currentFile}`);
        localStorage.setItem("itineraryDeletedPaths", JSON.stringify([...deleted]));
      } catch {}
      clearTimeout(syncTimerRef.current);
      setCurrentDbId(toDbId);
      localStorage.setItem("travelCurrentDb", toDbId);
      setCurrentFile(newPath);
      localStorage.setItem("travelCurrentFile", newPath);
      dirtyRef.current = false;
      setSyncStatus("saved");
      setShowMenu(false);
      setMoveToDbId(null);
    } catch {
      setMoveToDbId(null);
      setShowMenu(false);
    } finally {
      setMenuWorking(false);
    }
  }

  async function handleDeleteItinerary() {
    setMenuWorking(true);
    try {
      await deleteFromGitHub({ ...ghSettings, githubFile: currentFile });
      try { await deleteFromGitHub({ ...ghSettings, githubFile: currentFile.replace(/\.json$/i, ".ics") }); } catch {}
      try {
        const cacheKey = `${currentDbId}:${currentFile}`;
        const meta = JSON.parse(localStorage.getItem("itineraryMetadata") || "{}");
        delete meta[cacheKey];
        localStorage.setItem("itineraryMetadata", JSON.stringify(meta));
        // Record the deletion so the picker can filter it out even if GitHub CDN returns stale data
        const deleted = new Set(JSON.parse(localStorage.getItem("itineraryDeletedPaths") || "[]"));
        deleted.add(cacheKey);
        localStorage.setItem("itineraryDeletedPaths", JSON.stringify([...deleted]));
      } catch {}
      clearTimeout(syncTimerRef.current);
      setCurrentFile(null);
      localStorage.removeItem("travelCurrentFile");
      localStorage.removeItem("travelItinerary");
      setSyncStatus("idle");
    } catch {
      setConfirmDelete(false);
      setShowMenu(false);
    } finally {
      setMenuWorking(false);
    }
  }

  function handleSaveAs() {
    const newTitle = saveAsName.trim() || title;
    if (!newTitle) return;
    const path = `${ITINERARIES_FOLDER}/it-${crypto.randomUUID().slice(0, 8)}.json`;
    setTitle(newTitle);
    setCurrentFile(path);
    localStorage.setItem("travelCurrentFile", path);
    dirtyRef.current = true;
    setSyncStatus("pending");
    setSaveAsName("");
  }

  function buildICSContent(daysArr, sd, ttl, notes, fileId, appBase,
                           flights, rentalCars, savedPlaces, savedDirections, savedRoutes) {
    if (!sd || !daysArr.length) return null;
    const [sy, sm, sday] = sd.split("-").map(Number);
    const toICSDate = n => {
      const d = new Date(sy, sm - 1, sday + n - 1);
      return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,"0")}${String(d.getDate()).padStart(2,"0")}`;
    };
    const esc = s => (s ?? "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
    const toICSDateTime = (dateStr, hhmm) => {
      const [h, m] = hhmm.split(":").map(Number);
      return `${dateStr}T${String(h).padStart(2,"0")}${String(m).padStart(2,"0")}00`;
    };
    const addMins = (dt, mins) => {
      const y = +dt.slice(0,4), mo = +dt.slice(4,6)-1, day = +dt.slice(6,8);
      const h = +dt.slice(9,11), m = +dt.slice(11,13);
      const d = new Date(y, mo, day, h, m + mins);
      return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,"0")}${String(d.getDate()).padStart(2,"0")}` +
             `T${String(d.getHours()).padStart(2,"0")}${String(d.getMinutes()).padStart(2,"0")}00`;
    };
    const ampmTo24 = str => {
      if (!str) return null;
      if (/^\d{2}:\d{2}$/.test(str)) return str; // already HH:MM 24-hour
      const m = str.match(/(\d+):(\d+)\s*(AM|PM)/i);
      if (!m) return null;
      let h = +m[1];
      if (m[3].toUpperCase() === "PM" && h !== 12) h += 12;
      if (m[3].toUpperCase() === "AM" && h === 12) h = 0;
      return `${String(h).padStart(2,"0")}:${m[2]}`;
    };
    const parseDurMins = str => {
      if (!str) return 60;
      let total = 0;
      const hm = str.match(/(\d+)\s*h/i); const mm = str.match(/(\d+)\s*m/i);
      if (hm) total += +hm[1] * 60; if (mm) total += +mm[1];
      return total || 60;
    };

    const cal = [
      "BEGIN:VCALENDAR", "VERSION:2.0",
      `PRODID:-//${esc(ttl || "Travel Itinerary")}//EN`,
      "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
      `X-WR-CALNAME:${esc(ttl || "Travel Itinerary")}`,
    ];

    daysArr.forEach(d => {
      const dateStr = toICSDate(d.day);
      const parts = [];
      const _rNm = (savedRoutes?.[d.day] ?? []).reduce((s, r) => s + (r.nm || 0), 0);
      const _rHrs = (savedRoutes?.[d.day] ?? []).reduce((s, r) => s + (r.hrs || 0), 0);
      const _nm = _rNm > 0 ? _rNm : d.nm;
      const _hrs = _rHrs > 0 ? _rHrs : d.hrs;
      if (_nm > 0) parts.push(`${_nm} NM · ~${_hrs.toFixed(1)} hrs`);
      if (d.overnight) parts.push(`Overnight: ${d.overnight}`);
      const note = notes[d.day] !== undefined ? notes[d.day] : d.note;
      if (note) parts.push(`\nNote: ${note}`);
      const fl = (flights ?? {})[d.day] ?? [];
      if (fl.length) parts.push("\nFlights:\n" + fl.map(f =>
        `✈ ${f.flightNumber}: ${f.departure} → ${f.arrival}` +
        (f.miles ? ` · ${f.miles.toLocaleString()} mi` : "") +
        (f.confirmation ? ` (Conf: ${f.confirmation})` : "")
      ).join("\n"));
      const cars = (rentalCars ?? {})[d.day] ?? [];
      if (cars.length) parts.push("\nRental Cars:\n" + cars.map(c => {
        const pickup  = c.pickupLocation  || c.origin?.name       || "";
        const dropoff = c.dropoffLocation || c.destination?.name  || "";
        return `🚗 ${c.agency || "Rental Car"}` +
          (c.confirmation ? ` · Conf: ${c.confirmation}` : "") +
          (pickup   ? `\n   Pick-up: ${pickup}`   : "") +
          (dropoff  ? `\n   Drop-off: ${dropoff}` : "");
      }).join("\n"));

      // All-day summary event for the day
      cal.push("BEGIN:VEVENT");
      cal.push(`DTSTART;VALUE=DATE:${dateStr}`);
      cal.push(`DTEND;VALUE=DATE:${toICSDate(d.day + 1)}`);
      cal.push(`SUMMARY:${esc(`Day ${d.day}: ${d.leg}`)}`);
      if (d.overnight) cal.push(`LOCATION:${esc(d.overnight)}`);
      if (parts.length) cal.push(`DESCRIPTION:${esc(parts.join("\n"))}`);
      if (fileId && appBase) cal.push(`URL:${appBase}?i=${encodeURIComponent(fileId)}&day=${d.day}`);
      cal.push(`UID:day-${d.day}-${dateStr}@travelitinerary`);
      cal.push("END:VEVENT");

      // Timed event: flights
      fl.forEach(f => {
        const dep24 = ampmTo24(f.departureTime);
        const arr24 = ampmTo24(f.arrivalTime);
        if (!dep24) return;
        const dtStart = toICSDateTime(dateStr, dep24);
        const dtEnd   = arr24 ? toICSDateTime(dateStr, arr24) : addMins(dtStart, parseDurMins(f.duration));
        const desc = [
          f.airline && f.aircraft ? `${f.airline} · ${f.aircraft}` : f.airline || f.aircraft || "",
          f.departureName && f.arrivalName ? `${f.departureName} → ${f.arrivalName}` : "",
          f.confirmation ? `Confirmation: ${f.confirmation}` : "",
          f.notes || "",
        ].filter(Boolean).join("\n");
        cal.push("BEGIN:VEVENT");
        cal.push(`DTSTART:${dtStart}`);
        cal.push(`DTEND:${dtEnd}`);
        cal.push(`SUMMARY:${esc(`✈ ${f.flightNumber}: ${f.departure} → ${f.arrival}`)}`);
        if (desc) cal.push(`DESCRIPTION:${esc(desc)}`);
        cal.push(`UID:flight-${f.id}@travelitinerary`);
        cal.push("END:VEVENT");
      });

      // Timed event: places
      (savedPlaces?.[d.day] ?? []).forEach(p => {
        if (!p.time) return;
        const dtStart = toICSDateTime(dateStr, p.time);
        const dtEnd   = addMins(dtStart, 60);
        const desc = [
          p.phone ? `Phone: ${p.phone}` : "",
          p.website ? `Website: ${p.website}` : "",
          p.notes || "",
        ].filter(Boolean).join("\n");
        cal.push("BEGIN:VEVENT");
        cal.push(`DTSTART:${dtStart}`);
        cal.push(`DTEND:${dtEnd}`);
        cal.push(`SUMMARY:${esc(p.name)}`);
        if (p.address) cal.push(`LOCATION:${esc(p.address)}`);
        if (desc) cal.push(`DESCRIPTION:${esc(desc)}`);
        cal.push(`UID:place-${p.id}@travelitinerary`);
        cal.push("END:VEVENT");
      });

      // Timed event: directions
      (savedDirections?.[d.day] ?? []).forEach(dir => {
        const depTime = ampmTo24(dir.time || dir.departTime);
        if (!depTime) return;
        const dtStart  = toICSDateTime(dateStr, depTime);
        const arrTime  = ampmTo24(dir.arriveTime);
        const dtEnd    = arrTime ? toICSDateTime(dateStr, arrTime) : addMins(dtStart, parseDurMins(dir.duration));
        const originName = dir.origin?.name || "";
        const destName   = dir.destination?.name || "";
        const desc = [
          [dir.distance, dir.duration].filter(Boolean).join(" · "),
          dir.notes || "",
        ].filter(Boolean).join("\n");
        const TMODE = { DRIVING: "driving", WALKING: "walking", BICYCLING: "bicycling", TRANSIT: "transit" };
        const mapsUrl = originName && destName
          ? ((dir.mapsProvider ?? "google") === "apple"
              ? `https://maps.apple.com/?saddr=${encodeURIComponent(originName)}&daddr=${encodeURIComponent(destName)}&dirflg=${dir.travelMode === "WALKING" ? "w" : "d"}`
              : `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(originName)}&destination=${encodeURIComponent(destName)}&travelmode=${TMODE[dir.travelMode] ?? "driving"}`)
          : null;
        cal.push("BEGIN:VEVENT");
        cal.push(`DTSTART:${dtStart}`);
        cal.push(`DTEND:${dtEnd}`);
        cal.push(`SUMMARY:${esc(originName && destName ? `${originName} → ${destName}` : "Drive")}`);
        if (destName) cal.push(`LOCATION:${esc(destName)}`);
        if (desc)     cal.push(`DESCRIPTION:${esc(desc)}`);
        if (mapsUrl)  cal.push(`URL:${mapsUrl}`);
        cal.push(`UID:dir-${dir.id}@travelitinerary`);
        cal.push("END:VEVENT");
      });

      // Timed event: boating routes
      (savedRoutes?.[d.day] ?? []).forEach(r => {
        const depTime = ampmTo24(r.time);
        if (!depTime) return;
        const dtStart = toICSDateTime(dateStr, depTime);
        const dtEnd   = addMins(dtStart, Math.round((r.hrs || 1) * 60));
        const distParts = [];
        if (r.nm  > 0) distParts.push(`${r.nm} NM`);
        if (r.hrs > 0) { const h=Math.floor(r.hrs),m=Math.round((r.hrs-h)*60); distParts.push(`~${h>0?`${h}h `:""}${m>0?`${m}m`:""}`); }
        const desc = [
          distParts.join(" · "),
          r.startName && r.endName ? `${r.startName} → ${r.endName}` : "",
          r.notes || "",
        ].filter(Boolean).join("\n");
        cal.push("BEGIN:VEVENT");
        cal.push(`DTSTART:${dtStart}`);
        cal.push(`DTEND:${dtEnd}`);
        cal.push(`SUMMARY:${esc(`🚢 ${r.name || "Boating Route"}`)}`);
        if (desc) cal.push(`DESCRIPTION:${esc(desc)}`);
        cal.push(`UID:route-${r.id}@travelitinerary`);
        cal.push("END:VEVENT");
      });

      // Timed event: rental cars
      cars.forEach(c => {
        const depTime = ampmTo24(c.time || c.departTime);
        if (!depTime) return;
        const dtStart  = toICSDateTime(dateStr, depTime);
        const arrTime  = ampmTo24(c.arriveTime);
        const dtEnd    = arrTime ? toICSDateTime(dateStr, arrTime) : addMins(dtStart, parseDurMins(c.duration));
        const pickup   = c.pickupLocation  || c.origin?.name      || "";
        const dropoff  = c.dropoffLocation || c.destination?.name || "";
        const desc = [
          c.confirmation ? `Confirmation: ${c.confirmation}` : "",
          pickup   ? `Pick-up: ${pickup}`   : "",
          dropoff  ? `Drop-off: ${dropoff}` : "",
          c.distance ? c.distance           : "",
          c.duration ? c.duration           : "",
          c.notes || "",
        ].filter(Boolean).join("\n");
        cal.push("BEGIN:VEVENT");
        cal.push(`DTSTART:${dtStart}`);
        cal.push(`DTEND:${dtEnd}`);
        cal.push(`SUMMARY:${esc(`🚗 ${c.agency || "Rental Car"}`)}`);
        if (pickup) cal.push(`LOCATION:${esc(pickup)}`);
        if (desc)   cal.push(`DESCRIPTION:${esc(desc)}`);
        cal.push(`UID:rental-${c.id}@travelitinerary`);
        cal.push("END:VEVENT");
      });
    });
    cal.push("END:VCALENDAR");
    return cal.join("\r\n");
  }

  function generateICS() {
    const content = buildICSContent(days, startDate, title, customNotes, currentFile?.replace(/^.*\//, "").replace(/\.json$/i, ""), appBase, savedFlights, savedRentalCars, savedPlaces, savedDirections, savedRoutes);
    if (!content) return;
    const blob = new Blob([content], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${sanitizeFilename(title || "itinerary")}.ics`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async function handleCommit(message = "") {
    if (!ghSettings.githubToken || !effectiveRepo || !currentFile || currentFile === "__local__") return;
    setSyncStatus("saving");
    setSyncError("");
    const msg = message.trim() ||
      `Saved ${new Date().toLocaleString("en-US", { month:"short", day:"numeric", year:"numeric", hour:"numeric", minute:"2-digit" })}`;
    const data = {
      startDate, title, subtitle, itineraryNotes,
      days: days.map(d => {
        const { day: _, ...rest } = d;
        return {
          ...rest,
          note:       customNotes[String(d.day)]       ?? d.note       ?? "",
          places:     savedPlaces[String(d.day)]        ?? [],
          directions: savedDirections[String(d.day)]    ?? [],
          routes:     savedRoutes[String(d.day)]         ?? [],
          flights:    savedFlights[String(d.day)]        ?? [],
          rentalCars: savedRentalCars[String(d.day)]     ?? [],
        };
      }),
    };
    try {
      await saveToGitHub(data, { ...ghSettings, githubFile: currentFile, message: msg });
      const icsContent = buildICSContent(days, startDate, title, customNotes,
        currentFile?.replace(/^.*\//, "").replace(/\.json$/i, ""), appBase, savedFlights, savedRentalCars,
        savedPlaces, savedDirections, savedRoutes);
      if (icsContent) {
        await saveToGitHub(icsContent, { ...ghSettings, githubFile: currentFile.replace(/\.json$/i, ".ics") });
      }
      setSyncStatus("saved");
      dirtyRef.current = false;
      setShowCommitForm(false);
      setCommitDraft("");
    } catch (err) {
      setSyncStatus(err.message === "conflict" ? "conflict" : "error");
      setSyncError(err.message);
    }
  }

  function handleCloseRequest() {
    if (syncStatus === "unsaved") { setShowCloseWarn(true); return; }
    handleClose();
  }

  async function handleRestore(sha) {
    const data = await loadFromGitHub({ ...ghSettings, githubFile: currentFile, githubBranch: sha });
    if (data) {
      applyData(data);
      dirtyRef.current = true;
    }
    setShowHistory(false);
  }

  function reloadFromGitHub() {
    if (!currentFile || currentFile === "__local__") return;
    setSyncStatus("loading");
    loadFromGitHub({ ...settings, githubFile: currentFile })
      .then(data => {
        if (!data) { setSyncStatus("idle"); return; }
        applyData(data);
        setSyncStatus("synced");
      })
      .catch(() => setSyncStatus("error"));
  }

  function getDayDate(dayNum) {
    if (!startDate) return null;
    const [y, m, d] = startDate.split("-").map(Number);
    const date = new Date(y, m - 1, d + dayNum - 1);
    return {
      dow:   date.toLocaleDateString("en-US", { weekday: "short" }),
      date:  date.toLocaleDateString("en-US", { day: "numeric" }),
      month: date.toLocaleDateString("en-US", { month: "short" }),
    };
  }

  const SKIP_COUNTRY = /^(United States|USA|US|Canada|Australia|New Zealand|United Kingdom|UK|Mexico|France|Germany|Italy|Spain|Japan|China|Brazil|Ireland|Netherlands|Sweden|Norway|Denmark|Finland|Switzerland|Austria|Belgium|Portugal|Greece|Poland)$/i;
  const SKIP_STATE   = /^[A-Z]{1,3}(\s+[\dA-Z][\dA-Z\s-]{2,8})?$/;

  function cityFromAddress(text) {
    if (!text?.trim()) return null;
    const parts = text.split(",").map(p => p.trim()).filter(Boolean);
    if (!parts.length) return null;
    let end = parts.length - 1;
    while (end > 0 && (SKIP_COUNTRY.test(parts[end]) || SKIP_STATE.test(parts[end]))) end--;
    return parts[end] || null;
  }

  function getDayCities(dayNum) {
    const seen = new Set();
    const add = (text) => { const c = cityFromAddress(text); if (c) seen.add(c); };
    (savedFlights[dayNum]    ?? []).forEach(f => {
      if (f.departureName) seen.add(f.departureName);
      if (f.arrivalName)   seen.add(f.arrivalName);
    });
    (savedDirections[dayNum] ?? []).forEach(dir => { add(dir.origin?.name); add(dir.destination?.name); });
    (savedPlaces[dayNum]     ?? []).forEach(p   => add(p.address));
    (savedRentalCars[dayNum] ?? []).forEach(c   => { add(c.pickupLocation); add(c.dropoffLocation); });
    return [...seen].filter(Boolean);
  }

  const dateRange = (() => {
    if (!startDate || !days.length) return null;
    const [y, m, d] = startDate.split("-").map(Number);
    const start = new Date(y, m - 1, d);
    const end   = new Date(y, m - 1, d + days.length - 1);
    const fmtShort = dt => dt.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    const fmtFull  = dt => dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    return `${fmtShort(start)} – ${fmtFull(end)}`;
  })();

  const effNm  = d => { const rn = (savedRoutes[d.day] ?? []).reduce((s, r) => s + (r.nm  || 0), 0); return rn > 0 ? rn : d.nm; };
  const effHrs = d => { const rh = (savedRoutes[d.day] ?? []).reduce((s, r) => s + (r.hrs || 0), 0); return rh > 0 ? rh : d.hrs; };

  const totalNM  = days.reduce((s, d) => s + effNm(d), 0);
  const travelDays = days.filter(d =>
    effNm(d) > 0 ||
    (savedFlights[d.day] ?? []).length > 0 ||
    (savedDirections[d.day] ?? []).length > 0
  ).length;

  const totalFlightMiles = Math.round(
    Object.values(savedFlights).flat().reduce((s, f) => s + (f.miles || 0), 0)
  );

  const totalDrivingMiles = Math.round(
    Object.values(savedDirections).flat().reduce((s, d) => {
      if (!d.distance) return s;
      const m = d.distance.match(/([\d,.]+)\s*(km|mi|miles)?/i);
      if (!m) return s;
      const val = parseFloat(m[1].replace(/,/g, ""));
      const unit = (m[2] || "mi").toLowerCase();
      return s + (unit === "km" ? val * 0.621371 : val);
    }, 0)
  );
  const todos = [
    ...(itineraryNotes ? itineraryNotes.split("\n")
      .filter(line => /^TODO:/i.test(line.trim()))
      .map(line => ({ day: null, text: line.trim().replace(/^TODO:\s*/i, "") })) : []),
    ...days.flatMap(d => {
      const note = customNotes[d.day] !== undefined ? customNotes[d.day] : d.note;
      if (!note) return [];
      return note.split("\n")
        .filter(line => /^TODO:/i.test(line.trim()))
        .map(line => ({ day: d.day, text: line.trim().replace(/^TODO:\s*/i, "") }));
    }),
  ];

  // Compute local cache for picker (only meaningful data)
  const localCache = (() => {
    if (currentFile) return null; // already have a file open
    try {
      const s = localStorage.getItem("travelItinerary");
      const d = s ? JSON.parse(s) : null;
      if (!d || (!d.days?.length && !d.title)) return null;
      return d;
    } catch { return null; }
  })();

  // ── Add-panel helpers ──────────────────────────────────────────────────────
  function openAddPanel(day, type, subtype) {
    setMobileSheet(null);
    setAddPanel({ day, type, subtype: subtype ?? undefined, editItem: undefined });
  }
  function openEditPanel(day, item) {
    setMobileSheet(null);
    if (item._type === "place") {
      const kindMap = { accommodation:"stay", restaurant:"eat", activity:"see", other:"see" };
      const kind = item.placeKind || (kindMap[item.category] ?? "see");
      setAddPanel({ day, type:"place", subtype: kind, editItem: item });
    } else {
      // Map stored data format → AddTravelPanel editItem format
      let editItem;
      if (item._type === "flight") {
        editItem = {
          _origType: "flight",
          id: item.id, mode: "flight",
          from: { name: item.departureName || item.departure || "", code: item.departure || "", lat: item.departureLat || null, lng: item.departureLng || null },
          to:   { name: item.arrivalName   || item.arrival   || "", code: item.arrival   || "", lat: item.arrivalLat   || null, lng: item.arrivalLng   || null },
          departTime: item.departureTime || "", arriveTime: item.arrivalTime || "",
          airline: item.airline || "", aircraft: item.aircraft || "", flightNum: item.flightNumber || "",
          seat: item.seat || "", confirmation: item.confirmation || "",
          terminal: item.terminal || "", bags: item.bags || "",
          routeDistance: item.distance || "", routeDuration: item.duration || "",
          notes: item.notes || "",
        };
      } else if (item._type === "direction") {
        const modeMap = { DRIVING:"car", WALKING:"walk", TRANSIT:"train" };
        editItem = {
          _origType: "direction",
          id: item.id, mode: modeMap[item.travelMode] || "car",
          from: { name: item.origin?.name || "", lat: item.originLat || null, lng: item.originLng || null },
          to:   { name: item.destination?.name || "", lat: item.destinationLat || null, lng: item.destinationLng || null },
          departDate: item.departDate || "", departTime: item.time || "",
          arriveDate: item.arriveDate || "", arriveTime: item.arriveTime || "",
          routeDistance: item.distance || "", routeDuration: item.duration || "",
          routePath: item.routePath || null,
          notes: item.notes || "",
        };
      } else if (item._type === "route") {
        editItem = {
          _origType: "route",
          id: item.id, mode: "boat",
          from: { name: item.startName || "", lat: item.startLat || null, lng: item.startLng || null },
          to:   { name: item.endName   || "", lat: item.endLat   || null, lng: item.endLng   || null },
          departTime: item.time || "", boatVessel: item.vessel || "", notes: item.notes || "",
        };
      } else if (item._type === "rentalcar") {
        editItem = {
          _origType: "rentalcar",
          id: item.id, mode: "car",
          from: { name: item.origin?.name || item.pickupLocation  || "", lat: item.originLat || null, lng: item.originLng || null },
          to:   { name: item.destination?.name || item.dropoffLocation || "", lat: item.destinationLat || null, lng: item.destinationLng || null },
          departDate: item.departDate || "", departTime: item.time || "",
          arriveDate: item.arriveDate || "", arriveTime: item.arriveTime || "",
          routeDistance: item.distance || "", routeDuration: item.duration || "",
          routePath: item.routePath || null,
          vehicle: item.agency || "", confirmation: item.confirmation || "",
        };
      } else {
        editItem = { _origType: "other", id: item.id, mode: "other" };
      }
      setAddPanel({ day, type:"travel", subtype: undefined, editItem });
    }
  }
  function closeAddPanel() { setAddPanel(null); }

  // Esc closes the panel (and prevents browser fullscreen-exit on macOS)
  useEffect(() => {
    if (!addPanel && mobileSheet === null) return;
    const handler = e => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      if (addPanel) closeAddPanel();
      else setMobileSheet(null);
    };
    document.addEventListener("keydown", handler, true);
    return () => document.removeEventListener("keydown", handler, true);
  }, [addPanel, mobileSheet]);

  // Lock body scroll while panel is open so the page doesn't scroll behind it
  useEffect(() => {
    const shouldLock = !!addPanel || mobileSheet !== null;
    document.body.style.overflow = shouldLock ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [addPanel, mobileSheet]);

  function dayBiasFor(dayNum) {
    const d = days.find(x => x.day === dayNum);
    if (d?.centerLat && d?.centerLng) return { lat: d.centerLat, lng: d.centerLng };
    return computeDayCentroid(dayNum, savedPlaces, savedFlights, savedDirections, savedRoutes);
  }

  function panelTitle(panel) {
    if (!panel) return "";
    const edit = panel.editItem;
    if (panel.type === "place") return edit ? "Edit place" : "Add place";
    if (panel.type === "note")  return edit ? "Edit note"  : "Add note";
    if (panel.type === "travel") {
      const sub = { flight:"Flight", direction:"Drive / Transit", route:"Boating route", rentalcar:"Rental car" };
      const label = panel.subtype ? sub[panel.subtype] : "Travel";
      return edit ? `Edit ${label.toLowerCase()}` : (panel.subtype ? label : "Add travel");
    }
    return "";
  }

  // ── Location autocomplete helpers ─────────────────────────────────────────
  async function fetchLocPreds(dayNum, query, bias) {
    clearTimeout(locDebounceRef.current);
    if (!query.trim()) { setLocPreds([]); return; }
    locDebounceRef.current = setTimeout(async () => {
      const { provider } = getStoredProviderSettings();
      try {
        if (provider === "apple") {
          const mk = await loadLocApple();
          setLocPreds(await appleAutocomplete(mk, query, bias));
        } else {
          const { AutocompleteSuggestion } = await loadLocGoogle();
          const { suggestions } = await AutocompleteSuggestion.fetchAutocompleteSuggestions({
            input: query,
            ...(bias ? { locationBias: { lat: bias.lat, lng: bias.lng } } : {}),
          });
          setLocPreds(suggestions.filter(s => s.placePrediction).map(s => ({
            name:     s.placePrediction.mainText.text,
            subtitle: s.placePrediction.secondaryText?.text ?? "",
            _raw:     s,
          })));
        }
      } catch { setLocPreds([]); }
    }, 300);
  }

  async function selectLocPred(dayNum, pred) {
    setLocPreds([]); setLocActiveDay(null);
    const { provider } = getStoredProviderSettings();
    try {
      if (provider === "apple" && pred._data) {
        const mk = await loadLocApple();
        const details = await appleFetchPlaceDetails(mk, pred._data);
        setDays(prev => prev.map(x => x.day === dayNum
          ? { ...x, centerName: pred.name + (pred.subtitle ? `, ${pred.subtitle}` : ""), centerLat: details.lat, centerLng: details.lng }
          : x));
      } else if (pred._raw) {
        const place = pred._raw.placePrediction.toPlace();
        await place.fetchFields({ fields: ["location", "displayName"] });
        if (place.location) {
          setDays(prev => prev.map(x => x.day === dayNum
            ? { ...x, centerName: place.displayName ?? pred.name, centerLat: place.location.lat(), centerLng: place.location.lng() }
            : x));
        }
      }
    } catch { /* geocode failed — leave name unchanged */ }
  }

  if (urlLoad?.status === "loading") {
    return (
      <div style={{ display:"flex", justifyContent:"center", alignItems:"center",
        minHeight:"100vh", background:"#ffffff", color:"#5c6470",
        fontFamily:"inherit", fontSize:".9rem" }}>
        Loading…
      </div>
    );
  }

  if (urlLoad?.status === "notfound") {
    const name = urlLoad.file.replace(/^.*\//, "").replace(/\.json$/i, "");
    return (
      <div style={{ display:"flex", flexDirection:"column", justifyContent:"center",
        alignItems:"center", minHeight:"100vh", background:"#ffffff",
        fontFamily:"inherit", gap:"1rem", padding:"2rem" }}>
        <div style={{ fontSize:".62rem", color:"#0b3d6b", letterSpacing:".2em",
          textTransform:"uppercase" }}>Not Found</div>
        <div style={{ fontSize:"1.1rem", color:"#5c6470", textAlign:"center" }}>
          "{name}" doesn't exist.
        </div>
        <button onClick={() => {
            const url = new URL(window.location.href);
            url.searchParams.delete("i");
            history.replaceState(null, "", url);
            setUrlLoad(null);
          }}
          style={{ background:"none", border:"1px solid #2e5070", color:"#6b7a8a",
            borderRadius:4, padding:".5rem 1.25rem", fontSize:".82rem",
            fontFamily:"inherit", cursor:"pointer" }}>
          ← All Itineraries
        </button>
      </div>
    );
  }

  if (!currentFile) {
    return (
      <ItineraryPicker
        key={pickerKey}
        settings={settings}
        onSettingsChange={setSettings}
        onLoad={handleLoad}
        onCreate={handleCreate}
        localCache={localCache}
      />
    );
  }

  return (
    <div style={{ fontFamily: "inherit", background: "#ffffff", minHeight: "100vh", color: "#0e1014" }}>

      {/* ── HEADER ── */}
      <div style={{ background: "#ffffff", borderBottom: "1px solid #e2e5ea", padding: ".75rem 2rem" }}>
        <div style={{ maxWidth: 1100, margin: "0 auto" }}>
          {/* Breadcrumb: Trips / Title */}
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
            <div style={{ display:"flex", alignItems:"center", gap:8, fontSize:13, minWidth:0 }}>
              <button onClick={handleCloseRequest}
                style={{ background:"none", border:"none", color:"#5c6470", cursor:"pointer",
                  fontSize:13, fontFamily:"inherit", padding:0, flexShrink:0 }}>
                Trips
              </button>
              <span style={{ color:"#9ba1ac" }}>/</span>
              <span style={{ color:"#0e1014", fontWeight:500, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                {title}
              </span>
              {currentFile === "__local__" &&
                <span style={{ color:"#d97706", fontSize:11, flexShrink:0 }}>· Local only</span>}
            </div>
            <div style={{ display:"flex", alignItems:"center", gap:".75rem" }}>
              {syncStatus !== "idle" && (() => {
                const map = {
                  loading:  ["Loading…",        "#5c6470"],
                  saving:   ["Saving…",          "#d97706"],
                  saved:    ["● Synced",         "#16a34a"],
                  synced:   ["● Synced",         "#16a34a"],
                  unsaved:  ["● Unsaved",        "#d97706"],
                  offline:  ["Offline",          "#6b7a8a"],
                  error:    ["⚠ Error",          "#dc2626"],
                  conflict: ["⚠ Conflict",       "#dc2626"],
                };
                const [label, color] = map[syncStatus] ?? ["", "#5c6470"];
                const canCommit = ghSettings.githubToken && effectiveRepo && syncStatus !== "saving";
                const showCommit = ["unsaved", "error", "conflict"].includes(syncStatus) && canCommit;
                return (
                  <div style={{ display:"flex", alignItems:"center", gap:".4rem" }}>
                    <span style={{ fontSize:".62rem", color, fontFamily:"inherit" }}
                      title={syncError || undefined}>
                      {label}{syncError && syncStatus === "error" ? ` — ${syncError}` : ""}
                    </span>
                    {showCommit && (
                      <button onClick={() => setShowCommitForm(p => !p)}
                        style={{ background: showCommitForm ? "#f0f4f8" : "none",
                          border:"1px solid #2e5070", color:"#0b3d6b",
                          borderRadius:3, padding:".15rem .5rem", fontSize:".62rem",
                          fontFamily:"inherit", cursor:"pointer", whiteSpace:"nowrap" }}>
                        Commit{showCommitForm ? " ▲" : "…"}
                      </button>
                    )}
                  </div>
                );
              })()}
              {ghSettings.githubToken && currentFile && currentFile !== "__local__" && (
                <div style={{ position: "relative" }}>
                  <button onClick={() => { setShowMenu(p => !p); setShowSettings(false); setShowHistory(false); setConfirmDelete(false); }}
                    title="More options"
                    style={{ background:"none", border:"none", color: showMenu ? "#0b3d6b" : "#5c6470",
                      cursor:"pointer", fontSize:"1rem", padding:0, lineHeight:1, letterSpacing:".05em" }}>
                    ···
                  </button>
                  {showMenu && (
                    <div style={{ position:"absolute", right:0, top:"1.6rem", zIndex:100,
                      background:"#ffffff", border:"1px solid #e2e5ea", borderRadius:6,
                      minWidth:140, boxShadow:"0 4px 20px rgba(0,0,0,0.1)", overflow:"hidden" }}>
                      {!confirmDelete ? (
                        <>
                          {ghSettings.githubToken && (
                            <button onClick={() => { setShowHistory(p => !p); setShowMenu(false); }}
                              style={{ display:"block", width:"100%", textAlign:"left",
                                background:"none", border:"none", borderBottom:"1px solid #1e3a5230",
                                color: showHistory ? "#0b3d6b" : "#0e1014", fontFamily:"inherit", fontSize:".82rem",
                                padding:".65rem 1rem", cursor:"pointer" }}>
                              History
                            </button>
                          )}
                          <button onClick={handleDuplicate} disabled={menuWorking}
                            style={{ display:"block", width:"100%", textAlign:"left",
                              background:"none", border:"none", borderBottom:"1px solid #1e3a5230",
                              color:"#0e1014", fontFamily:"inherit", fontSize:".82rem",
                              padding:".65rem 1rem", cursor:"pointer", opacity: menuWorking ? 0.5 : 1 }}>
                            {menuWorking ? "Duplicating…" : "Duplicate"}
                          </button>
                          {databases.length > 1 && !moveToDbId && (
                            <div style={{ borderBottom:"1px solid #1e3a5230" }}>
                              <button onClick={() => setMoveToDbId("pick")} disabled={menuWorking}
                                style={{ display:"block", width:"100%", textAlign:"left",
                                  background:"none", border:"none",
                                  color:"#0e1014", fontFamily:"inherit", fontSize:".82rem",
                                  padding:".65rem 1rem", cursor:"pointer", opacity: menuWorking ? 0.5 : 1 }}>
                                Move to…
                              </button>
                            </div>
                          )}
                          {databases.length > 1 && moveToDbId === "pick" && (
                            <div style={{ padding:".5rem 1rem", borderBottom:"1px solid #1e3a5230" }}>
                              <div style={{ fontSize:".72rem", color:"#5c6470", fontFamily:"inherit", marginBottom:".4rem" }}>Move to:</div>
                              <div style={{ display:"flex", flexDirection:"column", gap:".25rem" }}>
                                {databases.filter(d => d.id !== currentDbId).map(d => (
                                  <button key={d.id} onClick={() => handleMoveItinerary(d.id)} disabled={menuWorking}
                                    style={{ background:"none", border:"1px solid #2e5070", color:"#0e1014",
                                      borderRadius:4, padding:".3rem .75rem", fontSize:".75rem",
                                      fontFamily:"inherit", cursor:"pointer", textAlign:"left",
                                      opacity: menuWorking ? 0.5 : 1 }}>
                                    {menuWorking ? "Moving…" : (d.label || d.githubRepo || "Database")}
                                  </button>
                                ))}
                                <button onClick={() => setMoveToDbId(null)} disabled={menuWorking}
                                  style={{ background:"none", border:"none", color:"#9ba1ac",
                                    fontFamily:"inherit", fontSize:".72rem", cursor:"pointer",
                                    textAlign:"left", padding:".2rem 0" }}>
                                  Cancel
                                </button>
                              </div>
                            </div>
                          )}
                          <button onClick={() => setConfirmDelete(true)} disabled={menuWorking}
                            style={{ display:"block", width:"100%", textAlign:"left",
                              background:"none", border:"none",
                              color:"#dc2626", fontFamily:"inherit", fontSize:".82rem",
                              padding:".65rem 1rem", cursor:"pointer", opacity: menuWorking ? 0.5 : 1 }}>
                            Delete
                          </button>
                        </>
                      ) : (
                        <div style={{ padding:".65rem 1rem" }}>
                          <div style={{ fontSize:".75rem", color:"#d97706", fontFamily:"inherit",
                            marginBottom:".5rem" }}>
                            Delete this itinerary?
                          </div>
                          <div style={{ display:"flex", gap:".4rem" }}>
                            <button onClick={handleDeleteItinerary} disabled={menuWorking}
                              style={{ background:"#fef2f2", border:"1px solid #dc354566",
                                color:"#dc2626", borderRadius:4, padding:".3rem .6rem",
                                fontSize:".72rem", fontFamily:"inherit", cursor:"pointer",
                                opacity: menuWorking ? 0.5 : 1 }}>
                              {menuWorking ? "Deleting…" : "Yes, delete"}
                            </button>
                            <button onClick={() => setConfirmDelete(false)} disabled={menuWorking}
                              style={{ background:"none", border:"1px solid #2e3a4a",
                                color:"#6b7a8a", borderRadius:4, padding:".3rem .6rem",
                                fontSize:".72rem", fontFamily:"inherit", cursor:"pointer" }}>
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
              {currentFile && currentFile !== "__local__" && typeof navigator.share === "function" && (
                <button
                  onClick={() => navigator.share({ title, url: window.location.href })}
                  title="Share itinerary"
                  style={{ background:"none", border:"none", color:"#5c6470",
                    cursor:"pointer", fontSize:".95rem", padding:0, lineHeight:1 }}>
                  ⬆
                </button>
              )}
              <button onClick={() => { setShowSettings(p => !p); setShowHistory(false); setShowMenu(false); }} title="Settings"
                style={{ background:"none", border:"none", color: showSettings ? "#0b3d6b" : "#5c6470",
                  cursor:"pointer", fontSize:"1rem", padding:0, lineHeight:1 }}>
                ⚙
              </button>
            </div>
          </div>

          {/* Settings panel */}
          {showSettings && (
            <Settings
              settings={settings}
              onSave={draft => { setSettings(draft); setShowSettings(false); }}
              onClose={() => setShowSettings(false)}
            />
          )}

          {/* History panel */}
          {showHistory && (
            <HistoryPanel
              key={currentFile}
              settings={ghSettings}
              currentFile={currentFile}
              onRestore={handleRestore}
              onClose={() => setShowHistory(false)}
            />
          )}

          {/* Commit form */}
          {showCommitForm && (
            <div style={{ margin: ".75rem 0 1rem", padding: ".75rem 1rem", background: "#f0f4f8",
              border: "1px solid #2e5070", borderRadius: 6 }}>
              <div style={{ fontSize: ".62rem", color: "#0b3d6b", letterSpacing: ".1em",
                textTransform: "uppercase", fontFamily: "inherit", marginBottom: ".6rem" }}>
                Commit to GitHub
              </div>
              <div style={{ display: "flex", gap: ".5rem", flexWrap: "wrap" }}>
                <input
                  autoFocus
                  value={commitDraft}
                  onChange={e => setCommitDraft(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === "Enter") handleCommit(commitDraft);
                    if (e.key === "Escape") { setShowCommitForm(false); setCommitDraft(""); }
                  }}
                  placeholder="Commit message (optional)"
                  style={{ flex: 1, minWidth: 180, background: "#ffffff", border: "1px solid #e2e5ea",
                    color: "#0e1014", borderRadius: 4, padding: ".35rem .65rem",
                    fontSize: ".82rem", fontFamily: "inherit", outline: "none" }}
                />
                <button onClick={() => handleCommit(commitDraft)}
                  disabled={syncStatus === "saving"}
                  style={{ background: "#f0f4f8", border: "1px solid #2e5070", color: "#0b3d6b",
                    borderRadius: 4, padding: ".35rem .85rem", fontSize: ".75rem",
                    fontFamily: "inherit", cursor: "pointer", whiteSpace: "nowrap",
                    opacity: syncStatus === "saving" ? 0.5 : 1 }}>
                  {syncStatus === "saving" ? "Committing…" : "Commit"}
                </button>
                <button onClick={() => { setShowCommitForm(false); setCommitDraft(""); }}
                  style={{ background: "none", border: "1px solid #2e3a4a", color: "#6b7a8a",
                    borderRadius: 4, padding: ".35rem .85rem", fontSize: ".75rem",
                    fontFamily: "inherit", cursor: "pointer" }}>
                  Cancel
                </button>
              </div>
              {syncError && (
                <div style={{ marginTop: ".5rem", fontSize: ".72rem", color: "#dc2626",
                  fontFamily: "inherit" }}>{syncError}</div>
              )}
            </div>
          )}

          {/* Navigation warning */}
          {showCloseWarn && (
            <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 2000,
              display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }}>
              <div style={{ background: "#ffffff", border: "1px solid #e2e5ea", borderRadius: 8,
                padding: "1.5rem", maxWidth: 360, width: "100%", fontFamily: "inherit" }}>
                <div style={{ fontSize: ".88rem", color: "#0e1014", marginBottom: ".75rem",
                  fontWeight: 500 }}>
                  Uncommitted changes
                </div>
                <div style={{ fontSize: ".78rem", color: "#5c6470", marginBottom: "1.25rem",
                  lineHeight: 1.5 }}>
                  You have local changes that haven't been committed to GitHub. They're saved in
                  your browser but will be lost if you clear your data.
                </div>
                <div style={{ display: "flex", gap: ".5rem", flexWrap: "wrap" }}>
                  <button onClick={() => { setShowCloseWarn(false); setShowCommitForm(true); }}
                    style={{ background: "#f0f4f8", border: "1px solid #2e5070", color: "#0b3d6b",
                      borderRadius: 4, padding: ".4rem .9rem", fontSize: ".78rem", cursor: "pointer" }}>
                    Commit now
                  </button>
                  <button onClick={() => { setShowCloseWarn(false); handleClose(); }}
                    style={{ background: "none", border: "1px solid #2e3a4a", color: "#6b7a8a",
                      borderRadius: 4, padding: ".4rem .9rem", fontSize: ".78rem", cursor: "pointer" }}>
                    Leave anyway
                  </button>
                  <button onClick={() => setShowCloseWarn(false)}
                    style={{ background: "none", border: "none", color: "#9ba1ac",
                      fontSize: ".78rem", cursor: "pointer", padding: ".4rem .5rem" }}>
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Save-to-GitHub banner (local session only) */}
          {currentFile === "__local__" && (
            <div style={{ margin: ".75rem 0 1rem", padding: ".75rem 1rem",
              background: "#fffbeb", border: "1px solid #e8a83844", borderRadius: 6,
              display: "flex", alignItems: "center", gap: ".75rem", flexWrap: "wrap" }}>
              <span style={{ fontSize: ".78rem", color: "#d97706", fontFamily: "inherit",
                flexShrink: 0 }}>
                Not saved to GitHub yet.
              </span>
              <input
                value={saveAsName || title}
                onChange={e => setSaveAsName(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleSaveAs()}
                placeholder="Itinerary name…"
                style={{ flex: 1, minWidth: 160, background: "#ffffff", border: "1px solid #e2e5ea",
                  color: "#0e1014", borderRadius: 4, padding: ".35rem .65rem",
                  fontSize: ".82rem", fontFamily: "inherit", outline: "none" }}
              />
              <button onClick={handleSaveAs}
                disabled={!ghSettings.githubToken || !effectiveRepo}
                title={(!ghSettings.githubToken || !effectiveRepo) ? "Configure GitHub in Settings ⚙ first" : ""}
                style={{ background: "#f0f4f8", border: "1px solid #2e5070", color: "#0b3d6b",
                  borderRadius: 4, padding: ".35rem .85rem", fontSize: ".75rem",
                  fontFamily: "inherit", cursor: "pointer", whiteSpace: "nowrap",
                  opacity: (!ghSettings.githubToken || !effectiveRepo) ? 0.45 : 1 }}>
                Save to GitHub
              </button>
            </div>
          )}

        </div>
      </div>

      {/* ── MAP ── */}
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "1.25rem 2rem 0" }}>
        <div style={{ borderRadius: 14, overflow: "hidden", border: "1px solid #e2e5ea" }}>
          <ItineraryMap days={days} savedFlights={savedFlights} savedDirections={savedDirections} savedPlaces={savedPlaces} savedRoutes={savedRoutes} />
        </div>
      </div>

      {/* ── TITLE + FACTS ── */}
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "1.5rem 2rem 0" }}>

        {/* Title — click to edit inline */}
        {editingHeader ? (
          <div style={{ marginBottom: subtitle ? ".3rem" : ".75rem" }}>
            <input autoFocus value={headerDraft.title}
              onChange={e => setHeaderDraft(p => ({ ...p, title: e.target.value }))}
              onBlur={() => { setTitle(headerDraft.title.trim() || title); setEditingHeader(false); }}
              onKeyDown={e => {
                if (e.key === "Escape") setEditingHeader(false);
                if (e.key === "Enter") { setTitle(headerDraft.title.trim() || title); setEditingHeader(false); }
              }}
              className="inline-title-input"
              style={{ width:"100%", background:"transparent", border:"none", color:"#0e1014",
                borderBottom:"2px solid #0b3d6b", padding:".1rem 0",
                fontFamily:"inherit", outline:"none", boxSizing:"border-box" }} />
          </div>
        ) : (
          <h1
            onClick={() => !readOnly && (setEditingHeader(true), setHeaderDraft({ title, subtitle }))}
            style={{ fontSize:"clamp(1.6rem,4vw,2.4rem)", fontWeight:700, color:"#0e1014",
              margin:"0 0 " + (subtitle ? ".3rem" : ".75rem"), letterSpacing:"-.03em",
              lineHeight:1.15, cursor: readOnly ? "default" : "text" }}>
            {title}
          </h1>
        )}
        {/* Subtitle — plain controlled input, no editingHeader dependency */}
        {!readOnly ? (
          <input
            value={subtitle}
            onChange={e => setSubtitle(e.target.value)}
            placeholder="Add subtitle…"
            className="inline-subtitle-input"
            style={{ display:"block", width:"100%", background:"transparent", border:"none",
              color: subtitle ? "#9ba1ac" : "#c8cdd4", padding:".1rem 0",
              fontFamily:"inherit", fontStyle:"italic", outline:"none",
              marginBottom:".75rem", cursor:"text", boxSizing:"border-box" }}
          />
        ) : subtitle ? (
          <p style={{ color:"#9ba1ac", margin:"0 0 .75rem", fontSize:".9rem", fontStyle:"italic" }}>{subtitle}</p>
        ) : null}
        {dateRange && !editingHeader && (
          <div style={{ fontSize:15, color:"#5c6470", marginBottom:"1.5rem", fontVariantNumeric:"tabular-nums" }}>
            {dateRange} · {days.length} {days.length === 1 ? "day" : "days"}
          </div>
        )}

        {/* Two-column: stats+notes left, date grid+todos right */}
        <div style={{ display:"flex", gap:48, alignItems:"stretch", marginBottom:"1.5rem", flexWrap:"wrap" }}>

          {/* Left: stats + notes */}
          <div style={{ flex:1, minWidth:200, display:"flex", flexDirection:"column", gap:16 }}>
            {(() => {
              const stats = [
                totalNM > 0           && { label: "Boating",     val: `${Math.round(totalNM)} NM` },
                totalFlightMiles > 0  && { label: "Flying",      val: `${totalFlightMiles.toLocaleString()} mi` },
                totalDrivingMiles > 0 && { label: "Driving",     val: `${totalDrivingMiles.toLocaleString()} mi` },
                travelDays > 0        && { label: "Travel days", val: String(travelDays) },
                days.filter(d => d.fuelStop).length > 0 && { label: "Fuel stops", val: String(days.filter(d => d.fuelStop).length) },
              ].filter(Boolean);
              if (!stats.length) return null;
              return (
                <div style={{ display:"flex", gap:24, flexWrap:"wrap" }}>
                  {stats.map(s => (
                    <div key={s.label}>
                      <div style={{ fontSize:"1.4rem", fontWeight:700, color:"#0b3d6b", letterSpacing:"-.02em", fontVariantNumeric:"tabular-nums" }}>{s.val}</div>
                      <div style={{ fontSize:11, color:"#9ba1ac", letterSpacing:".08em", textTransform:"uppercase", marginTop:2 }}>{s.label}</div>
                    </div>
                  ))}
                </div>
              );
            })()}

            {/* Notes — click to edit inline, auto-save on blur */}
            {!readOnly ? (
              editingNotes ? (
                <textarea
                  autoFocus
                  value={itineraryNotes}
                  onChange={e => { dirtyRef.current = true; setItineraryNotes(e.target.value); }}
                  onBlur={() => setEditingNotes(false)}
                  onKeyDown={e => { if (e.key === "Escape") setEditingNotes(false); }}
                  placeholder="Notes about this trip…"
                  className="inline-notes-textarea"
                  style={{ width:"100%", flex:1, background:"transparent", border:"none",
                    borderBottom:"1px solid #e2e5ea", color:"#0e1014",
                    padding:".1rem 0", fontFamily:"inherit",
                    lineHeight:1.6, boxSizing:"border-box", outline:"none",
                    resize:"none", minHeight:0 }}
                />
              ) : (
                <div onClick={() => setEditingNotes(true)}
                  style={{ fontSize:13, lineHeight:1.6, color: itineraryNotes ? "#0e1014" : "#9ba1ac",
                    cursor:"text", minHeight:24 }}>
                  {itineraryNotes
                    ? <NoteMarkdown>{itineraryNotes}</NoteMarkdown>
                    : "Add notes about this trip…"}
                </div>
              )
            ) : itineraryNotes ? (
              <div style={{ fontSize:13, lineHeight:1.6, color:"#0e1014" }}>
                <NoteMarkdown>{itineraryNotes}</NoteMarkdown>
              </div>
            ) : null}
          </div>

          {/* Right: date grid only */}
          <div style={{ width:300, flexShrink:0, display:"flex", flexDirection:"column", gap:10 }}>

            {/* Date grid */}
            {(() => {
              const hasDate = !!startDate;
              const start = hasDate ? (() => { const [y,m,d] = startDate.split("-").map(Number); return new Date(y,m-1,d); })() : null;
              const end   = hasDate ? (() => { const [y,m,d] = startDate.split("-").map(Number); return new Date(y,m-1,d+days.length-1); })() : null;
              const fmt   = dt => dt.toLocaleDateString("en-US", { month:"short", day:"numeric" });
              const stops = (Object.values(savedPlaces).flat().length || 0) + (Object.values(savedFlights).flat().length || 0);
              return (
                <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
                    {/* Days */}
                    <div style={{ padding:"10px 12px", borderRadius:8, background:"#f8f9fb", border:"1px solid #e2e5ea" }}>
                      <div style={{ fontSize:9, fontWeight:600, letterSpacing:".12em", color:"#9ba1ac", marginBottom:3, textTransform:"uppercase" }}>Days</div>
                      <div style={{ fontSize:15, fontWeight:600, color:"#0e1014", fontVariantNumeric:"tabular-nums" }}>{days.length}</div>
                    </div>
                    {/* Stops */}
                    <div style={{ padding:"10px 12px", borderRadius:8, background:"#f8f9fb", border:"1px solid #e2e5ea" }}>
                      <div style={{ fontSize:9, fontWeight:600, letterSpacing:".12em", color:"#9ba1ac", marginBottom:3, textTransform:"uppercase" }}>Stops</div>
                      <div style={{ fontSize:15, fontWeight:600, color:"#0e1014", fontVariantNumeric:"tabular-nums" }}>{stops}</div>
                    </div>
                    {/* Start — date picker */}
                    <div style={{ padding:"10px 12px", borderRadius:8, background:"#f8f9fb",
                      border: hasDate ? "1px solid #e2e5ea" : "1px dashed #d1d5db",
                      position:"relative", cursor: readOnly ? "default" : "pointer" }}>
                      <div style={{ fontSize:9, fontWeight:600, letterSpacing:".12em", color:"#9ba1ac", marginBottom:3, textTransform:"uppercase" }}>Start</div>
                      <div style={{ fontSize:15, fontWeight:600, fontVariantNumeric:"tabular-nums",
                        color: hasDate ? "#0e1014" : "#9ba1ac" }}>
                        {hasDate ? fmt(start) : "Set date"}
                      </div>
                      {!readOnly && (
                        <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
                          style={{ position:"absolute", inset:0, opacity:0, cursor:"pointer",
                            width:"100%", height:"100%", padding:0, margin:0, border:"none" }} />
                      )}
                    </div>
                    {/* End */}
                    <div style={{ padding:"10px 12px", borderRadius:8, background:"#f8f9fb", border:"1px solid #e2e5ea" }}>
                      <div style={{ fontSize:9, fontWeight:600, letterSpacing:".12em", color:"#9ba1ac", marginBottom:3, textTransform:"uppercase" }}>End</div>
                      <div style={{ fontSize:15, fontWeight:600, color: hasDate ? "#0e1014" : "#9ba1ac", fontVariantNumeric:"tabular-nums" }}>
                        {hasDate ? fmt(end) : "—"}
                      </div>
                    </div>
                  </div>

                  {/* ICS export actions */}
                  {hasDate && days.length > 0 && (
                    <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                      <button onClick={generateICS}
                        style={{ background:"none", border:"1px solid #e2e5ea", color:"#5c6470",
                          cursor:"pointer", fontSize:11, fontFamily:"inherit",
                          padding:"4px 10px", borderRadius:6 }}>
                        Export .ics
                      </button>
                      {effectiveRepo && currentFile && currentFile !== "__local__" && (
                        <button onClick={() => {
                            const icsFile = currentFile.replace(/\.json$/i, ".ics");
                            const url = `https://raw.githubusercontent.com/${effectiveRepo}/${effectiveBranch}/${icsFile}`;
                            navigator.clipboard.writeText(url);
                            setCopiedICS(true);
                            setTimeout(() => setCopiedICS(false), 2000);
                          }}
                          style={{ background:"none", border:"1px solid #e2e5ea",
                            color: copiedICS ? "#16a34a" : "#5c6470",
                            cursor:"pointer", fontSize:11, fontFamily:"inherit",
                            padding:"4px 10px", borderRadius:6 }}>
                          {copiedICS ? "Copied!" : "Subscribe URL"}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })()}

            {/* TODOs */}
            {todos.length > 0 && (
              <div style={{ padding:"12px 14px", background:"#fffbeb",
                border:"1px solid rgba(217,119,6,0.2)", borderRadius:8 }}>
                <div style={{ fontSize:9, fontWeight:600, letterSpacing:".12em", color:"#d97706",
                  textTransform:"uppercase", marginBottom:8 }}>
                  {todos.length} TODO{todos.length !== 1 ? "s" : ""}
                </div>
                <ul style={{ margin:0, paddingLeft:"1rem", display:"flex", flexDirection:"column", gap:4 }}>
                  {todos.map((t, i) => (
                    <li key={i}
                      onClick={t.day != null ? () => { setActiveTab("itinerary"); } : undefined}
                      style={{ fontSize:12, color:"#0e1014", lineHeight:1.5,
                        cursor: t.day != null ? "pointer" : "default" }}>
                      {t.day != null && (
                        <span style={{ fontSize:10, color:"#d97706", marginRight:4, opacity:.8 }}>
                          Day {t.day}
                        </span>
                      )}
                      <NoteMarkdown>{t.text}</NoteMarkdown>
                    </li>
                  ))}
                </ul>
              </div>
            )}

          </div>
        </div>
      </div>

      {/* ── SECONDARY INFO ── */}
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "0 2rem" }}>

        </div>

      {/* ── CONFLICT BANNER ── */}
      {syncStatus === "conflict" && (
        <div style={{ background:"#fef2f2", borderBottom:"1px solid #dc354566", padding:".6rem 1rem",
          display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <span style={{ fontSize:".78rem", color:"#dc2626", fontFamily:"inherit" }}>
            ⚠ Conflict — GitHub has a newer version.
          </span>
          <button onClick={reloadFromGitHub}
            style={{ background:"none", border:"1px solid #dc354566", color:"#dc2626",
              borderRadius:4, padding:".25rem .65rem", fontSize:".72rem",
              fontFamily:"inherit", cursor:"pointer" }}>
            Reload from GitHub
          </button>
        </div>
      )}

      {/* ── TABS ── */}
      <div style={{ borderBottom:"1px solid #e2e5ea", background:"#ffffff" }}>
        <div style={{ maxWidth:1100, margin:"0 auto", display:"flex" }}>
          {[["itinerary","Day by Day"],["fuel","Fuel Plan"],["tides","Tide Warnings"]].map(([t,lbl])=>(
            <button key={t} onClick={()=>setActiveTab(t)} style={{
              background:"none", border:"none",
              borderBottom: activeTab===t ? "2px solid #0b3d6b" : "2px solid transparent",
              color: activeTab===t ? "#0b3d6b" : "#5c6470",
              padding:".85rem 1.5rem", fontSize:".78rem", letterSpacing:".12em",
              textTransform:"uppercase", cursor:"pointer", fontFamily:"inherit" }}>
              {lbl}
            </button>
          ))}
        </div>
      </div>

      <div style={{ maxWidth:1100, margin:"0 auto", padding:"1.5rem 2rem 3rem" }}>

        {/* ── ITINERARY TAB ── */}
        {activeTab === "itinerary" && days.length === 0 && (
          <div style={{ padding: "2rem 1rem", fontFamily: "inherit" }}>
            {settings.anthropicKey ? (
              <ClaudePrompt
                mode="full"
                onApplyFull={applyClaudeFullItinerary}
                apiKey={settings.anthropicKey}
                model={settings.claudeModel ?? "claude-sonnet-4-6"}
              />
            ) : (
              <div style={{ textAlign: "center", color: "#6b7a8a", marginBottom: "1.25rem",
                fontSize: ".9rem" }}>
                No itinerary yet.
              </div>
            )}
            <div style={{ textAlign: "center", marginTop: "1.25rem" }}>
              <button onClick={() => { setDays(initialDays); ; }}
                style={{ background: "#f0f4f8", border: "1px solid #2e5070", color: "#0b3d6b",
                  borderRadius: 6, padding: ".55rem 1.5rem", fontSize: ".82rem",
                  fontFamily: "inherit", cursor: "pointer" }}>
                Load sample itinerary
              </button>
            </div>
          </div>
        )}
        {activeTab === "itinerary" && (<>
        {days.map(d => {
          const isLayover = effNm(d) === 0;
          const dayInfo   = getDayDate(d.day);
          const dayBias   = (d.centerLat && d.centerLng)
            ? { lat: d.centerLat, lng: d.centerLng }
            : computeDayCentroid(d.day, savedPlaces, savedFlights, savedDirections, savedRoutes);
          return (
            <div key={d.day}>

              {/* ── Day: two-column layout ── */}
                <div className="day-expanded-grid" style={{ display:"grid", gridTemplateColumns:"3fr 2fr", gap:36,
                  padding:"28px 0 36px", borderBottom:"1px solid #e2e5ea" }}>

                  {/* Left: day header */}
                  <div style={{ display:"flex", flexDirection:"column", gap:10, minHeight:0 }}>

                    {/* Desktop date display */}
                    <div className="day-date-desktop">
                      <div style={{ fontSize:10, fontWeight:600, letterSpacing:1.5, color:"#9ba1ac", textTransform:"uppercase", marginBottom:4 }}>
                        Day {d.day} / {days.length}
                      </div>
                      {dayInfo ? (
                        <div style={{ display:"flex", alignItems:"baseline", gap:8 }}>
                          <div style={{ fontSize:52, fontWeight:700, color:"#0b3d6b", lineHeight:1,
                            letterSpacing:-2, fontVariantNumeric:"tabular-nums" }}>
                            {dayInfo.date}
                          </div>
                          <div>
                            <div style={{ fontSize:13, fontWeight:600 }}>{dayInfo.dow}</div>
                            <div style={{ fontSize:11, color:"#9ba1ac", letterSpacing:1 }}>{dayInfo.month.toUpperCase()}</div>
                          </div>
                        </div>
                      ) : (
                        <div style={{ fontSize:44, fontWeight:700, color:"#0b3d6b", lineHeight:1, fontVariantNumeric:"tabular-nums" }}>
                          {d.day}
                        </div>
                      )}
                      {/* Location — shown next to date */}
                      {(dayBias !== null || d.centerName) && (
                        <div style={{ position:"relative", marginTop:6 }}>
                          <div style={{ display:"flex", alignItems:"center", gap:4 }}>
                            <span style={{ color:"#9ba1ac", fontSize:11, flexShrink:0 }}>📍</span>
                            <input
                              value={d.centerName || ""}
                              onChange={e => {
                                setDays(prev => prev.map(x => x.day === d.day ? { ...x, centerName: e.target.value } : x));
                                fetchLocPreds(d.day, e.target.value, dayBias);
                                setLocActiveDay(d.day);
                              }}
                              onFocus={() => setLocActiveDay(d.day)}
                              onBlur={() => setTimeout(() => { if (locActiveDay === d.day) { setLocPreds([]); setLocActiveDay(null); } }, 150)}
                              onKeyDown={e => { if (e.key === "Escape") { setLocPreds([]); setLocActiveDay(null); } }}
                              placeholder={dayBias ? "Detecting…" : ""}
                              readOnly={readOnly}
                              title={d.centerLat ? `${d.centerLat.toFixed(3)}, ${d.centerLng.toFixed(3)}` : ""}
                              style={{ fontSize:11, color:"#5c6470", background:"none", border:"none", outline:"none",
                                fontFamily:"inherit", flex:1, cursor: readOnly ? "default" : "text",
                                padding:0, minWidth:0 }}
                            />
                            {!readOnly && d.centerLat !== null && (
                              <button
                                onClick={() => setDays(prev => prev.map(x => x.day === d.day
                                  ? { ...x, centerName: "", centerLat: null, centerLng: null }
                                  : x))}
                                title="Reset to auto-detected location"
                                style={{ background:"none", border:"none", color:"#9ba1ac", cursor:"pointer",
                                  fontSize:11, padding:0, lineHeight:1, flexShrink:0 }}>
                                ↺
                              </button>
                            )}
                          </div>
                          {locActiveDay === d.day && locPreds.length > 0 && (
                            <div style={{ position:"absolute", top:"100%", left:0, zIndex:200, minWidth:260,
                              background:"#ffffff", border:"1px solid #e2e5ea", borderRadius:8,
                              boxShadow:"0 4px 20px rgba(0,0,0,0.1)", overflow:"hidden", marginTop:4 }}>
                              {locPreds.map((pred, i) => (
                                <button key={i}
                                  onMouseDown={e => { e.preventDefault(); selectLocPred(d.day, pred); }}
                                  style={{ display:"block", width:"100%", textAlign:"left", background:"none",
                                    border:"none", borderBottom: i < locPreds.length-1 ? "1px solid #f0f1f3" : "none",
                                    padding:"8px 12px", fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>
                                  <div style={{ fontWeight:500, color:"#0e1014" }}>{pred.name}</div>
                                  {pred.subtitle && <div style={{ fontSize:11, color:"#9ba1ac", marginTop:1 }}>{pred.subtitle}</div>}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Mobile date + title row */}
                    <div className="day-date-mobile" style={{ alignItems:"flex-start", gap:12 }}>
                      <div style={{
                        width:56, height:56, borderRadius:12, background:"#0b3d6b", color:"#fff",
                        display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center",
                        flexShrink:0, gap:2,
                      }}>
                        <div style={{ fontSize:9, fontWeight:600, letterSpacing:1, opacity:.85 }}>
                          {dayInfo?.dow?.toUpperCase() ?? `D${d.day}`}
                        </div>
                        <div style={{ fontSize:22, fontWeight:700, lineHeight:1, fontVariantNumeric:"tabular-nums" }}>
                          {dayInfo?.date ?? d.day}
                        </div>
                      </div>
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ fontSize:10, fontWeight:600, letterSpacing:1.5, color:"#9ba1ac", textTransform:"uppercase", marginBottom:4 }}>
                          Day {d.day} / {days.length}{dayInfo ? ` · ${dayInfo.month.toUpperCase()}` : ""}
                        </div>
                        <div style={{ fontSize:17, fontWeight:600, letterSpacing:-0.2, lineHeight:1.3 }}>{d.leg}</div>
                      </div>
                    </div>

                    {/* Title / edit (hidden on mobile — shown in day-date-mobile row) */}
                    <div className="day-title-desktop">
                    {editingCoreDay === d.day ? (
                      <input autoFocus value={coreDraft.leg}
                        onChange={e => setCoreDraft(p => ({ ...p, leg: e.target.value }))}
                        onBlur={() => saveCore(d.day)}
                        onKeyDown={e => { if (e.key === "Escape") setEditingCoreDay(null); if (e.key === "Enter") saveCore(d.day); }}
                        className="inline-day-title-input"
                        style={{ width:"100%", background:"transparent", border:"none",
                          borderBottom:"2px solid #0b3d6b", color:"#0e1014",
                          padding:".1rem 0", fontFamily:"inherit", outline:"none", boxSizing:"border-box" }} />
                    ) : (
                      <div
                        onClick={() => !readOnly && startEditCore(d.day, d)}
                        style={{ fontSize:17, fontWeight:600, letterSpacing:-0.2, lineHeight:1.3,
                          cursor: readOnly ? "default" : "text" }}>
                        {d.leg}
                      </div>
                    )}
                    </div>{/* end day-title-desktop */}


                    {/* Day notes — Markdown display when idle, textarea when editing */}
                    {(() => {
                      const note = customNotes[d.day] !== undefined ? customNotes[d.day] : (d.note || "");
                      if (readOnly && !note) return null;
                      const isEditing = !readOnly && editingNoteDay === d.day;

                      if (isEditing) return (
                        <textarea
                          ref={el => el && el.focus()}
                          value={noteDraft}
                          onChange={e => setNoteDraft(e.target.value)}
                          onBlur={e => { dirtyRef.current = true; setCustomNotes(prev => ({ ...prev, [d.day]: e.target.value })); setEditingNoteDay(null); }}
                          onKeyDown={e => { if (e.key === "Escape") cancelEditNote(); }}
                          placeholder="Add a note…"
                          className="inline-day-notes-textarea"
                          style={{ width:"100%", background:"transparent", border:"none",
                            borderBottom:"1px solid #e2e5ea", color:"#0e1014",
                            padding:".1rem 0", fontFamily:"inherit",
                            lineHeight:1.55, boxSizing:"border-box", outline:"none",
                            resize:"none", flex:1, minHeight:60, overflow:"auto" }}
                        />
                      );

                      return (
                        <div
                          onClick={e => {
                            if (readOnly) return;
                            // Synchronous focus attempt so iOS raises keyboard on tap
                            const ta = e.currentTarget.querySelector("textarea._note_ta");
                            if (ta) ta.focus();
                            startEditNote(d.day, note);
                          }}
                          style={{ flex:1, minHeight:20, cursor: readOnly ? "default" : "text" }}>
                          {/* Hidden textarea keeps iOS focus chain alive during the click */}
                          {!readOnly && <textarea className="_note_ta" readOnly style={{ position:"absolute", opacity:0, width:1, height:1, pointerEvents:"none" }} />}
                          {note
                            ? <div style={{ fontSize:12, lineHeight:1.55, color:"#5c6470" }}><NoteMarkdown>{note}</NoteMarkdown></div>
                            : <div style={{ fontSize:12, lineHeight:1.55, color:"#9ba1ac", fontStyle:"italic" }}>Add a note…</div>}
                        </div>
                      );
                    })()}

                  </div>

                  {/* Right: content with left border */}
                  <div className="day-expanded-right" style={{ borderLeft:"1px solid #e2e5ea", paddingLeft:32, minWidth:0 }}>
                  {/* ── Unified timeline (all item types, sorted by time) ── */}
                  {(() => {
                    const distUnit = settings.distanceUnit ?? "km";
                    const places   = (savedPlaces[d.day]      ?? []).map(p => ({ _type:"place",     _sort: timeToSortKey(p.time),              _disp: fmtTime12(p.time),              ...p }));
                    const flights  = (savedFlights[d.day]     ?? []).map(f => ({ _type:"flight",    _sort: timeToSortKey(f.departureTime),      _disp: fmtTime12(f.departureTime),     ...f }));
                    const dirs     = (savedDirections[d.day]  ?? []).map(x => ({ _type:"direction", _sort: timeToSortKey(x.time),              _disp: fmtTime12(x.time),              ...x }));
                    const routes   = (savedRoutes[d.day]      ?? []).map(r => ({ _type:"route",     _sort: timeToSortKey(r.time),              _disp: fmtTime12(r.time),              ...r }));
                    const cars     = (savedRentalCars[d.day]  ?? []).map(c => ({ _type:"rentalcar", _sort: timeToSortKey(c.time),              _disp: fmtTime12(c.time),              ...c }));

                    const all = [...places, ...flights, ...dirs, ...routes, ...cars]
                      .sort((a, b) => {
                        if (!a._sort && !b._sort) return 0;
                        if (!a._sort) return 1;
                        if (!b._sort) return -1;
                        return a._sort.localeCompare(b._sort);
                      });

                    if (!all.length) return null;

                    return (
                      <ol style={{ listStyle:"none", padding:0, margin:"1rem 0 0", display:"flex", flexDirection:"column" }}>
                        {all.map((item, idx) => {
                          const isLast = idx === all.length - 1;

                          // Dot color + icon per type
                          let dotColor = "#0b3d6b";
                          let icon = null;
                          let title = "";
                          let sub1 = "";
                          let sub2 = "";
                          let badge = "";
                          let onDel = null;
                          let mapsUrl = null;

                          if (item._type === "place") {
                            const cat = PLACE_CATEGORIES.find(c => c.key === item.category) ?? PLACE_CATEGORIES[PLACE_CATEGORIES.length - 1];
                            dotColor = cat.color;
                            icon = <span style={{ display:"inline-block", width:8, height:8, borderRadius:"50%", background:cat.color, flexShrink:0, marginTop:1 }}/>;
                            title = item.name;
                            sub1 = item.address || "";
                            sub2 = item.notes || "";
                            onDel = !readOnly ? () => deletePlace(d.day, item.id) : null;
                            if (item.placeId) {
                              mapsUrl = (item.mapsProvider ?? "google") === "apple"
                                ? `https://maps.apple.com/?q=${encodeURIComponent(item.name)}`
                                : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(item.name)}&query_place_id=${encodeURIComponent(item.placeId)}`;
                            }
                          } else if (item._type === "flight") {
                            dotColor = "#0b3d6b";
                            icon = <svg width="13" height="13" viewBox="0 0 16 16" fill="none" style={{ flexShrink:0 }}><path d="M2 9.5l5 .5 2.5 3.5 1 .3 0-3.6 4-1.6c.5-.2.7-.7.5-1.2l-.1-.2c-.2-.5-.7-.7-1.2-.5l-3.7 1.5L7 5l-.4-1.1 1-.4-.7-.7L4.4 3.6 4 4.8 2.5 6.3 1.2 6.8c-.4.2-.6.5-.5.8l.1.3c.1.4.5.5.9.4L2 9.5z" stroke="#0b3d6b" strokeWidth="1.3" strokeLinejoin="round"/></svg>;
                            title = [item.flightNumber, item.departure && item.arrival ? `${item.departure} → ${item.arrival}` : ""].filter(Boolean).join(" · ");
                            sub1 = [item.departureName, item.arrivalName].filter(Boolean).join(" → ");
                            const flightDur = (() => {
                              if (!item.departureTime || !item.arrivalTime) return "";
                              const [dh, dm] = item.departureTime.split(":").map(Number);
                              const [ah, am] = item.arrivalTime.split(":").map(Number);
                              let mins = (ah * 60 + am) - (dh * 60 + dm);
                              if (mins <= 0) mins += 1440;
                              const h = Math.floor(mins / 60), m = mins % 60;
                              return h > 0 && m > 0 ? `${h}h ${m}m` : h > 0 ? `${h}h` : `${m}m`;
                            })();
                            sub2 = [item.airline, item.aircraft, flightDur, item.distance].filter(Boolean).join(" · ");
                            badge = item.confirmation || "";
                            onDel = !readOnly ? () => deleteFlight(d.day, item.id) : null;
                          } else if (item._type === "direction") {
                            dotColor = "#16a34a";
                            icon = <svg width="13" height="13" viewBox="0 0 16 16" fill="none" style={{ flexShrink:0 }}><path d="M2 8h12M10 4l4 4-4 4" stroke="#16a34a" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>;
                            title = [item.origin?.name, item.destination?.name].filter(Boolean).join(" → ");
                            const rawDist = item.distance || "";
                            const distNum = parseFloat(rawDist);
                            let distDisplay = rawDist;
                            if (!isNaN(distNum) && rawDist.match(/km/i) && distUnit === "mi") distDisplay = `${Math.round(distNum * 0.621371)} mi`;
                            else if (!isNaN(distNum) && rawDist.match(/mi/i) && distUnit === "km") distDisplay = `${Math.round(distNum * 1.60934)} km`;
                            sub1 = [distDisplay, item.duration].filter(Boolean).join(" · ");
                            sub2 = item.notes || "";
                            onDel = !readOnly ? () => deleteDirection(d.day, item.id) : null;
                          } else if (item._type === "route") {
                            dotColor = "#0b3d6b";
                            icon = <svg width="13" height="13" viewBox="0 0 16 16" fill="none" style={{ flexShrink:0 }}><path d="M8 1.5C5.5 1.5 3.5 3.5 3.5 6c0 3 4.5 8 4.5 8s4.5-5 4.5-8c0-2.5-2-4.5-4.5-4.5z" stroke="#0b3d6b" strokeWidth="1.3" strokeLinejoin="round"/><circle cx="8" cy="6" r="1.5" stroke="#0b3d6b" strokeWidth="1.3"/></svg>;
                            title = item.name || [item.startName, item.endName].filter(Boolean).join(" → ") || "Route";
                            if (item.nm > 0) {
                              const h = Math.floor(item.hrs), m = Math.round((item.hrs - h) * 60);
                              const hrsStr = h === 0 ? `${m}m` : m === 0 ? `${h}h` : `${h}h ${m}m`;
                              sub1 = `${item.nm} NM · ~${hrsStr}`;
                            }
                            if (item.startName && item.endName && item.name) sub2 = `${item.startName} → ${item.endName}`;
                            onDel = !readOnly ? () => deleteRoute(d.day, item.id) : null;
                          } else if (item._type === "rentalcar") {
                            dotColor = "#d97706";
                            icon = <svg width="13" height="13" viewBox="0 0 16 16" fill="none" style={{ flexShrink:0 }}><path d="M2.5 11V8.5l1.2-3a1 1 0 011-.7h6.6a1 1 0 011 .7l1.2 3V11" stroke="#d97706" strokeWidth="1.3" strokeLinejoin="round"/><rect x="2" y="11" width="12" height="2.5" rx=".5" stroke="#d97706" strokeWidth="1.3"/></svg>;
                            title = item.agency || "Rental Car";
                            sub1 = [item.pickupLocation, item.dropoffLocation].filter(Boolean).join(" → ");
                            const rcRaw = item.distance || "";
                            const rcNum = parseFloat(rcRaw);
                            let rcDist = rcRaw;
                            if (!isNaN(rcNum) && rcRaw.match(/km/i) && distUnit === "mi") rcDist = `${Math.round(rcNum * 0.621371)} mi`;
                            else if (!isNaN(rcNum) && rcRaw.match(/mi/i) && distUnit === "km") rcDist = `${Math.round(rcNum * 1.60934)} km`;
                            sub2 = [rcDist, item.duration].filter(Boolean).join(" · ");
                            badge = item.confirmation || "";
                            onDel = !readOnly ? () => deleteRentalCar(d.day, item.id) : null;
                          }

                          return (
                            <React.Fragment key={item._type + item.id}>
                            <li style={{ display:"flex", gap:14, position:"relative" }}>
                              {/* Time */}
                              <div style={{ width:52, flexShrink:0, textAlign:"right", paddingTop:1, fontVariantNumeric:"tabular-nums" }}>
                                <div style={{ fontSize:12, color:"#5c6470", fontWeight:500, letterSpacing:-0.1 }}>{item._disp}</div>
                              </div>
                              {/* Dot + connector */}
                              <div style={{ width:18, flexShrink:0, display:"flex", flexDirection:"column", alignItems:"center", position:"relative" }}>
                                <div style={{ width:10, height:10, borderRadius:5, background:"#ffffff", border:`2px solid ${dotColor}`, marginTop:4, zIndex:1, flexShrink:0 }}/>
                                {!isLast && <div style={{ position:"absolute", top:14, bottom:-14, width:1.5, background:"#e2e5ea" }}/>}
                              </div>
                              {/* Content */}
                              <div style={{ flex:1, minWidth:0, paddingBottom: isLast ? 0 : 14 }}>
                                <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", gap:8 }}>
                                  <div style={{ flex:1, minWidth:0, cursor:"pointer" }}
                                    onClick={() => openEditPanel(d.day, item)}>
                                    <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:2, flexWrap:"wrap" }}>
                                      {icon}
                                      <span style={{ fontSize:14, fontWeight:600, letterSpacing:-0.1, color:"#0e1014" }}>{title}</span>
                                    </div>
                                    {sub1 && <div style={{ fontSize:12.5, color:"#5c6470", lineHeight:1.45, marginBottom:sub2 ? 1 : 0 }}>{sub1}</div>}
                                    {sub2 && <div style={{ marginTop:1 }}><NoteMarkdown>{sub2}</NoteMarkdown></div>}
                                    {badge && (
                                      <div style={{ marginTop:4, display:"inline-block",
                                        fontFamily:"ui-monospace, 'SF Mono', Menlo, monospace",
                                        fontSize:11, padding:"3px 8px", borderRadius:5,
                                        background:"#f0f4f8", border:"1px solid #e2e5ea", color:"#5c6470" }}>
                                        {badge}
                                      </div>
                                    )}
                                  </div>
                                  <div style={{ display:"flex", gap:6, alignItems:"center", flexShrink:0 }}>
                                    {mapsUrl && (
                                      <a href={mapsUrl} target="_blank" rel="noopener noreferrer"
                                        style={{ fontSize:11, color:"#2563eb", textDecoration:"none" }}>
                                        Maps ↗
                                      </a>
                                    )}
                                    {onDel && (
                                      <button onClick={onDel}
                                        style={{ background:"none", border:"none", color:"#9ba1ac",
                                          cursor:"pointer", fontSize:14, lineHeight:1, padding:0 }}>
                                        ×
                                      </button>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </li>
                            {/* Insert gap between items */}
                            {!isLast && !readOnly && (() => {
                              const nextItem = all[idx + 1];
                              const suggested = (() => {
                                const parseSort = s => {
                                  if (!s) return null;
                                  const mo = s.match(/^(\d{2}):(\d{2})$/);
                                  if (!mo) return null;
                                  return parseInt(mo[1]) * 60 + parseInt(mo[2]);
                                };
                                const a = parseSort(item._sort);
                                const b = parseSort(nextItem._sort);
                                if (a === null || b === null) return null;
                                const mid = Math.round((a + b) / 2 / 15) * 15;
                                const h = Math.floor(mid / 60) % 24;
                                const mn = mid % 60;
                                return `${String(h).padStart(2,"0")}:${String(mn).padStart(2,"0")}`;
                              })();
                              return (
                                <InsertGap
                                  key={"gap-" + idx}
                                  suggestedTime={suggested ? fmtTime12(suggested) : undefined}
                                  onInsert={() => openAddPanel(d.day, "place")}
                                />
                              );
                            })()}
                            </React.Fragment>
                          );
                        })}
                      </ol>
                    );
                  })()}

                  {/* Empty state */}
                  {!readOnly && (() => {
                    const allItems = [
                      ...(savedPlaces[d.day] ?? []), ...(savedFlights[d.day] ?? []),
                      ...(savedDirections[d.day] ?? []), ...(savedRoutes[d.day] ?? []),
                      ...(savedRentalCars[d.day] ?? []),
                    ];
                    if (allItems.length > 0) return null;
                    return (
                      <div style={{
                        border:"1px dashed #e2e5ea", borderRadius:14,
                        background:"#f8f9fb", padding:"32px 28px",
                        display:"flex", flexDirection:"column", alignItems:"center", gap:14, textAlign:"center",
                        marginTop:8,
                      }}>
                        <div style={{
                          width:44, height:44, borderRadius:22,
                          background:"#ffffff", border:"1px solid #e2e5ea",
                          color:"#9ba1ac", display:"flex", alignItems:"center", justifyContent:"center",
                        }}>{AddGlyph.plus}</div>
                        <div>
                          <div style={{ fontSize:15, fontWeight:600, letterSpacing:-0.2, marginBottom:4 }}>Nothing planned yet.</div>
                          <div style={{ fontSize:12.5, color:"#5c6470", maxWidth:320 }}>
                            Add a flight, a place to visit, or a note.
                          </div>
                        </div>
                        <div style={{ display:"flex", gap:8, marginTop:6, flexWrap:"wrap", justifyContent:"center" }}>
                          <AddTypeBtn glyph={AddGlyph.flight} label="Add travel" sub="Flight, drive, walk…"  onClick={() => openAddPanel(d.day,"travel")} />
                          <AddTypeBtn glyph={AddGlyph.pin}    label="Add place"  sub="Stay, eat, see, do"    onClick={() => openAddPanel(d.day,"place")}  accent />
                        </div>
                      </div>
                    );
                  })()}

                  {/* Add buttons bar — desktop, shown when timeline has items */}
                  {!readOnly && (() => {
                    const allItems = [
                      ...(savedPlaces[d.day] ?? []), ...(savedFlights[d.day] ?? []),
                      ...(savedDirections[d.day] ?? []), ...(savedRoutes[d.day] ?? []),
                      ...(savedRentalCars[d.day] ?? []),
                    ];
                    if (!allItems.length) return null;
                    return (
                      <div className="day-add-bar" style={{ gap:8, marginTop:14, padding:"4px 0 0" }}>
                        <AddTypeBtn glyph={AddGlyph.flight} label="Add travel" sub="Flight, drive, walk…"  onClick={() => openAddPanel(d.day,"travel")} />
                        <AddTypeBtn glyph={AddGlyph.pin}    label="Add place"  sub="Stay, eat, see, do"    onClick={() => openAddPanel(d.day,"place")} />
                        <button title="More: import GPX, paste link, duplicate from another day" style={{
                          width:44, display:"flex", alignItems:"center", justifyContent:"center",
                          borderRadius:8, background:"#ffffff", border:"1px solid #e2e5ea",
                          color:"#9ba1ac", cursor:"pointer", fontFamily:"inherit", flexShrink:0,
                        }}>{AddGlyph.more}</button>
                      </div>
                    );
                  })()}

                  {/* Mobile FAB */}
                  {!readOnly && (
                    <button className="day-add-fab" onClick={() => setMobileSheet(d.day)}
                      style={{ fontSize:"inherit", lineHeight:1 }}>
                      {AddGlyph.plus}
                    </button>
                  )}

                  {/* Claude suggestions */}
                  {settings.anthropicKey && !readOnly && (
                    <ClaudePrompt
                      mode="day"
                      dayNum={d.day}
                      dayContext={{ leg: d.leg, overnight: d.overnight }}
                      itineraryContext={{ title, startDate, days }}
                      onApplyDay={applyClaudeDaySuggestions}
                      apiKey={settings.anthropicKey}
                      model={settings.claudeModel ?? "claude-sonnet-4-6"}
                    />
                  )}

                  {/* Tide warning */}
                  {d.tideWarning && d.tideNote && (
                    <div style={{ marginTop:".75rem", padding:".75rem 1rem", background:"#fef2f2",
                      borderLeft:"3px solid #dc3545", borderRadius:"0 4px 4px 0" }}>
                      <div style={{ fontSize:".62rem", color:"#dc2626", letterSpacing:".1em", textTransform:"uppercase", marginBottom:4, fontFamily:"inherit" }}>⚠ Tide Warning</div>
                      <div style={{ fontSize:".82rem", color:"#ef4444", fontFamily:"inherit", lineHeight:1.55 }}>{d.tideNote}</div>
                    </div>
                  )}

                  </div>
                </div>
            </div>
          );
        })}
        {!readOnly && (
          <div style={{ display:"flex", justifyContent:"center", marginTop:"1rem" }}>
            <button onClick={() => addBlankDay(days.length > 0 ? days[days.length - 1].day : 0)}
              style={{ background:"none", border:"1px dashed #2e5070", color:"#6b7a8a",
                borderRadius:6, padding:".55rem 1.5rem", fontSize:".78rem",
                fontFamily:"inherit", cursor:"pointer", letterSpacing:".05em" }}>
              + Add day at end
            </button>
          </div>
        )}
        </>)}

        {/* ── FUEL TAB ── */}
        {activeTab === "fuel" && (
          <div>
            <div style={{ marginBottom:"1.5rem", padding:"1.25rem", background:"#f8f9fb", border:"1px solid #1e3a52", borderRadius:6 }}>
              <div style={{ fontSize:".7rem", color:"#0b3d6b", letterSpacing:".15em", textTransform:"uppercase", marginBottom:"1rem", fontFamily:"inherit" }}>Fuel Plan Summary</div>
              {fuelSummary.map(f => (
                <div key={f.label} style={{ display:"flex", justifyContent:"space-between", padding:".6rem 0", borderBottom:"1px solid #1e3a5240", fontFamily:"inherit" }}>
                  <span style={{ fontSize:".85rem", color:"#5c6470" }}>{f.label}</span>
                  <span style={{ fontSize:".85rem", color:"#0e1014" }}>{f.value}</span>
                </div>
              ))}
            </div>
            <div style={{ padding:"1.25rem", background:"#f8f9fb", border:"1px solid #e8553844", borderRadius:6, marginBottom:"1rem" }}>
              <div style={{ fontSize:".7rem", color:"#d97706", letterSpacing:".15em", textTransform:"uppercase", marginBottom:".75rem", fontFamily:"inherit" }}>⛽ Fuel Stop Details</div>
              {fuelStops.map(s => (
                <div key={s.stop} style={{ marginBottom:"1.25rem", paddingBottom:"1.25rem", borderBottom:"1px solid #1e3a5230" }}>
                  <div style={{ fontSize:".9rem", color:"#0e1014", fontFamily:"inherit", marginBottom:4 }}>{s.stop}</div>
                  <div style={{ fontSize:".8rem", color:"#9ba1ac", fontFamily:"inherit", marginBottom:3 }}>{s.marina}</div>
                  <div style={{ fontSize:".75rem", color:"#5c6470", fontFamily:"inherit", marginBottom:6 }}>VHF: {s.vhf}</div>
                  <div style={{ fontSize:".8rem", color:"#7a9ab8", fontFamily:"inherit", fontStyle:"italic" }}>{s.notes}</div>
                </div>
              ))}
            </div>
            <div style={{ padding:".85rem 1rem", background:"#f0f4f8", border:"1px solid #c9a84c33", borderRadius:6, fontSize:".8rem", color:"#5c6470", fontFamily:"inherit", lineHeight:1.6 }}>
              <strong style={{ color:"#0b3d6b" }}>Note:</strong> All calculations assume 15 kts / 33 gal·hr. Running at 20 kts increases consumption ~50–70%. Maintain a 15–20% reserve minimum. Fuel Stop #4 at Victoria on Day 17 is easy insurance — you're stopping there for lunch anyway.
            </div>
          </div>
        )}

        {/* ── TIDES TAB ── */}
        {activeTab === "tides" && (
          <div>
            <div style={{ padding:".85rem 1rem", background:"#fef2f2", border:"1px solid #dc354566", borderRadius:6, marginBottom:"1.25rem", fontSize:".82rem", color:"#ef4444", fontFamily:"inherit", lineHeight:1.6 }}>
              <strong style={{ color:"#dc2626" }}>Critical:</strong> This route has two non-negotiable tidal rapids (Malibu and Seymour) and one high-traffic channel (Active Pass). Plan exact passage times the night before using official CHS tables. Cross-check with at least two sources.
            </div>
            {tideWarnings.map(t => (
              <div key={t.passage} style={{ marginBottom:".75rem", padding:"1.1rem 1.25rem", background:"#f8f9fb", border:"1px solid #dc354533", borderRadius:6 }}>
                <div style={{ fontSize:".9rem", color:"#0e1014", fontFamily:"inherit", marginBottom:".4rem" }}>{t.passage}</div>
                <div style={{ fontSize:".82rem", color:"#9ba1ac", fontFamily:"inherit", lineHeight:1.55 }}>{t.detail}</div>
              </div>
            ))}
            <div style={{ marginTop:"1.5rem", padding:"1.25rem", background:"#f8f9fb", border:"1px solid #1e3a52", borderRadius:6 }}>
              <div style={{ fontSize:".7rem", color:"#0b3d6b", letterSpacing:".15em", textTransform:"uppercase", marginBottom:".85rem", fontFamily:"inherit" }}>Apps & Resources</div>
              {[
                ["Navionics Boating App",      "Best all-in-one: charts, tides, ActiveCaptain community notes"],
                ["XTide / Tides Near Me",       "Precise slack water timing for BC passages"],
                ["tides.gc.ca (CHS)",           "Official Canadian Hydrographic Service tide predictions"],
                ["PredictWind or SailFlow",     "Weather routing — critical for Johnstone Strait & Haro Strait"],
                ["VHF Channel 16",              "Monitor at all times underway; 66A for BC marinas"],
                ["CBP ROAM App (US Customs)",   "Required for US re-entry — register all passengers before departure"],
              ].map(([tool,desc]) => (
                <div key={tool} style={{ display:"flex", gap:".75rem", marginBottom:".7rem", fontFamily:"inherit" }}>
                  <span style={{ color:"#0b3d6b", flexShrink:0, marginTop:2 }}>◆</span>
                  <div>
                    <div style={{ fontSize:".85rem", color:"#0e1014" }}>{tool}</div>
                    <div style={{ fontSize:".78rem", color:"#5c6470", marginTop:1 }}>{desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Lock/unlock toggle — bottom of page content */}
        {currentDb.githubToken && currentFile && currentFile !== "__local__" && (
          <div style={{ display: "flex", justifyContent: "center", alignItems: "center",
            gap: ".75rem", marginTop: "1.5rem", paddingTop: "1rem",
            borderTop: "1px solid #1e3a5230" }}>
            <span style={{ fontSize: ".72rem", fontFamily: "inherit", letterSpacing: ".04em",
              minWidth: 48, textAlign: "right",
              color: isLocked ? "#8338e8" : "#6b7a8a" }}>
              {isLocked ? "Locked" : "Editing"}
            </span>
            <div onClick={toggleLock}
              style={{ width: 44, height: 26, borderRadius: 13, cursor: "pointer",
                background: isLocked ? "#e2e5ea" : "#2e7050", position: "relative",
                flexShrink: 0, transition: "background 0.2s",
                border: `1px solid ${isLocked ? "#3a4a5a" : "#3a8060"}` }}>
              <div style={{
                width: 20, height: 20, borderRadius: "50%", background: "white",
                position: "absolute", top: 2, left: isLocked ? 2 : 20,
                transition: "left 0.2s", boxShadow: "0 1px 3px rgba(0,0,0,0.4)",
              }} />
            </div>
            <span style={{ fontSize: ".72rem", fontFamily: "inherit", letterSpacing: ".04em",
              minWidth: 48, color: isLocked ? "#6b7a8a" : "#3a9060" }}>
              {isLocked ? "Unlock" : "🔒 Lock"}
            </span>
          </div>
        )}

      </div>

      {/* ── Mobile: initial options bottom sheet ── */}
      {mobileSheet !== null && (
        <>
          <div className="add-sheet-backdrop" onClick={() => setMobileSheet(null)} />
          <div className="add-sheet">
            <div className="add-sheet-handle" />
            <div style={{ fontSize:15, fontWeight:600, padding:"0 20px 14px", color:"#0e1014" }}>
              {(() => {
                const info = getDayDate(mobileSheet);
                return `Add to Day ${mobileSheet}${info ? ` · ${info.dow} ${info.date} ${info.month}` : ""}`;
              })()}
            </div>
            {[
              { type:"travel", label:"Add travel", sub:"Flight, drive, walk, train, ferry",   glyph:AddGlyph.flight, amber:false },
              { type:"place",  label:"Add place",  sub:"Stay, eat, see, do",                  glyph:AddGlyph.pin,    amber:false },
              { type:"note",   label:"Add note",   sub:"Reminder, thought, packing item",     glyph:AddGlyph.note,   amber:false },
              { type:"paste",  label:"Paste a confirmation", sub:"Or forward to your inbox address", glyph:AddGlyph.forward, amber:true },
            ].map(({ type, label, sub, glyph, amber }) => (
              <button key={type} className="add-sheet-row"
                onClick={() => type === "paste" ? null : openAddPanel(mobileSheet, type)}>
                <div className="add-sheet-row-icon" style={{
                  background: amber ? "rgba(245,181,68,0.16)" : "#e8f1f9",
                  color: amber ? "#f5b544" : "#0b3d6b",
                }}>
                  {glyph}
                </div>
                <div>
                  <div style={{ fontWeight:600, fontSize:15, color:"#0e1014" }}>{label}</div>
                  <div style={{ fontSize:13, color:"#5c6470", marginTop:2 }}>{sub}</div>
                </div>
                <span style={{ marginLeft:"auto", color:"#9ba1ac" }}>›</span>
              </button>
            ))}
          </div>
        </>
      )}

      {/* ── Add panel (desktop: right drawer; mobile: bottom sheet) ── */}
      {addPanel && (
        <>
          <div className="add-panel-backdrop" onClick={closeAddPanel} />
          <div className="add-panel">
            {/* Header — hidden for types that provide their own header */}
            <div className="add-panel-header" style={{ display: (addPanel.type === "place" || addPanel.type === "travel") ? "none" : undefined }}>
              {addPanel.subtype && (
                <button className="add-panel-back"
                  onClick={() => setAddPanel(p => ({ ...p, subtype: undefined }))}>‹</button>
              )}
              <span style={{ flex:1 }}>{panelTitle(addPanel)}</span>
              <button className="add-panel-close" onClick={closeAddPanel}>×</button>
            </div>

            {/* Body */}
            <div className="add-panel-body">

              {/* Travel — unified AddTravelPanel */}
              {addPanel.type === "travel" && (() => {
                const pdi = getDayDate(addPanel.day);
                const pDay = days.find(x => x.day === addPanel.day);
                // Compute ISO date for this day (needed for AeroDataBox flight lookup)
                const departDate = (() => {
                  if (!startDate) return null;
                  const [y, m, d0] = startDate.split("-").map(Number);
                  const dt = new Date(y, m - 1, d0 + addPanel.day - 1);
                  return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,"0")}-${String(dt.getDate()).padStart(2,"0")}`;
                })();
                const dayLabel = [
                  `Day ${addPanel.day}`,
                  pdi ? `${pdi.dow} ${pdi.month} ${pdi.date}` : null,
                  pDay?.leg ?? null,
                ].filter(Boolean).join(" · ");
                return (
                  <AddTravelPanel
                    day={addPanel.day}
                    dayLabel={dayLabel}
                    editItem={addPanel.editItem}
                    onAdd={item => {
                      // Route to the appropriate data handler based on mode
                      if (item.mode === "flight") {
                        addFlight(addPanel.day, {
                          id: item.id, flightNumber: item.flightNum,
                          departure: item.from?.code, arrival: item.to?.code,
                          departureName: item.from?.name, arrivalName: item.to?.name,
                          departureTime: item.departTime, arrivalTime: item.arriveTime,
                          airline: item.airline, aircraft: item.aircraft,
                          confirmation: item.confirmation,
                          departureLat: item.from?.lat, departureLng: item.from?.lng,
                          arrivalLat: item.to?.lat, arrivalLng: item.to?.lng,
                          distance: item.routeDistance || "",
                          miles: item.routeDistance ? Math.round(parseFloat(item.routeDistance.replace(/,/g, ""))) || 0 : 0,
                          notes: item.notes,
                        });
                      } else if (item.mode === "boat") {
                        addRoute(addPanel.day, {
                          id: item.id, name: `${item.from?.name} → ${item.to?.name}`,
                          startName: item.from?.name, endName: item.to?.name,
                          startLat: item.from?.lat, startLng: item.from?.lng,
                          endLat: item.to?.lat, endLng: item.to?.lng,
                          time: item.departTime, nm: null, hrs: null, notes: item.notes,
                        });
                      } else {
                        const modeMap = { car:"DRIVING", walk:"WALKING", train:"TRANSIT", ferry:"TRANSIT", other:"DRIVING" };
                        addDirection(addPanel.day, {
                          id: item.id,
                          origin: { name: item.from?.name || "" },
                          destination: { name: item.to?.name || "" },
                          originLat: item.from?.lat, originLng: item.from?.lng,
                          destinationLat: item.to?.lat, destinationLng: item.to?.lng,
                          travelMode: modeMap[item.mode] || "DRIVING",
                          departDate: item.departDate, time: item.departTime,
                          arriveDate: item.arriveDate, arriveTime: item.arriveTime,
                          distance: item.routeDistance || "", duration: item.routeDuration || "",
                          routePath: item.routePath || null,
                          notes: item.notes,
                        });
                      }
                      closeAddPanel();
                    }}
                    onUpdate={item => {
                      const d = {
                        flightNumber: item.flightNum, departure: item.from?.code, arrival: item.to?.code,
                        departureName: item.from?.name, arrivalName: item.to?.name,
                        departureTime: item.departTime, arrivalTime: item.arriveTime,
                        airline: item.airline, aircraft: item.aircraft, confirmation: item.confirmation, seat: item.seat,
                        terminal: item.terminal, bags: item.bags,
                        distance: item.routeDistance || undefined,
                        miles: item.routeDistance ? Math.round(parseFloat(item.routeDistance.replace(/,/g, ""))) || undefined : undefined,
                        departureLat: item.from?.lat, departureLng: item.from?.lng,
                        arrivalLat: item.to?.lat, arrivalLng: item.to?.lng,
                        origin: { name: item.from?.name || "" }, destination: { name: item.to?.name || "" },
                        originLat: item.from?.lat, originLng: item.from?.lng,
                        destinationLat: item.to?.lat, destinationLng: item.to?.lng,
                        travelMode: { car:"DRIVING", walk:"WALKING", train:"TRANSIT", ferry:"TRANSIT", other:"DRIVING" }[item.mode] || "DRIVING",
                        startName: item.from?.name, endName: item.to?.name,
                        startLat: item.from?.lat, startLng: item.from?.lng,
                        endLat: item.to?.lat, endLng: item.to?.lng,
                        departDate: item.departDate, time: item.departTime,
                        arriveDate: item.arriveDate, arriveTime: item.arriveTime,
                        notes: item.notes, vessel: item.boatVessel,
                        agency: item.vehicle, pickupLocation: item.from?.name, dropoffLocation: item.to?.name,
                        distance: item.routeDistance || undefined, duration: item.routeDuration || undefined,
                        routePath: item.routePath || undefined,
                      };
                      // Remove undefined keys so they don't overwrite existing values with undefined.
                      // Exempt time/date fields — those are always explicit (even when empty).
                      const keepAlways = new Set(["departDate","time","arriveDate","arriveTime"]);
                      Object.keys(d).forEach(k => !keepAlways.has(k) && d[k] === undefined && delete d[k]);
                      const origType = item._origType || (item.mode === "flight" ? "flight" : item.mode === "boat" ? "route" : "direction");
                      if (origType === "flight")    updateFlight(addPanel.day, item.id, d);
                      else if (origType === "route")     updateRoute(addPanel.day, item.id, d);
                      else if (origType === "rentalcar") updateRentalCar(addPanel.day, item.id, d);
                      else                              updateDirection(addPanel.day, item.id, d);
                      closeAddPanel();
                    }}
                    onClose={closeAddPanel}
                    readOnly={readOnly}
                    locationBias={dayBiasFor(addPanel.day)}
                    loadLocGoogle={loadLocGoogle}
                    loadLocApple={loadLocApple}
                    getStoredProviderSettings={getStoredProviderSettings}
                    appleAutocomplete={appleAutocomplete}
                    appleFetchPlaceDetails={appleFetchPlaceDetails}
                    routeServerUrl={settings.routeServerUrl ?? "https://waypoint.troyhakala.com"}
                    aeroDataBoxKey={settings.aeroDataBoxKey ?? ""}
                    calendarDate={departDate}
                    distanceUnit={settings.distanceUnit ?? "km"}
                  />
                );
              })()}

              {/* Place — uses the new unified AddPlacePanel */}
              {addPanel.type === "place" && (() => {
                const pdi = getDayDate(addPanel.day);
                const pDay = days.find(x => x.day === addPanel.day);
                const dayLabel = [
                  `Day ${addPanel.day}`,
                  pdi ? `${pdi.dow} ${pdi.month} ${pdi.date}` : null,
                  pDay?.leg ?? null,
                ].filter(Boolean).join(" · ");
                return (
                  <AddPlacePanel
                    day={addPanel.day}
                    dayLabel={dayLabel}
                    initialKind={addPanel.subtype || "eat"}
                    editItem={addPanel.editItem}
                    onAdd={p => { addPlace(addPanel.day, p); closeAddPanel(); }}
                    onUpdate={(id, updates) => { updatePlace(addPanel.day, id, updates); closeAddPanel(); }}
                    onClose={closeAddPanel}
                    readOnly={readOnly}
                    locationBias={dayBiasFor(addPanel.day)}
                    loadLocGoogle={loadLocGoogle}
                    loadLocApple={loadLocApple}
                    getStoredProviderSettings={getStoredProviderSettings}
                    appleAutocomplete={appleAutocomplete}
                    appleFetchPlaceDetails={appleFetchPlaceDetails}
                  />
                );
              })()}

              {/* Note */}
              {addPanel.type === "note" && (() => {
                const note = customNotes[addPanel.day] !== undefined
                  ? customNotes[addPanel.day]
                  : (days.find(x => x.day === addPanel.day)?.note ?? "");
                const isEditing = editingNoteDay === addPanel.day;
                return (
                  <div>
                    {!readOnly ? (
                      <>
                        <textarea
                          autoFocus
                          value={isEditing ? noteDraft : note}
                          onChange={e => {
                            if (!isEditing) startEditNote(addPanel.day, note);
                            setNoteDraft(e.target.value);
                          }}
                          onFocus={() => { if (!isEditing) startEditNote(addPanel.day, note); }}
                          placeholder="Add a note for this day…"
                          rows={6}
                          style={{ width:"100%", background:"#f8f9fb", border:"1px solid #e2e5ea",
                            color:"#0e1014", borderRadius:8, padding:".6rem .85rem", fontSize:14,
                            fontFamily:"inherit", lineHeight:1.6, resize:"vertical",
                            boxSizing:"border-box", outline:"none" }}
                        />
                        <div style={{ display:"flex", gap:8, marginTop:10 }}>
                          <button
                            onClick={() => { saveNote(addPanel.day); closeAddPanel(); }}
                            style={{ background:"#0b3d6b", border:"none", color:"#fff",
                              borderRadius:8, padding:"8px 18px", fontSize:13,
                              fontFamily:"inherit", cursor:"pointer", fontWeight:600 }}>
                            Save
                          </button>
                          <button
                            onClick={() => { cancelEditNote(); closeAddPanel(); }}
                            style={{ background:"none", border:"1px solid #e2e5ea", color:"#5c6470",
                              borderRadius:8, padding:"8px 14px", fontSize:13,
                              fontFamily:"inherit", cursor:"pointer" }}>
                            Cancel
                          </button>
                        </div>
                      </>
                    ) : (
                      <div style={{ fontSize:14, lineHeight:1.6, color:"#0e1014" }}>
                        <NoteMarkdown>{note}</NoteMarkdown>
                      </div>
                    )}
                  </div>
                );
              })()}

            </div>
          </div>
        </>
      )}

    </div>
  );
}
