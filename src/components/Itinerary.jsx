import { useState } from "react";
import { days, tagConfig, fuelStops, fuelSummary, tideWarnings } from "../data/itinerary.js";

export default function Itinerary() {
  const [openDay, setOpenDay] = useState(1);
  const [activeTab, setActiveTab] = useState("itinerary");

  const totalNM  = days.reduce((s, d) => s + d.nm, 0);
  const underway = days.filter(d => d.nm > 0).length;
  const layovers = days.filter(d => d.nm === 0).length;

  return (
    <div style={{ fontFamily: "Georgia, 'Times New Roman', serif", background: "#0b1929", minHeight: "100vh", color: "#e8dcc8" }}>

      {/* ── HEADER ── */}
      <div style={{ background: "linear-gradient(135deg,#0b1929 0%,#112a44 50%,#0b1929 100%)", borderBottom: "1px solid #c9a84c33", padding: "2.5rem 2rem 2rem" }}>
        <div style={{ maxWidth: 820, margin: "0 auto" }}>
          <div style={{ fontSize: ".7rem", letterSpacing: ".25em", color: "#c9a84c", textTransform: "uppercase", marginBottom: ".5rem" }}>
            Pacific Northwest Cruise · July · 17 Days
          </div>
          <h1 style={{ fontSize: "clamp(1.6rem,4vw,2.4rem)", fontWeight: 400, color: "#f5edd8", margin: "0 0 .4rem", letterSpacing: "-.02em", lineHeight: 1.15 }}>
            Seattle to the Broughton Islands
          </h1>
          <p style={{ color: "#9ab8d4", margin: "0 0 1.5rem", fontSize: ".95rem", fontStyle: "italic" }}>
            Princess Louisa Inlet · Vancouver · Salt Spring · Desolation Sound · Johnstone Strait · Broughtons · Gulf Islands
          </p>

          {/* Stats */}
          <div style={{ display: "flex", gap: "2rem", flexWrap: "wrap", marginBottom: "1.25rem" }}>
            {[
              { label: "Total Distance", val: `${totalNM} NM` },
              { label: "Underway Days",  val: String(underway)  },
              { label: "Layover Days",   val: String(layovers)  },
              { label: "Fuel Stops",     val: "4"               },
            ].map(s => (
              <div key={s.label}>
                <div style={{ fontSize: "1.3rem", color: "#c9a84c" }}>{s.val}</div>
                <div style={{ fontSize: ".7rem", color: "#6b8fa8", letterSpacing: ".1em", textTransform: "uppercase" }}>{s.label}</div>
              </div>
            ))}
          </div>

          {/* Day-strip */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center" }}>
            {days.map(d => {
              const lay  = d.nm === 0;
              const fuel = d.fuelStop;
              const tide = d.tideWarning;
              const bg   = tide ? "#5c1a1a" : fuel ? "#5c3010" : lay ? "#1a3d1a" : "#1e3a52";
              const col  = tide ? "#e87878" : fuel ? "#e8a838" : lay ? "#5cb85c" : "#6b8fa8";
              return (
                <div key={d.day}
                  onClick={() => { setOpenDay(d.day); setActiveTab("itinerary"); }}
                  title={d.leg}
                  style={{ width:32, height:32, borderRadius:4, background:bg, display:"flex", alignItems:"center", justifyContent:"center",
                    fontSize:".6rem", color:col, cursor:"pointer", fontFamily:"sans-serif",
                    border: openDay === d.day ? "1px solid #c9a84c" : "1px solid transparent" }}>
                  D{d.day}
                </div>
              );
            })}
            <div style={{ display:"flex", gap:10, marginLeft:8, flexWrap:"wrap", alignItems:"center" }}>
              {[["#1e3a52","#6b8fa8","Underway"],["#1a3d1a","#5cb85c","Layover"],["#5c3010","#e8a838","⛽ Fuel"],["#5c1a1a","#e87878","⚠ Tides"]].map(([bg,col,lbl])=>(
                <div key={lbl} style={{ display:"flex", alignItems:"center", gap:4 }}>
                  <div style={{ width:10, height:10, borderRadius:2, background:bg, border:`1px solid ${col}` }}/>
                  <span style={{ fontSize:".62rem", color:col, fontFamily:"sans-serif" }}>{lbl}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── TABS ── */}
      <div style={{ borderBottom:"1px solid #1e3a5240", background:"#0d1f33" }}>
        <div style={{ maxWidth:820, margin:"0 auto", display:"flex" }}>
          {[["itinerary","Day by Day"],["fuel","Fuel Plan"],["tides","Tide Warnings"]].map(([t,lbl])=>(
            <button key={t} onClick={()=>setActiveTab(t)} style={{
              background:"none", border:"none",
              borderBottom: activeTab===t ? "2px solid #c9a84c" : "2px solid transparent",
              color: activeTab===t ? "#c9a84c" : "#6b8fa8",
              padding:".85rem 1.5rem", fontSize:".78rem", letterSpacing:".12em",
              textTransform:"uppercase", cursor:"pointer" }}>
              {lbl}
            </button>
          ))}
        </div>
      </div>

      <div style={{ maxWidth:820, margin:"0 auto", padding:"1.5rem 1rem 3rem" }}>

        {/* ── ITINERARY TAB ── */}
        {activeTab === "itinerary" && days.map(d => {
          const isOpen    = openDay === d.day;
          const isLayover = d.nm === 0;
          return (
            <div key={d.day} style={{
              marginBottom:".5rem",
              border: isOpen ? "1px solid #c9a84c55" : "1px solid #1e3a5260",
              borderRadius:6, background: isOpen ? "#0d2035" : "#0b1929", overflow:"hidden" }}>

              {/* Row */}
              <button onClick={()=>setOpenDay(isOpen ? null : d.day)} style={{
                width:"100%", background:"none", border:"none", padding:"1rem 1.25rem",
                cursor:"pointer", display:"flex", alignItems:"center", gap:"1rem", textAlign:"left" }}>
                <div style={{
                  minWidth:38, height:38, borderRadius:"50%",
                  background: isOpen ? "#c9a84c" : "#1a3352",
                  color: isOpen ? "#0b1929" : "#c9a84c",
                  display:"flex", alignItems:"center", justifyContent:"center",
                  fontSize:".75rem", fontWeight:700, flexShrink:0 }}>
                  {d.day}
                </div>
                <div style={{ flex:1 }}>
                  <div style={{ color: isOpen ? "#f5edd8" : "#c8daea", fontSize:".95rem", lineHeight:1.3 }}>
                    {d.leg}
                    {d.fuelStop    && <span style={{ marginLeft:8,  background:"#e8553822", color:"#e87758", fontSize:".63rem", padding:"2px 7px", borderRadius:10, fontFamily:"sans-serif", verticalAlign:"middle" }}>⛽ {d.fuelLabel}</span>}
                    {d.tideWarning && <span style={{ marginLeft:6,  background:"#dc354522", color:"#f87878", fontSize:".63rem", padding:"2px 7px", borderRadius:10, fontFamily:"sans-serif", verticalAlign:"middle" }}>⚠ Tide Critical</span>}
                    {d.tags.includes("combined-leg") && <span style={{ marginLeft:6, background:"#20c99722", color:"#20c997", fontSize:".63rem", padding:"2px 7px", borderRadius:10, fontFamily:"sans-serif", verticalAlign:"middle" }}>Combined</span>}
                  </div>
                  <div style={{ color:"#4e7a9e", fontSize:".75rem", marginTop:2, fontFamily:"sans-serif" }}>
                    {isLayover ? "Layover" : `${d.nm} NM · ~${d.hrs.toFixed(1)} hrs @ 15 kts`}
                    {" · "}
                    <span style={{ fontStyle:"italic", color:"#3d6680" }}>{d.overnight}</span>
                  </div>
                </div>
                <div style={{ color:"#4e7a9e", transform: isOpen ? "rotate(180deg)" : "none" }}>▾</div>
              </button>

              {/* Expanded */}
              {isOpen && (
                <div style={{ padding:"0 1.25rem 1.25rem", borderTop:"1px solid #1e3a5240" }}>
                  {/* Tags */}
                  <div style={{ display:"flex", flexWrap:"wrap", gap:6, margin:".85rem 0 1rem" }}>
                    {d.tags.filter(t=>tagConfig[t]).map(t => {
                      const c = tagConfig[t];
                      return <span key={t} style={{ fontSize:".63rem", padding:"3px 9px", borderRadius:12,
                        background:c.color+"22", color:c.color, border:`1px solid ${c.color}44`,
                        letterSpacing:".07em", fontFamily:"sans-serif", textTransform:"uppercase" }}>{c.label}</span>;
                    })}
                  </div>
                  {/* Highlights */}
                  <ul style={{ margin:0, padding:0, listStyle:"none" }}>
                    {d.highlights.map((h,i) => (
                      <li key={i} style={{ display:"flex", gap:".75rem", marginBottom:".55rem",
                        fontSize:".875rem", lineHeight:1.5, color:"#b8cfe0", fontFamily:"sans-serif" }}>
                        <span style={{ color:"#c9a84c", flexShrink:0, marginTop:2 }}>◆</span>
                        <span>{h}</span>
                      </li>
                    ))}
                  </ul>
                  {/* Captain's note */}
                  {d.note && (
                    <div style={{ marginTop:"1rem", padding:".75rem 1rem", background:"#0a1a2a",
                      borderLeft:"3px solid #c9a84c66", borderRadius:"0 4px 4px 0" }}>
                      <div style={{ fontSize:".62rem", color:"#c9a84c", letterSpacing:".1em", textTransform:"uppercase", marginBottom:4, fontFamily:"sans-serif" }}>Captain's Note</div>
                      <div style={{ fontSize:".82rem", color:"#8fb0cc", fontFamily:"sans-serif", lineHeight:1.55 }}>{d.note}</div>
                    </div>
                  )}
                  {/* Tide warning */}
                  {d.tideWarning && d.tideNote && (
                    <div style={{ marginTop:".75rem", padding:".75rem 1rem", background:"#1a0a0a",
                      borderLeft:"3px solid #dc3545", borderRadius:"0 4px 4px 0" }}>
                      <div style={{ fontSize:".62rem", color:"#e87878", letterSpacing:".1em", textTransform:"uppercase", marginBottom:4, fontFamily:"sans-serif" }}>⚠ Tide Warning</div>
                      <div style={{ fontSize:".82rem", color:"#cc8888", fontFamily:"sans-serif", lineHeight:1.55 }}>{d.tideNote}</div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {/* ── FUEL TAB ── */}
        {activeTab === "fuel" && (
          <div>
            <div style={{ marginBottom:"1.5rem", padding:"1.25rem", background:"#0d2035", border:"1px solid #1e3a52", borderRadius:6 }}>
              <div style={{ fontSize:".7rem", color:"#c9a84c", letterSpacing:".15em", textTransform:"uppercase", marginBottom:"1rem", fontFamily:"sans-serif" }}>Fuel Plan Summary</div>
              {fuelSummary.map(f => (
                <div key={f.label} style={{ display:"flex", justifyContent:"space-between", padding:".6rem 0", borderBottom:"1px solid #1e3a5240", fontFamily:"sans-serif" }}>
                  <span style={{ fontSize:".85rem", color:"#6b8fa8" }}>{f.label}</span>
                  <span style={{ fontSize:".85rem", color:"#e8dcc8" }}>{f.value}</span>
                </div>
              ))}
            </div>
            <div style={{ padding:"1.25rem", background:"#0d2035", border:"1px solid #e8553844", borderRadius:6, marginBottom:"1rem" }}>
              <div style={{ fontSize:".7rem", color:"#e87758", letterSpacing:".15em", textTransform:"uppercase", marginBottom:".75rem", fontFamily:"sans-serif" }}>⛽ Fuel Stop Details</div>
              {fuelStops.map(s => (
                <div key={s.stop} style={{ marginBottom:"1.25rem", paddingBottom:"1.25rem", borderBottom:"1px solid #1e3a5230" }}>
                  <div style={{ fontSize:".9rem", color:"#e8dcc8", fontFamily:"Georgia,serif", marginBottom:4 }}>{s.stop}</div>
                  <div style={{ fontSize:".8rem", color:"#9ab8d4", fontFamily:"sans-serif", marginBottom:3 }}>{s.marina}</div>
                  <div style={{ fontSize:".75rem", color:"#6b8fa8", fontFamily:"sans-serif", marginBottom:6 }}>VHF: {s.vhf}</div>
                  <div style={{ fontSize:".8rem", color:"#7a9ab8", fontFamily:"sans-serif", fontStyle:"italic" }}>{s.notes}</div>
                </div>
              ))}
            </div>
            <div style={{ padding:".85rem 1rem", background:"#0a1a2a", border:"1px solid #c9a84c33", borderRadius:6, fontSize:".8rem", color:"#8fb0cc", fontFamily:"sans-serif", lineHeight:1.6 }}>
              <strong style={{ color:"#c9a84c" }}>Note:</strong> All calculations assume 15 kts / 33 gal·hr. Running at 20 kts increases consumption ~50–70%. Maintain a 15–20% reserve minimum. Fuel Stop #4 at Victoria on Day 17 is easy insurance — you're stopping there for lunch anyway.
            </div>
          </div>
        )}

        {/* ── TIDES TAB ── */}
        {activeTab === "tides" && (
          <div>
            <div style={{ padding:".85rem 1rem", background:"#1a0a0a", border:"1px solid #dc354566", borderRadius:6, marginBottom:"1.25rem", fontSize:".82rem", color:"#cc8888", fontFamily:"sans-serif", lineHeight:1.6 }}>
              <strong style={{ color:"#e87878" }}>Critical:</strong> This route has two non-negotiable tidal rapids (Malibu and Seymour) and one high-traffic channel (Active Pass). Plan exact passage times the night before using official CHS tables. Cross-check with at least two sources.
            </div>
            {tideWarnings.map(t => (
              <div key={t.passage} style={{ marginBottom:".75rem", padding:"1.1rem 1.25rem", background:"#0d2035", border:"1px solid #dc354533", borderRadius:6 }}>
                <div style={{ fontSize:".9rem", color:"#f5edd8", fontFamily:"Georgia,serif", marginBottom:".4rem" }}>{t.passage}</div>
                <div style={{ fontSize:".82rem", color:"#9ab8d4", fontFamily:"sans-serif", lineHeight:1.55 }}>{t.detail}</div>
              </div>
            ))}
            <div style={{ marginTop:"1.5rem", padding:"1.25rem", background:"#0d2035", border:"1px solid #1e3a52", borderRadius:6 }}>
              <div style={{ fontSize:".7rem", color:"#c9a84c", letterSpacing:".15em", textTransform:"uppercase", marginBottom:".85rem", fontFamily:"sans-serif" }}>Apps & Resources</div>
              {[
                ["Navionics Boating App",      "Best all-in-one: charts, tides, ActiveCaptain community notes"],
                ["XTide / Tides Near Me",       "Precise slack water timing for BC passages"],
                ["tides.gc.ca (CHS)",           "Official Canadian Hydrographic Service tide predictions"],
                ["PredictWind or SailFlow",     "Weather routing — critical for Johnstone Strait & Haro Strait"],
                ["VHF Channel 16",              "Monitor at all times underway; 66A for BC marinas"],
                ["CBP ROAM App (US Customs)",   "Required for US re-entry — register all passengers before departure"],
              ].map(([tool,desc]) => (
                <div key={tool} style={{ display:"flex", gap:".75rem", marginBottom:".7rem", fontFamily:"sans-serif" }}>
                  <span style={{ color:"#c9a84c", flexShrink:0, marginTop:2 }}>◆</span>
                  <div>
                    <div style={{ fontSize:".85rem", color:"#e8dcc8" }}>{tool}</div>
                    <div style={{ fontSize:".78rem", color:"#6b8fa8", marginTop:1 }}>{desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
