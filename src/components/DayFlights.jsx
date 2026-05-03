import { useState } from "react";
import NoteMarkdown from "./NoteMarkdown.jsx";

const borderAccent = "3px solid #8338e866";
const accentColor  = "#8338e8";

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

const BLANK = { flightNumber: "", departure: "", arrival: "", departureName: "", arrivalName: "",
                departureTime: "", arrivalTime: "", airline: "", aircraft: "", status: "", miles: "", confirmation: "",
                departureLat: "", departureLng: "", arrivalLat: "", arrivalLng: "" };

function parseLocalTime(localStr) {
  // Format: "2026-06-01 07:00-07:00" → "7:00 AM"
  if (!localStr) return "";
  const timePart = localStr.includes("T") ? localStr.split("T")[1] : localStr.split(" ")[1];
  if (!timePart) return "";
  const [hh, mm] = timePart.slice(0, 5).split(":").map(Number);
  if (isNaN(hh) || isNaN(mm)) return "";
  const ampm = hh < 12 ? "AM" : "PM";
  const h = hh % 12 || 12;
  return `${h}:${String(mm).padStart(2, "0")} ${ampm}`;
}

function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 3959;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(a)));
}

function getFlightDate(startDate, dayNum) {
  if (!startDate) return null;
  const [y, m, d] = startDate.split("-").map(Number);
  const date = new Date(y, m - 1, d + dayNum - 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function genId() {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export default function DayFlights({
  flights, onAdd, onUpdate, onDelete,
  readOnly = false, startDate, dayNum, aeroDataBoxKey,
}) {
  const [isAdding,   setIsAdding]   = useState(false);
  const [draft,      setDraft]      = useState(BLANK);
  const [looking,    setLooking]    = useState(false);
  const [lookupErr,  setLookupErr]  = useState(null);
  const [editingId,  setEditingId]  = useState(null);
  const [noteDraft,  setNoteDraft]  = useState("");

  const set = (k, v) => setDraft(p => ({ ...p, [k]: v }));

  const canAdd = draft.flightNumber.trim() && draft.departure.trim() && draft.arrival.trim();

  async function handleLookup() {
    const fn = draft.flightNumber.trim().replace(/\s+/g, "");
    const date = getFlightDate(startDate, dayNum);
    if (!fn || !date) return;
    setLooking(true);
    setLookupErr(null);
    try {
      const res = await fetch(
        `https://aerodatabox.p.rapidapi.com/flights/number/${encodeURIComponent(fn)}/${date}`,
        { headers: { "X-RapidAPI-Key": aeroDataBoxKey, "X-RapidAPI-Host": "aerodatabox.p.rapidapi.com" } }
      );
      if (!res.ok) { setLookupErr("Flight not found."); return; }
      const data = await res.json();
      const flight = Array.isArray(data) ? data[0] : data;
      if (!flight) { setLookupErr("No results."); return; }
      const dep = flight.departure?.airport;
      const arr = flight.arrival?.airport;
      const depIata = dep?.iata ?? "";
      const arrIata = arr?.iata ?? "";
      let miles = "";
      if (dep?.location && arr?.location) {
        miles = String(haversineDistance(
          dep.location.lat, dep.location.lon,
          arr.location.lat, arr.location.lon
        ));
      }
      const depName      = dep?.municipalityName ?? "";
      const arrName      = arr?.municipalityName ?? "";
      const departureTime = parseLocalTime(flight.departure?.scheduledTime?.local ?? "");
      const arrivalTime   = parseLocalTime(flight.arrival?.scheduledTime?.local ?? "");
      const airline       = flight.airline?.name ?? "";
      const aircraft      = flight.aircraft?.model ?? "";
      const status        = flight.status ?? "";
      const departureLat = dep?.location?.lat ?? "";
      const departureLng = dep?.location?.lon ?? "";
      const arrivalLat   = arr?.location?.lat ?? "";
      const arrivalLng   = arr?.location?.lon ?? "";
      setDraft(p => ({ ...p, departure: depIata, arrival: arrIata,
        departureName: depName, arrivalName: arrName,
        departureTime, arrivalTime, airline, aircraft, status, miles,
        departureLat, departureLng, arrivalLat, arrivalLng }));
    } catch {
      setLookupErr("Lookup failed — check your API key.");
    } finally {
      setLooking(false);
    }
  }

  function handleAdd() {
    if (!canAdd) return;
    const miles = parseInt(draft.miles);
    onAdd({
      id:           genId(),
      flightNumber:  draft.flightNumber.trim(),
      departure:     draft.departure.trim().toUpperCase(),
      arrival:       draft.arrival.trim().toUpperCase(),
      departureName:  draft.departureName.trim(),
      arrivalName:    draft.arrivalName.trim(),
      departureTime:  draft.departureTime.trim(),
      arrivalTime:    draft.arrivalTime.trim(),
      airline:        draft.airline.trim(),
      aircraft:       draft.aircraft.trim(),
      status:         draft.status.trim(),
      miles:          isNaN(miles) ? null : miles,
      confirmation:  draft.confirmation.trim(),
      departureLat:  parseFloat(draft.departureLat) || null,
      departureLng:  parseFloat(draft.departureLng) || null,
      arrivalLat:    parseFloat(draft.arrivalLat)   || null,
      arrivalLng:    parseFloat(draft.arrivalLng)   || null,
      notes:        "",
      addedAt:      new Date().toISOString(),
    });
    setIsAdding(false);
    setDraft(BLANK);
    setLookupErr(null);
  }

  function handleCancel() {
    setIsAdding(false);
    setDraft(BLANK);
    setLookupErr(null);
  }

  if (readOnly && flights.length === 0) return null;

  return (
    <div style={{ marginTop: "1rem" }}>

      {/* Section header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
        padding: ".75rem 1rem", background: "#0a1a2a", borderLeft: borderAccent,
        borderRadius: "0 4px 0 0" }}>
        <div style={{ display: "flex", alignItems: "center", gap: ".5rem" }}>
          <span style={{ ...S.label, color: accentColor }}>Flights</span>
          {flights.length > 0 && (
            <span style={{ background: `${accentColor}22`, color: accentColor,
              border: `1px solid ${accentColor}44`,
              borderRadius: 10, padding: "1px 7px", fontSize: ".6rem", fontFamily: "sans-serif" }}>
              {flights.length}
            </span>
          )}
        </div>
        {!isAdding && !readOnly && (
          <button type="button" onClick={() => setIsAdding(true)}
            onTouchEnd={e => { e.preventDefault(); setIsAdding(true); }}
            style={{ ...S.btnGhost, fontSize: ".7rem", padding: ".25rem .65rem" }}>
            + Add Flight
          </button>
        )}
        {isAdding && (
          <button type="button" onClick={handleCancel}
            onTouchEnd={e => { e.preventDefault(); handleCancel(); }}
            style={{ ...S.btnGhost, fontSize: ".7rem", padding: ".25rem .65rem" }}>
            Cancel
          </button>
        )}
      </div>

      {/* Add form */}
      {isAdding && (
        <div style={{ background: "#0a1a2a", borderLeft: borderAccent, padding: ".75rem 1rem" }}>

          {/* Flight number + lookup */}
          <div style={{ marginBottom: ".5rem" }}>
            <div style={{ ...S.label, color: "#6b8fa8", marginBottom: 3 }}>Flight Number</div>
            <div style={{ display: "flex", gap: ".4rem" }}>
              <input autoFocus value={draft.flightNumber}
                onChange={e => { set("flightNumber", e.target.value); setLookupErr(null); }}
                onKeyDown={e => e.key === "Enter" && aeroDataBoxKey && handleLookup()}
                placeholder="e.g. UA 123"
                style={{ ...S.input, flex: 1 }} />
              {aeroDataBoxKey && (
                <button type="button" onClick={handleLookup} disabled={!draft.flightNumber.trim() || looking}
                  style={{ ...S.btnGhost, opacity: (!draft.flightNumber.trim() || looking) ? 0.45 : 1 }}>
                  {looking ? "Looking…" : "Look up"}
                </button>
              )}
            </div>
            {lookupErr && (
              <div style={{ fontSize: ".72rem", color: "#e87878", fontFamily: "sans-serif", marginTop: 3 }}>
                {lookupErr}
              </div>
            )}
          </div>

          {/* From / To */}
          <div style={{ display: "flex", gap: ".5rem", marginBottom: ".5rem", alignItems: "flex-end" }}>
            <div style={{ width: 80 }}>
              <div style={{ ...S.label, color: "#6b8fa8", marginBottom: 3 }}>From</div>
              <input value={draft.departure}
                onChange={e => set("departure", e.target.value.toUpperCase())}
                onKeyDown={e => e.key === "Enter" && handleAdd()}
                placeholder="SFO"
                style={{ ...S.input, width: "100%", textTransform: "uppercase" }} />
            </div>
            <div style={{ color: "#4e7a9e", fontFamily: "sans-serif", fontSize: ".9rem",
              paddingBottom: ".5rem", flexShrink: 0 }}>→</div>
            <div style={{ width: 80 }}>
              <div style={{ ...S.label, color: "#6b8fa8", marginBottom: 3 }}>To</div>
              <input value={draft.arrival}
                onChange={e => set("arrival", e.target.value.toUpperCase())}
                onKeyDown={e => e.key === "Enter" && handleAdd()}
                placeholder="LAX"
                style={{ ...S.input, width: "100%", textTransform: "uppercase" }} />
            </div>
            <div style={{ flex: 1, minWidth: 70 }}>
              <div style={{ ...S.label, color: "#6b8fa8", marginBottom: 3 }}>Miles</div>
              <input type="text" inputMode="numeric" value={draft.miles}
                onChange={e => set("miles", e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleAdd()}
                placeholder="2,453"
                style={{ ...S.input, width: "100%" }} />
            </div>
          </div>

          {/* Confirmation */}
          <div style={{ marginBottom: ".65rem" }}>
            <div style={{ ...S.label, color: "#6b8fa8", marginBottom: 3 }}>
              Confirmation # <span style={{ color: "#3d5060", fontStyle: "italic", textTransform: "none",
                letterSpacing: 0 }}>(optional)</span>
            </div>
            <input value={draft.confirmation}
              onChange={e => set("confirmation", e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleAdd()}
              placeholder="ABC123"
              style={{ ...S.input, width: "100%" }} />
          </div>

          <button type="button" onClick={handleAdd}
            onTouchEnd={e => { e.preventDefault(); handleAdd(); }}
            style={{ ...S.btnPrimary, opacity: canAdd ? 1 : 0.45 }}>
            Add Flight
          </button>
        </div>
      )}

      {/* Flight cards */}
      {flights.map(f => (
        <div key={f.id} style={{ borderLeft: borderAccent, background: "#0a1a2a" }}>
          <div style={{ padding: ".65rem 1rem", borderTop: "1px solid #1e3a5230" }}>

            {/* Header row */}
            <div style={{ display: "flex", justifyContent: "space-between",
              alignItems: "flex-start", gap: ".5rem", marginBottom: ".3rem" }}>
              <div style={{ flex: 1 }}>
                {/* Flight number + route */}
                <div style={{ fontSize: ".88rem", color: "#e8dcc8", fontFamily: "sans-serif",
                  fontWeight: 600, lineHeight: 1.3 }}>
                  ✈ {f.flightNumber}
                  {f.departure && f.arrival && (
                    <span style={{ fontWeight: 400, color: "#c8daea" }}>
                      {"  "}{f.departure} → {f.arrival}
                    </span>
                  )}
                </div>
                {/* City names */}
                {(f.departureName || f.arrivalName) && (
                  <div style={{ fontSize: ".78rem", color: "#8fb0cc", fontFamily: "sans-serif",
                    marginTop: 2 }}>
                    {[f.departureName, f.arrivalName].filter(Boolean).join(" → ")}
                  </div>
                )}
                {/* Airline + aircraft */}
                {(f.airline || f.aircraft) && (
                  <div style={{ fontSize: ".72rem", color: "#6b8fa8", fontFamily: "sans-serif",
                    marginTop: 2 }}>
                    {[f.airline, f.aircraft].filter(Boolean).join("  ·  ")}
                  </div>
                )}
                {/* Times + status */}
                {(f.departureTime || f.arrivalTime || f.status) && (
                  <div style={{ fontSize: ".72rem", fontFamily: "sans-serif", marginTop: 2,
                    display: "flex", gap: ".75rem", flexWrap: "wrap", alignItems: "center" }}>
                    {(f.departureTime || f.arrivalTime) && (
                      <span style={{ color: "#c9a84c" }}>
                        {[f.departureTime, f.arrivalTime].filter(Boolean).join(" → ")}
                      </span>
                    )}
                    {f.status && (
                      <span style={{ color: f.status === "Arrived" ? "#5cb85c"
                        : f.status === "Departed" ? "#4a9eff" : "#6b8fa8",
                        background: f.status === "Arrived" ? "#5cb85c18"
                          : f.status === "Departed" ? "#4a9eff18" : "#6b8fa818",
                        border: `1px solid ${f.status === "Arrived" ? "#5cb85c44"
                          : f.status === "Departed" ? "#4a9eff44" : "#6b8fa844"}`,
                        borderRadius: 3, padding: "1px 5px", fontSize: ".65rem",
                        letterSpacing: ".04em" }}>
                        {f.status}
                      </span>
                    )}
                  </div>
                )}
                {/* Miles + confirmation */}
                {(f.miles || f.confirmation) && (
                  <div style={{ fontSize: ".72rem", color: "#4e7a9e", fontFamily: "sans-serif",
                    marginTop: 2 }}>
                    {[
                      f.miles ? `${f.miles.toLocaleString()} mi` : null,
                      f.confirmation ? `Conf: ${f.confirmation}` : null,
                    ].filter(Boolean).join("  ·  ")}
                  </div>
                )}
              </div>
              {!readOnly && (
                <button type="button" onClick={() => onDelete(f.id)}
                  style={{ background: "none", border: "none", color: `${accentColor}66`,
                    cursor: "pointer", fontSize: ".85rem", lineHeight: 1, padding: 0, flexShrink: 0 }}>
                  ×
                </button>
              )}
            </div>

            {/* Notes */}
            {editingId === f.id && !readOnly ? (
              <div style={{ marginTop: ".35rem" }}>
                <textarea value={noteDraft} rows={2} autoFocus
                  onChange={e => setNoteDraft(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === "Escape") setEditingId(null);
                    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                      onUpdate(f.id, { notes: noteDraft }); setEditingId(null);
                    }
                  }}
                  style={{ ...S.input, width: "100%", resize: "vertical", minHeight: 48 }} />
                <div style={{ display: "flex", gap: ".4rem", marginTop: ".35rem" }}>
                  <button type="button"
                    onClick={() => { onUpdate(f.id, { notes: noteDraft }); setEditingId(null); }}
                    style={S.btnPrimary}>Save</button>
                  <button type="button" onClick={() => setEditingId(null)} style={S.btnGhost}>Cancel</button>
                </div>
              </div>
            ) : (
              <div onClick={() => !readOnly && (setEditingId(f.id), setNoteDraft(f.notes))}
                style={{ cursor: readOnly ? "default" : "pointer" }}>
                {f.notes
                  ? <NoteMarkdown>{f.notes}</NoteMarkdown>
                  : !readOnly && <span style={{ fontSize: ".78rem", color: "#2e4a5e",
                      fontFamily: "sans-serif", fontStyle: "italic" }}>Add notes…</span>}
              </div>
            )}
          </div>
        </div>
      ))}

      {/* Bottom cap */}
      {(flights.length > 0 || isAdding) && (
        <div style={{ height: 1, background: `${accentColor}22`, borderLeft: borderAccent }} />
      )}
    </div>
  );
}
