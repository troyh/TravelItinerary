// Design tokens — matches the Claude Design mockup
export const T = {
  bg:          "#ffffff",
  surface:     "#ffffff",
  surface2:    "#f8f9fb",
  surface3:    "#f0f4f8",
  text:        "#0e1014",
  textMuted:   "#5c6470",
  textFaint:   "#9ba1ac",
  border:      "#e2e5ea",
  borderSoft:  "#eef0f3",
  accent:      "#0b3d6b",
  accentSoft:  "#e8f1f9",
  amber:       "#f5b544",
  amberSoft:   "#fff7ed",
  red:         "#dc2626",
  redSoft:     "#fef2f2",
  redBorder:   "#fecaca",
  green:       "#16a34a",
  greenSoft:   "#f0fdf4",
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
    border: `1px solid ${T.border}`, borderRadius: 8,
    padding: "8px 14px", fontSize: 13, fontWeight: 500,
    fontFamily: T.font, cursor: "pointer", whiteSpace: "nowrap",
  },
  danger: {
    background: T.redSoft, color: T.red,
    border: `1px solid ${T.redBorder}`, borderRadius: 8,
    padding: "8px 14px", fontSize: 13, fontWeight: 500,
    fontFamily: T.font, cursor: "pointer",
  },
  icon: {
    width: 32, height: 32, borderRadius: 8,
    border: `1px solid ${T.border}`, background: T.surface2,
    color: T.textMuted, display: "flex", alignItems: "center",
    justifyContent: "center", cursor: "pointer", padding: 0,
    fontFamily: T.font,
  },
};

export const input = {
  background: T.bg, border: `1px solid ${T.border}`,
  color: T.text, borderRadius: 8, padding: "8px 12px",
  fontSize: 13, fontFamily: T.font, outline: "none",
  boxSizing: "border-box",
};
