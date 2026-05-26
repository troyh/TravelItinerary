import { useState, useEffect, useRef, createContext, useContext } from "react";
import { testConnection, inferRepo } from "../lib/github.js";
import { CLAUDE_MODELS } from "../lib/claude.js";

// ── Design tokens ────────────────────────────────────────────────────────────
const T = {
  text: "#0e1014", textMuted: "#5c6470", textFaint: "#9ba1ac",
  accent: "#0b3d6b", accentSoft: "#e8f1f9", amber: "#f5b544",
  bg: "#ffffff", surface: "#ffffff", surface2: "#f8f9fb",
  border: "#e2e5ea", borderSoft: "#1e3a5220",
};

const MobileCtx = createContext(false);

// ── Sections ─────────────────────────────────────────────────────────────────
const SECTIONS = [
  { id: "maps",      label: "Maps & navigation", num: "01" },
  { id: "flights",   label: "Flights",           num: "02" },
  { id: "claude",    label: "Claude",            num: "03" },
  { id: "databases", label: "Databases",         num: "04" },
  { id: "about",     label: "About",             num: "05" },
];

// ── Helper ───────────────────────────────────────────────────────────────────
function inferKeyStatus(key, validator) {
  if (!key) return null;
  return validator(key) ? "connected" : "issue";
}

// ── Primitives ────────────────────────────────────────────────────────────────

function StatusDot({ status }) {
  const map = {
    connected: { color: "#22A06B", label: "Connected", shadow: "0 0 0 3px #22A06B33" },
    issue:     { color: T.amber,   label: "Issue detected", shadow: "none" },
    testing:   { color: T.textFaint, label: "Testing…", shadow: "none" },
  };
  const cfg = map[status] ?? { color: T.textFaint, label: "Not configured", shadow: "none" };
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6,
      fontSize: 11, fontWeight: 600, color: T.textMuted }}>
      <span style={{ width: 7, height: 7, borderRadius: 4, background: cfg.color,
        boxShadow: cfg.shadow, display: "inline-block", flexShrink: 0 }} />
      {cfg.label}
    </span>
  );
}

function Seg({ options, value, onChange, fullWidth }) {
  const mobile = useContext(MobileCtx);
  const fw = fullWidth || mobile;
  return (
    <div style={{ display: "inline-flex", padding: 3, borderRadius: 8,
      background: T.surface2, border: `1px solid ${T.border}`,
      width: fw ? "100%" : "auto" }}>
      {options.map(opt => {
        const selected = opt.value === value;
        return (
          <button key={opt.value} onClick={() => onChange(opt.value)}
            style={{ padding: "7px 14px", borderRadius: 6, border: "none", cursor: "pointer",
              fontFamily: "inherit", fontSize: 12.5,
              background: selected ? T.bg : "transparent",
              color: selected ? T.text : T.textMuted,
              fontWeight: selected ? 600 : 400,
              boxShadow: selected ? "0 1px 3px rgba(0,0,0,0.06)" : "none",
              flex: fw ? 1 : "none",
            }}>
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function KeyInput({ value, onChange, defaultMasked = true, placeholder, status }) {
  const [masked, setMasked] = useState(defaultMasked);
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    if (!value) return;
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  }

  const monoFont = "ui-monospace, SFMono-Regular, Menlo, monospace";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", gap: 6 }}>
        <input
          type={masked ? "password" : "text"}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          style={{ flex: 1, fontFamily: monoFont, fontSize: 12.5,
            padding: "11px 14px", borderRadius: 8, border: `1px solid ${T.border}`,
            background: T.bg, outline: "none", color: T.text, boxSizing: "border-box" }}
        />
        <button onClick={() => setMasked(p => !p)}
          style={{ padding: "0 14px", background: T.surface2, border: `1px solid ${T.border}`,
            borderRadius: 8, fontSize: 12, fontWeight: 500, cursor: "pointer",
            fontFamily: "inherit", color: T.textMuted, flexShrink: 0 }}>
          {masked ? "Show" : "Hide"}
        </button>
        <button onClick={handleCopy}
          style={{ padding: "0 12px", background: T.surface2, border: `1px solid ${T.border}`,
            borderRadius: 8, fontSize: 12, cursor: "pointer", color: T.textMuted,
            flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}
          title="Copy">
          {copied ? "✓" : (
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
              <rect x="3.5" y="3.5" width="6.5" height="6.5" rx="1"
                stroke="currentColor" strokeWidth="1.2"/>
              <path d="M3 8H2a1 1 0 01-1-1V2a1 1 0 011-1h5a1 1 0 011 1v1"
                stroke="currentColor" strokeWidth="1.2"/>
            </svg>
          )}
        </button>
      </div>
      <StatusDot status={status} />
    </div>
  );
}

function FieldLabel({ children, optional }) {
  return (
    <div style={{ fontSize: 10.5, fontWeight: 600, color: T.textMuted,
      letterSpacing: 1.4, textTransform: "uppercase", marginBottom: 6,
      display: "flex", alignItems: "center", gap: 7 }}>
      {children}
      {optional && (
        <span style={{ fontSize: 10, fontWeight: 500, color: T.textFaint,
          textTransform: "none", letterSpacing: 0,
          background: T.surface2, border: `1px solid ${T.border}`,
          borderRadius: 4, padding: "1px 6px" }}>
          optional
        </span>
      )}
    </div>
  );
}

function FieldHint({ children }) {
  return (
    <div style={{ fontSize: 11.5, color: T.textMuted, marginTop: 6, lineHeight: 1.5 }}>
      {children}
    </div>
  );
}

function Field({ label, optional, hint, children }) {
  return (
    <div>
      {label && <FieldLabel optional={optional}>{label}</FieldLabel>}
      {children}
      {hint && <FieldHint>{hint}</FieldHint>}
    </div>
  );
}

function Card({ id, eyebrow, title, action, children, danger }) {
  const mobile = useContext(MobileCtx);
  const headerBg = danger ? "rgba(184,74,46,0.06)" : T.bg;
  const eyebrowColor = danger ? "#B84A2E" : T.textFaint;
  const titleColor = danger ? "#B84A2E" : T.text;
  if (mobile) {
    return (
      <div id={`settings-${id}`} style={{ marginBottom: 28 }}>
        <div style={{ padding: "0 16px 8px", display: "flex", alignItems: "center", gap: 8 }}>
          {eyebrow && (
            <div style={{ fontSize: 9.5, fontWeight: 600, letterSpacing: 1.4,
              color: eyebrowColor, textTransform: "uppercase" }}>
              {eyebrow}
            </div>
          )}
          <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: 0.8,
            color: titleColor, textTransform: "uppercase" }}>
            {title}
          </div>
          {action && <div style={{ marginLeft: "auto" }}>{action}</div>}
        </div>
        <div style={{ margin: "0 14px", padding: "14px 16px", borderRadius: 14,
          background: T.surface, border: `1px solid ${T.border}`,
          display: "flex", flexDirection: "column", gap: 18 }}>
          {children}
        </div>
      </div>
    );
  }
  return (
    <div id={`settings-${id}`} style={{ borderRadius: 12, border: `1px solid ${T.border}`,
      overflow: "hidden" }}>
      <div style={{ padding: "18px 24px 16px", borderBottom: `1px solid ${T.borderSoft}`,
        display: "flex", alignItems: "flex-end", gap: 16, background: headerBg }}>
        <div style={{ flex: 1 }}>
          {eyebrow && (
            <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: 1.5,
              color: eyebrowColor, textTransform: "uppercase", marginBottom: 4 }}>
              {eyebrow}
            </div>
          )}
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600, letterSpacing: -0.2,
            color: titleColor, fontFamily: "inherit" }}>
            {title}
          </h2>
        </div>
        {action && <div style={{ flexShrink: 0 }}>{action}</div>}
      </div>
      <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 22,
        background: T.surface }}>
        {children}
      </div>
    </div>
  );
}

function LeftNav({ activeSection, onNav }) {
  return (
    <div style={{ position: "sticky", top: 24, alignSelf: "flex-start", width: 220 }}>
      <div style={{ fontSize: 10, letterSpacing: 1.5, color: T.textFaint,
        textTransform: "uppercase", padding: "4px 12px 10px", fontWeight: 600 }}>
        Settings
      </div>
      {SECTIONS.map(s => {
        const active = s.id === activeSection;
        return (
          <button key={s.id} onClick={() => onNav(s.id)}
            style={{ display: "flex", alignItems: "center", gap: 10,
              padding: "8px 12px", borderRadius: 7, width: "100%",
              background: active ? T.surface2 : "transparent",
              border: active ? `1px solid ${T.border}` : "1px solid transparent",
              color: active ? T.text : T.textMuted,
              fontWeight: active ? 600 : 500,
              cursor: "pointer", fontFamily: "inherit", fontSize: 13,
              textAlign: "left", marginBottom: 2 }}>
            <span style={{ fontSize: 10, color: T.textFaint, fontWeight: 500,
              letterSpacing: 0.5, flexShrink: 0 }}>
              {s.num}
            </span>
            {s.label}
          </button>
        );
      })}
    </div>
  );
}

// ── DbForm ────────────────────────────────────────────────────────────────────
function DbForm({ db, inferredRepo, onSave, onCancel }) {
  const [d, setD] = useState({
    label:        db?.label        ?? "",
    githubToken:  db?.githubToken  ?? "",
    githubRepo:   db?.githubRepo   ?? "",
    githubBranch: db?.githubBranch ?? "",
  });
  const [showToken,  setShowToken]  = useState(false);
  const [testStatus, setTestStatus] = useState("");
  const set = (k, v) => setD(p => ({ ...p, [k]: v }));
  const effectiveRepo = d.githubRepo || inferredRepo || "";
  const monoFont = "ui-monospace, SFMono-Regular, Menlo, monospace";

  const inputStyle = {
    padding: "10px 13px", borderRadius: 8, border: `1px solid ${T.border}`,
    background: T.bg, fontSize: 13, fontFamily: "inherit", outline: "none",
    boxSizing: "border-box", width: "100%", color: T.text,
  };

  async function handleTest() {
    setTestStatus("testing");
    try {
      await testConnection({ githubToken: d.githubToken, githubRepo: effectiveRepo });
      setTestStatus("ok");
    } catch (e) { setTestStatus(e.message); }
  }

  const btnBase = {
    padding: "8px 14px", borderRadius: 7, fontSize: 12, fontWeight: 500,
    cursor: "pointer", fontFamily: "inherit", border: `1px solid ${T.border}`,
  };

  return (
    <div style={{ padding: 20, background: T.surface2, borderRadius: 10,
      border: `1px solid ${T.border}`, display: "flex", flexDirection: "column", gap: 16 }}>
      <Field label="Label">
        <input value={d.label} onChange={e => set("label", e.target.value)}
          placeholder="e.g. Personal" style={inputStyle} autoFocus />
      </Field>
      <Field label="GitHub Personal Access Token">
        <div style={{ display: "flex", gap: 6 }}>
          <input value={d.githubToken} onChange={e => set("githubToken", e.target.value)}
            type={showToken ? "text" : "password"} placeholder="ghp_…"
            style={{ ...inputStyle, flex: 1, fontFamily: monoFont, fontSize: 12.5 }} />
          <button onClick={() => setShowToken(p => !p)}
            style={{ ...btnBase, background: T.surface2, color: T.textMuted, flexShrink: 0 }}>
            {showToken ? "Hide" : "Show"}
          </button>
        </div>
      </Field>
      <Field label="Repository" optional>
        <input value={d.githubRepo} onChange={e => set("githubRepo", e.target.value)}
          placeholder={inferredRepo || "owner/repo"} style={inputStyle} />
      </Field>
      <Field label="Branch" optional>
        <input value={d.githubBranch} onChange={e => set("githubBranch", e.target.value)}
          placeholder="data" style={inputStyle} />
      </Field>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        {testStatus && testStatus !== "testing" && (
          <span style={{ fontSize: 12, fontFamily: "inherit",
            color: testStatus === "ok" ? "#22A06B" : "#dc2626", fontWeight: 500 }}>
            {testStatus === "ok" ? "✓ Connected" : testStatus}
          </span>
        )}
        <button onClick={handleTest}
          disabled={!d.githubToken || !effectiveRepo || testStatus === "testing"}
          style={{ ...btnBase, background: T.surface2, color: T.textMuted,
            opacity: (!d.githubToken || !effectiveRepo) ? 0.45 : 1 }}>
          {testStatus === "testing" ? "Testing…" : "Test connection"}
        </button>
        <button onClick={() => onSave(d)} disabled={!d.label.trim()}
          style={{ ...btnBase, background: T.accent, border: `1px solid ${T.accent}`,
            color: "#fff", fontWeight: 600, opacity: !d.label.trim() ? 0.45 : 1 }}>
          Save
        </button>
        <button onClick={onCancel}
          style={{ ...btnBase, background: "transparent", color: T.textMuted }}>
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function Settings({ settings, onSave, onClose }) {
  const inferredRepo = inferRepo();
  const [activeSection, setActiveSection] = useState("maps");
  const scrollRef = useRef(null);
  const [isMobile, setIsMobile] = useState(() => window.innerWidth <= 640);
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth <= 640);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);

  // ── Draft state ─────────────────────────────────────────────────────────────
  const [draft, setDraft] = useState({
    mapsProvider:     settings.mapsProvider     ?? "google",
    googleMapsKey:    settings.googleMapsKey    ?? "",
    appleMapKitToken: settings.appleMapKitToken ?? "",
    aeroDataBoxKey:   settings.aeroDataBoxKey   ?? "",
    anthropicKey:     settings.anthropicKey     ?? "",
    claudeModel:      settings.claudeModel      ?? "claude-sonnet-4-6",
    distanceUnit:     settings.distanceUnit     ?? "km",
    routeServerUrl:   settings.routeServerUrl   ?? "",
  });
  const set = (k, v) => setDraft(p => ({ ...p, [k]: v }));

  // ── Databases ───────────────────────────────────────────────────────────────
  const [dbs, setDbs] = useState(() => settings.databases ?? []);
  const [editingDbId, setEditingDbId] = useState(
    () => (settings.databases ?? []).length === 0 && inferRepo() ? "new" : null
  );

  function saveDb(formData) {
    if (editingDbId === "new") {
      setDbs(prev => [...prev, { id: crypto.randomUUID(), ...formData }]);
    } else {
      setDbs(prev => prev.map(db => db.id === editingDbId ? { ...db, ...formData } : db));
    }
    setEditingDbId(null);
  }

  function deleteDb(id) {
    setDbs(prev => prev.filter(db => db.id !== id));
    if (editingDbId === id) setEditingDbId(null);
  }

  // ── Auto-save ───────────────────────────────────────────────────────────────
  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) { isFirstRender.current = false; return; }
    onSave({
      ...settings,
      mapsProvider:     draft.mapsProvider,
      googleMapsKey:    draft.googleMapsKey,
      appleMapKitToken: draft.appleMapKitToken,
      aeroDataBoxKey:   draft.aeroDataBoxKey,
      anthropicKey:     draft.anthropicKey,
      claudeModel:      draft.claudeModel,
      distanceUnit:     draft.distanceUnit,
      routeServerUrl:   draft.routeServerUrl,
      databases:        dbs,
      githubToken:  undefined,
      githubRepo:   undefined,
      githubBranch: undefined,
    });
  }, [draft, dbs]);

  // ── Scroll tracking ─────────────────────────────────────────────────────────
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const threshold = window.innerHeight * 0.35;
      let active = SECTIONS[0].id;
      for (const s of SECTIONS) {
        const sEl = document.getElementById(`settings-${s.id}`);
        if (sEl && sEl.getBoundingClientRect().top <= threshold) active = s.id;
      }
      setActiveSection(active);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  // ── Esc to close ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const handler = e => { if (e.key === "Escape") { e.preventDefault(); onClose(); } };
    document.addEventListener("keydown", handler, true);
    return () => document.removeEventListener("keydown", handler, true);
  }, [onClose]);

  // ── Body scroll lock ─────────────────────────────────────────────────────────
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  function navTo(id) {
    setActiveSection(id);
    const el = document.getElementById(`settings-${id}`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // ── Status computations ─────────────────────────────────────────────────────
  const mapkitStatus    = inferKeyStatus(draft.appleMapKitToken, k => k.startsWith("eyJ"));
  const googleStatus    = inferKeyStatus(draft.googleMapsKey, k => k.startsWith("AIza") && k.length > 20);
  const aeroStatus      = inferKeyStatus(draft.aeroDataBoxKey, k => k.length > 20);
  const anthropicStatus = inferKeyStatus(draft.anthropicKey, k => k.startsWith("sk-ant-"));
  const routeServerStatus = draft.routeServerUrl
    ? (draft.routeServerUrl.startsWith("http") ? "connected" : "issue")
    : null;
  const mapsCardStatus = draft.mapsProvider === "apple" ? mapkitStatus : googleStatus;

  const monoFont = "ui-monospace, SFMono-Regular, Menlo, monospace";

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <MobileCtx.Provider value={isMobile}>
    <div style={{ position: "fixed", inset: 0, zIndex: 1050, background: T.bg,
      display: "flex", flexDirection: "column", fontFamily: "inherit" }}>

      {/* Top bar */}
      <div style={{
        flexShrink: 0, borderBottom: `1px solid ${T.border}`,
        display: "grid", gridTemplateColumns: isMobile ? "72px 1fr 72px" : "1fr auto",
        alignItems: "center", gap: 8,
        padding: isMobile ? "max(52px,12px) 8px 12px" : "0 24px",
        height: isMobile ? "auto" : 52,
        background: T.bg,
      }}>
        {isMobile && (
          <button onClick={onClose} style={{
            display: "inline-flex", alignItems: "center", gap: 2,
            background: "none", border: "none", color: T.accent,
            fontSize: 14, fontWeight: 500, cursor: "pointer", fontFamily: "inherit",
            padding: "6px 8px",
          }}>
            <svg width="8" height="14" viewBox="0 0 8 14" fill="none">
              <path d="M7 1L1 7l6 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Back
          </button>
        )}
        <div style={{
          fontSize: isMobile ? 16 : 15, fontWeight: 700, letterSpacing: -0.2, color: T.text,
          textAlign: isMobile ? "center" : "left",
        }}>
          Settings
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{
            padding: isMobile ? "6px 12px" : "8px 18px", borderRadius: 8,
            border: isMobile ? "none" : `1px solid ${T.border}`,
            background: isMobile ? "transparent" : T.surface2,
            color: T.accent, fontWeight: 600,
            fontSize: isMobile ? 14 : 13.5,
            cursor: "pointer", fontFamily: "inherit",
          }}>
            Done
          </button>
        </div>
      </div>

      {/* Body */}
      <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", background: isMobile ? T.surface2 : T.bg,
        padding: isMobile ? "20px 0 48px" : "32px 48px 64px" }}>
        <div style={{ maxWidth: isMobile ? "100%" : 1080, margin: "0 auto",
          display: isMobile ? "block" : "grid",
          gridTemplateColumns: "220px 1fr", gap: 40 }}>

          {/* Left nav — desktop only */}
          {!isMobile && <LeftNav activeSection={activeSection} onNav={navTo} />}

          {/* Content */}
          <div style={{ display: "flex", flexDirection: "column", gap: isMobile ? 0 : 28 }}>

            {/* Maps & navigation */}
            <Card id="maps" eyebrow={SECTIONS[0].num} title={SECTIONS[0].label}
              action={<StatusDot status={mapsCardStatus} />}>
              <Field label="Maps provider">
                <Seg
                  options={[{ value: "google", label: "Google Maps" }, { value: "apple", label: "Apple Maps" }]}
                  value={draft.mapsProvider}
                  onChange={v => set("mapsProvider", v)}
                />
              </Field>

              {draft.mapsProvider === "apple" && (
                <Field label="Apple MapKit JS token"
                  hint={<>Generate in Apple Developer → Maps IDs &amp; Keys.</>}>
                  <KeyInput
                    value={draft.appleMapKitToken}
                    onChange={v => set("appleMapKitToken", v)}
                    defaultMasked={false}
                    placeholder="eyJ…"
                    status={mapkitStatus}
                  />
                </Field>
              )}

              {draft.mapsProvider === "google" && (
                <Field label="Google Maps API key"
                  hint={<>From Google Cloud Console → APIs &amp; Services.</>}>
                  <KeyInput
                    value={draft.googleMapsKey}
                    onChange={v => set("googleMapsKey", v)}
                    defaultMasked={false}
                    placeholder="AIzaSy…"
                    status={googleStatus}
                  />
                </Field>
              )}

              <Field label="Driving distance units"
                hint="Used everywhere distances appear — leg cards, fuel estimates, route summaries.">
                <Seg
                  options={[{ value: "km", label: "km" }, { value: "mi", label: "mi" }]}
                  value={draft.distanceUnit}
                  onChange={v => set("distanceUnit", v)}
                />
              </Field>

              <Field label="Boating route server" optional
                hint="Fetches water-aware GPX routes when start/end coordinates are set on a Boat leg.">
                <div style={{ display: "flex", borderRadius: 8, border: `1px solid ${T.border}`,
                  overflow: "hidden" }}>
                  <div style={{ padding: "0 12px", background: T.surface2,
                    borderRight: `1px solid ${T.border}`, display: "flex", alignItems: "center",
                    fontFamily: monoFont, fontSize: 12, color: T.textMuted, flexShrink: 0 }}>
                    URL
                  </div>
                  <input
                    value={draft.routeServerUrl}
                    onChange={e => set("routeServerUrl", e.target.value)}
                    placeholder="https://…"
                    style={{ flex: 1, fontFamily: monoFont, fontSize: 12.5,
                      padding: "10px 13px", border: "none", background: T.bg,
                      outline: "none", color: T.text, boxSizing: "border-box" }}
                  />
                </div>
                <div style={{ marginTop: 8 }}>
                  <StatusDot status={routeServerStatus} />
                </div>
              </Field>
            </Card>

            {/* Flights */}
            <Card id="flights" eyebrow={SECTIONS[1].num} title={SECTIONS[1].label}>
              <Field label="AeroDataBox API key" optional
                hint={<>From RapidAPI → AeroDataBox. Enables automatic flight lookup by flight number.</>}>
                <KeyInput
                  value={draft.aeroDataBoxKey}
                  onChange={v => set("aeroDataBoxKey", v)}
                  defaultMasked={false}
                  placeholder="Paste your RapidAPI key…"
                  status={aeroStatus}
                />
              </Field>
            </Card>

            {/* Claude */}
            <Card id="claude" eyebrow={SECTIONS[2].num} title={SECTIONS[2].label}>
              <Field label="Anthropic API key" optional
                hint={<>From console.anthropic.com. Enables the Claude concierge, ⌘K bar, and Plan with Claude.</>}>
                <KeyInput
                  value={draft.anthropicKey}
                  onChange={v => set("anthropicKey", v)}
                  defaultMasked={true}
                  placeholder="sk-ant-…"
                  status={anthropicStatus}
                />
              </Field>

              {draft.anthropicKey && (
                <Field label="Claude model"
                  hint="Sonnet is the default — better reasoning. Haiku is faster and uses fewer tokens.">
                  <Seg
                    options={CLAUDE_MODELS.map(m => ({ value: m.id, label: m.label }))}
                    value={draft.claudeModel}
                    onChange={v => set("claudeModel", v)}
                  />
                </Field>
              )}
            </Card>

            {/* Databases */}
            <Card id="databases" eyebrow={SECTIONS[3].num} title={SECTIONS[3].label}>
              {dbs.length === 0 && editingDbId !== "new" && (
                <div style={{ fontSize: 13, color: T.textMuted, fontStyle: "italic" }}>
                  No databases configured. Add one to enable GitHub sync.
                </div>
              )}

              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {dbs.map(db => (
                  <div key={db.id}>
                    {editingDbId === db.id ? (
                      <DbForm db={db} inferredRepo={inferredRepo}
                        onSave={saveDb} onCancel={() => setEditingDbId(null)} />
                    ) : (
                      <div style={{ display: "flex", justifyContent: "space-between",
                        alignItems: "center", padding: "12px 16px",
                        background: T.surface2, border: `1px solid ${T.border}`,
                        borderRadius: 10 }}>
                        <div>
                          <div style={{ fontSize: 13.5, color: T.text, fontWeight: 500 }}>
                            {db.label || "Unnamed"}
                          </div>
                          <div style={{ fontSize: 11.5, color: T.textMuted, marginTop: 2 }}>
                            {[db.githubRepo || inferredRepo || "—", db.githubBranch || "data"].join(" · ")}
                          </div>
                        </div>
                        <div style={{ display: "flex", gap: 6 }}>
                          <button onClick={() => setEditingDbId(db.id)}
                            style={{ padding: "6px 12px", borderRadius: 7, fontSize: 12,
                              fontWeight: 500, cursor: "pointer", fontFamily: "inherit",
                              background: T.surface2, border: `1px solid ${T.border}`,
                              color: T.textMuted }}>
                            Edit
                          </button>
                          <button onClick={() => deleteDb(db.id)}
                            style={{ padding: "6px 12px", borderRadius: 7, fontSize: 12,
                              fontWeight: 500, cursor: "pointer", fontFamily: "inherit",
                              background: "transparent", border: "1px solid #f9c9c0",
                              color: "#B84A2E" }}>
                            Remove
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {editingDbId === "new" ? (
                <DbForm
                  db={dbs.length === 0 && inferredRepo
                    ? { label: "Personal", githubRepo: inferredRepo, githubBranch: "data" }
                    : null}
                  inferredRepo={inferredRepo}
                  onSave={saveDb} onCancel={() => setEditingDbId(null)} />
              ) : (
                <button onClick={() => setEditingDbId("new")}
                  style={{ alignSelf: "flex-start", padding: "9px 16px", borderRadius: 8,
                    border: `1px solid ${T.border}`, background: T.surface2, color: T.text,
                    fontSize: 13, fontWeight: 500, cursor: "pointer", fontFamily: "inherit" }}>
                  + Add database
                </button>
              )}
            </Card>

            {/* About */}
            <Card id="about" eyebrow={SECTIONS[4].num} title={SECTIONS[4].label}>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ display: "flex", gap: 16, fontSize: 13 }}>
                  <span style={{ color: T.textMuted, width: 80, flexShrink: 0 }}>Version</span>
                  <span style={{ color: T.text }}>1.0</span>
                </div>
                <div style={{ display: "flex", gap: 16, fontSize: 13 }}>
                  <span style={{ color: T.textMuted, width: 80, flexShrink: 0 }}>Source</span>
                  <a href={inferredRepo ? `https://github.com/${inferredRepo}` : "#"}
                    target="_blank" rel="noreferrer"
                    style={{ color: T.accent, textDecoration: "none", fontWeight: 500 }}>
                    GitHub
                  </a>
                </div>
              </div>
            </Card>

          </div>
        </div>
      </div>
    </div>
    </MobileCtx.Provider>
  );
}
