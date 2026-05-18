import { useState } from "react";
import NoteMarkdown from "./NoteMarkdown.jsx";

const borderAccent = "3px solid #e8832e66";
const accentColor  = "#e8832e";

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

const BLANK = { agency: "", confirmation: "", pickupLocation: "", dropoffLocation: "", time: "" };

function fmtTime(hhmm) {
  if (!hhmm) return "";
  const [h, m] = hhmm.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

const timeInputStyle = {
  background: "none", border: "none", color: "#0b3d6b",
  fontSize: ".75rem", fontFamily: "inherit",
  cursor: "pointer", padding: 0, outline: "none", colorScheme: "dark",
};

function genId() {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export default function DayRentalCar({ rentalCars, onAdd, onUpdate, onDelete, readOnly = false, hideList = false, autoOpen = false }) {
  const [isAdding,  setIsAdding]  = useState(false);
  const [draft,     setDraft]     = useState(BLANK);
  const [editingId, setEditingId] = useState(null);
  const [noteDraft, setNoteDraft] = useState("");

  const set = (k, v) => setDraft(p => ({ ...p, [k]: v }));
  const canAdd = draft.agency.trim().length > 0;

  function handleAdd() {
    if (!canAdd) return;
    onAdd({
      id:              genId(),
      agency:          draft.agency.trim(),
      confirmation:    draft.confirmation.trim(),
      pickupLocation:  draft.pickupLocation.trim(),
      dropoffLocation: draft.dropoffLocation.trim(),
      time:            draft.time,
      notes:           "",
      addedAt:         new Date().toISOString(),
    });
    setIsAdding(false);
    setDraft(BLANK);
  }

  function handleCancel() {
    setIsAdding(false);
    setDraft(BLANK);
  }

  // Open add form when autoOpen prop is set
  useEffect(() => { if (autoOpen) setIsAdding(true); }, [autoOpen]);

  if (readOnly && rentalCars.length === 0) return null;  if (readOnly && rentalCars.length === 0) return null;

  return (
    <div style={{ marginTop: "1rem" }}>

      {/* Section header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
        padding: ".75rem 1rem", background: "#f0f4f8", borderLeft: borderAccent,
        borderRadius: "0 4px 0 0" }}>
        <div style={{ display: "flex", alignItems: "center", gap: ".5rem" }}>
          <span style={{ ...S.label, color: accentColor }}>Rental Cars</span>
          {rentalCars.length > 0 && (
            <span style={{ background: `${accentColor}22`, color: accentColor,
              border: `1px solid ${accentColor}44`,
              borderRadius: 10, padding: "1px 7px", fontSize: ".6rem", fontFamily: "inherit" }}>
              {rentalCars.length}
            </span>
          )}
        </div>
        {!isAdding && !readOnly && (
          <button type="button" onClick={() => setIsAdding(true)}
            onTouchEnd={e => { e.preventDefault(); setIsAdding(true); }}
            style={{ ...S.btnGhost, fontSize: ".7rem", padding: ".25rem .65rem" }}>
            + Add Rental Car
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

          {/* Agency */}
          <div style={{ marginBottom: ".5rem" }}>
            <div style={{ ...S.label, color: "#5c6470", marginBottom: 3 }}>Agency</div>
            <input autoFocus value={draft.agency}
              onChange={e => set("agency", e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleAdd()}
              placeholder="e.g. Hertz"
              style={{ ...S.input, width: "100%" }} />
          </div>

          {/* Confirmation */}
          <div style={{ marginBottom: ".5rem" }}>
            <div style={{ ...S.label, color: "#5c6470", marginBottom: 3 }}>
              Confirmation # <span style={{ color: "#9ba1ac", fontStyle: "italic",
                textTransform: "none", letterSpacing: 0 }}>(optional)</span>
            </div>
            <input value={draft.confirmation}
              onChange={e => set("confirmation", e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleAdd()}
              placeholder="ABC123"
              style={{ ...S.input, width: "100%" }} />
          </div>

          {/* Pick-up / Drop-off */}
          <div style={{ display: "flex", gap: ".5rem", marginBottom: ".65rem", alignItems: "flex-end" }}>
            <div style={{ flex: 1 }}>
              <div style={{ ...S.label, color: "#5c6470", marginBottom: 3 }}>
                Pick-up <span style={{ color: "#9ba1ac", fontStyle: "italic",
                  textTransform: "none", letterSpacing: 0 }}>(optional)</span>
              </div>
              <input value={draft.pickupLocation}
                onChange={e => set("pickupLocation", e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleAdd()}
                placeholder="SFO Airport"
                style={{ ...S.input, width: "100%" }} />
            </div>
            <div style={{ color: "#6b7a8a", fontFamily: "inherit", fontSize: ".9rem",
              paddingBottom: ".5rem", flexShrink: 0 }}>→</div>
            <div style={{ flex: 1 }}>
              <div style={{ ...S.label, color: "#5c6470", marginBottom: 3 }}>
                Drop-off <span style={{ color: "#9ba1ac", fontStyle: "italic",
                  textTransform: "none", letterSpacing: 0 }}>(optional)</span>
              </div>
              <input value={draft.dropoffLocation}
                onChange={e => set("dropoffLocation", e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleAdd()}
                placeholder="Downtown Seattle"
                style={{ ...S.input, width: "100%" }} />
            </div>
          </div>

          <div style={{ marginBottom: ".65rem" }}>
            <div style={{ ...S.label, color: "#5c6470", marginBottom: 3 }}>
              Pick-up time <span style={{ color: "#9ba1ac", fontStyle: "italic",
                textTransform: "none", letterSpacing: 0 }}>(optional)</span>
            </div>
            <input type="time" value={draft.time}
              onChange={e => set("time", e.target.value)}
              style={{ ...S.input, width: 140, colorScheme: "dark" }} />
          </div>

          <button type="button" onClick={handleAdd}
            onTouchEnd={e => { e.preventDefault(); handleAdd(); }}
            style={{ ...S.btnPrimary, opacity: canAdd ? 1 : 0.45 }}>
            Add Rental Car
          </button>
        </div>
      )}

      {/* Rental car cards */}
      {!hideList && rentalCars.map(c => (
        <div key={c.id} style={{ borderLeft: borderAccent, background: "#f0f4f8" }}>
          <div style={{ padding: ".65rem 1rem", borderTop: "1px solid #1e3a5230" }}>

            {/* Header row */}
            <div style={{ display: "flex", justifyContent: "space-between",
              alignItems: "flex-start", gap: ".5rem", marginBottom: ".3rem" }}>
              <div style={{ flex: 1 }}>
                {/* Agency + confirmation */}
                <div style={{ fontSize: ".88rem", color: "#0e1014", fontFamily: "inherit",
                  fontWeight: 600, lineHeight: 1.3 }}>
                  🚗 {c.agency}
                  {c.confirmation && (
                    <span style={{ fontWeight: 400, color: "#0e1014" }}>
                      {"  ·  "}Conf: {c.confirmation}
                    </span>
                  )}
                </div>
                {/* Pickup / dropoff + time */}
                <div style={{ fontSize: ".78rem", color: "#5c6470", fontFamily: "inherit",
                  marginTop: 2, display: "flex", alignItems: "center", gap: ".5rem", flexWrap: "wrap" }}>
                  {(c.pickupLocation || c.dropoffLocation) && (
                    <span>
                      {c.pickupLocation && c.dropoffLocation
                        ? `${c.pickupLocation} → ${c.dropoffLocation}`
                        : c.pickupLocation
                          ? `Pick-up: ${c.pickupLocation}`
                          : `Drop-off: ${c.dropoffLocation}`}
                    </span>
                  )}
                  {!readOnly
                    ? <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
                        <input type="time" value={c.time || ""}
                          onChange={e => onUpdate(c.id, { time: e.target.value })}
                          style={{ ...timeInputStyle, color: c.time ? "#0b3d6b" : "#2e4a5e" }} />
                        {c.time && (
                          <button type="button" onClick={() => onUpdate(c.id, { time: "" })}
                            style={{ background: "none", border: "none", color: "#2e4a5e",
                              cursor: "pointer", fontSize: ".75rem", padding: "0 2px", lineHeight: 1 }}>
                            ×
                          </button>
                        )}
                      </div>
                    : c.time
                      ? <span style={{ color: "#0b3d6b" }}>{fmtTime(c.time)}</span>
                      : null}
                </div>
              </div>
              {!readOnly && (
                <button type="button" onClick={() => onDelete(c.id)}
                  style={{ background: "none", border: "none", color: `${accentColor}66`,
                    cursor: "pointer", fontSize: ".85rem", lineHeight: 1, padding: 0, flexShrink: 0 }}>
                  ×
                </button>
              )}
            </div>

            {/* Notes */}
            {editingId === c.id && !readOnly ? (
              <div style={{ marginTop: ".35rem" }}>
                <textarea value={noteDraft} rows={2} autoFocus
                  onChange={e => setNoteDraft(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === "Escape") setEditingId(null);
                    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                      onUpdate(c.id, { notes: noteDraft }); setEditingId(null);
                    }
                  }}
                  style={{ ...S.input, width: "100%", resize: "vertical", minHeight: 48 }} />
                <div style={{ display: "flex", gap: ".4rem", marginTop: ".35rem" }}>
                  <button type="button"
                    onClick={() => { onUpdate(c.id, { notes: noteDraft }); setEditingId(null); }}
                    style={S.btnPrimary}>Save</button>
                  <button type="button" onClick={() => setEditingId(null)} style={S.btnGhost}>Cancel</button>
                </div>
              </div>
            ) : (
              <div onClick={() => !readOnly && (setEditingId(c.id), setNoteDraft(c.notes))}
                style={{ cursor: readOnly ? "default" : "pointer" }}>
                {c.notes
                  ? <NoteMarkdown>{c.notes}</NoteMarkdown>
                  : !readOnly && <span style={{ fontSize: ".78rem", color: "#2e4a5e",
                      fontFamily: "inherit", fontStyle: "italic" }}>Add notes…</span>}
              </div>
            )}
          </div>
        </div>
      ))}

      {/* Bottom cap */}
      {!hideList && (rentalCars.length > 0 || isAdding) && (
        <div style={{ height: 1, background: `${accentColor}22`, borderLeft: borderAccent }} />
      )}
    </div>
  );
}
