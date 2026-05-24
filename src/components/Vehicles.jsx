import { useState, useEffect, useCallback } from "react";
import { T, btn, input as inputStyle } from "../theme.js";

// ── Constants ─────────────────────────────────────────────────────────────────

const MONO = "'ui-monospace','SFMono-Regular','Menlo',monospace";
const CURRENCY_SYMBOL = { USD: "$", EUR: "€", GBP: "£", JPY: "¥" };
const sym = c => CURRENCY_SYMBOL[c] || c;

const CAR_GRADIENTS = [
  "linear-gradient(135deg,#1F5E3A 0%,#5B8C70 100%)",
  "linear-gradient(135deg,#B84A2E 0%,#F5B544 100%)",
  "linear-gradient(135deg,#4A2D6B 0%,#9B70BF 100%)",
  "linear-gradient(135deg,#5E3A1F 0%,#C4956A 100%)",
];
const BOAT_GRADIENTS = [
  "linear-gradient(135deg,#0B3D6B 0%,#5BB3E8 100%)",
  "linear-gradient(135deg,#0D5E5A 0%,#3ABFBB 100%)",
  "linear-gradient(135deg,#1A3A5C 0%,#4E8BB5 100%)",
];

const DEFAULT_CURVE = [
  { rpm: 1000, gph: 0.30, speed: 3.0 },
  { rpm: 1800, gph: 0.55, speed: 5.0 },
  { rpm: 2600, gph: 1.20, speed: 6.0 },
];

function pickBg(kind, vehicles) {
  const n = vehicles.filter(v => v.kind === kind).length;
  return (kind === "boat" ? BOAT_GRADIENTS : CAR_GRADIENTS)[n % (kind === "boat" ? BOAT_GRADIENTS : CAR_GRADIENTS).length];
}

function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// ── Fuel math ─────────────────────────────────────────────────────────────────

function interpolateGph(curve, speed) {
  if (!curve?.length) return 0;
  const s = [...curve].sort((a, b) => a.speed - b.speed);
  if (speed <= s[0].speed) return s[0].gph;
  if (speed >= s[s.length - 1].speed) return s[s.length - 1].gph;
  for (let i = 0; i < s.length - 1; i++) {
    if (speed >= s[i].speed && speed <= s[i + 1].speed) {
      const t = (speed - s[i].speed) / (s[i + 1].speed - s[i].speed);
      return s[i].gph + t * (s[i + 1].gph - s[i].gph);
    }
  }
  return s[s.length - 1].gph;
}

const boatGphAtTarget = v => interpolateGph(v.fuel.curve, v.fuel.targetSpeed);

function vehicleRange(v) {
  const usable = v.fuel.tankSize * (1 - (v.fuel.reservePct || 15) / 100);
  if (v.kind === "boat") {
    const gph = boatGphAtTarget(v);
    return gph ? Math.round((usable / gph) * v.fuel.targetSpeed) : 0;
  }
  return Math.round(usable * (v.fuel.mpgCombined || 0));
}

// ── Glyphs ────────────────────────────────────────────────────────────────────

const CAR_GLYPH = (
  <svg width="18" height="18" viewBox="0 0 16 16" fill="none">
    <path d="M2.5 11V8.5l1.2-3a1 1 0 011-.7h6.6a1 1 0 011 .7l1.2 3V11" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
    <rect x="1.5" y="9.5" width="13" height="3" rx="1" stroke="currentColor" strokeWidth="1.3"/>
    <circle cx="4.5" cy="13" r="1" stroke="currentColor" strokeWidth="1.3"/>
    <circle cx="11.5" cy="13" r="1" stroke="currentColor" strokeWidth="1.3"/>
  </svg>
);

const BOAT_GLYPH = (
  <svg width="18" height="18" viewBox="0 0 16 16" fill="none">
    <path d="M8 2.2L11.6 9.8H8z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
    <line x1="8" y1="2" x2="8" y2="10" stroke="currentColor" strokeWidth="1.2"/>
    <path d="M2 11.5h12l-1.3 1.9a1 1 0 01-.83.45H4.13a1 1 0 01-.83-.45L2 11.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
  </svg>
);

const PLUS_GLYPH = (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
    <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
  </svg>
);

// ── FuelMeter ─────────────────────────────────────────────────────────────────

function FuelMeter({ pct, reservePct, compact, showLabel }) {
  const isLow = pct <= (reservePct || 15) + 5;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: compact ? 4 : 6, width: "100%" }}>
      {showLabel && (
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: T.textMuted, fontWeight: 600, letterSpacing: 0.5 }}>
          <span>FUEL</span>
          <span style={{ color: isLow ? T.amber : T.text, fontVariantNumeric: "tabular-nums" }}>{pct}%</span>
        </div>
      )}
      <div style={{
        position: "relative", height: compact ? 6 : 10, borderRadius: 999,
        background: T.surface2, border: `1px solid ${T.borderSoft}`, overflow: "hidden",
      }}>
        {reservePct > 0 && (
          <div style={{
            position: "absolute", left: 0, top: 0, bottom: 0, width: `${reservePct}%`,
            background: `repeating-linear-gradient(45deg,${T.borderSoft},${T.borderSoft} 3px,transparent 3px,transparent 6px)`,
          }}/>
        )}
        <div style={{
          position: "absolute", left: 0, top: 0, bottom: 0, width: `${pct}%`,
          background: isLow ? T.amber : T.accent, borderRadius: 999, transition: "width 240ms ease",
        }}/>
        {reservePct > 0 && (
          <div style={{ position: "absolute", left: `${reservePct}%`, top: -2, bottom: -2, width: 1, background: T.amber, opacity: 0.5 }}/>
        )}
      </div>
      {!compact && !showLabel && (
        <div style={{ fontSize: 10.5, color: T.textMuted, fontVariantNumeric: "tabular-nums", letterSpacing: 0.3 }}>
          {pct}%{reservePct ? <span style={{ color: T.textFaint }}> · reserve at {reservePct}%</span> : null}
        </div>
      )}
    </div>
  );
}

// ── FuelCurveChart ────────────────────────────────────────────────────────────

function FuelCurveChart({ curve, targetSpeed, height = 160 }) {
  const W = 360;
  const valid = (curve || []).filter(p => Number(p.speed) > 0 && Number(p.gph) >= 0);
  const sorted = [...valid].sort((a, b) => Number(a.speed) - Number(b.speed));

  if (sorted.length < 2) return (
    <div style={{ height, display: "flex", alignItems: "center", justifyContent: "center", color: T.textFaint, fontSize: 12 }}>
      Add at least 2 points to preview the curve
    </div>
  );

  const ts = Number(targetSpeed) || 0;
  const maxSpeed = Math.max(...sorted.map(p => Number(p.speed)), ts) * 1.1;
  const maxGph = Math.max(...sorted.map(p => Number(p.gph))) * 1.2;
  if (!maxSpeed || !maxGph) return null;

  const PAD = { l: 36, r: 14, t: 10, b: 24 };
  const x = s => PAD.l + (Number(s) / maxSpeed) * (W - PAD.l - PAD.r);
  const y = g => height - PAD.b - (Number(g) / maxGph) * (height - PAD.t - PAD.b);
  const targetGph = interpolateGph(sorted.map(p => ({ ...p, speed: Number(p.speed), gph: Number(p.gph) })), ts);

  let d = "";
  sorted.forEach((p, i) => {
    const px = x(p.speed), py = y(p.gph);
    if (i === 0) { d += `M ${px} ${py}`; return; }
    const prev = sorted[i - 1];
    const mx = (x(prev.speed) + px) / 2;
    const my = (y(prev.gph) + py) / 2;
    d += ` Q ${x(prev.speed)} ${y(prev.gph)} ${mx} ${my}`;
    if (i === sorted.length - 1) d += ` T ${px} ${py}`;
  });
  const areaD = d + ` L ${x(sorted[sorted.length - 1].speed)} ${y(0)} L ${x(sorted[0].speed)} ${y(0)} Z`;
  const labelLeft = Math.min(x(ts) + 8, W - 108);
  const labelTop = Math.max(y(targetGph) - 22, PAD.t + 2);

  return (
    <svg viewBox={`0 0 ${W} ${height}`} style={{ width: "100%", height: "auto", display: "block" }}>
      <line x1={PAD.l} y1={PAD.t} x2={PAD.l} y2={height - PAD.b} stroke={T.borderSoft} strokeWidth="1"/>
      <line x1={PAD.l} y1={height - PAD.b} x2={W - PAD.r} y2={height - PAD.b} stroke={T.borderSoft} strokeWidth="1"/>
      {[0.25, 0.5, 0.75].map(f => (
        <line key={f} x1={PAD.l} x2={W - PAD.r}
          y1={PAD.t + f * (height - PAD.t - PAD.b)} y2={PAD.t + f * (height - PAD.t - PAD.b)}
          stroke={T.borderSoft} strokeDasharray="2,3" strokeWidth="0.5"/>
      ))}
      <path d={areaD} fill={T.accentSoft} opacity="0.55"/>
      <path d={d} fill="none" stroke={T.accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      {sorted.map((p, i) => (
        <circle key={i} cx={x(p.speed)} cy={y(p.gph)} r="3.5" fill={T.bg} stroke={T.accent} strokeWidth="1.5"/>
      ))}
      {ts > 0 && (
        <>
          <line x1={x(ts)} y1={PAD.t} x2={x(ts)} y2={height - PAD.b} stroke={T.text} strokeDasharray="3,3" strokeWidth="1" opacity="0.35"/>
          <circle cx={x(ts)} cy={y(targetGph)} r="5.5" fill={T.accent} stroke={T.bg} strokeWidth="2"/>
          <g transform={`translate(${labelLeft},${labelTop})`}>
            <rect x="0" y="0" width="104" height="20" rx="4" fill={T.text}/>
            <text x="7" y="14" fill={T.bg} fontSize="9.5" fontWeight="600" fontFamily={MONO}>
              {ts} kn → {targetGph.toFixed(2)} gph
            </text>
          </g>
        </>
      )}
      <text x={PAD.l} y={height - 8} fill={T.textFaint} fontSize="8.5" fontWeight="600">0</text>
      <text x={W - PAD.r} y={height - 8} fill={T.textFaint} fontSize="8.5" fontWeight="600" textAnchor="end">{maxSpeed.toFixed(1)} kn</text>
      <text x="4" y={PAD.t + 8} fill={T.textFaint} fontSize="8.5" fontWeight="600">gph</text>
    </svg>
  );
}

// ── StatTile ──────────────────────────────────────────────────────────────────

function StatTile({ label, value, sub, accent }) {
  return (
    <div style={{
      padding: "11px 13px", borderRadius: 9,
      background: accent ? T.accentSoft : T.surface2,
      border: `1px solid ${accent ? "transparent" : T.borderSoft}`,
    }}>
      <div style={{ fontSize: 9.5, fontWeight: 600, letterSpacing: 1.5, color: accent ? T.accent : T.textMuted, marginBottom: 4, textTransform: "uppercase" }}>{label}</div>
      <div style={{ fontSize: 17, fontWeight: 700, color: accent ? T.accent : T.text, letterSpacing: -0.3, fontVariantNumeric: "tabular-nums" }}>{value}</div>
      {sub && <div style={{ fontSize: 10.5, color: T.textMuted, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

// ── SpecRow ───────────────────────────────────────────────────────────────────

function SpecRow({ label, children }) {
  return (
    <div style={{
      display: "grid", gridTemplateColumns: "130px 1fr",
      gap: 12, padding: "9px 0",
      borderBottom: `1px solid ${T.borderSoft}`, alignItems: "baseline",
    }}>
      <div style={{ fontSize: 11, color: T.textMuted, fontWeight: 500, letterSpacing: 0.3 }}>{label}</div>
      <div style={{ fontSize: 13, color: T.text, fontWeight: 500 }}>{children}</div>
    </div>
  );
}

// ── Chip ──────────────────────────────────────────────────────────────────────

function Chip({ children, tone = "soft" }) {
  const styles = {
    soft:   { bg: T.surface2,   border: T.border,           color: T.textMuted },
    amber:  { bg: T.amberSoft,  border: "#f5c04466",        color: "#92600a"   },
    accent: { bg: T.accentSoft, border: T.accent + "44",    color: T.accent    },
  };
  const s = styles[tone] || styles.soft;
  return (
    <span style={{
      display: "inline-block", fontSize: 10.5, fontWeight: 600,
      padding: "2px 8px", borderRadius: 5,
      background: s.bg, border: `1px solid ${s.border}`, color: s.color,
    }}>{children}</span>
  );
}

// ── VehicleTile ───────────────────────────────────────────────────────────────

function VehicleTile({ vehicle, active, onClick }) {
  const v = vehicle;
  const isBoat = v.kind === "boat";
  const economy = isBoat
    ? `${boatGphAtTarget(v).toFixed(2)} gph @ ${v.fuel.targetSpeed} kn`
    : `${v.fuel.mpgCombined} mpg combined`;

  return (
    <button onClick={onClick} style={{
      padding: 0, borderRadius: 12, width: "100%",
      background: active ? T.surface : T.surface2,
      border: `1px solid ${active ? T.accent : T.border}`,
      cursor: "pointer", textAlign: "left", fontFamily: T.font,
      color: T.text, display: "flex", flexDirection: "column",
      boxShadow: active ? `0 0 0 1px ${T.accent}` : "none",
      overflow: "hidden", transition: "box-shadow 0.12s",
    }}>
      <div style={{
        height: 64, background: v.photoBg || T.accent,
        display: "flex", alignItems: "flex-end", justifyContent: "space-between",
        padding: "0 12px 10px",
      }}>
        <div style={{
          width: 34, height: 34, borderRadius: 8,
          background: "rgba(255,255,255,0.18)",
          display: "flex", alignItems: "center", justifyContent: "center", color: "#fff",
        }}>{isBoat ? BOAT_GLYPH : CAR_GLYPH}</div>
        {v.rentalOf && (
          <span style={{
            fontSize: 9.5, fontWeight: 700, letterSpacing: 1.2,
            padding: "3px 7px", borderRadius: 4,
            background: "rgba(255,255,255,0.22)", color: "#fff", textTransform: "uppercase",
          }}>Rental</span>
        )}
      </div>
      <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 8, flex: 1 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: -0.2, lineHeight: 1.15 }}>{v.name}</div>
          <div style={{ fontSize: 11.5, color: T.textMuted, marginTop: 2 }}>{v.year} {v.make} {v.model}</div>
        </div>
        <FuelMeter pct={v.fuel.currentPct ?? 0} compact/>
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          fontSize: 11, color: T.textMuted, fontVariantNumeric: "tabular-nums", marginTop: "auto",
        }}>
          <span>{economy}</span>
          <span>{sym(v.cost.currency)}{Number(v.cost.perUnit).toFixed(2)}/{v.fuel.unit}</span>
        </div>
      </div>
    </button>
  );
}

function AddVehicleTile({ onClick }) {
  return (
    <button onClick={onClick} style={{
      borderRadius: 12, width: "100%",
      background: "transparent", border: `1px dashed ${T.border}`,
      cursor: "pointer", fontFamily: T.font, color: T.textMuted,
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      gap: 8, minHeight: 180,
    }}>
      <div style={{
        width: 36, height: 36, borderRadius: 18, border: `1px solid ${T.border}`,
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>{PLUS_GLYPH}</div>
      <div style={{ fontSize: 12, fontWeight: 500 }}>Add vehicle</div>
    </button>
  );
}

// ── VehicleDetail ─────────────────────────────────────────────────────────────

function VehicleDetail({ vehicle, onEdit }) {
  const v = vehicle;
  const isBoat = v.kind === "boat";
  const [tab, setTab] = useState("fuel");
  const gphAtTarget = isBoat ? boatGphAtTarget(v) : 0;
  const range = vehicleRange(v);

  const sampleLeg = isBoat
    ? { label: "Cascais → Portinho da Arrábida", distance: 21, distUnit: "nm", duration: 3.83 }
    : { label: "Lisbon → Sintra", distance: 28, distUnit: "mi", duration: 0.65 };
  const legFuel = isBoat ? sampleLeg.duration * gphAtTarget : sampleLeg.distance / (v.fuel.mpgCombined || 1);
  const legCost = legFuel * Number(v.cost.perUnit);

  return (
    <div style={{ border: `1px solid ${T.border}`, borderRadius: 14, background: T.surface, overflow: "hidden" }}>
      {/* Header */}
      <div style={{ padding: "20px 24px", display: "flex", alignItems: "center", gap: 16, borderBottom: `1px solid ${T.border}` }}>
        <div style={{
          width: 64, height: 64, borderRadius: 14, background: v.photoBg || T.accent,
          display: "flex", alignItems: "center", justifyContent: "center",
          color: "#fff", flexShrink: 0,
        }}>
          <div style={{ transform: "scale(1.8)" }}>{isBoat ? BOAT_GLYPH : CAR_GLYPH}</div>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 4, flexWrap: "wrap" }}>
            <span style={{ fontSize: 22, fontWeight: 700, letterSpacing: -0.4 }}>{v.name}</span>
            <Chip tone={v.rentalOf ? "amber" : "soft"}>
              {v.rentalOf ? `Rental · ${v.rentalOf}` : isBoat ? "Your boat" : "Daily driver"}
            </Chip>
            {v.isDefault && <Chip tone="accent">Default</Chip>}
          </div>
          <div style={{ fontSize: 12.5, color: T.textMuted, fontVariantNumeric: "tabular-nums" }}>
            {[v.year, v.make, v.model, v.type].filter(Boolean).join(" · ")}
            {v.plate && ` · ${v.plate}`}
          </div>
        </div>
        {onEdit && (
          <button onClick={() => onEdit(v)} style={{ ...btn.ghost }}>Edit</button>
        )}
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", padding: "0 24px", borderBottom: `1px solid ${T.border}`, background: T.surface2 }}>
        {[
          { id: "fuel",  label: "Fuel & range" },
          { id: "specs", label: "Specs" },
          { id: "trips", label: "Used on", count: v.usedOn?.length ?? 0 },
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            padding: "13px 4px", marginRight: 22,
            background: "transparent", border: "none",
            borderBottom: `2px solid ${tab === t.id ? T.accent : "transparent"}`,
            color: tab === t.id ? T.text : T.textMuted,
            fontSize: 12.5, fontWeight: 600, cursor: "pointer",
            fontFamily: T.font, display: "flex", alignItems: "center", gap: 6,
            marginBottom: -1,
          }}>
            {t.label}
            {t.count != null && (
              <span style={{ fontSize: 10.5, color: T.textFaint, fontVariantNumeric: "tabular-nums" }}>{t.count}</span>
            )}
          </button>
        ))}
      </div>

      {/* Fuel & range tab */}
      {tab === "fuel" && (
        <div style={{ padding: 24, display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 32 }}>
          {/* Left */}
          <div>
            <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: 1.5, color: T.textMuted, marginBottom: 12, textTransform: "uppercase" }}>Current tank</div>
            <div style={{ padding: 16, borderRadius: 12, background: T.surface2, border: `1px solid ${T.borderSoft}`, display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
                <div>
                  <div style={{ fontSize: 26, fontWeight: 700, letterSpacing: -0.5, fontVariantNumeric: "tabular-nums" }}>
                    {(v.fuel.tankSize * (v.fuel.currentPct ?? 0) / 100).toFixed(1)}
                    <span style={{ fontSize: 13, fontWeight: 500, color: T.textMuted, marginLeft: 4 }}>/ {v.fuel.tankSize} {v.fuel.unit}</span>
                  </div>
                  <div style={{ fontSize: 11.5, color: T.textMuted, marginTop: 2 }}>{v.fuel.type}</div>
                </div>
                <Chip tone={(v.fuel.currentPct ?? 0) > 30 ? "soft" : "amber"}>{v.fuel.currentPct ?? 0}%</Chip>
              </div>
              <FuelMeter pct={v.fuel.currentPct ?? 0} reservePct={v.fuel.reservePct || 15}/>
              {v.lastFill && (
                <div style={{ fontSize: 11.5, color: T.textMuted, paddingTop: 8, borderTop: `1px solid ${T.borderSoft}`, fontVariantNumeric: "tabular-nums" }}>
                  Last fill: <span style={{ color: T.text }}>{v.lastFill.date}</span> · {v.lastFill.units} {v.fuel.unit} · {sym(v.cost.currency)}{Number(v.lastFill.total).toFixed(2)}
                </div>
              )}
            </div>

            <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: 1.5, color: T.textMuted, marginTop: 20, marginBottom: 12, textTransform: "uppercase" }}>Efficiency</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10 }}>
              {isBoat ? (
                <>
                  <StatTile label="At avg speed" value={`${gphAtTarget.toFixed(2)} gph`} sub={`@ ${v.fuel.targetSpeed} kn`}/>
                  <StatTile label="Reserve" value={`${v.fuel.reservePct}%`} sub={`${(v.fuel.tankSize * v.fuel.reservePct / 100).toFixed(0)} ${v.fuel.unit} held back`}/>
                  <StatTile label="Range" value={`${range} nm`} sub={`@ ${v.fuel.targetSpeed} kn`} accent/>
                </>
              ) : (
                <>
                  <StatTile label="City" value={v.fuel.mpgCity || "—"} sub="mpg"/>
                  <StatTile label="Highway" value={v.fuel.mpgHighway || "—"} sub="mpg"/>
                  <StatTile label="Range" value={`${range} mi`} sub={`@ ${v.fuel.mpgCombined} combined`} accent/>
                </>
              )}
            </div>

            {isBoat && (v.fuel.curve?.length ?? 0) >= 2 && (
              <>
                <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: 1.5, color: T.textMuted, marginTop: 20, marginBottom: 12, textTransform: "uppercase" }}>Fuel curve</div>
                <div style={{ padding: 16, borderRadius: 12, background: T.surface2, border: `1px solid ${T.borderSoft}`, display: "flex", flexDirection: "column", gap: 10 }}>
                  <FuelCurveChart curve={v.fuel.curve} targetSpeed={v.fuel.targetSpeed}/>
                  <div style={{
                    display: "grid", gridTemplateColumns: `repeat(${v.fuel.curve.length},1fr)`,
                    paddingTop: 10, borderTop: `1px solid ${T.borderSoft}`, fontVariantNumeric: "tabular-nums",
                  }}>
                    {v.fuel.curve.map((p, i) => (
                      <div key={i} style={{ textAlign: "center", borderRight: i < v.fuel.curve.length - 1 ? `1px solid ${T.borderSoft}` : "none" }}>
                        <div style={{ fontSize: 10, color: T.textFaint, marginBottom: 2 }}>{Number(p.rpm).toLocaleString()}<span style={{ fontSize: 9 }}> rpm</span></div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: T.text }}>{Number(p.gph).toFixed(2)}</div>
                        <div style={{ fontSize: 10, color: T.textMuted }}>{p.speed} kn</div>
                      </div>
                    ))}
                  </div>
                  <div style={{ fontSize: 11.5, color: T.textMuted, lineHeight: 1.5, fontStyle: "italic" }}>
                    {v.name} burns fuel non-linearly with speed. The app interpolates this curve at your average trip speed.
                  </div>
                </div>
              </>
            )}
            {isBoat && (v.fuel.curve?.length ?? 0) < 2 && (
              <div style={{ marginTop: 16, padding: "12px 14px", borderRadius: 10, background: T.amberSoft, border: `1px solid #f5c04466`, fontSize: 12.5, color: "#92600a", lineHeight: 1.5 }}>
                Add at least one more curve point for fuel estimates. <button onClick={() => onEdit(v)} style={{ background: "none", border: "none", color: T.accent, fontWeight: 600, cursor: "pointer", fontSize: 12.5, padding: 0, fontFamily: T.font }}>Edit</button>
              </div>
            )}
          </div>

          {/* Right */}
          <div>
            <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: 1.5, color: T.textMuted, marginBottom: 12, textTransform: "uppercase" }}>Cost</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <StatTile label={`Per ${v.fuel.unit}`} value={`${sym(v.cost.currency)}${Number(v.cost.perUnit).toFixed(2)}`} sub={v.cost.currency}/>
              <StatTile label="Per fill-up" value={`${sym(v.cost.currency)}${(v.fuel.tankSize * Number(v.cost.perUnit)).toFixed(0)}`} sub={`${v.fuel.tankSize} ${v.fuel.unit}`}/>
            </div>

            <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: 1.5, color: T.textMuted, marginTop: 20, marginBottom: 8, textTransform: "uppercase" }}>Preview · example leg</div>
            <div style={{ padding: 14, borderRadius: 12, background: T.bg, border: `1px dashed ${T.accent}`, display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ width: 26, height: 26, borderRadius: 6, background: T.accentSoft, color: T.accent, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  {isBoat ? BOAT_GLYPH : CAR_GLYPH}
                </div>
                <div style={{ flex: 1, fontSize: 12.5, fontWeight: 600, color: T.text, letterSpacing: -0.1 }}>{sampleLeg.label}</div>
                <Chip tone="accent">EXAMPLE</Chip>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", fontVariantNumeric: "tabular-nums" }}>
                <div style={{ paddingRight: 10, borderRight: `1px solid ${T.borderSoft}` }}>
                  <div style={{ fontSize: 9.5, fontWeight: 600, letterSpacing: 1.2, color: T.textMuted, marginBottom: 2 }}>DISTANCE</div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: T.text }}>{sampleLeg.distance} <span style={{ fontSize: 10, color: T.textMuted }}>{sampleLeg.distUnit}</span></div>
                </div>
                <div style={{ padding: "0 10px", borderRight: `1px solid ${T.borderSoft}` }}>
                  <div style={{ fontSize: 9.5, fontWeight: 600, letterSpacing: 1.2, color: T.textMuted, marginBottom: 2 }}>FUEL</div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: T.text }}>{legFuel.toFixed(1)} <span style={{ fontSize: 10, color: T.textMuted }}>{v.fuel.unit}</span></div>
                </div>
                <div style={{ paddingLeft: 10 }}>
                  <div style={{ fontSize: 9.5, fontWeight: 600, letterSpacing: 1.2, color: T.textMuted, marginBottom: 2 }}>COST</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: T.accent }}>{sym(v.cost.currency)}{legCost.toFixed(2)}</div>
                </div>
              </div>
              <div style={{ fontSize: 11, color: T.textMuted, lineHeight: 1.5, fontStyle: "italic" }}>
                {isBoat
                  ? `${sampleLeg.distance} nm ÷ ${v.fuel.targetSpeed} kn × ${gphAtTarget.toFixed(2)} gph = ${legFuel.toFixed(1)} ${v.fuel.unit}`
                  : `${sampleLeg.distance} mi ÷ ${v.fuel.mpgCombined} mpg = ${legFuel.toFixed(1)} ${v.fuel.unit}`}
              </div>
            </div>

            <div style={{ marginTop: 14, fontSize: 11.5, color: T.textMuted, lineHeight: 1.5 }}>
              Fuel estimates appear on every {isBoat ? "Boat" : "Drive"} leg that uses this vehicle. Cost converts to your trip currency automatically.
            </div>
          </div>
        </div>
      )}

      {/* Specs tab */}
      {tab === "specs" && (
        <div style={{ padding: 24, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 32 }}>
          <div>
            <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: 1.5, color: T.textMuted, marginBottom: 6, textTransform: "uppercase" }}>Identity</div>
            <SpecRow label="Name">{v.name}</SpecRow>
            <SpecRow label="Make / model">{v.make} {v.model}</SpecRow>
            <SpecRow label="Year">{v.year || "—"}</SpecRow>
            <SpecRow label={isBoat ? "Hull type" : "Body"}>{v.type || "—"}</SpecRow>
            {!isBoat && <SpecRow label="License plate">{v.plate || "—"}</SpecRow>}
            {isBoat && <SpecRow label="Berths">{v.berths || "—"}</SpecRow>}
          </div>
          <div>
            <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: 1.5, color: T.textMuted, marginBottom: 6, textTransform: "uppercase" }}>{isBoat ? "Engine & fuel" : "Powertrain & fuel"}</div>
            {isBoat && v.engine && <SpecRow label="Engine">{v.engine.type || "—"}</SpecRow>}
            {isBoat && v.engine && <SpecRow label="Engine hours">{v.engine.hours ? `${v.engine.hours} h` : "—"}</SpecRow>}
            <SpecRow label="Fuel type">{v.fuel.type || "—"}</SpecRow>
            <SpecRow label="Tank size">{v.fuel.tankSize} {v.fuel.unit}</SpecRow>
            {isBoat ? (
              <>
                <SpecRow label="Fuel curve">{(v.fuel.curve?.length || 0)} points{(v.fuel.curve?.length >= 2) ? ` · ${Math.min(...v.fuel.curve.map(p => p.rpm))}–${Math.max(...v.fuel.curve.map(p => p.rpm))} rpm` : ""}</SpecRow>
                <SpecRow label="Target avg speed">{v.fuel.targetSpeed} kn → {boatGphAtTarget(v).toFixed(2)} gph</SpecRow>
                <SpecRow label="Reserve">{v.fuel.reservePct}% held back from estimates</SpecRow>
              </>
            ) : (
              <SpecRow label="Economy">{v.fuel.mpgCity || "—"} city / {v.fuel.mpgHighway || "—"} hwy / {v.fuel.mpgCombined} combined</SpecRow>
            )}
            <SpecRow label="Cost per unit">{sym(v.cost.currency)}{Number(v.cost.perUnit).toFixed(2)} / {v.fuel.unit} ({v.cost.currency})</SpecRow>
          </div>
        </div>
      )}

      {/* Used on tab */}
      {tab === "trips" && (
        <div style={{ padding: 24 }}>
          {(v.usedOn?.length ?? 0) === 0 ? (
            <div style={{ fontSize: 13, color: T.textMuted, fontStyle: "italic" }}>
              No trips yet — this vehicle will appear here once you attach it to a Drive or Boat leg.
            </div>
          ) : (
            v.usedOn.map((trip, i) => (
              <div key={i} style={{
                display: "grid", gridTemplateColumns: "30px 1fr 90px 70px 65px",
                alignItems: "center", gap: 12, padding: "12px 0",
                borderBottom: `1px solid ${T.borderSoft}`,
              }}>
                <div style={{
                  width: 28, height: 28, borderRadius: 7, background: T.surface2,
                  border: `1px solid ${T.borderSoft}`,
                  display: "flex", alignItems: "center", justifyContent: "center", color: T.textMuted,
                }}>
                  <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M8 1.5C5.5 1.5 3.5 3.5 3.5 6c0 3 4.5 8 4.5 8s4.5-5 4.5-8c0-2.5-2-4.5-4.5-4.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/><circle cx="8" cy="6" r="1.5" stroke="currentColor" strokeWidth="1.3"/></svg>
                </div>
                <div style={{ fontSize: 13, fontWeight: 500 }}>{trip.trip}</div>
                <div style={{ fontSize: 12, color: T.textMuted, fontVariantNumeric: "tabular-nums" }}>{trip.distance}</div>
                <div style={{ fontSize: 12, color: T.textMuted, fontVariantNumeric: "tabular-nums" }}>{trip.fuel}</div>
                <div style={{ fontSize: 12, fontWeight: 600, color: T.text, fontVariantNumeric: "tabular-nums", textAlign: "right" }}>{trip.cost}</div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ── Add / Edit panel ──────────────────────────────────────────────────────────

function SelectRow({ options, value, onChange }) {
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {options.map(opt => (
        <button key={opt} onClick={() => onChange(opt)} style={{
          padding: "7px 12px", borderRadius: 7,
          background: opt === value ? T.accentSoft : T.surface,
          color: opt === value ? T.accent : T.textMuted,
          border: `1px solid ${opt === value ? "transparent" : T.border}`,
          fontSize: 12, fontWeight: opt === value ? 600 : 500,
          cursor: "pointer", fontFamily: T.font,
        }}>{opt}</button>
      ))}
    </div>
  );
}

function FormSection({ label, hint, children }) {
  return (
    <section>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 10 }}>
        <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: 1.5, color: T.textMuted, textTransform: "uppercase" }}>{label}</div>
        {hint && <div style={{ fontSize: 11, color: T.textFaint, fontStyle: "italic" }}>{hint}</div>}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>{children}</div>
    </section>
  );
}

function FieldLabel({ children }) {
  return <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: 0.6, color: T.textMuted, textTransform: "uppercase", marginBottom: 5 }}>{children}</div>;
}

function TextInput({ value, onChange, placeholder, mono, suffix, type = "text" }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, position: "relative" }}>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          ...inputStyle, width: "100%",
          fontFamily: mono ? MONO : T.font,
          paddingRight: suffix ? 36 : 12,
        }}
      />
      {suffix && (
        <span style={{ position: "absolute", right: 10, fontSize: 11, color: T.textMuted, pointerEvents: "none" }}>{suffix}</span>
      )}
    </div>
  );
}

function AddVehiclePanel({ onClose, onSave, vehicles, editVehicle }) {
  const isEdit = !!editVehicle;
  const [mode, setMode] = useState(isEdit ? editVehicle.kind : "picker");

  // ── Car state ──
  const [carName,     setCarName]     = useState(isEdit && editVehicle.kind === "car" ? editVehicle.name       : "");
  const [carMake,     setCarMake]     = useState(isEdit && editVehicle.kind === "car" ? editVehicle.make       : "");
  const [carModel,    setCarModel]    = useState(isEdit && editVehicle.kind === "car" ? editVehicle.model      : "");
  const [carYear,     setCarYear]     = useState(isEdit && editVehicle.kind === "car" ? String(editVehicle.year || "") : "");
  const [carPlate,    setCarPlate]    = useState(isEdit && editVehicle.kind === "car" ? editVehicle.plate      : "");
  const [carType,     setCarType]     = useState(isEdit && editVehicle.kind === "car" ? editVehicle.type       : "");
  const [carFuelType, setCarFuelType] = useState(isEdit && editVehicle.kind === "car" ? editVehicle.fuel.type  : "Regular gas");
  const [carTankSize, setCarTankSize] = useState(isEdit && editVehicle.kind === "car" ? String(editVehicle.fuel.tankSize) : "");
  const [carUnit,     setCarUnit]     = useState(isEdit && editVehicle.kind === "car" ? editVehicle.fuel.unit  : "gal");
  const [carMpgCity,  setCarMpgCity]  = useState(isEdit && editVehicle.kind === "car" ? String(editVehicle.fuel.mpgCity || "") : "");
  const [carMpgHwy,   setCarMpgHwy]   = useState(isEdit && editVehicle.kind === "car" ? String(editVehicle.fuel.mpgHighway || "") : "");
  const [carMpgComb,  setCarMpgComb]  = useState(isEdit && editVehicle.kind === "car" ? String(editVehicle.fuel.mpgCombined || "") : "");
  const [carPrice,    setCarPrice]    = useState(isEdit && editVehicle.kind === "car" ? String(editVehicle.cost.perUnit) : "");
  const [carCurrency, setCarCurrency] = useState(isEdit && editVehicle.kind === "car" ? editVehicle.cost.currency : "USD");

  // ── Boat state ──
  const [boatName,        setBoatName]        = useState(isEdit && editVehicle.kind === "boat" ? editVehicle.name               : "");
  const [boatMake,        setBoatMake]        = useState(isEdit && editVehicle.kind === "boat" ? editVehicle.make               : "");
  const [boatModel,       setBoatModel]       = useState(isEdit && editVehicle.kind === "boat" ? editVehicle.model              : "");
  const [boatYear,        setBoatYear]        = useState(isEdit && editVehicle.kind === "boat" ? String(editVehicle.year || "") : "");
  const [boatBerths,      setBoatBerths]      = useState(isEdit && editVehicle.kind === "boat" ? String(editVehicle.berths || "") : "");
  const [boatType,        setBoatType]        = useState(isEdit && editVehicle.kind === "boat" ? editVehicle.type               : "Sailboat");
  const [engineType,      setEngineType]      = useState(isEdit && editVehicle.kind === "boat" ? editVehicle.engine?.type       : "Diesel");
  const [engineHours,     setEngineHours]     = useState(isEdit && editVehicle.kind === "boat" ? String(editVehicle.engine?.hours || "") : "");
  const [boatFuelType,    setBoatFuelType]    = useState(isEdit && editVehicle.kind === "boat" ? editVehicle.fuel.type          : "Diesel");
  const [boatTankSize,    setBoatTankSize]    = useState(isEdit && editVehicle.kind === "boat" ? String(editVehicle.fuel.tankSize) : "");
  const [boatUnit,        setBoatUnit]        = useState(isEdit && editVehicle.kind === "boat" ? editVehicle.fuel.unit          : "gal");
  const [boatReserve,     setBoatReserve]     = useState(isEdit && editVehicle.kind === "boat" ? String(editVehicle.fuel.reservePct) : "20");
  const [curve,           setCurve]           = useState(isEdit && editVehicle.kind === "boat" ? editVehicle.fuel.curve.map(p => ({ ...p, rpm: String(p.rpm), gph: String(p.gph), speed: String(p.speed) })) : DEFAULT_CURVE.map(p => ({ rpm: String(p.rpm), gph: String(p.gph), speed: String(p.speed) })));
  const [targetSpeed,     setTargetSpeed]     = useState(isEdit && editVehicle.kind === "boat" ? String(editVehicle.fuel.targetSpeed) : "5.5");
  const [boatPrice,       setBoatPrice]       = useState(isEdit && editVehicle.kind === "boat" ? String(editVehicle.cost.perUnit) : "");
  const [boatCurrency,    setBoatCurrency]    = useState(isEdit && editVehicle.kind === "boat" ? editVehicle.cost.currency      : "USD");

  // ── Rental state (shared) ──
  const [isRental,    setIsRental]    = useState(!!editVehicle?.rentalOf);
  const [rentalFrom,  setRentalFrom]  = useState(editVehicle?.rentalOf || "");
  const [isDefault,   setIsDefault]   = useState(!!editVehicle?.isDefault);

  const numericCurve = curve.map(p => ({ rpm: Number(p.rpm), gph: Number(p.gph), speed: Number(p.speed) })).filter(p => p.speed > 0 && p.gph >= 0);
  const ts = Number(targetSpeed) || 0;
  const previewGph = numericCurve.length >= 2 ? interpolateGph(numericCurve, ts) : 0;
  const previewRange = boatTankSize && previewGph && ts
    ? Math.round((Number(boatTankSize) * (1 - Number(boatReserve || 20) / 100) / previewGph) * ts)
    : 0;

  const carValid = carName.trim() && carMake.trim() && carModel.trim() && Number(carTankSize) > 0 && Number(carMpgComb) > 0 && Number(carPrice) >= 0;
  const boatValid = boatName.trim() && boatMake.trim() && boatModel.trim() && Number(boatTankSize) > 0 && numericCurve.length >= 2 && ts > 0 && Number(boatPrice) >= 0;

  function addCurveRow() {
    setCurve(prev => [...prev, { rpm: "", gph: "", speed: "" }]);
  }

  function updateCurveRow(i, field, val) {
    setCurve(prev => prev.map((r, idx) => idx === i ? { ...r, [field]: val } : r));
  }

  function removeCurveRow(i) {
    setCurve(prev => prev.filter((_, idx) => idx !== i));
  }

  function handleSave() {
    if (mode === "car") {
      onSave({
        id: editVehicle?.id || newId(),
        kind: "car",
        name: carName.trim(),
        make: carMake.trim(),
        model: carModel.trim(),
        year: carYear ? parseInt(carYear) : "",
        type: carType.trim(),
        plate: carPlate.trim(),
        fuel: {
          type: carFuelType,
          tankSize: Number(carTankSize),
          unit: carUnit,
          mpgCity: carMpgCity ? Number(carMpgCity) : null,
          mpgHighway: carMpgHwy ? Number(carMpgHwy) : null,
          mpgCombined: Number(carMpgComb),
          currentPct: editVehicle?.fuel?.currentPct ?? 100,
        },
        cost: { perUnit: Number(carPrice), currency: carCurrency },
        photoBg: editVehicle?.photoBg || pickBg("car", vehicles),
        rentalOf: isRental ? (rentalFrom.trim() || "rental") : null,
        isDefault,
        lastFill: editVehicle?.lastFill || null,
        usedOn: editVehicle?.usedOn || [],
      });
    } else {
      onSave({
        id: editVehicle?.id || newId(),
        kind: "boat",
        name: boatName.trim(),
        make: boatMake.trim(),
        model: boatModel.trim(),
        year: boatYear ? parseInt(boatYear) : "",
        type: boatType,
        berths: boatBerths ? parseInt(boatBerths) : "",
        engine: { type: engineType, hours: engineHours ? Number(engineHours) : null },
        fuel: {
          type: boatFuelType,
          tankSize: Number(boatTankSize),
          unit: boatUnit,
          curve: numericCurve,
          targetSpeed: ts,
          reservePct: Number(boatReserve) || 20,
          currentPct: editVehicle?.fuel?.currentPct ?? 100,
        },
        cost: { perUnit: Number(boatPrice), currency: boatCurrency },
        photoBg: editVehicle?.photoBg || pickBg("boat", vehicles),
        rentalOf: isRental ? (rentalFrom.trim() || "rental") : null,
        isDefault,
        lastFill: editVehicle?.lastFill || null,
        usedOn: editVehicle?.usedOn || [],
      });
    }
  }

  const title = mode === "picker" ? "What kind of vehicle?" : mode === "car" ? (isEdit ? "Edit car" : "New car") : (isEdit ? "Edit boat" : "New boat");

  return (
    <div style={{
      position: "fixed", top: 0, right: 0, bottom: 0, width: "min(480px,100vw)",
      background: T.bg, borderLeft: `1px solid ${T.border}`,
      display: "flex", flexDirection: "column",
      zIndex: 1100, boxShadow: "-4px 0 24px rgba(0,0,0,0.10)",
      animation: "drawerSlideInRight 260ms cubic-bezier(0.22,1,0.36,1) forwards",
    }}>
      {/* Header */}
      <div style={{ padding: "18px 22px 14px", borderBottom: `1px solid ${T.border}`, flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 2 }}>
          <div style={{ fontSize: 10.5, color: T.textMuted, fontWeight: 600, letterSpacing: 1.5, textTransform: "uppercase" }}>{isEdit ? "Edit vehicle" : "Add vehicle"}</div>
          <button onClick={onClose} style={{ ...btn.icon, width: 28, height: 28 }}>
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none"><path d="M2 2l7 7M9 2l-7 7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
          </button>
        </div>
        <div style={{ fontSize: 19, fontWeight: 700, letterSpacing: -0.3, color: T.text }}>{title}</div>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: "auto", padding: "18px 22px 24px", display: "flex", flexDirection: "column", gap: 22 }}>
        {/* Picker */}
        {mode === "picker" && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {[
              { id: "car",  label: "Car",  desc: "Or any road vehicle — truck, van, motorcycle. Fuel by MPG or L/100km.", gradient: CAR_GRADIENTS[0], glyph: CAR_GLYPH },
              { id: "boat", label: "Boat", desc: "Sailboats and powerboats. Fuel by gallons-per-hour at cruise.",          gradient: BOAT_GRADIENTS[0], glyph: BOAT_GLYPH },
            ].map((t, i) => (
              <button key={t.id} onClick={() => setMode(t.id)} style={{
                padding: 0, borderRadius: 12, overflow: "hidden",
                background: T.surface, color: T.text,
                border: `2px solid ${i === 0 ? T.accent : T.border}`,
                cursor: "pointer", fontFamily: T.font, textAlign: "left",
                display: "flex", flexDirection: "column",
                boxShadow: i === 0 ? `0 0 0 1px ${T.accent}` : "none",
              }}>
                <div style={{ height: 80, background: t.gradient, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <div style={{ transform: "scale(2.2)" }}>{t.glyph}</div>
                </div>
                <div style={{ padding: "12px 14px" }}>
                  <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: -0.2, marginBottom: 4 }}>{t.label}</div>
                  <div style={{ fontSize: 11, color: T.textMuted, lineHeight: 1.4 }}>{t.desc}</div>
                </div>
              </button>
            ))}
          </div>
        )}

        {/* Car form */}
        {mode === "car" && (
          <>
            <FormSection label="Identity">
              <div><FieldLabel>Vehicle name</FieldLabel><TextInput value={carName} onChange={setCarName} placeholder="e.g. The Outback" suffix="optional"/></div>
              <div style={{ display: "flex", gap: 10 }}>
                <div style={{ flex: 1 }}><FieldLabel>Make</FieldLabel><TextInput value={carMake} onChange={setCarMake} placeholder="Subaru"/></div>
                <div style={{ flex: 1 }}><FieldLabel>Model</FieldLabel><TextInput value={carModel} onChange={setCarModel} placeholder="Outback"/></div>
              </div>
              <div style={{ display: "flex", gap: 10 }}>
                <div style={{ flex: 1 }}><FieldLabel>Year</FieldLabel><TextInput value={carYear} onChange={setCarYear} placeholder="2022" mono type="number"/></div>
                <div style={{ flex: 1 }}><FieldLabel>Body type</FieldLabel><TextInput value={carType} onChange={setCarType} placeholder="AWD wagon"/></div>
              </div>
              <div><FieldLabel>License plate</FieldLabel><TextInput value={carPlate} onChange={setCarPlate} placeholder="CA · 8RPN322" mono suffix="optional"/></div>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
                <input type="checkbox" checked={isRental} onChange={e => setIsRental(e.target.checked)} style={{ width: 15, height: 15 }}/>
                <span style={{ color: T.text }}>Rental vehicle</span>
              </label>
              {isRental && <div><FieldLabel>Rented from</FieldLabel><TextInput value={rentalFrom} onChange={setRentalFrom} placeholder="e.g. Enterprise" suffix="optional"/></div>}
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
                <input type="checkbox" checked={isDefault} onChange={e => setIsDefault(e.target.checked)} style={{ width: 15, height: 15 }}/>
                <span style={{ color: T.text }}>Default for drive legs</span>
              </label>
            </FormSection>

            <FormSection label="Fuel">
              <div><FieldLabel>Fuel type</FieldLabel><SelectRow options={["Regular gas","Premium","Diesel","Hybrid","Electric"]} value={carFuelType} onChange={setCarFuelType}/></div>
              <div style={{ display: "flex", gap: 10 }}>
                <div style={{ flex: 1 }}><FieldLabel>Tank size</FieldLabel><TextInput value={carTankSize} onChange={setCarTankSize} placeholder="18.5" mono type="number"/></div>
                <div style={{ flex: 1 }}><FieldLabel>Unit</FieldLabel><SelectRow options={["gal","L"]} value={carUnit} onChange={setCarUnit}/></div>
              </div>
            </FormSection>

            <FormSection label="Economy" hint="From EPA sticker or your tracking">
              <div style={{ display: "flex", gap: 10 }}>
                <div style={{ flex: 1 }}><FieldLabel>City</FieldLabel><TextInput value={carMpgCity} onChange={setCarMpgCity} suffix="mpg" mono type="number"/></div>
                <div style={{ flex: 1 }}><FieldLabel>Highway</FieldLabel><TextInput value={carMpgHwy} onChange={setCarMpgHwy} suffix="mpg" mono type="number"/></div>
                <div style={{ flex: 1 }}><FieldLabel>Combined *</FieldLabel><TextInput value={carMpgComb} onChange={setCarMpgComb} suffix="mpg" mono type="number"/></div>
              </div>
              <div style={{ padding: "10px 12px", borderRadius: 8, background: T.surface2, border: `1px solid ${T.borderSoft}`, fontSize: 11.5, color: T.textMuted, lineHeight: 1.5 }}>
                The app uses <strong style={{ color: T.text, fontWeight: 600 }}>highway MPG</strong> for trips over 50 miles and combined for shorter legs. You can override per-leg.
              </div>
            </FormSection>

            <FormSection label="Cost">
              <div style={{ display: "flex", gap: 10 }}>
                <div style={{ flex: 1 }}><FieldLabel>Current price *</FieldLabel><TextInput value={carPrice} onChange={setCarPrice} suffix={`/${carUnit}`} mono type="number"/></div>
                <div style={{ flex: 1 }}><FieldLabel>Currency</FieldLabel><SelectRow options={["USD","EUR","GBP","JPY"]} value={carCurrency} onChange={setCarCurrency}/></div>
              </div>
            </FormSection>
          </>
        )}

        {/* Boat form */}
        {mode === "boat" && (
          <>
            <FormSection label="Identity">
              <div><FieldLabel>Vessel name *</FieldLabel><TextInput value={boatName} onChange={setBoatName} placeholder="S/V Halcyon"/></div>
              <div style={{ display: "flex", gap: 10 }}>
                <div style={{ flex: 1 }}><FieldLabel>Make</FieldLabel><TextInput value={boatMake} onChange={setBoatMake} placeholder="Beneteau"/></div>
                <div style={{ flex: 1 }}><FieldLabel>Model</FieldLabel><TextInput value={boatModel} onChange={setBoatModel} placeholder="Oceanis 32"/></div>
              </div>
              <div style={{ display: "flex", gap: 10 }}>
                <div style={{ flex: 1 }}><FieldLabel>Year</FieldLabel><TextInput value={boatYear} onChange={setBoatYear} placeholder="2018" mono type="number"/></div>
                <div style={{ flex: 1 }}><FieldLabel>Berths</FieldLabel><TextInput value={boatBerths} onChange={setBoatBerths} placeholder="4" mono type="number"/></div>
              </div>
              <div><FieldLabel>Type</FieldLabel><SelectRow options={["Sailboat","Powerboat"]} value={boatType} onChange={setBoatType}/></div>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
                <input type="checkbox" checked={isRental} onChange={e => setIsRental(e.target.checked)} style={{ width: 15, height: 15 }}/>
                <span style={{ color: T.text }}>Charter / rental</span>
              </label>
              {isRental && <div><FieldLabel>Chartered from</FieldLabel><TextInput value={rentalFrom} onChange={setRentalFrom} placeholder="e.g. Sunsail, Moorings" suffix="optional"/></div>}
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
                <input type="checkbox" checked={isDefault} onChange={e => setIsDefault(e.target.checked)} style={{ width: 15, height: 15 }}/>
                <span style={{ color: T.text }}>Default for boat legs</span>
              </label>
            </FormSection>

            <FormSection label="Engine">
              <div><FieldLabel>Engine type</FieldLabel><SelectRow options={["Gas (petrol)","Diesel","Electric"]} value={engineType} onChange={setEngineType}/></div>
              <div><FieldLabel>Engine hours · baseline</FieldLabel><TextInput value={engineHours} onChange={setEngineHours} placeholder="1247.5" suffix="h" mono type="number"/></div>
            </FormSection>

            <FormSection label="Fuel & range" hint="Powers leg-level fuel estimate">
              <div style={{ display: "flex", gap: 10 }}>
                <div style={{ flex: 1 }}><FieldLabel>Fuel type</FieldLabel><SelectRow options={["Diesel","Gas (petrol)","Electric"]} value={boatFuelType} onChange={setBoatFuelType}/></div>
              </div>
              <div style={{ display: "flex", gap: 10 }}>
                <div style={{ flex: 1 }}><FieldLabel>Tank size *</FieldLabel><TextInput value={boatTankSize} onChange={setBoatTankSize} placeholder="50" mono type="number"/></div>
                <div style={{ flex: "0 0 auto" }}><FieldLabel>Unit</FieldLabel><SelectRow options={["gal","L"]} value={boatUnit} onChange={setBoatUnit}/></div>
                <div style={{ flex: 1 }}><FieldLabel>Reserve held back</FieldLabel><TextInput value={boatReserve} onChange={setBoatReserve} suffix="%" mono type="number"/></div>
              </div>

              <div style={{ padding: "10px 12px", borderRadius: 8, background: T.surface2, border: `1px solid ${T.borderSoft}`, fontSize: 11.5, color: T.text, lineHeight: 1.55 }}>
                <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: 1.5, color: T.textMuted, marginBottom: 4, textTransform: "uppercase" }}>Operating curve</div>
                Fuel use rises <strong style={{ fontWeight: 600 }}>exponentially</strong> with speed — at hull speed a displacement sailboat burns several times more than at trolling RPM. Log a few RPM points; the app interpolates the right rate for whatever speed you actually average.
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 24px", gap: 8, padding: "2px 10px 0", fontSize: 9.5, fontWeight: 600, letterSpacing: 1.2, color: T.textMuted, textTransform: "uppercase" }}>
                <span>RPM</span><span>GPH</span><span>Speed (kn)</span><span/>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {curve.map((row, i) => (
                  <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 24px", gap: 8, alignItems: "center", padding: "7px 10px", borderRadius: 7, background: T.surface, border: `1px solid ${T.border}` }}>
                    <input value={row.rpm} onChange={e => updateCurveRow(i, "rpm", e.target.value)} placeholder="1800" style={{ ...inputStyle, fontFamily: MONO, padding: "5px 8px", fontSize: 12 }} type="number"/>
                    <input value={row.gph} onChange={e => updateCurveRow(i, "gph", e.target.value)} placeholder="0.55" style={{ ...inputStyle, fontFamily: MONO, padding: "5px 8px", fontSize: 12 }} type="number" step="0.01"/>
                    <input value={row.speed} onChange={e => updateCurveRow(i, "speed", e.target.value)} placeholder="5.0" style={{ ...inputStyle, fontFamily: MONO, padding: "5px 8px", fontSize: 12 }} type="number" step="0.1"/>
                    <button onClick={() => removeCurveRow(i)} style={{ background: "transparent", border: "none", color: T.textFaint, cursor: "pointer", fontSize: 16, padding: 0, lineHeight: 1, fontFamily: T.font }}>×</button>
                  </div>
                ))}
                <button onClick={addCurveRow} style={{ padding: "8px 10px", borderRadius: 7, background: "transparent", border: `1px dashed ${T.border}`, color: T.textMuted, fontSize: 12, fontWeight: 500, cursor: "pointer", fontFamily: T.font, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                  {PLUS_GLYPH} Add data point
                </button>
              </div>

              {numericCurve.length >= 2 && (
                <div style={{ padding: "12px 14px", borderRadius: 10, background: T.bg, border: `1px solid ${T.borderSoft}` }}>
                  <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: 1.5, color: T.textMuted, marginBottom: 6, textTransform: "uppercase" }}>Curve preview</div>
                  <FuelCurveChart curve={numericCurve} targetSpeed={ts} height={140}/>
                </div>
              )}

              <div style={{ display: "flex", gap: 10, alignItems: "stretch" }}>
                <div style={{ flex: 1 }}>
                  <FieldLabel>Target average speed *</FieldLabel>
                  <TextInput value={targetSpeed} onChange={setTargetSpeed} suffix="kn" mono type="number" step="0.1"/>
                </div>
                {numericCurve.length >= 2 && ts > 0 && (
                  <div style={{ flex: "1.3 1 0", padding: "10px 12px", borderRadius: 8, background: T.accentSoft, border: `1px solid ${T.accentSoft}`, display: "flex", flexDirection: "column", justifyContent: "flex-end", gap: 3 }}>
                    <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: 1.5, color: T.accent, textTransform: "uppercase" }}>What the app uses</div>
                    <div style={{ fontFamily: MONO, fontSize: 12, color: T.text, fontWeight: 600 }}>{ts} kn → {previewGph.toFixed(2)} gph</div>
                    {previewRange > 0 && <div style={{ fontSize: 11, color: T.textMuted }}>Range from full tank: <strong style={{ color: T.text, fontWeight: 600 }}>{previewRange} nm</strong></div>}
                  </div>
                )}
              </div>
            </FormSection>

            <FormSection label="Cost">
              <div style={{ display: "flex", gap: 10 }}>
                <div style={{ flex: 1 }}><FieldLabel>Fuel price *</FieldLabel><TextInput value={boatPrice} onChange={setBoatPrice} suffix={`/${boatUnit}`} mono type="number"/></div>
                <div style={{ flex: 1 }}><FieldLabel>Currency</FieldLabel><SelectRow options={["USD","EUR","GBP","JPY"]} value={boatCurrency} onChange={setBoatCurrency}/></div>
              </div>
            </FormSection>
          </>
        )}
      </div>

      {/* Footer */}
      <div style={{ padding: "12px 22px", borderTop: `1px solid ${T.border}`, background: T.surface2, display: "flex", justifyContent: "flex-end", gap: 8, flexShrink: 0 }}>
        <button onClick={onClose} style={{ ...btn.ghost }}>Cancel</button>
        {mode === "picker" ? (
          <button onClick={() => setMode("car")} style={{ ...btn.primary }}>Continue</button>
        ) : (
          <button
            onClick={handleSave}
            disabled={mode === "car" ? !carValid : !boatValid}
            style={{ ...btn.primary, opacity: (mode === "car" ? !carValid : !boatValid) ? 0.45 : 1 }}
          >
            {isEdit ? "Save changes" : "Save vehicle"}
          </button>
        )}
      </div>
    </div>
  );
}

// ── VehiclesPage ──────────────────────────────────────────────────────────────

export default function VehiclesPage({ vehicles, databases = [], activeDbId, onDbChange, onAdd, onUpdate, onDelete }) {
  const [activeId, setActiveId] = useState(vehicles[0]?.id ?? null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [editVehicle, setEditVehicle] = useState(null);

  useEffect(() => {
    if (vehicles.length > 0 && !vehicles.find(v => v.id === activeId)) {
      setActiveId(vehicles[0].id);
    }
    if (vehicles.length === 0) setActiveId(null);
  }, [vehicles]);

  const active = vehicles.find(v => v.id === activeId) ?? null;

  function openAdd() { setEditVehicle(null); setPanelOpen(true); }
  function openEdit(v) { setEditVehicle(v); setPanelOpen(true); }
  function closePanel() { setPanelOpen(false); setEditVehicle(null); }

  function handleSave(v) {
    if (editVehicle) {
      onUpdate(v);
    } else {
      onAdd(v);
      setActiveId(v.id);
    }
    closePanel();
  }

  const multiDb = databases.length > 1;

  return (
    <div style={{ fontFamily: T.font, color: T.text }}>
      {/* Database switcher (only when multiple repos) */}
      {multiDb && (
        <div style={{ display: "flex", gap: 6, marginBottom: 20, flexWrap: "wrap" }}>
          {databases.map(db => {
            const active = db.id === activeDbId;
            return (
              <button
                key={db.id}
                onClick={() => onDbChange?.(db.id)}
                style={{
                  padding: "5px 14px", borderRadius: 20, fontSize: 13, fontWeight: active ? 600 : 500,
                  border: `1px solid ${active ? T.accent : T.border}`,
                  background: active ? T.accentSoft : "transparent",
                  color: active ? T.accent : T.textMuted,
                  cursor: "pointer", fontFamily: T.font,
                }}
              >
                {db.label}
              </button>
            );
          })}
        </div>
      )}

      {/* Page description */}
      <div style={{ fontSize: 13, color: T.textMuted, marginBottom: 24, lineHeight: 1.5 }}>
        Settings here feed fuel-cost estimates on every Drive and Boat leg. Update fuel prices anytime — old trips stay frozen at the price you logged.
      </div>

      {vehicles.length === 0 ? (
        /* Empty state */
        <div style={{
          padding: "64px 32px", borderRadius: 14, background: T.surface2,
          border: `1px solid ${T.border}`, textAlign: "center",
          display: "flex", flexDirection: "column", alignItems: "center", gap: 16,
        }}>
          <div style={{ display: "flex", gap: 16 }}>
            <div style={{ opacity: 0.25, color: T.text }}><div style={{ transform: "scale(2.5)", display: "inline-block" }}>{CAR_GLYPH}</div></div>
            <div style={{ opacity: 0.25, color: T.text }}><div style={{ transform: "scale(2.5)", display: "inline-block" }}>{BOAT_GLYPH}</div></div>
          </div>
          <div style={{ fontSize: 15, fontWeight: 600, color: T.text }}>No vehicles yet</div>
          <div style={{ fontSize: 13, color: T.textMuted, maxWidth: 360, lineHeight: 1.6 }}>
            Add a vehicle to start tracking fuel and cost on Drive and Boat legs.
          </div>
          <button onClick={openAdd} style={{ ...btn.primary, marginTop: 4 }}>
            {PLUS_GLYPH} Add vehicle
          </button>
        </div>
      ) : (
        <>
          {/* Tile grid */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(200px,1fr))", gap: 12, marginBottom: 32 }}>
            {vehicles.map(v => (
              <VehicleTile key={v.id} vehicle={v} active={v.id === activeId} onClick={() => setActiveId(v.id)}/>
            ))}
            <AddVehicleTile onClick={openAdd}/>
          </div>

          {/* Detail panel */}
          {active && <VehicleDetail vehicle={active} onEdit={openEdit}/>}
        </>
      )}

      {/* Add / Edit panel backdrop + panel */}
      {panelOpen && (
        <>
          <div onClick={closePanel} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", zIndex: 1099 }}/>
          <AddVehiclePanel
            vehicles={vehicles}
            editVehicle={editVehicle}
            onClose={closePanel}
            onSave={handleSave}
          />
        </>
      )}
    </div>
  );
}
