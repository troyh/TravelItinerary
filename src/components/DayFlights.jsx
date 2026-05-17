import { useState } from "react";
import NoteMarkdown from "./NoteMarkdown.jsx";

const borderAccent = "3px solid #8338e866";
const accentColor  = "#8338e8";

const S = {
  input: { background: "#f0f4f8", border: "1px solid #2e5070", color: "#0e1014",
    borderRadius: 4, padding: ".4rem .65rem", fontSize: ".82rem", fontFamily: "inherit",
    outline: "none", boxSizing: "border-box" },
  btnPrimary: { background: "#e8f1f9", border: "1px solid #2e5070", color: "#0b3d6b",
    borderRadius: 4, padding: ".35rem .8rem", fontSize: ".75rem", fontFamily: "inherit",
    cursor: "pointer", whiteSpace: "nowrap", touchAction: "manipulation" },
  btnGhost: { background: "none", border: "1px solid #2e3a4a", color: "#6b7a8a",
    borderRadius: 4, padding: ".35rem .8rem", fontSize: ".75rem", fontFamily: "inherit",
    cursor: "pointer", whiteSpace: "nowrap", touchAction: "manipulation" },
  label: { fontSize: ".62rem", letterSpacing: ".1em", textTransform: "uppercase",
    fontFamily: "inherit" },
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
  readOnly = false, startDate, dayNum, aeroDataBoxKey, hideList = false,
}) {
  const [isAdding,      setIsAdding]      = useState(false);
  const [draft,         setDraft]         = useState(BLANK);
  const [looking,       setLooking]       = useState(false);
  const [lookupErr,     setLookupErr]     = useState(null);
  const [lookupResults, setLookupResults] = useState(null); // null | Flight[]
  const [editingId,     setEditingId]     = useState(null);
  const [noteDraft,     setNoteDraft]     = useState("");

  const set = (k, v) => setDraft(p => ({ ...p, [k]: v }));

  const canAdd = draft.flightNumber.trim() && draft.departure.trim() && draft.arrival.trim();

  function applyFlight(flight) {
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
    setDraft(p => ({
      ...p,
      departure:    depIata,
      arrival:      arrIata,
      departureName: dep?.municipalityName ?? "",
      arrivalName:   arr?.municipalityName ?? "",
      departureTime: parseLocalTime(flight.departure?.scheduledTime?.local ?? ""),
      arrivalTime:   parseLocalTime(flight.arrival?.scheduledTime?.local ?? ""),
      airline:       flight.airline?.name ?? "",
      aircraft:      flight.aircraft?.model ?? "",
      status:        flight.status ?? "",
      miles,
      departureLat:  dep?.location?.lat ?? "",
      departureLng:  dep?.location?.lon ?? "",
      arrivalLat:    arr?.location?.lat ?? "",
      arrivalLng:    arr?.location?.lon ?? "",
    }));
    setLookupResults(null);
  }

  async function handleLookup() {
    const fn = draft.flightNumber.trim().replace(/\s+/g, "");
    const date = getFlightDate(startDate, dayNum);
    if (!fn) return;
    if (!date) { setLookupErr("Set a departure date on the itinerary first."); return; }
    setLooking(true);
    setLookupErr(null);
    setLookupResults(null);
    try {
      const res = await fetch(
        `https://aerodatabox.p.rapidapi.com/flights/number/${encodeURIComponent(fn)}/${date}`,
        { headers: { "X-RapidAPI-Key": aeroDataBoxKey, "X-RapidAPI-Host": "aerodatabox.p.rapidapi.com" } }
      );
      if (!res.ok) { setLookupErr(`Flight not found for ${fn} on ${date}.`); return; }
      const data = await res.json();
      const results = (Array.isArray(data) ? data : [data]).filter(Boolean);
      if (!results.length) { setLookupErr("No results."); return; }
      if (results.length === 1) {
        applyFlight(results[0]);
      } else {
        setLookupResults(results);
      }
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
        padding: ".75rem 1rem", background: "#f0f4f8", borderLeft: borderAccent,
        borderRadius: "0 4px 0 0" }}>
        <div style={{ display: "flex", alignItems: "center", gap: ".5rem" }}>
          <span style={{ ...S.label, color: accentColor }}>Flights</span>
          {flights.length > 0 && (
            <span style={{ background: `${accentColor}22`, color: accentColor,
              border: `1px solid ${accentColor}44`,
              borderRadius: 10, padding: "1px 7px", fontSize: ".6rem", fontFamily: "inherit" }}>
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
        <div style={{ background: "#f0f4f8", borderLeft: borderAccent, padding: ".75rem 1rem" }}>

          {/* Flight number + lookup */}
          <div style={{ marginBottom: ".5rem" }}>
            <div style={{ ...S.label, color: "#5c6470", marginBottom: 3 }}>Flight Number</div>
            <div style={{ display: "flex", gap: ".4rem" }}>
              <input autoFocus value={draft.flightNumber}
                onChange={e => { set("flightNumber", e.target.value); setLookupErr(null); }}
                onKeyDown={e => e.key === "Enter" && aeroDataBoxKey && handleLookup()}
                placeholder="e.g. UA 123"
                style={{ ...S.input, flex: 1 }} />
              {aeroDataBoxKey && (
                <button type="button" onClick={handleLookup} disabled={!draft.flightNumber.trim() || looking}
                  title={getFlightDate(startDate, dayNum) ? `Query date: ${getFlightDate(startDate, dayNum)}` : "Set a departure date on the itinerary to enable lookup"}
                  style={{ ...S.btnGhost, opacity: (!draft.flightNumber.trim() || looking) ? 0.45 : 1 }}>
                  {looking ? "Looking…" : "Look up"}
                </button>
              )}
            </div>
            {lookupErr && (
              <div style={{ fontSize: ".72rem", color: "#dc2626", fontFamily: "inherit", marginTop: 3 }}>
                {lookupErr}
              </div>
            )}
            {lookupResults && (
              <div style={{ marginTop: ".5rem", border: "1px solid #2e5070", borderRadius: 4,
                background: "#071520", overflow: "hidden" }}>
                <div style={{ fontSize: ".62rem", color: "#5c6470", letterSpacing: ".08em",
                  textTransform: "uppercase", fontFamily: "inherit",
                  padding: ".35rem .65rem", borderBottom: "1px solid #1e3a5230" }}>
                  Multiple flights found — select one
                </div>
                {lookupResults.map((r, i) => {
                  const dep = r.departure?.airport;
                  const arr = r.arrival?.airport;
                  const label = [
                    dep?.iata && arr?.iata ? `${dep.iata} → ${arr.iata}` : null,
                    dep?.municipalityName && arr?.municipalityName
                      ? `${dep.municipalityName} → ${arr.municipalityName}` : null,
                    r.airline?.name ?? null,
                    parseLocalTime(r.departure?.scheduledTime?.local ?? "") || null,
                  ].filter(Boolean).join("  ·  ");
                  return (
                    <div key={i} onClick={() => applyFlight(r)}
                      style={{ padding: ".45rem .65rem", cursor: "pointer",
                        borderBottom: i < lookupResults.length - 1 ? "1px solid #1e3a5230" : "none",
                        fontFamily: "inherit", fontSize: ".8rem", color: "#0e1014" }}
                      onMouseEnter={e => e.currentTarget.style.background = "#e8f1f9"}
                      onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                      {label || `Option ${i + 1}`}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* From / To */}
          <div style={{ display: "flex", gap: ".5rem", marginBottom: ".5rem", alignItems: "flex-end" }}>
            <div style={{ width: 80 }}>
              <div style={{ ...S.label, color: "#5c6470", marginBottom: 3 }}>From</div>
              <input value={draft.departure}
                onChange={e => set("departure", e.target.value.toUpperCase())}
                onKeyDown={e => e.key === "Enter" && handleAdd()}
                placeholder="SFO"
                style={{ ...S.input, width: "100%", textTransform: "uppercase" }} />
            </div>
            <div style={{ color: "#6b7a8a", fontFamily: "inherit", fontSize: ".9rem",
              paddingBottom: ".5rem", flexShrink: 0 }}>→</div>
            <div style={{ width: 80 }}>
              <div style={{ ...S.label, color: "#5c6470", marginBottom: 3 }}>To</div>
              <input value={draft.arrival}
                onChange={e => set("arrival", e.target.value.toUpperCase())}
                onKeyDown={e => e.key === "Enter" && handleAdd()}
                placeholder="LAX"
                style={{ ...S.input, width: "100%", textTransform: "uppercase" }} />
            </div>
            <div style={{ flex: 1, minWidth: 70 }}>
              <div style={{ ...S.label, color: "#5c6470", marginBottom: 3 }}>Miles</div>
              <input type="text" inputMode="numeric" value={draft.miles}
                onChange={e => set("miles", e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleAdd()}
                placeholder="2,453"
                style={{ ...S.input, width: "100%" }} />
            </div>
          </div>

          {/* Confirmation */}
          <div style={{ marginBottom: ".65rem" }}>
            <div style={{ ...S.label, color: "#5c6470", marginBottom: 3 }}>
              Confirmation # <span style={{ color: "#9ba1ac", fontStyle: "italic", textTransform: "none",
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

      {/* Flight timeline */}
      {!hideList && flights.length > 0 && (
        <div style={{ borderLeft: borderAccent, background: "#f0f4f8", padding: ".65rem 1rem .25rem" }}>
          {flights.map((f, idx) => {
            const isLast = idx === flights.length - 1;
            return (
              <div key={f.id} style={{ display: "flex", gap: 14, paddingBottom: isLast ? 8 : 16 }}>
                {/* Time zone */}
                <div style={{ width: 42, textAlign: "right", fontSize: 12, color: "#5c6470",
                  fontFamily: "inherit", flexShrink: 0, paddingTop: 1 }}>
                  {f.departureTime || ""}
                </div>

                {/* Rail zone */}
                <div style={{ width: 18, position: "relative", display: "flex",
                  flexDirection: "column", alignItems: "center", flexShrink: 0 }}>
                  <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#fff",
                    border: "2px solid #0b3d6b", marginTop: 4, flexShrink: 0, zIndex: 1 }} />
                  {!isLast && (
                    <div style={{ position: "absolute", top: 14, bottom: -16, width: 1.5,
                      background: "#e2e5ea" }} />
                  )}
                </div>

                {/* Content zone */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  {/* Header row */}
                  <div style={{ display: "flex", justifyContent: "space-between",
                    alignItems: "flex-start", gap: ".5rem", marginBottom: ".3rem" }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      {/* Flight number + route */}
                      <div style={{ fontSize: ".88rem", color: "#0e1014", fontFamily: "inherit",
                        fontWeight: 600, lineHeight: 1.3, display: "flex", alignItems: "center", gap: 5 }}>
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none"
                          xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: 0 }}>
                          <path d="M2 9.5l5 .5 2.5 3.5 1 .3 0-3.6 4-1.6c.5-.2.7-.7.5-1.2l-.1-.2c-.2-.5-.7-.7-1.2-.5l-3.7 1.5L7 5l-.4-1.1 1-.4-.7-.7L4.4 3.6 4 4.8 2.5 6.3 1.2 6.8c-.4.2-.6.5-.5.8l.1.3c.1.4.5.5.9.4L2 9.5z"
                            stroke="#0b3d6b" strokeWidth="1.3" strokeLinejoin="round" fill="#0b3d6b" />
                        </svg>
                        <span>{f.flightNumber}</span>
                        {f.departure && f.arrival && (
                          <span style={{ fontWeight: 400, color: "#0e1014" }}>
                            {f.departure} → {f.arrival}
                          </span>
                        )}
                      </div>
                      {/* Departure city */}
                      {f.departureName && (
                        <div style={{ fontSize: ".78rem", color: "#5c6470", fontFamily: "inherit",
                          marginTop: 2 }}>
                          {f.departureName}
                        </div>
                      )}
                      {/* Arrival city */}
                      {f.arrivalName && (
                        <div style={{ fontSize: ".78rem", color: "#5c6470", fontFamily: "inherit",
                          marginTop: 1 }}>
                          {f.arrivalName}
                        </div>
                      )}
                      {/* Confirmation pill */}
                      {f.confirmation && (
                        <div style={{ marginTop: 4 }}>
                          <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 11,
                            background: "#f0f4f8", border: "1px solid #e2e5ea", borderRadius: 5,
                            padding: "3px 8px", color: "#5c6470" }}>
                            {f.confirmation}
                          </span>
                        </div>
                      )}
                      {/* Airline + aircraft */}
                      {(f.airline || f.aircraft) && (
                        <div style={{ fontSize: ".72rem", color: "#5c6470", fontFamily: "inherit",
                          marginTop: 2 }}>
                          {[f.airline, f.aircraft].filter(Boolean).join("  ·  ")}
                        </div>
                      )}
                      {/* Times + status */}
                      {(f.departureTime || f.arrivalTime || f.status) && (
                        <div style={{ fontSize: ".72rem", fontFamily: "inherit", marginTop: 2,
                          display: "flex", gap: ".75rem", flexWrap: "wrap", alignItems: "center" }}>
                          {(f.departureTime || f.arrivalTime) && (
                            <span style={{ color: "#0b3d6b" }}>
                              {[f.departureTime, f.arrivalTime].filter(Boolean).join(" → ")}
                            </span>
                          )}
                          {f.status && (
                            <span style={{ color: f.status === "Arrived" ? "#16a34a"
                              : f.status === "Departed" ? "#2563eb" : "#5c6470",
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
                      {/* Miles */}
                      {f.miles && (
                        <div style={{ fontSize: ".72rem", color: "#6b7a8a", fontFamily: "inherit",
                          marginTop: 2 }}>
                          {f.miles.toLocaleString()} mi
                        </div>
                      )}
                    </div>
                    {/* Delete button */}
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
                            fontFamily: "inherit", fontStyle: "italic" }}>Add notes…</span>}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Bottom cap */}
      {!hideList && (flights.length > 0 || isAdding) && (
        <div style={{ height: 1, background: `${accentColor}22`, borderLeft: borderAccent }} />
      )}
    </div>
  );
}
