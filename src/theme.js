// Design tokens — CSS custom properties so dark mode works automatically
export const T = {
  bg:          "var(--bg)",
  surface:     "var(--surface)",
  surface2:    "var(--surface2)",
  surface3:    "var(--surface3)",
  text:        "var(--text)",
  textMuted:   "var(--text-muted)",
  textFaint:   "var(--text-faint)",
  border:      "var(--border)",
  borderSoft:  "var(--border-soft)",
  accent:      "var(--accent)",
  accentSoft:  "var(--accent-soft)",
  amber:       "var(--amber)",
  amberSoft:   "var(--amber-soft)",
  red:         "var(--red)",
  redSoft:     "var(--red-soft)",
  redBorder:   "var(--red-border)",
  green:       "var(--green)",
  greenSoft:   "var(--green-soft)",
  font:        "'Geist', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif",
};

// Shared button styles
export const btn = {
  primary: {
    background: T.accent, color: "#fff", border: "none",
    borderRadius: 8, padding: "9px 16px", fontSize: 13, fontWeight: 600,
    fontFamily: T.font, cursor: "pointer", display: "inline-flex",
    alignItems: "center", gap: 6, whiteSpace: "nowrap",
  },
  ghost: {
    background: "transparent", color: T.textMuted,
    border: `1px solid var(--border)`, borderRadius: 8,
    padding: "8px 14px", fontSize: 13, fontWeight: 500,
    fontFamily: T.font, cursor: "pointer", whiteSpace: "nowrap",
  },
  danger: {
    background: T.redSoft, color: T.red,
    border: `1px solid var(--red-border)`, borderRadius: 8,
    padding: "8px 14px", fontSize: 13, fontWeight: 500,
    fontFamily: T.font, cursor: "pointer",
  },
  icon: {
    width: 32, height: 32, borderRadius: 8,
    border: `1px solid var(--border)`, background: T.surface2,
    color: T.textMuted, display: "flex", alignItems: "center",
    justifyContent: "center", cursor: "pointer", padding: 0,
    fontFamily: T.font,
  },
};

export const input = {
  background: T.bg, border: `1px solid var(--border)`,
  color: T.text, borderRadius: 8, padding: "8px 12px",
  fontSize: 13, fontFamily: T.font, outline: "none",
  boxSizing: "border-box",
};
