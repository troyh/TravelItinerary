import { useState } from "react";
import NoteMarkdown from "./NoteMarkdown.jsx";

const borderAccent = "3px solid #c9a84c66";

const S = {
  input: { background: "#0a1a2a", border: "1px solid #2e5070", color: "#e8dcc8",
    borderRadius: 4, padding: ".4rem .65rem", fontSize: ".82rem", fontFamily: "sans-serif",
    outline: "none", boxSizing: "border-box" },
  btnPrimary: { background: "#1a3352", border: "1px solid #2e5070", color: "#c9a84c",
    borderRadius: 4, padding: ".35rem .8rem", fontSize: ".75rem", fontFamily: "sans-serif",
    cursor: "pointer", whiteSpace: "nowrap" },
  btnGhost: { background: "none", border: "1px solid #2e3a4a", color: "#4e7a9e",
    borderRadius: 4, padding: ".35rem .8rem", fontSize: ".75rem", fontFamily: "sans-serif",
    cursor: "pointer", whiteSpace: "nowrap" },
  label: { fontSize: ".62rem", letterSpacing: ".1em", textTransform: "uppercase",
    fontFamily: "sans-serif" },
};

const BLANK = { name: "", nm: "", speedKts: 15 };

export default function DayRoute({ routes, onAdd, onUpdate, onDelete, onApplyToDay }) {
  const [isAdding,  setIsAdding]  = useState(false);
  const [draft,     setDraft]     = useState(BLANK);
  const [editingId, setEditingId] = useState(null);
  const [noteDraft, setNoteDraft] = useState("");

  const set = (k, v) => setDraft(p => ({ ...p, [k]: v }));

  const computedHrs = draft.nm && draft.speedKts
    ? Math.round((parseFloat(draft.nm) / parseFloat(draft.speedKts)) * 10) / 10
    : null;

  function handleAdd() {
    const nm = parseFloat(draft.nm);
    if (!nm || nm <= 0) return;
    const speedKts = parseFloat(draft.speedKts) || 15;
    onAdd({
      id:       crypto.randomUUID(),
      name:     draft.name.trim(),
      nm:       Math.round(nm * 10) / 10,
      speedKts,
      hrs:      Math.round((nm / speedKts) * 10) / 10,
      notes:    "",
      addedAt:  new Date().toISOString(),
    });
    setIsAdding(false);
    setDraft(BLANK);
  }

  function handleCancel() {
    setIsAdding(false);
    setDraft(BLANK);
  }

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
        {!isAdding && (
          <button onClick={() => setIsAdding(true)}
            style={{ ...S.btnGhost, fontSize: ".7rem", padding: ".25rem .65rem" }}>
            + Add Route
          </button>
        )}
        {isAdding && (
          <button onClick={handleCancel}
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
              <input autoFocus value={draft.name}
                onChange={e => set("name", e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleAdd()}
                placeholder="e.g. Anacortes → Friday Harbor"
                style={{ ...S.input, width: "100%" }} />
            </div>
            <div style={{ width: 90 }}>
              <div style={{ ...S.label, color: "#6b8fa8", marginBottom: 3 }}>Distance</div>
              <input type="number" value={draft.nm} min="0" step="0.1"
                onChange={e => set("nm", e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleAdd()}
                placeholder="NM"
                style={{ ...S.input, width: "100%" }} />
            </div>
            <div style={{ width: 80 }}>
              <div style={{ ...S.label, color: "#6b8fa8", marginBottom: 3 }}>Speed</div>
              <input type="number" value={draft.speedKts} min="1" step="0.5"
                onChange={e => set("speedKts", e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleAdd()}
                placeholder="kts"
                style={{ ...S.input, width: "100%" }} />
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: ".75rem" }}>
            <button onClick={handleAdd} disabled={!draft.nm || parseFloat(draft.nm) <= 0}
              style={{ ...S.btnPrimary,
                opacity: (!draft.nm || parseFloat(draft.nm) <= 0) ? 0.45 : 1 }}>
              Add
            </button>
            {computedHrs !== null && (
              <span style={{ fontSize: ".78rem", color: "#c9a84c", fontFamily: "sans-serif" }}>
                ~{computedHrs} hrs at {draft.speedKts} kts
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
              <button onClick={() => onDelete(route.id)}
                style={{ background: "none", border: "none", color: "#5a4a20",
                  cursor: "pointer", fontSize: ".85rem", lineHeight: 1, padding: 0,
                  flexShrink: 0 }}>
                ×
              </button>
            </div>

            {/* Stats row */}
            <div style={{ fontSize: ".75rem", color: "#4e7a9e", fontFamily: "sans-serif",
              marginBottom: ".4rem" }}>
              {route.nm} NM · ~{route.hrs} hrs at {route.speedKts} kts
            </div>

            {/* Use these values */}
            <button onClick={() => onApplyToDay({ nm: route.nm, hrs: route.hrs })}
              style={{ ...S.btnGhost, fontSize: ".68rem", padding: ".2rem .55rem",
                marginBottom: ".45rem" }}>
              Use these values
            </button>

            {/* Notes inline edit */}
            {editingId === route.id ? (
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
                  <button onClick={() => { onUpdate(route.id, { notes: noteDraft }); setEditingId(null); }}
                    style={S.btnPrimary}>Save</button>
                  <button onClick={() => setEditingId(null)} style={S.btnGhost}>Cancel</button>
                </div>
              </div>
            ) : (
              <div onClick={() => { setEditingId(route.id); setNoteDraft(route.notes); }}
                style={{ cursor: "pointer" }}>
                {route.notes
                  ? <NoteMarkdown>{route.notes}</NoteMarkdown>
                  : <span style={{ fontSize: ".78rem", color: "#2e4a5e", fontFamily: "sans-serif",
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
