import { useState } from "react";
import NoteMarkdown from "./NoteMarkdown.jsx";

const borderAccent = "3px solid #e8832e66";
const accentColor  = "#e8832e";

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

const BLANK = { agency: "", confirmation: "", pickupLocation: "", dropoffLocation: "" };

function genId() {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export default function DayRentalCar({ rentalCars, onAdd, onUpdate, onDelete, readOnly = false }) {
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

  if (readOnly && rentalCars.length === 0) return null;

  return (
    <div style={{ marginTop: "1rem" }}>

      {/* Section header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
        padding: ".75rem 1rem", background: "#0a1a2a", borderLeft: borderAccent,
        borderRadius: "0 4px 0 0" }}>
        <div style={{ display: "flex", alignItems: "center", gap: ".5rem" }}>
          <span style={{ ...S.label, color: accentColor }}>Rental Cars</span>
          {rentalCars.length > 0 && (
            <span style={{ background: `${accentColor}22`, color: accentColor,
              border: `1px solid ${accentColor}44`,
              borderRadius: 10, padding: "1px 7px", fontSize: ".6rem", fontFamily: "sans-serif" }}>
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
        <div style={{ background: "#0a1a2a", borderLeft: borderAccent, padding: ".75rem 1rem" }}>

          {/* Agency */}
          <div style={{ marginBottom: ".5rem" }}>
            <div style={{ ...S.label, color: "#6b8fa8", marginBottom: 3 }}>Agency</div>
            <input autoFocus value={draft.agency}
              onChange={e => set("agency", e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleAdd()}
              placeholder="e.g. Hertz"
              style={{ ...S.input, width: "100%" }} />
          </div>

          {/* Confirmation */}
          <div style={{ marginBottom: ".5rem" }}>
            <div style={{ ...S.label, color: "#6b8fa8", marginBottom: 3 }}>
              Confirmation # <span style={{ color: "#3d5060", fontStyle: "italic",
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
              <div style={{ ...S.label, color: "#6b8fa8", marginBottom: 3 }}>
                Pick-up <span style={{ color: "#3d5060", fontStyle: "italic",
                  textTransform: "none", letterSpacing: 0 }}>(optional)</span>
              </div>
              <input value={draft.pickupLocation}
                onChange={e => set("pickupLocation", e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleAdd()}
                placeholder="SFO Airport"
                style={{ ...S.input, width: "100%" }} />
            </div>
            <div style={{ color: "#4e7a9e", fontFamily: "sans-serif", fontSize: ".9rem",
              paddingBottom: ".5rem", flexShrink: 0 }}>→</div>
            <div style={{ flex: 1 }}>
              <div style={{ ...S.label, color: "#6b8fa8", marginBottom: 3 }}>
                Drop-off <span style={{ color: "#3d5060", fontStyle: "italic",
                  textTransform: "none", letterSpacing: 0 }}>(optional)</span>
              </div>
              <input value={draft.dropoffLocation}
                onChange={e => set("dropoffLocation", e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleAdd()}
                placeholder="Downtown Seattle"
                style={{ ...S.input, width: "100%" }} />
            </div>
          </div>

          <button type="button" onClick={handleAdd}
            onTouchEnd={e => { e.preventDefault(); handleAdd(); }}
            style={{ ...S.btnPrimary, opacity: canAdd ? 1 : 0.45 }}>
            Add Rental Car
          </button>
        </div>
      )}

      {/* Rental car cards */}
      {rentalCars.map(c => (
        <div key={c.id} style={{ borderLeft: borderAccent, background: "#0a1a2a" }}>
          <div style={{ padding: ".65rem 1rem", borderTop: "1px solid #1e3a5230" }}>

            {/* Header row */}
            <div style={{ display: "flex", justifyContent: "space-between",
              alignItems: "flex-start", gap: ".5rem", marginBottom: ".3rem" }}>
              <div style={{ flex: 1 }}>
                {/* Agency + confirmation */}
                <div style={{ fontSize: ".88rem", color: "#e8dcc8", fontFamily: "sans-serif",
                  fontWeight: 600, lineHeight: 1.3 }}>
                  🚗 {c.agency}
                  {c.confirmation && (
                    <span style={{ fontWeight: 400, color: "#c8daea" }}>
                      {"  ·  "}Conf: {c.confirmation}
                    </span>
                  )}
                </div>
                {/* Pickup / dropoff */}
                {(c.pickupLocation || c.dropoffLocation) && (
                  <div style={{ fontSize: ".78rem", color: "#8fb0cc", fontFamily: "sans-serif",
                    marginTop: 2 }}>
                    {c.pickupLocation && c.dropoffLocation
                      ? `${c.pickupLocation} → ${c.dropoffLocation}`
                      : c.pickupLocation
                        ? `Pick-up: ${c.pickupLocation}`
                        : `Drop-off: ${c.dropoffLocation}`}
                  </div>
                )}
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
                      fontFamily: "sans-serif", fontStyle: "italic" }}>Add notes…</span>}
              </div>
            )}
          </div>
        </div>
      ))}

      {/* Bottom cap */}
      {(rentalCars.length > 0 || isAdding) && (
        <div style={{ height: 1, background: `${accentColor}22`, borderLeft: borderAccent }} />
      )}
    </div>
  );
}
