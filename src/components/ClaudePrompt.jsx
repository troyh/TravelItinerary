import { useState } from "react";
import { askClaude, SYSTEM_FULL_ITINERARY, SYSTEM_DAY_SUGGESTIONS } from "../lib/claude.js";

const S = {
  input: { background: "#0a1a2a", border: "1px solid #2e5070", color: "#e8dcc8",
    borderRadius: 4, padding: ".4rem .65rem", fontSize: ".82rem", fontFamily: "sans-serif",
    outline: "none", boxSizing: "border-box", width: "100%", resize: "vertical" },
  btnPrimary: { background: "#1a3352", border: "1px solid #2e5070", color: "#c9a84c",
    borderRadius: 4, padding: ".35rem .8rem", fontSize: ".75rem", fontFamily: "sans-serif",
    cursor: "pointer", whiteSpace: "nowrap", touchAction: "manipulation" },
  btnGhost: { background: "none", border: "1px solid #2e3a4a", color: "#4e7a9e",
    borderRadius: 4, padding: ".35rem .8rem", fontSize: ".75rem", fontFamily: "sans-serif",
    cursor: "pointer", whiteSpace: "nowrap", touchAction: "manipulation" },
  label: { fontSize: ".62rem", letterSpacing: ".1em", textTransform: "uppercase",
    fontFamily: "sans-serif", color: "#4e7a9e" },
};

function formatDate(iso) {
  if (!iso) return null;
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatDateRange(startDate, dayCount) {
  if (!startDate || !dayCount) return null;
  const [y, m, d] = startDate.split("-").map(Number);
  const start = new Date(y, m - 1, d);
  const end   = new Date(y, m - 1, d + dayCount - 1);
  const fmt = dt => dt.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const fmtFull = dt => dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  return `${fmt(start)} – ${fmtFull(end)}`;
}

function FullPreview({ preview }) {
  const days = preview.days ?? [];
  const highlights = preview.highlights ?? {};
  const places = preview.places ?? {};
  const dateRange = formatDateRange(preview.startDate, days.length);

  return (
    <div style={{ fontFamily: "sans-serif" }}>
      {/* Title + meta */}
      <div style={{ fontSize: ".95rem", color: "#e8dcc8", fontWeight: 600,
        marginBottom: ".2rem" }}>
        "{preview.title}"
      </div>
      {preview.subtitle && (
        <div style={{ fontSize: ".78rem", color: "#8fb0cc", marginBottom: ".2rem" }}>
          {preview.subtitle}
        </div>
      )}
      <div style={{ fontSize: ".72rem", color: "#4e7a9e", marginBottom: ".85rem" }}>
        {[dateRange, days.length ? `${days.length} day${days.length !== 1 ? "s" : ""}` : null]
          .filter(Boolean).join(" · ")}
      </div>

      {/* Day list */}
      <div style={{ display: "flex", flexDirection: "column", gap: ".6rem" }}>
        {days.map(d => {
          const hl = highlights[String(d.day)] ?? [];
          const pl = places[String(d.day)] ?? [];
          return (
            <div key={d.day} style={{ borderLeft: "2px solid #2e5070", paddingLeft: ".65rem" }}>
              <div style={{ fontSize: ".8rem", color: "#c9a84c", fontWeight: 600,
                marginBottom: ".2rem" }}>
                Day {d.day}{"  "}<span style={{ fontWeight: 400, color: "#c8daea" }}>{d.leg}</span>
              </div>
              {hl.map((h, i) => (
                <div key={i} style={{ fontSize: ".72rem", color: "#8fb0cc", marginLeft: ".3rem" }}>
                  ★ {h}
                </div>
              ))}
              {pl.map((p, i) => (
                <div key={i} style={{ fontSize: ".72rem", color: "#6b8fa8", marginLeft: ".3rem",
                  marginTop: ".1rem" }}>
                  📍 {p.name}
                  <span style={{ color: "#3d5060" }}> · {p.category}</span>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DayPreview({ preview }) {
  const places = preview.places ?? [];
  const highlights = preview.highlights ?? [];

  return (
    <div style={{ fontFamily: "sans-serif" }}>
      {places.length > 0 && (
        <div style={{ marginBottom: ".65rem" }}>
          <div style={{ ...S.label, marginBottom: ".35rem" }}>
            Places ({places.length})
          </div>
          {places.map((p, i) => (
            <div key={i} style={{ marginBottom: ".35rem" }}>
              <div style={{ fontSize: ".8rem", color: "#c8daea" }}>
                📍 {p.name}
                <span style={{ color: "#3d5060", fontSize: ".7rem" }}> · {p.category}</span>
              </div>
              {p.notes && (
                <div style={{ fontSize: ".72rem", color: "#6b8fa8", marginLeft: "1.1rem",
                  marginTop: ".1rem" }}>
                  {p.notes}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {highlights.length > 0 && (
        <div>
          <div style={{ ...S.label, marginBottom: ".35rem" }}>
            Highlights ({highlights.length})
          </div>
          {highlights.map((h, i) => (
            <div key={i} style={{ fontSize: ".72rem", color: "#8fb0cc", marginBottom: ".2rem" }}>
              ★ {h}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ClaudePrompt({
  mode, dayNum, dayContext, itineraryContext,
  onApplyFull, onApplyDay, apiKey, model,
}) {
  const [isOpen,   setIsOpen]   = useState(mode === "full");
  const [prompt,   setPrompt]   = useState("");
  const [loading,  setLoading]  = useState(false);
  const [preview,  setPreview]  = useState(null);
  const [error,    setError]    = useState(null);

  function buildUserPrompt() {
    if (mode === "full") return prompt.trim();
    const ctx = itineraryContext;
    const lines = [];
    if (ctx?.title)     lines.push(`Trip: ${ctx.title}${ctx.startDate ? ` (starting ${formatDate(ctx.startDate)})` : ""}`);
    if (dayContext?.leg) lines.push(`Day ${dayNum}: ${dayContext.leg}${dayContext.overnight ? `, overnight: ${dayContext.overnight}` : ""}`);
    lines.push("", `User request: ${prompt.trim()}`);
    return lines.join("\n");
  }

  async function handleAsk() {
    const p = prompt.trim();
    if (!p) return;
    setLoading(true);
    setError(null);
    setPreview(null);
    try {
      const system = mode === "full" ? SYSTEM_FULL_ITINERARY : SYSTEM_DAY_SUGGESTIONS;
      const result = await askClaude({ prompt: buildUserPrompt(), system, apiKey, model });
      setPreview(result);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  function handleApply() {
    if (!preview) return;
    if (mode === "full") onApplyFull(preview);
    else                  onApplyDay(dayNum, preview);
    setPreview(null);
    setPrompt("");
    if (mode === "day") setIsOpen(false);
  }

  function handleStartOver() {
    setPreview(null);
    setError(null);
  }

  function handleCancel() {
    setPreview(null);
    setPrompt("");
    setError(null);
    if (mode === "day") setIsOpen(false);
  }

  // Day mode: collapsed until opened
  if (mode === "day" && !isOpen) {
    return (
      <div style={{ marginTop: "1rem" }}>
        <div style={{ padding: ".75rem 1rem", background: "#0a1a2a",
          borderLeft: "3px solid #4e7a9e44", borderRadius: "0 4px 0 0",
          display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ ...S.label }}>Ask Claude</span>
          <button type="button" onClick={() => setIsOpen(true)}
            onTouchEnd={e => { e.preventDefault(); setIsOpen(true); }}
            style={{ ...S.btnGhost, fontSize: ".7rem", padding: ".25rem .65rem" }}>
            ✨ Ask Claude…
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ marginTop: "1rem" }}>
      {/* Header */}
      <div style={{ padding: ".75rem 1rem", background: "#0a1a2a",
        borderLeft: "3px solid #4e7a9e66", borderRadius: "0 4px 0 0",
        display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ ...S.label }}>
          {mode === "full" ? "Ask Claude" : "Ask Claude"}
        </span>
        {mode === "day" && !preview && (
          <button type="button" onClick={handleCancel}
            style={{ background: "none", border: "none", color: "#4e7a9e",
              cursor: "pointer", fontSize: ".85rem", padding: 0 }}>
            ×
          </button>
        )}
      </div>

      <div style={{ background: "#0a1a2a", borderLeft: "3px solid #4e7a9e66",
        padding: ".75rem 1rem" }}>

        {/* Preview */}
        {preview ? (
          <>
            {/* Preview header */}
            <div style={{ display: "flex", justifyContent: "space-between",
              alignItems: "center", marginBottom: ".65rem" }}>
              <div style={{ fontSize: ".72rem", color: "#c9a84c", fontFamily: "sans-serif",
                fontWeight: 600, letterSpacing: ".04em" }}>
                ✨ {mode === "full" ? "Claude's Itinerary" : `Suggestions for Day ${dayNum}`}
              </div>
              <button type="button" onClick={handleCancel}
                style={{ background: "none", border: "none", color: "#4e7a9e",
                  cursor: "pointer", fontSize: ".85rem", padding: 0 }}>
                ×
              </button>
            </div>

            {/* Preview content */}
            <div style={{ padding: ".65rem .85rem", background: "#071520",
              border: "1px solid #2e5070", borderRadius: 4, marginBottom: ".65rem" }}>
              {mode === "full"
                ? <FullPreview preview={preview} />
                : <DayPreview preview={preview} />}
            </div>

            {/* Actions */}
            <div style={{ display: "flex", gap: ".5rem" }}>
              <button type="button" onClick={handleApply} style={S.btnPrimary}>
                Apply
              </button>
              <button type="button" onClick={handleStartOver} style={S.btnGhost}>
                Start over
              </button>
            </div>
          </>
        ) : (
          <>
            {/* Prompt input */}
            <div style={{ marginBottom: ".5rem" }}>
              {mode === "full" ? (
                <div style={{ ...S.label, marginBottom: 4 }}>
                  Describe your trip
                </div>
              ) : (
                <div style={{ ...S.label, marginBottom: 4 }}>
                  What are you looking for?
                </div>
              )}
              <textarea
                autoFocus={mode === "day"}
                value={prompt}
                rows={mode === "full" ? 3 : 2}
                onChange={e => setPrompt(e.target.value)}
                onKeyDown={e => {
                  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") handleAsk();
                }}
                placeholder={mode === "full"
                  ? "e.g. 10-day road trip from Portland to Glacier National Park in July"
                  : "e.g. seafood restaurants and a morning hike near Astoria, OR"}
                style={S.input}
              />
            </div>

            {/* Error */}
            {error && (
              <div style={{ fontSize: ".72rem", color: "#e87878", fontFamily: "sans-serif",
                marginBottom: ".5rem" }}>
                {error}
              </div>
            )}

            {/* Actions */}
            <div style={{ display: "flex", alignItems: "center", gap: ".5rem" }}>
              <button type="button" onClick={handleAsk}
                disabled={!prompt.trim() || loading}
                style={{ ...S.btnPrimary, opacity: (!prompt.trim() || loading) ? 0.45 : 1 }}>
                {loading ? "Asking…" : "✨ Ask Claude"}
              </button>
              {mode === "day" && (
                <button type="button" onClick={handleCancel} style={S.btnGhost}>
                  Cancel
                </button>
              )}
              {loading && (
                <span style={{ fontSize: ".7rem", color: "#4e7a9e", fontFamily: "sans-serif",
                  fontStyle: "italic" }}>
                  This may take a moment…
                </span>
              )}
            </div>
          </>
        )}
      </div>

      {/* Bottom cap */}
      <div style={{ height: 1, background: "#4e7a9e22",
        borderLeft: "3px solid #4e7a9e66" }} />
    </div>
  );
}
