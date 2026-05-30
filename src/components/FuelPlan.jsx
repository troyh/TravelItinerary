import React, { useState, useEffect, useId } from "react";
import { T, btn } from "../theme.js";
import {
  simulateFuelPlan, simulateAutoBaseline,
  collectVehicleSegments, defaultStartingFuel, CURRENCY_SYM,
} from "../lib/fuelPlan.js";

// ─── Icons ───────────────────────────────────────────────────────────────────

function FuelPumpGlyph({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none">
      <path d="M2 12V3a1 1 0 011-1h4a1 1 0 011 1v9M2 12h7M3 5h4M3 8h4M9 5l2 1.5V11a1 1 0 001 1M11 9a1 1 0 001-1V6.5L11 5"
        stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

export function FuelPumpGlyphSmall() {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
      <path d="M2 12V3a1 1 0 011-1h4a1 1 0 011 1v9M2 12h7M3 5h4M3 8h4M9 5l2 1.5V11a1 1 0 001 1M11 9a1 1 0 001-1V6.5L11 5"
        stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

// ─── Fuel Trajectory Chart ────────────────────────────────────────────────────

function FuelTrajectoryChart({ sim, vehicle }) {
  const uid = useId();
  const PAD = { l: 38, r: 24, t: 18, b: 36 };
  const width = 720;
  const height = 180;
  const tank = sim.tank;
  if (!tank) return null;

  const xStep = (width - PAD.l - PAD.r) / Math.max(1, sim.rows.length);
  const xAt = i => PAD.l + i * xStep;
  const yAt = v => PAD.t + (1 - Math.max(0, v) / tank) * (height - PAD.t - PAD.b);

  const pts = [];
  pts.push({ x: PAD.l, y: yAt(sim.rows[0]?.levelBefore ?? tank) });
  sim.rows.forEach((row, i) => {
    if (row.kind === "refuel") {
      pts.push({ x: xAt(i + 0.5), y: yAt(row.levelBefore), refuel: true });
      pts.push({ x: xAt(i + 0.5), y: yAt(row.levelAfter), refuel: true });
    } else {
      pts.push({ x: xAt(i + 1), y: yAt(row.levelAfter) });
    }
  });

  const d = pts.reduce((s, p, i) => s + `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)} `, "");
  const areaD = d + `L ${pts[pts.length - 1].x} ${yAt(0)} L ${pts[0].x} ${yAt(0)} Z`;
  const reserveY = yAt(sim.reserve);
  const refuelItems = sim.rows.map((r, i) => ({ r, i })).filter(({ r }) => r.kind === "refuel");
  const unit = vehicle.fuel.unit;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} style={{ width: "100%", height: "auto", display: "block" }}>
      <line x1={PAD.l} y1={yAt(tank)} x2={width - PAD.r} y2={yAt(tank)}
        stroke={T.borderSoft} strokeDasharray="2,3" strokeWidth="0.5"/>
      <text x={PAD.l - 6} y={yAt(tank) + 3} fill={T.textFaint} fontSize="9" fontWeight="600" textAnchor="end">
        {tank}{unit}
      </text>
      <line x1={PAD.l} y1={yAt(tank / 2)} x2={width - PAD.r} y2={yAt(tank / 2)}
        stroke={T.borderSoft} strokeDasharray="2,3" strokeWidth="0.5"/>
      <text x={PAD.l - 6} y={yAt(tank / 2) + 3} fill={T.textFaint} fontSize="9" fontWeight="600" textAnchor="end">
        {(tank / 2).toFixed(0)}
      </text>

      <defs>
        <pattern id={`hatch-${uid}`} patternUnits="userSpaceOnUse" width="5" height="5" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="5" stroke={T.amber} strokeWidth="1" opacity="0.45"/>
        </pattern>
      </defs>
      <rect x={PAD.l} y={reserveY} width={width - PAD.l - PAD.r} height={yAt(0) - reserveY}
        fill={`url(#hatch-${uid})`} opacity="0.5"/>
      <line x1={PAD.l} y1={reserveY} x2={width - PAD.r} y2={reserveY}
        stroke={T.amber} strokeWidth="1" opacity="0.7"/>
      <text x={width - PAD.r - 6} y={reserveY - 4} fill={T.amber} fontSize="9" fontWeight="700" textAnchor="end" letterSpacing="0.5">
        RESERVE · {vehicle.fuel.reservePct ?? 15}%
      </text>

      <line x1={PAD.l} y1={yAt(0)} x2={width - PAD.r} y2={yAt(0)} stroke={T.border} strokeWidth="1"/>
      <line x1={PAD.l} y1={PAD.t} x2={PAD.l} y2={yAt(0)} stroke={T.border} strokeWidth="1"/>

      <path d={areaD} fill={T.accentSoft} opacity="0.6"/>

      {refuelItems.map(({ r, i }) => {
        const x = xAt(i + 0.5);
        const y1 = yAt(r.levelBefore);
        const y2 = yAt(r.levelAfter);
        return (
          <g key={`rf-${i}`}>
            <line x1={x} y1={yAt(tank)} x2={x} y2={yAt(0)}
              stroke={T.accent} strokeDasharray="3,3" strokeWidth="0.7" opacity="0.4"/>
            <line x1={x} y1={y1} x2={x} y2={y2}
              stroke={T.accent} strokeWidth="3" strokeLinecap="round"/>
            <polygon points={`${x - 4},${y2 + 5} ${x + 4},${y2 + 5} ${x},${y2}`} fill={T.accent}/>
          </g>
        );
      })}

      <path d={d} fill="none" stroke={T.accent} strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round"/>

      {pts.map((p, i) => p.refuel ? null : (
        <circle key={i} cx={p.x} cy={p.y} r="3.5" fill={T.bg} stroke={T.accent} strokeWidth="1.8"/>
      ))}

      {sim.rows.map((row, i) => {
        if (row.kind === "refuel") {
          const x = xAt(i + 0.5);
          return (
            <g key={`rfl-${i}`}>
              <text x={x} y={height - 18} fill={T.accent} fontSize="9" fontWeight="700" textAnchor="middle" letterSpacing="0.5">⛽</text>
              <text x={x} y={height - 6} fill={T.textMuted} fontSize="8.5" fontWeight="600" textAnchor="middle" fontFamily="ui-monospace, monospace">
                +{row.amountAdded}{unit}
              </text>
            </g>
          );
        }
        const x = xAt(i + 1);
        return (
          <g key={`lgl-${i}`}>
            <text x={x} y={height - 18} fill={T.textMuted} fontSize="9" fontWeight="600" textAnchor="middle">L{row.legIdx + 1}</text>
            <text x={x} y={height - 6} fill={T.textFaint} fontSize="8.5" fontWeight="500" textAnchor="middle" fontFamily="ui-monospace, monospace">
              {row.pctAfter}%
            </text>
          </g>
        );
      })}

      <text x={PAD.l} y={PAD.t - 6} fill={T.textMuted} fontSize="9" fontWeight="700" letterSpacing="0.5">START</text>
    </svg>
  );
}

// ─── Starting Fuel Control ────────────────────────────────────────────────────

function StartingFuelControl({ vehicle, value, onChange }) {
  const tank = vehicle.fuel.tankSize;
  const pct = Math.round((value / tank) * 100);
  const reservePct = vehicle.fuel.reservePct ?? 15;
  const unit = vehicle.fuel.unit;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 18, padding: "14px 18px",
      background: T.surface2, border: `1px solid ${T.borderSoft}`, borderRadius: 10 }}>
      <div style={{ flexShrink: 0 }}>
        <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: 1.5, color: T.textMuted,
          marginBottom: 4, textTransform: "uppercase" }}>Starting fuel</div>
        <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: -0.4, fontVariantNumeric: "tabular-nums" }}>
          {value}
          <span style={{ fontSize: 12, fontWeight: 500, color: T.textMuted, marginLeft: 4 }}>/ {tank} {unit}</span>
        </div>
      </div>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ position: "relative", height: 26, display: "flex", alignItems: "center" }}>
          <input type="range" min={0} max={tank} step={0.5} value={value}
            onInput={e => onChange(parseFloat(e.target.value))}
            style={{ width: "100%", accentColor: "var(--accent)", height: 6 }}/>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10,
          color: T.textFaint, fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>
          <span>Empty</span>
          <span style={{ color: T.amber }}>Reserve · {reservePct}%</span>
          <span>{pct}%</span>
          <span>Full</span>
        </div>
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        {[25, 50, 75, 100].map(p => (
          <button key={p} onClick={() => onChange(Math.round(tank * p / 100 * 10) / 10)}
            style={{ padding: "6px 10px", borderRadius: 6, fontFamily: "inherit",
              background: pct === p ? "var(--accent)" : T.surface,
              color: pct === p ? "#fff" : T.textMuted,
              border: `1px solid ${pct === p ? "transparent" : T.border}`,
              fontSize: 11, fontWeight: 600, cursor: "pointer", fontVariantNumeric: "tabular-nums" }}>
            {p}%
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Leg Row ──────────────────────────────────────────────────────────────────

function FuelLegRow({ row, vehicle, isLast, isMobile }) {
  const leg = row.leg;
  const isBoat = vehicle.kind === "boat";
  const sym = CURRENCY_SYM[vehicle.cost?.currency] || "$";
  const perUnit = vehicle.cost?.perUnit ?? 0;
  const unit = vehicle.fuel.unit;
  const reservePct = vehicle.fuel.reservePct ?? 15;

  const statusEl = row.empty ? (
    <span style={{ fontSize: 11, fontWeight: 600, color: T.amber }}>⚠ Empty mid-leg</span>
  ) : row.belowReserve ? (
    <span style={{ fontSize: 11, fontWeight: 600, color: T.amber }}>Below reserve</span>
  ) : (
    <span style={{ fontSize: 11, color: T.textMuted }}>{row.pctAfter}% left</span>
  );

  const fuelBar = (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10,
        color: T.textFaint, fontWeight: 600, fontVariantNumeric: "tabular-nums", letterSpacing: 0.3 }}>
        <span>{row.levelBefore.toFixed(1)}{unit}</span>
        <span style={{ color: T.textMuted, textTransform: "uppercase", letterSpacing: 1 }}>
          −{row.consume.toFixed(isBoat ? 2 : 1)} {unit}
        </span>
        <span style={{ color: row.empty ? T.amber : row.belowReserve ? T.amber : T.text, fontWeight: 700 }}>
          {Math.max(0, row.levelAfter).toFixed(1)}{unit}
        </span>
      </div>
      <div style={{ position: "relative", height: 8, borderRadius: 999,
        background: T.surface2, border: `1px solid ${T.borderSoft}`, overflow: "hidden" }}>
        <div style={{ position: "absolute", left: 0, top: 0, bottom: 0,
          width: `${reservePct}%`,
          background: `repeating-linear-gradient(45deg, ${T.borderSoft}, ${T.borderSoft} 3px, transparent 3px, transparent 6px)` }}/>
        <div style={{ position: "absolute", left: 0, top: 0, bottom: 0,
          width: `${Math.max(0, row.levelAfter / vehicle.fuel.tankSize) * 100}%`,
          background: row.empty ? T.amber : row.belowReserve ? T.amber : "var(--accent)",
          transition: "width 240ms ease" }}/>
      </div>
    </div>
  );

  const spineCol = (
    <div style={{ position: "relative", height: "100%", display: "flex", justifyContent: "center" }}>
      <div style={{ position: "absolute", top: -20, bottom: -20, left: "50%", width: 1.5,
        background: T.borderSoft, transform: "translateX(-50%)" }}/>
      <div style={{ position: "relative", zIndex: 1, width: 22, height: 22, borderRadius: 11,
        background: row.belowReserve ? T.amber : T.accentSoft,
        color: row.belowReserve ? "#fff" : "var(--accent)",
        display: "flex", alignItems: "center", justifyContent: "center",
        border: `2px solid ${T.surface}`, fontSize: 10, fontWeight: 700,
        fontFamily: "ui-monospace, monospace" }}>
        {row.legIdx + 1}
      </div>
    </div>
  );

  if (isMobile) {
    return (
      <div style={{ display: "grid", gridTemplateColumns: "28px 1fr", gap: 10,
        alignItems: "start", padding: "14px 14px 14px 8px",
        borderBottom: isLast ? "none" : `1px solid ${T.borderSoft}`, position: "relative" }}>
        {spineCol}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div>
            <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: 1, color: T.textFaint,
              marginBottom: 3, textTransform: "uppercase" }}>{leg.day}</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: T.text, lineHeight: 1.25 }}>
              {leg.from}<span style={{ color: T.textFaint, margin: "0 5px", fontWeight: 400 }}>→</span>{leg.to}
            </div>
            <div style={{ fontSize: 11, color: T.textMuted, marginTop: 3, fontVariantNumeric: "tabular-nums",
              display: "flex", gap: 10, flexWrap: "wrap" }}>
              <span>{leg.distance} {leg.unit} · {leg.duration}</span>
              {statusEl}
              {perUnit > 0 && <span style={{ fontVariantNumeric: "tabular-nums" }}>{sym}{(row.consume * perUnit).toFixed(2)}</span>}
            </div>
          </div>
          {fuelBar}
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "28px 1fr 2fr 120px 80px",
      gap: 14, alignItems: "center", padding: "16px 18px 16px 8px",
      borderBottom: isLast ? "none" : `1px solid ${T.borderSoft}`, position: "relative" }}>
      {spineCol}
      {/* Route */}
      <div>
        <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: 1, color: T.textFaint,
          marginBottom: 3, textTransform: "uppercase" }}>{leg.day}</div>
        <div style={{ fontSize: 13, fontWeight: 600, color: T.text, lineHeight: 1.25 }}>
          {leg.from}
          <span style={{ color: T.textFaint, margin: "0 5px", fontWeight: 400 }}>→</span>
          {leg.to}
        </div>
        <div style={{ fontSize: 11, color: T.textMuted, marginTop: 3, fontVariantNumeric: "tabular-nums" }}>
          {leg.distance} {leg.unit} · {leg.duration}
        </div>
      </div>
      {fuelBar}
      <div style={{ textAlign: "right" }}>{statusEl}</div>
      <div style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
        {perUnit > 0 && (
          <>
            <div style={{ fontSize: 13, fontWeight: 700, color: T.text, letterSpacing: -0.2 }}>
              {sym}{(row.consume * perUnit).toFixed(2)}
            </div>
            <div style={{ fontSize: 10, color: T.textFaint, marginTop: 2 }}>fuel cost</div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Refuel Row ───────────────────────────────────────────────────────────────

function FuelRefuelRow({ row, vehicle, onAmountChange, onRemove, onDragStart, onDragEnd, isMobile }) {
  const sym = CURRENCY_SYM[vehicle.cost?.currency] || "$";
  const perUnit = vehicle.cost?.perUnit ?? 0;
  const tank = vehicle.fuel.tankSize;
  const unit = vehicle.fuel.unit;
  const sliderPct = (row.amountAdded / tank) * 100;
  const beforePct = Math.round(row.levelBefore / tank * 100);

  let caption;
  if (row.source === "user-moved" && row.movedFromIdx != null) {
    caption = <>Moved earlier — originally suggested before <strong style={{ color: T.text, fontWeight: 600 }}>Leg {row.movedFromIdx + 1}</strong></>;
  } else if (row.source === "user-added" || row.source === "user-edited-amount") {
    caption = <>Manually scheduled · tank at {beforePct}% before</>;
  } else {
    caption = <>Tank at {beforePct}% — would not finish next leg</>;
  }

  return (
    <div style={{ position: "relative", margin: "4px 0", padding: "16px 18px 16px 8px",
      borderTop: `1px dashed var(--accent)`, borderBottom: `1px dashed var(--accent)`,
      background: T.accentSoft }}>
      {/* Grip handle — desktop only */}
      {!isMobile && (
        <button
          draggable
          onDragStart={e => { e.dataTransfer.effectAllowed = "move"; onDragStart?.(); }}
          onDragEnd={onDragEnd}
          title="Drag to move earlier or later"
          style={{ position: "absolute", left: -10, top: "50%", transform: "translateY(-50%)",
            width: 22, height: 36, borderRadius: 6, background: T.surface,
            border: `1px solid ${T.border}`, color: T.textMuted, cursor: "grab", padding: 0,
            fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
          <svg width="9" height="13" viewBox="0 0 9 13" fill="currentColor">
            <circle cx="2" cy="2" r="1.1"/><circle cx="7" cy="2" r="1.1"/>
            <circle cx="2" cy="6.5" r="1.1"/><circle cx="7" cy="6.5" r="1.1"/>
            <circle cx="2" cy="11" r="1.1"/><circle cx="7" cy="11" r="1.1"/>
          </svg>
        </button>
      )}
      {/* Remove button */}
      <button onClick={onRemove}
        title="Remove this refuel stop"
        style={{ position: "absolute", top: 8, right: 8, width: 22, height: 22, borderRadius: 6,
          background: T.surface, border: `1px solid ${T.border}`, color: T.textMuted,
          cursor: "pointer", padding: 0, fontFamily: "inherit",
          display: "flex", alignItems: "center", justifyContent: "center" }}>
        <svg width="9" height="9" viewBox="0 0 9 9" fill="none">
          <path d="M1.5 1.5l6 6M7.5 1.5l-6 6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
        </svg>
      </button>

      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "28px 1fr" : "28px 1fr 2fr 80px",
        gap: isMobile ? 10 : 14, alignItems: "center" }}>
        {/* Pump icon */}
        <div style={{ display: "flex", justifyContent: "center" }}>
          <div style={{ width: 28, height: 28, borderRadius: 14, background: "var(--accent)", color: "#fff",
            display: "flex", alignItems: "center", justifyContent: "center",
            border: `2px solid ${T.surface}` }}>
            <FuelPumpGlyph size={13}/>
          </div>
        </div>

        {/* Label + station + caption (+ slider + cost inlined on mobile) */}
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1.5, color: "var(--accent)",
              textTransform: "uppercase" }}>⛽ Refuel stop</div>
            {row.pinned && (
              <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 0.8, padding: "2px 6px",
                borderRadius: 999, background: T.text, color: T.bg, textTransform: "uppercase",
                display: "inline-flex", alignItems: "center", gap: 4 }}>
                <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor">
                  <path d="M4 0.5L5 3l2.5.4-1.8 1.7.4 2.4L4 6.3 1.9 7.5l.4-2.4L.5 3.4 3 3z"/>
                </svg>
                PINNED
              </div>
            )}
          </div>
          <div style={{ fontSize: 13, fontWeight: 600, color: T.text, lineHeight: 1.25 }}>
            {row.station || "Top up before next leg"}
          </div>
          <div style={{ fontSize: 11, color: T.textMuted, marginTop: 3 }}>{caption}</div>
          {isMobile && (
            <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10,
                color: T.textMuted, fontWeight: 600, letterSpacing: 0.3 }}>
                <span>Fill to</span>
                <span style={{ fontVariantNumeric: "tabular-nums", color: "var(--accent)", fontWeight: 700 }}>
                  {row.topOffPct}% (+{row.amountAdded} {unit})
                </span>
                {perUnit > 0 && (
                  <span style={{ fontVariantNumeric: "tabular-nums", color: "var(--accent)" }}>
                    {sym}{(row.amountAdded * perUnit).toFixed(2)}
                  </span>
                )}
              </div>
              <input type="range" min={beforePct} max={100} step={1}
                value={row.topOffPct}
                onInput={e => {
                  const targetPct = parseInt(e.target.value, 10);
                  const amount = Math.max(0, Math.round(tank * targetPct / 100 - row.levelBefore));
                  onAmountChange?.(row.beforeLegIdx, amount);
                }}
                style={{ width: "100%", accentColor: "var(--accent)" }}/>
            </div>
          )}
        </div>

        {!isMobile && (<>
          {/* Amount slider */}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10,
              color: T.textMuted, fontWeight: 600, letterSpacing: 0.3 }}>
              <span>Fill to</span>
              <span style={{ fontVariantNumeric: "tabular-nums", color: "var(--accent)", fontWeight: 700 }}>
                {row.topOffPct}% (+{row.amountAdded} {unit})
              </span>
              <span style={{ fontVariantNumeric: "tabular-nums" }}>→ {row.levelAfter.toFixed(0)}{unit}</span>
            </div>
            <input type="range" min={beforePct} max={100} step={1}
              value={row.topOffPct}
              onInput={e => {
                const targetPct = parseInt(e.target.value, 10);
                const amount = Math.max(0, Math.round(tank * targetPct / 100 - row.levelBefore));
                onAmountChange?.(row.beforeLegIdx, amount);
              }}
              style={{ width: "100%", accentColor: "var(--accent)" }}/>
          </div>

          {/* Cost */}
          <div style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
            {perUnit > 0 && (
              <>
                <div style={{ fontSize: 13, fontWeight: 700, color: "var(--accent)", letterSpacing: -0.2 }}>
                  {sym}{(row.amountAdded * perUnit).toFixed(2)}
                </div>
                <div style={{ fontSize: 10, color: T.textFaint, marginTop: 2 }}>at pump</div>
              </>
            )}
          </div>
        </>)}
      </div>
    </div>
  );
}

// ─── Inter-leg Inserter ───────────────────────────────────────────────────────

function InterLegInserter({ afterLegIdx, onInsert, onDragOver, onDragLeave, onDrop, isDragTarget }) {
  const [hovered, setHovered] = useState(false);
  const active = hovered || isDragTarget;

  return (
    <div
      style={{ display: "grid", gridTemplateColumns: "28px 1fr", gap: 14,
        padding: active ? "8px 18px 8px 8px" : "2px 18px 2px 8px",
        alignItems: "center", position: "relative", transition: "padding 160ms ease" }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onDragOver={e => { e.preventDefault(); onDragOver?.(); }}
      onDragLeave={onDragLeave}
      onDrop={e => { e.preventDefault(); onDrop?.(); }}>
      <div style={{ position: "relative", display: "flex", justifyContent: "center" }}>
        <div style={{ position: "absolute", top: -20, bottom: -20, left: "50%", width: 1.5,
          background: T.borderSoft, transform: "translateX(-50%)" }}/>
        <button onClick={() => onInsert?.(afterLegIdx)}
          style={{ position: "relative", zIndex: 1,
            width: active ? 22 : 16, height: active ? 22 : 16, borderRadius: "50%",
            background: active ? "var(--accent)" : T.surface,
            color: active ? "#fff" : T.textFaint,
            border: `1.5px ${active ? "solid" : "dashed"} ${active ? "var(--accent)" : T.border}`,
            display: "flex", alignItems: "center", justifyContent: "center",
            cursor: "pointer", padding: 0, fontFamily: "inherit", transition: "all 160ms ease" }}>
          <svg width={active ? 11 : 8} height={active ? 11 : 8} viewBox="0 0 11 11" fill="none">
            <path d="M5.5 2v7M2 5.5h7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        </button>
      </div>
      <div style={{ fontSize: active ? 12 : 0, color: active ? "var(--accent)" : "transparent",
        fontWeight: 600, opacity: active ? 1 : 0, transition: "opacity 160ms ease",
        display: "flex", alignItems: "center", gap: 8 }}>
        Add refuel here
      </div>
    </div>
  );
}

// ─── Vehicle Fuel Plan ────────────────────────────────────────────────────────

function VehicleFuelPlan({ vehicle, legs, startingFuel, pinnedRefuels, onStartingFuelChange, onPinChange, isMobile }) {
  const [hintDismissed, setHintDismissed] = useState(false);
  const [dragging, setDragging] = useState(null); // { fromIdx, amount }
  const [dragOverIdx, setDragOverIdx] = useState(null);

  const sim = simulateFuelPlan(vehicle, legs, startingFuel, pinnedRefuels);
  const isBoat = vehicle.kind === "boat";
  const sym = CURRENCY_SYM[vehicle.cost?.currency] || "$";
  const tank = vehicle.fuel.tankSize;
  const unit = vehicle.fuel.unit;
  const hasPins = (pinnedRefuels ?? []).length > 0;
  const hasRefuels = sim.rows.some(r => r.kind === "refuel");

  const autoSim = hasPins ? simulateAutoBaseline(vehicle, legs, startingFuel) : null;

  function handleAmountChange(beforeLegIdx, amount) {
    const existing = (pinnedRefuels ?? []).find(p => p.beforeLegIdx === beforeLegIdx);
    if (existing) {
      onPinChange((pinnedRefuels ?? []).map(p =>
        p.beforeLegIdx === beforeLegIdx ? { ...p, amount, source: "user-edited-amount" } : p));
    } else {
      onPinChange([...(pinnedRefuels ?? []), { beforeLegIdx, amount, source: "user-edited-amount" }]);
    }
  }

  function handleRemove(beforeLegIdx) {
    onPinChange((pinnedRefuels ?? []).filter(p => p.beforeLegIdx !== beforeLegIdx));
  }

  function handleInsert(afterLegIdx) {
    // afterLegIdx is the legIdx of the preceding leg; insert before leg afterLegIdx+1
    const newIdx = afterLegIdx + 1;
    // Find what the level would be at that point in the current sim
    let levelAtPoint = startingFuel;
    const tmpSim = simulateFuelPlan(vehicle, legs, startingFuel, pinnedRefuels);
    for (const row of tmpSim.rows) {
      if (row.kind === "leg" && row.legIdx === afterLegIdx) {
        levelAtPoint = row.levelAfter;
        break;
      }
    }
    const amount = Math.max(1, Math.round(tank - levelAtPoint));
    const alreadyHasPin = (pinnedRefuels ?? []).some(p => p.beforeLegIdx === newIdx);
    if (alreadyHasPin) return;
    onPinChange([...(pinnedRefuels ?? []), { beforeLegIdx: newIdx, amount, source: "user-added" }]);
  }

  function handleDrop(toAfterLegIdx) {
    if (dragging == null) return;
    const newIdx = toAfterLegIdx + 1;
    if (newIdx === dragging.fromIdx) { setDragging(null); setDragOverIdx(null); return; }
    const newPins = (pinnedRefuels ?? []).filter(p => p.beforeLegIdx !== dragging.fromIdx);
    newPins.push({ beforeLegIdx: newIdx, amount: dragging.amount, source: "user-moved", movedFromIdx: dragging.fromIdx });
    onPinChange(newPins);
    setDragging(null);
    setDragOverIdx(null);
  }

  // Build interleaved items: leg rows + inserters + refuel rows
  const items = [];
  for (let i = 0; i < sim.rows.length; i++) {
    const row = sim.rows[i];
    const next = sim.rows[i + 1];
    items.push({ type: row.kind === "refuel" ? "refuel" : "leg", row, key: `r${i}` });
    if (row.kind === "leg") {
      // Insert inserter only if: next doesn't exist or next is a leg (not a refuel already here)
      const nextIsRefuelHere = next && next.kind === "refuel" && next.beforeLegIdx === row.legIdx + 1;
      if (!nextIsRefuelHere) {
        items.push({ type: "inserter", afterLegIdx: row.legIdx, key: `i${i}` });
      }
    }
  }

  const totalDist = legs.reduce((s, l) => s + (l.distance ?? 0), 0);
  const distUnit = legs[0]?.unit ?? unit;
  const finalPct = Math.round(Math.max(0, sim.finalLevel) / tank * 100);

  // Before/after cost comparison
  let costSavings = null;
  if (autoSim && hasPins && vehicle.cost?.perUnit > 0) {
    const diff = autoSim.totals.refuelCost - sim.totals.refuelCost;
    if (Math.abs(diff) > 0.5) costSavings = diff;
  }

  return (
    <section style={{ border: `1px solid ${T.border}`, borderRadius: 14, background: T.surface, overflow: "hidden" }}>
      {/* Vehicle header */}
      <div style={{ display: "flex", alignItems: "stretch", borderBottom: `1px solid ${T.border}` }}>
        <div style={{ width: 56, background: vehicle.photoBg || (isBoat ? "#1e3a5f" : "#2d4a6b"),
          color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <div style={{ fontSize: 22 }}>{isBoat ? "⛵" : "🚗"}</div>
        </div>
        <div style={{ flex: 1, padding: "14px 18px", display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
              <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: -0.3 }}>{vehicle.name}</div>
              {vehicle.rentalOf && (
                <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 999,
                  background: T.amberSoft, color: T.amber, border: `1px solid ${T.amber}40` }}>Rental</span>
              )}
            </div>
            <div style={{ fontSize: 12, color: T.textMuted, marginTop: 3, fontVariantNumeric: "tabular-nums" }}>
              {vehicle.year} {vehicle.make} {vehicle.model} · {tank} {unit} tank
              {vehicle.cost?.perUnit > 0 && ` · ${sym}${vehicle.cost.perUnit.toFixed(2)}/${unit}`}
              {isBoat
                ? ` · ${legs.length} passage${legs.length !== 1 ? "s" : ""}`
                : ` · ${vehicle.fuel.mpgCombined ?? "?"} mpg combined`}
            </div>
          </div>
          <div style={{ display: "flex", gap: 14, fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>
            {[
              { label: "Legs", value: legs.length },
              { label: "Fuel", value: `${sim.totals.consumed.toFixed(1)}${unit}` },
              { label: "Refuels", value: sim.totals.refuels, amber: sim.totals.refuels > 0 },
              vehicle.cost?.perUnit > 0 && { label: "Cost", value: `${sym}${sim.totals.cost.toFixed(0)}`, accent: true },
            ].filter(Boolean).map(s => (
              <div key={s.label} style={{ minWidth: 48 }}>
                <div style={{ fontSize: 9.5, fontWeight: 600, letterSpacing: 1.2, color: T.textMuted,
                  textTransform: "uppercase", marginBottom: 2 }}>{s.label}</div>
                <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: -0.3,
                  color: s.accent ? "var(--accent)" : s.amber ? T.amber : T.text }}>{s.value}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Starting fuel + chart */}
      <div style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 14 }}>
        <StartingFuelControl vehicle={vehicle} value={startingFuel} onChange={onStartingFuelChange}/>
        <div style={{ padding: "12px 14px 8px", background: T.surface2,
          border: `1px solid ${T.borderSoft}`, borderRadius: 10 }}>
          <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: 1.5, color: T.textMuted,
            marginBottom: 8, textTransform: "uppercase" }}>
            Fuel trajectory · {legs.length} {isBoat ? "passage" : "drive"}{legs.length !== 1 ? "s" : ""}
          </div>
          <FuelTrajectoryChart sim={sim} vehicle={vehicle}/>
        </div>
      </div>

      {/* Hint banner */}
      {hasRefuels && !hintDismissed && (
        <div style={{ padding: "10px 18px", background: T.surface2,
          borderTop: `1px solid ${T.border}`, borderBottom: `1px solid ${T.border}`,
          fontSize: 12, color: T.textMuted, display: "flex", alignItems: "center", gap: 10 }}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ color: "var(--accent)", flexShrink: 0 }}>
            <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.3"/>
            <path d="M7 4v3.5M7 9.5h0.01" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
          </svg>
          <span style={{ flex: 1 }}>
            {!isMobile && <><strong style={{ color: T.text, fontWeight: 600 }}>Drag the grip</strong> on a refuel to move it earlier or later · </>}
            click <strong style={{ color: T.text, fontWeight: 600 }}>+</strong> between legs to add one manually ·
            click <strong style={{ color: T.text, fontWeight: 600 }}>×</strong> to remove
          </span>
          <button onClick={() => setHintDismissed(true)}
            style={{ background: "none", border: "none", color: T.textFaint, cursor: "pointer",
              padding: "2px 4px", fontFamily: "inherit", fontSize: 16, lineHeight: 1 }}>×</button>
        </div>
      )}

      {/* Before/after compare panel */}
      {hasPins && autoSim && (
        <div style={{ margin: "0 18px 4px", display: "grid", gridTemplateColumns: "1fr 24px 1fr",
          background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10,
          overflow: "hidden", marginTop: 14 }}>
          <div style={{ padding: "14px 16px" }}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1.5, color: T.textMuted,
              textTransform: "uppercase", marginBottom: 4 }}>Auto-suggested</div>
            <div style={{ fontSize: 12, color: T.textMuted, fontVariantNumeric: "tabular-nums" }}>
              <div>Refuels: {autoSim.totals.refuels}</div>
              <div>End: {Math.max(0, autoSim.finalLevel).toFixed(1)}{unit}</div>
              {vehicle.cost?.perUnit > 0 && <div>Cost: {sym}{autoSim.totals.refuelCost.toFixed(2)} at pump</div>}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center",
            background: T.surface2, color: T.textFaint }}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M3 7h8M7 3l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <div style={{ padding: "14px 16px", background: T.accentSoft }}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1.5, color: "var(--accent)",
              textTransform: "uppercase", marginBottom: 4 }}>Your version</div>
            <div style={{ fontSize: 12, color: T.text, fontVariantNumeric: "tabular-nums" }}>
              <div style={{ fontWeight: 600 }}>Refuels: {sim.totals.refuels}</div>
              <div style={{ fontWeight: 600 }}>End: {Math.max(0, sim.finalLevel).toFixed(1)}{unit}</div>
              {vehicle.cost?.perUnit > 0 && (
                <div style={{ fontWeight: 600 }}>
                  Cost: {sym}{sim.totals.refuelCost.toFixed(2)} at pump
                  {costSavings != null && costSavings > 0.5 && (
                    <span style={{ color: "var(--accent)" }}> · saves {sym}{costSavings.toFixed(2)}</span>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Leg list */}
      <div style={{ borderTop: `1px solid ${T.border}`, marginTop: hasPins && autoSim ? 14 : 0 }}>
        {items.map((it, idx) => {
          if (it.type === "inserter") {
            return (
              <InterLegInserter key={it.key}
                afterLegIdx={it.afterLegIdx}
                onInsert={handleInsert}
                isDragTarget={dragOverIdx === it.afterLegIdx}
                onDragOver={() => setDragOverIdx(it.afterLegIdx)}
                onDragLeave={() => setDragOverIdx(null)}
                onDrop={() => handleDrop(it.afterLegIdx)}/>
            );
          }
          if (it.type === "refuel") {
            return (
              <FuelRefuelRow key={it.key}
                row={it.row}
                vehicle={vehicle}
                isMobile={isMobile}
                onAmountChange={handleAmountChange}
                onRemove={() => handleRemove(it.row.beforeLegIdx)}
                onDragStart={() => setDragging({ fromIdx: it.row.beforeLegIdx, amount: it.row.amountAdded })}
                onDragEnd={() => { if (dragOverIdx == null) setDragging(null); }}/>
            );
          }
          const isLast = idx === items.length - 1 || (idx === items.length - 2 && items[items.length - 1]?.type === "inserter");
          return (
            <FuelLegRow key={it.key} row={it.row} vehicle={vehicle} isLast={isLast} isMobile={isMobile}/>
          );
        })}
      </div>

      {/* Totals footer */}
      <div style={{ padding: "12px 18px", borderTop: `1px solid ${T.border}`,
        background: T.surface2, display: "flex", alignItems: "center",
        justifyContent: "space-between", fontSize: 12, color: T.textMuted, flexWrap: "wrap", gap: 8 }}>
        <span>
          Total · <span style={{ color: T.text, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
            {totalDist.toFixed(totalDist % 1 === 0 ? 0 : 1)} {distUnit}
          </span>
          {" · ending at "}
          <span style={{ color: T.text, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
            {Math.max(0, sim.finalLevel).toFixed(1)}{unit} ({finalPct}%)
          </span>
        </span>
        {vehicle.cost?.perUnit > 0 && (
          <span style={{ fontVariantNumeric: "tabular-nums" }}>
            Fuel cost <strong style={{ color: T.text, fontWeight: 700 }}>{sym}{sim.totals.cost.toFixed(2)}</strong>
            {sim.totals.refuels > 0 && (
              <> · pump <strong style={{ color: "var(--accent)", fontWeight: 700 }}>{sym}{sim.totals.refuelCost.toFixed(2)}</strong>
                {costSavings != null && costSavings > 0.5 && (
                  <span style={{ color: "var(--accent)" }}> · {sym}{costSavings.toFixed(2)} less than auto</span>
                )}
              </>
            )}
          </span>
        )}
      </div>
    </section>
  );
}

// ─── Entry Card (exported) ────────────────────────────────────────────────────

export function FuelPlanEntryCard({ savedRoutes, savedDirections, vehiclesByDb, currentDbVehicles, fuelPlanState, onOpen, readOnly }) {
  const allVehicles = Object.values(vehiclesByDb ?? {}).flat();

  const carSegments = collectVehicleSegments("car", savedRoutes, savedDirections, allVehicles);
  const boatSegments = collectVehicleSegments("boat", savedRoutes, savedDirections, allVehicles);
  const allSegments = [...carSegments, ...boatSegments];

  if (!allSegments.length) return null;

  const driveCount = carSegments.reduce((s, seg) => s + seg.legs.length, 0);
  const passageCount = boatSegments.reduce((s, seg) => s + seg.legs.length, 0);

  let totalRefuels = 0;
  let totalCost = 0;
  let hasCostData = false;
  const firstRefuel = { label: null, dayNum: null };

  allSegments.forEach(({ vehicle, legs }) => {
    const startFuel = (fuelPlanState?.startingFuel ?? {})[vehicle.id] ?? defaultStartingFuel(vehicle);
    const pins = (fuelPlanState?.pinnedRefuels ?? {})[vehicle.id] ?? [];
    const sim = simulateFuelPlan(vehicle, legs, startFuel, pins);
    totalRefuels += sim.totals.refuels;
    if (vehicle.cost?.perUnit > 0) {
      totalCost += sim.totals.cost;
      hasCostData = true;
    }
    if (!firstRefuel.label && sim.totals.refuels > 0) {
      const refuelRow = sim.rows.find(r => r.kind === "refuel");
      if (refuelRow != null) {
        const legRow = sim.rows.find(r => r.kind === "leg" && r.legIdx === refuelRow.beforeLegIdx);
        if (legRow) {
          firstRefuel.label = legRow.leg.from || null;
          firstRefuel.dayNum = legRow.leg._dayNum ?? null;
        }
      }
    }
  });

  const sym = CURRENCY_SYM[allSegments[0]?.vehicle?.cost?.currency] || "$";

  return (
    <div style={{ padding: 16, borderRadius: 10, background: T.surface,
      border: `1px solid ${T.border}`, display: "flex", flexDirection: "column", gap: 12,
      position: "relative", overflow: "hidden" }}>
      {/* Accent strip */}
      <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: 3, background: "var(--accent)" }}/>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 4 }}>
        <div style={{ width: 32, height: 32, borderRadius: 8, background: T.accentSoft,
          color: "var(--accent)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <FuelPumpGlyph size={14}/>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 9.5, fontWeight: 600, letterSpacing: 1.5, color: T.textMuted, textTransform: "uppercase" }}>Fuel plan</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: T.text, letterSpacing: -0.1, marginTop: 1 }}>
            {[driveCount > 0 && `${driveCount} drive${driveCount !== 1 ? "s" : ""}`,
              passageCount > 0 && `${passageCount} passage${passageCount !== 1 ? "s" : ""}`]
              .filter(Boolean).join(" · ")}
          </div>
        </div>
      </div>

      {/* Stats row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 0,
        padding: "10px 0", borderTop: `1px solid ${T.borderSoft}`, borderBottom: `1px solid ${T.borderSoft}` }}>
        {[
          { label: "Vehicles", value: String(allSegments.length) },
          { label: "Refuels", value: String(totalRefuels), amber: totalRefuels > 0 },
          hasCostData && { label: "Cost", value: `${sym}${Math.round(totalCost)}`, accent: true },
        ].filter(Boolean).map(s => (
          <div key={s.label} style={{ textAlign: "left", padding: "0 6px" }}>
            <div style={{ fontSize: 9, fontWeight: 600, letterSpacing: 1.2, color: T.textMuted,
              textTransform: "uppercase", marginBottom: 2 }}>{s.label}</div>
            <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: -0.3, fontVariantNumeric: "tabular-nums",
              color: s.accent ? "var(--accent)" : s.amber ? T.amber : T.text }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Next refuel callout */}
      {totalRefuels > 0 && firstRefuel.label && (
        <div style={{ padding: "8px 10px", borderRadius: 6, background: T.accentSoft,
          display: "flex", alignItems: "center", gap: 8, fontSize: 11.5, color: T.text }}>
          <span style={{ color: "var(--accent)" }}>📍</span>
          <span>
            <span style={{ color: T.textMuted }}>Next refuel: </span>
            <span style={{ fontWeight: 600 }}>before {firstRefuel.label}</span>
            {firstRefuel.dayNum && <span style={{ color: T.textMuted }}> · Day {firstRefuel.dayNum}</span>}
          </span>
        </div>
      )}

      {/* CTA */}
      <button onClick={onOpen}
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "9px 12px", borderRadius: 7, background: T.text, color: T.bg, border: "none",
          fontSize: 12.5, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", letterSpacing: -0.05 }}>
        <span>Open fuel plan →</span>
        <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
          <path d="M3 2l4 3.5L3 9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>
    </div>
  );
}

// ─── Main FuelPlan Modal (default export) ────────────────────────────────────

export default function FuelPlan({ days, savedRoutes, savedDirections, vehiclesByDb, currentDbVehicles, startDate, fuelPlanState, onFuelPlanChange, onClose }) {
  const [activeMobileTab, setActiveMobileTab] = useState("car");
  const isMobile = typeof window !== "undefined" && window.innerWidth <= 640;

  const allVehicles = Object.values(vehiclesByDb ?? {}).flat();
  const carSegments = collectVehicleSegments("car", savedRoutes, savedDirections, allVehicles);
  const boatSegments = collectVehicleSegments("boat", savedRoutes, savedDirections, allVehicles);
  const allSegments = [...carSegments, ...boatSegments];

  // Summary stats
  let totalRoutes = 0, totalConsumedStr = "", totalRefuels = 0, totalCostNum = 0;
  let hasCostData = false;
  const consumedByUnit = {};
  allSegments.forEach(({ vehicle, legs }) => {
    const startFuel = (fuelPlanState?.startingFuel ?? {})[vehicle.id] ?? defaultStartingFuel(vehicle);
    const pins = (fuelPlanState?.pinnedRefuels ?? {})[vehicle.id] ?? [];
    const sim = simulateFuelPlan(vehicle, legs, startFuel, pins);
    totalRoutes += legs.length;
    totalRefuels += sim.totals.refuels;
    const u = vehicle.fuel.unit;
    consumedByUnit[u] = (consumedByUnit[u] ?? 0) + sim.totals.consumed;
    if (vehicle.cost?.perUnit > 0) { totalCostNum += sim.totals.cost; hasCostData = true; }
  });
  totalConsumedStr = Object.entries(consumedByUnit)
    .map(([u, v]) => `${v.toFixed(1)} ${u}`).join(" + ");
  const sym = CURRENCY_SYM[allSegments[0]?.vehicle?.cost?.currency] || "$";

  function updateStartingFuel(vehicleId, value) {
    onFuelPlanChange({
      ...fuelPlanState,
      startingFuel: { ...(fuelPlanState?.startingFuel ?? {}), [vehicleId]: value },
    });
  }

  function updatePinnedRefuels(vehicleId, pins) {
    onFuelPlanChange({
      ...fuelPlanState,
      pinnedRefuels: { ...(fuelPlanState?.pinnedRefuels ?? {}), [vehicleId]: pins },
    });
  }

  // Esc closes
  useEffect(() => {
    function onKey(e) { if (e.key === "Escape") onClose(); }
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  // Body scroll lock
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  const segmentsToShow = isMobile
    ? (activeMobileTab === "car" ? carSegments : boatSegments)
    : null;

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 960, background: T.bg,
      overflowY: "auto", fontFamily: T.font }}>
      <div style={{ maxWidth: 1240, margin: "0 auto", padding: isMobile ? "16px 16px 80px" : "48px 60px 80px" }}>

        {/* Breadcrumb */}
        <div style={{ fontSize: 12, color: T.textMuted, marginBottom: 14,
          display: "flex", alignItems: "center", gap: 6 }}>
          <button onClick={onClose}
            style={{ background: "none", border: "none", color: T.textMuted, cursor: "pointer",
              padding: 0, fontFamily: "inherit", fontSize: 12, display: "flex", alignItems: "center", gap: 4 }}>
            ← Back
          </button>
          <span style={{ color: T.textFaint }}>/</span>
          <span style={{ color: T.text, fontWeight: 600 }}>Fuel plan</span>
        </div>

        {/* Page header */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between",
          gap: 16, marginBottom: 8, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: 1.5, color: T.textMuted,
              textTransform: "uppercase", marginBottom: 6 }}>
              {totalRoutes} route{totalRoutes !== 1 ? "s" : ""} · {allSegments.length} vehicle{allSegments.length !== 1 ? "s" : ""}
            </div>
            <h1 style={{ fontSize: isMobile ? 26 : 32, fontWeight: 700, margin: 0, letterSpacing: -0.6 }}>
              Fuel plan
            </h1>
          </div>
          <button onClick={onClose} style={{ ...btn.primary }}>
            Save plan
          </button>
        </div>

        <p style={{ fontSize: 13, color: T.textMuted, marginBottom: 24, maxWidth: 720, lineHeight: 1.6 }}>
          Routes from this trip that have a vehicle attached, in chronological order. Adjust starting fuel, then add or move refuel stops. Cars and boats are tracked separately — you'll fill up in different places anyway.
        </p>

        {/* Trip-wide summary card */}
        {allSegments.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${isMobile ? 2 : 4}, 1fr)`, gap: 0,
            background: T.surface, border: `1px solid ${T.border}`, borderRadius: 14,
            overflow: "hidden", marginBottom: 28 }}>
            {[
              { label: "Routes covered", value: String(totalRoutes),
                sub: `${carSegments.reduce((s, x) => s + x.legs.length, 0)} drives · ${boatSegments.reduce((s, x) => s + x.legs.length, 0)} passages` },
              { label: "Total fuel", value: totalConsumedStr || "0", sub: "across all vehicles" },
              { label: "Refuel stops", value: String(totalRefuels),
                sub: totalRefuels > 0 ? "auto-inserted + manual" : "no top-ups needed",
                highlight: totalRefuels > 0 },
              hasCostData && { label: "Estimated cost", value: `${sym}${Math.round(totalCostNum)}`,
                sub: "fuel only", accent: true },
            ].filter(Boolean).map((s, idx, arr) => (
              <div key={s.label} style={{ padding: "16px 18px",
                borderRight: idx < arr.length - 1 ? `1px solid ${T.borderSoft}` : "none",
                background: s.accent ? T.accentSoft : "transparent" }}>
                <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: 1.5,
                  color: s.accent ? "var(--accent)" : T.textMuted, marginBottom: 6, textTransform: "uppercase" }}>
                  {s.label}
                </div>
                <div style={{ fontSize: isMobile ? 18 : 22, fontWeight: 700, letterSpacing: -0.4,
                  color: s.accent ? "var(--accent)" : s.highlight ? T.amber : T.text,
                  fontVariantNumeric: "tabular-nums" }}>
                  {s.value}
                </div>
                <div style={{ fontSize: 11, color: s.accent ? "var(--accent)" : T.textMuted, marginTop: 4 }}>
                  {s.sub}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Mobile tabs */}
        {isMobile && (carSegments.length > 0 || boatSegments.length > 0) && (
          <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
            {[
              carSegments.length > 0 && { id: "car", label: `🚗 Cars (${carSegments.length})` },
              boatSegments.length > 0 && { id: "boat", label: `⛵ Boats (${boatSegments.length})` },
            ].filter(Boolean).map(tab => (
              <button key={tab.id} onClick={() => setActiveMobileTab(tab.id)}
                style={{ flex: 1, padding: "10px 12px", borderRadius: 8, fontFamily: "inherit",
                  background: activeMobileTab === tab.id ? "var(--accent)" : T.surface2,
                  color: activeMobileTab === tab.id ? "#fff" : T.text,
                  border: `1px solid ${activeMobileTab === tab.id ? "transparent" : T.border}`,
                  fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                {tab.label}
              </button>
            ))}
          </div>
        )}

        {/* Cars section */}
        {(!isMobile || activeMobileTab === "car") && carSegments.length > 0 && (
          <div style={{ marginBottom: 36 }}>
            {!isMobile && (
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12,
                paddingBottom: 8, borderBottom: `1px solid ${T.borderSoft}` }}>
                <div style={{ width: 28, height: 28, borderRadius: 8, background: T.surface2,
                  border: `1px solid ${T.borderSoft}`, display: "flex", alignItems: "center",
                  justifyContent: "center", fontSize: 16 }}>🚗</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: T.text, letterSpacing: -0.3 }}>Cars</div>
                <div style={{ fontSize: 12, color: T.textMuted }}>
                  {carSegments.reduce((s, x) => s + x.legs.length, 0)} drives
                </div>
              </div>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              {carSegments.map(({ vehicle, legs }) => (
                <VehicleFuelPlan key={vehicle.id}
                  vehicle={vehicle} legs={legs}
                  startingFuel={(fuelPlanState?.startingFuel ?? {})[vehicle.id] ?? defaultStartingFuel(vehicle)}
                  pinnedRefuels={(fuelPlanState?.pinnedRefuels ?? {})[vehicle.id] ?? []}
                  onStartingFuelChange={v => updateStartingFuel(vehicle.id, v)}
                  onPinChange={pins => updatePinnedRefuels(vehicle.id, pins)}
                  isMobile={isMobile}/>
              ))}
            </div>
          </div>
        )}

        {/* Boats section */}
        {(!isMobile || activeMobileTab === "boat") && boatSegments.length > 0 && (
          <div style={{ marginBottom: 24 }}>
            {!isMobile && (
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12,
                paddingBottom: 8, borderBottom: `1px solid ${T.borderSoft}` }}>
                <div style={{ width: 28, height: 28, borderRadius: 8, background: T.surface2,
                  border: `1px solid ${T.borderSoft}`, display: "flex", alignItems: "center",
                  justifyContent: "center", fontSize: 16 }}>⛵</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: T.text, letterSpacing: -0.3 }}>Boats</div>
                <div style={{ fontSize: 12, color: T.textMuted }}>
                  {boatSegments.reduce((s, x) => s + x.legs.length, 0)} passages
                </div>
              </div>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              {boatSegments.map(({ vehicle, legs }) => (
                <VehicleFuelPlan key={vehicle.id}
                  vehicle={vehicle} legs={legs}
                  startingFuel={(fuelPlanState?.startingFuel ?? {})[vehicle.id] ?? defaultStartingFuel(vehicle)}
                  pinnedRefuels={(fuelPlanState?.pinnedRefuels ?? {})[vehicle.id] ?? []}
                  onStartingFuelChange={v => updateStartingFuel(vehicle.id, v)}
                  onPinChange={pins => updatePinnedRefuels(vehicle.id, pins)}
                  isMobile={isMobile}/>
              ))}
            </div>
          </div>
        )}

        {/* Footnote */}
        <div style={{ marginTop: 24, padding: "14px 18px", borderRadius: 10,
          background: T.surface2, border: `1px solid ${T.borderSoft}`,
          fontSize: 11.5, color: T.textMuted, lineHeight: 1.6 }}>
          <strong style={{ color: T.text, fontWeight: 600 }}>How this works:</strong>{" "}
          Car consumption uses saved MPG. Boat consumption uses interpolated GPH at target speed.
          Refuel stops are auto-suggested when the trajectory would dip below the vehicle's reserve.
          Move or edit a refuel to pin it — the planner respects your placement.
          Downstream legs recompute live.
        </div>
      </div>
    </div>
  );
}
