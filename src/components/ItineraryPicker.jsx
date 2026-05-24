import { useState, useEffect, useRef } from "react";
import NoteMarkdown from "./NoteMarkdown.jsx";
import { listItineraries, loadFromGitHub, ITINERARIES_FOLDER, inferRepo } from "../lib/github.js";
import Settings from "./Settings.jsx";
import { T, btn, input } from "../theme.js";
import VehiclesPage from "./Vehicles.jsx";

const DB_COLORS = ["#0b3d6b", "#2563eb", "#059669", "#dc2626", "#7c3aed", "#0891b2"];
function dbColor(idx) { return DB_COLORS[idx % DB_COLORS.length]; }

function formatDateRange(startDate, dayCount) {
  if (!startDate || !dayCount) return null;
  const [y, m, d] = startDate.split("-").map(Number);
  const start = new Date(y, m - 1, d);
  const end   = new Date(y, m - 1, d + dayCount - 1);
  const short = dt => dt.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const full  = dt => dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  return `${short(start)} – ${full(end)}`;
}

function resolveDb(db) {
  const repo = db.githubRepo || inferRepo() || "";
  return { ...db, githubRepo: repo, githubBranch: db.githubBranch || "data" };
}

function parseDate(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function getEndDate(startDate, dayCount) {
  if (!startDate || !dayCount) return null;
  const [y, m, d] = startDate.split("-").map(Number);
  return new Date(y, m - 1, d + dayCount - 1);
}

function daysBetween(from, to) {
  return Math.round((to - from) / 86400000);
}

// ── Sub-components ────────────────────────────────────────────────────────────

const PinIcon = (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
    <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"
          stroke="currentColor" strokeWidth="1.6" fill="currentColor" fillOpacity="0.15"/>
    <circle cx="12" cy="9" r="2.5" stroke="currentColor" strokeWidth="1.6"/>
  </svg>
);

const NoteIcon = (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
    <rect x="4" y="3" width="16" height="18" rx="2" stroke="currentColor" strokeWidth="1.6" fill="currentColor" fillOpacity="0.1"/>
    <line x1="8" y1="8" x2="16" y2="8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    <line x1="8" y1="12" x2="16" y2="12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    <line x1="8" y1="16" x2="12" y2="16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
  </svg>
);

const PersonIcon = (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
    <circle cx="12" cy="7" r="4" stroke="currentColor" strokeWidth="1.6" fill="currentColor" fillOpacity="0.12"/>
    <path d="M4 20c0-4 3.58-7 8-7s8 3 8 7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
  </svg>
);

const CarIcon = (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
    <path d="M5 13l1.5-5h11L19 13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
    <rect x="3" y="13" width="18" height="6" rx="2" stroke="currentColor" strokeWidth="1.6" fill="currentColor" fillOpacity="0.1"/>
    <circle cx="7.5" cy="19" r="1.5" fill="currentColor"/>
    <circle cx="16.5" cy="19" r="1.5" fill="currentColor"/>
  </svg>
);

const GearIcon = (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
    <path d="M8 10.5A2.5 2.5 0 1 0 8 5.5a2.5 2.5 0 0 0 0 5z" stroke="currentColor" strokeWidth="1.4"/>
    <path d="M13.5 8c0-.28-.02-.56-.06-.83l1.28-1a.5.5 0 0 0 .12-.64l-1.2-2.07a.5.5 0 0 0-.61-.22l-1.5.6a6 6 0 0 0-1.43-.83l-.22-1.58A.5.5 0 0 0 9.38 1H6.62a.5.5 0 0 0-.5.43L5.9 3.01a6 6 0 0 0-1.43.83l-1.5-.6a.5.5 0 0 0-.61.22L1.16 5.53a.5.5 0 0 0 .12.64l1.28 1A5.9 5.9 0 0 0 2.5 8c0 .28.02.56.06.83l-1.28 1a.5.5 0 0 0-.12.64l1.2 2.07a.5.5 0 0 0 .61.22l1.5-.6c.44.32.92.6 1.43.83l.22 1.58c.06.25.27.43.5.43h2.76a.5.5 0 0 0 .5-.43l.22-1.58c.51-.23.99-.5 1.43-.83l1.5.6a.5.5 0 0 0 .61-.22l1.2-2.07a.5.5 0 0 0-.12-.64l-1.28-1c.04-.27.06-.55.06-.83z" stroke="currentColor" strokeWidth="1.4"/>
  </svg>
);

function NavRow({ label, count, active, onClick }) {
  const [hov, setHov] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        width: "100%", padding: "8px 12px", borderRadius: 8, textAlign: "left",
        border: active ? `1px solid ${T.border}` : "1px solid transparent",
        background: active ? T.surface : hov ? T.surface3 : "transparent",
        color: (active || hov) ? T.text : T.textMuted,
        fontSize: 13, fontWeight: active ? 600 : 500,
        cursor: "pointer", fontFamily: T.font,
        transition: "background 0.1s, color 0.1s",
      }}
    >
      <span>{label}</span>
      <span style={{ fontSize: 11, color: T.textFaint, fontVariantNumeric: "tabular-nums" }}>
        {count > 99 ? "99+" : count}
      </span>
    </button>
  );
}

function MobileNavRow({ label, icon, count, active, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex", alignItems: "center", gap: 12,
        width: "100%", padding: "12px 12px", borderRadius: 10, textAlign: "left",
        border: active ? `1px solid ${T.border}` : "1px solid transparent",
        background: active ? T.surface : "transparent",
        color: active ? T.text : T.textMuted,
        fontSize: 15, fontWeight: active ? 600 : 500, letterSpacing: -0.1,
        cursor: "pointer", fontFamily: T.font,
      }}
    >
      {icon && (
        <span style={{ color: active ? T.accent : T.textMuted, flexShrink: 0, display: "flex" }}>
          {icon}
        </span>
      )}
      <span style={{ flex: 1 }}>{label}</span>
      <span style={{ fontSize: 12, color: T.textFaint, fontVariantNumeric: "tabular-nums" }}>
        {count > 99 ? "99+" : count}
      </span>
    </button>
  );
}

function SectionLabel({ label, count }) {
  return (
    <div style={{
      display: "flex", alignItems: "baseline", gap: 8,
      paddingBottom: 10, marginBottom: 4,
      borderBottom: `1px solid ${T.border}`,
    }}>
      <span style={{
        fontSize: 11, fontWeight: 600, letterSpacing: "0.12em",
        textTransform: "uppercase", color: T.textMuted,
      }}>{label}</span>
      {count != null && (
        <span style={{ fontSize: 11, color: T.textFaint, fontVariantNumeric: "tabular-nums" }}>{count}</span>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ItineraryPicker({ settings, onSettingsChange, onLoad, onCreate, localCache,
  vehiclesByDb = {}, vehiclesDbId, onVehiclesDbChange,
  onAddVehicle, onUpdateVehicle, onDeleteVehicle,
}) {
  const [files,        setFiles]        = useState([]);
  const [deletedPaths] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem("itineraryDeletedPaths") || "[]")); }
    catch { return new Set(); }
  });
  const [details,      setDetails]      = useState(() => {
    try {
      const raw = JSON.parse(localStorage.getItem("itineraryMetadata") || "{}");
      let changed = false;
      for (const k of Object.keys(raw)) {
        if (raw[k].todos === undefined) { raw[k].todos = []; changed = true; }
      }
      if (changed) { try { localStorage.setItem("itineraryMetadata", JSON.stringify(raw)); } catch {} }
      return raw;
    } catch { return {}; }
  });
  const [listStatus,   setListStatus]   = useState("idle");
  const [newName,      setNewName]      = useState("");
  const [createDbId,   setCreateDbId]   = useState(null);
  const [loadingPath,  setLoadingPath]  = useState(null);
  const [refreshTick,  setRefreshTick]  = useState(0);
  const refreshAllRef  = useRef(false);
  const [loadError,    setLoadError]    = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [drawerOpen,   setDrawerOpen]   = useState(false);
  const [activePage,   setActivePage]   = useState("trips");
  const [pullStatus,   setPullStatus]   = useState("idle"); // "idle"|"pulling"|"done"
  const [pullProgress, setPullProgress] = useState({ done: 0, total: 0 });
  useEffect(() => { document.title = "Headway."; }, []);

  useEffect(() => {
    const id = setInterval(() => {
      refreshAllRef.current = true;
      setRefreshTick(t => t + 1);
    }, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, []);

  const databases   = settings.databases ?? [];
  const writableDbs = databases.filter(db => db.githubToken && (db.githubRepo || inferRepo()));
  const canWrite    = writableDbs.length > 0;
  const hasAnyDb    = databases.some(db => db.githubRepo || inferRepo());
  const multiDb     = databases.length > 1;
  const defaultCreateDbId = writableDbs[0]?.id ?? null;

  useEffect(() => {
    if (!databases.length) return;
    setListStatus("loading");
    Promise.all(
      databases.map(async (db, idx) => {
        const ghs = resolveDb(db);
        if (!ghs.githubRepo) return [];
        const dbFiles = await listItineraries(ghs).catch(() => []);
        return dbFiles.map(f => ({ ...f, dbId: db.id, dbLabel: db.label || `DB ${idx + 1}`, dbIdx: idx, ghs }));
      })
    ).then(results => {
      const allFiles = results.flat();
      const live = allFiles.filter(f => !deletedPaths.has(`${f.dbId}:${f.path}`));
      const stillPresent = new Set(allFiles.map(f => `${f.dbId}:${f.path}`));
      const toRemove = [...deletedPaths].filter(k => !stillPresent.has(k));
      if (toRemove.length) {
        toRemove.forEach(k => deletedPaths.delete(k));
        try { localStorage.setItem("itineraryDeletedPaths", JSON.stringify([...deletedPaths])); } catch {}
      }
      setFiles(live);
      setListStatus("idle");
    });
  }, [refreshTick]);

  useEffect(() => {
    if (!files.length) return;
    const forceAll = refreshAllRef.current;
    refreshAllRef.current = false;
    const missing = forceAll ? files : files.filter(f => !details[`${f.dbId}:${f.path}`]);
    if (!missing.length) return;
    Promise.all(
      missing.map(f =>
        loadFromGitHub({ ...f.ghs, githubFile: f.path })
          .then(data => data ? [f, data] : null)
          .catch(() => null)
      )
    ).then(results => {
      const updates = {};
      for (const r of results) {
        if (!r) continue;
        const [f, data] = r;
        const key = `${f.dbId}:${f.path}`;
        const overnights = data.days?.map(d => d.overnight).filter(Boolean) ?? [];
        const legs       = data.days?.map(d => d.leg).filter(Boolean) ?? [];
        const todoLines  = str => (str || "").split("\n")
          .filter(l => /^TODO:/i.test(l.trim()))
          .map(l => l.trim().replace(/^TODO:\s*/i, ""));
        const todos = [
          ...todoLines(data.itineraryNotes),
          ...(data.days ?? []).flatMap(d => todoLines(
            data.notes?.[d.day] !== undefined ? data.notes[d.day] : d.note
          )),
        ];
        let drivingKm = 0;
        Object.values(data.directions ?? {}).forEach(dirs => (dirs ?? []).forEach(d => {
          const km = d.distance?.match(/^([\d.]+)\s*km/i);
          const mi = d.distance?.match(/^([\d.]+)\s*mi/i);
          const m  = d.distance?.match(/^(\d+)\s*m\b/i);
          if (km) drivingKm += parseFloat(km[1]);
          else if (mi) drivingKm += parseFloat(mi[1]) * 1.60934;
          else if (m)  drivingKm += parseFloat(m[1]) / 1000;
        }));
        updates[key] = {
          title:      data.title || null,
          startDate:  data.startDate,
          dayCount:   data.days?.length ?? 0,
          locations:  overnights.length >= 2 ? `${overnights[0]} → ${overnights[overnights.length - 1]}`
                    : overnights[0] ?? legs[0] ?? null,
          drivingKm:  drivingKm > 0 ? Math.round(drivingKm) : null,
          todos,
        };
      }
      if (Object.keys(updates).length) {
        setDetails(prev => ({ ...prev, ...updates }));
        try {
          const meta = JSON.parse(localStorage.getItem("itineraryMetadata") || "{}");
          localStorage.setItem("itineraryMetadata", JSON.stringify({ ...meta, ...updates }));
        } catch {}
      }
    });
  }, [files]);

  async function handleLoad(f) {
    setLoadingPath(`${f.dbId}:${f.path}`);
    setLoadError(null);
    try {
      let data = null;
      try {
        data = await loadFromGitHub({ ...f.ghs, githubFile: f.path });
      } catch {
        // Network failed — try local pull cache
        const cached = localStorage.getItem(`itinerary:${f.dbId}:${f.path}`);
        if (cached) data = JSON.parse(cached);
      }
      if (!data) throw new Error("Not found");
      onLoad(f.path, data, f.dbId);
    } catch {
      setLoadError("Failed to load — check your connection and token.");
    } finally {
      setLoadingPath(null);
    }
  }

  async function handlePull() {
    if (!files.length || pullStatus === "pulling") return;
    setPullStatus("pulling");
    setPullProgress({ done: 0, total: files.length });

    const metaUpdates = {};
    let done = 0;

    for (const f of files) {
      try {
        const data = await loadFromGitHub({ ...f.ghs, githubFile: f.path });
        if (!data) continue;

        // Cache full JSON
        try { localStorage.setItem(`itinerary:${f.dbId}:${f.path}`, JSON.stringify(data)); } catch {}

        // Extract metadata (same logic as the details useEffect)
        const key = `${f.dbId}:${f.path}`;
        const overnights = data.days?.map(d => d.overnight).filter(Boolean) ?? [];
        const legs       = data.days?.map(d => d.leg).filter(Boolean) ?? [];
        const todoLines  = str => (str || "").split("\n")
          .filter(l => /^TODO:/i.test(l.trim()))
          .map(l => l.trim().replace(/^TODO:\s*/i, ""));
        const todos = [
          ...todoLines(data.itineraryNotes),
          ...(data.days ?? []).flatMap(d => todoLines(
            data.notes?.[d.day] !== undefined ? data.notes[d.day] : d.note
          )),
        ];
        let drivingKm = 0;
        (data.days ?? []).forEach(d => (d.directions ?? []).forEach(dir => {
          const km = dir.distance?.match(/^([\d.]+)\s*km/i);
          const mi = dir.distance?.match(/^([\d.]+)\s*mi/i);
          if (km) drivingKm += parseFloat(km[1]);
          else if (mi) drivingKm += parseFloat(mi[1]) * 1.60934;
        }));
        metaUpdates[key] = {
          title: data.title || null,
          startDate: data.startDate,
          dayCount: data.days?.length ?? 0,
          locations: overnights.length >= 2 ? `${overnights[0]} → ${overnights[overnights.length - 1]}`
                   : overnights[0] ?? legs[0] ?? null,
          drivingKm: drivingKm > 0 ? Math.round(drivingKm) : null,
          todos,
        };
      } catch {}
      done++;
      setPullProgress({ done, total: files.length });
    }

    // Persist metadata updates
    if (Object.keys(metaUpdates).length) {
      setDetails(prev => ({ ...prev, ...metaUpdates }));
      try {
        const meta = JSON.parse(localStorage.getItem("itineraryMetadata") || "{}");
        localStorage.setItem("itineraryMetadata", JSON.stringify({ ...meta, ...metaUpdates }));
      } catch {}
    }

    setPullStatus("done");
    setTimeout(() => setPullStatus("idle"), 2500);
  }

  function handleCreate() {
    if (!newName.trim()) return;
    const dbId = createDbId ?? defaultCreateDbId;
    onCreate(newName.trim(), dbId);
  }

  // ── Group files into sections ──────────────────────────────────────────────

  const todayMidnight = (() => { const t = new Date(); t.setHours(0, 0, 0, 0); return t; })();
  const enriched = files.map(f => ({ ...f, d: details[`${f.dbId}:${f.path}`] }));

  const upcoming = enriched
    .filter(f => {
      const sd = f.d?.startDate;
      if (!sd) return false;
      const end = getEndDate(sd, f.d?.dayCount);
      return !end || end >= todayMidnight;
    })
    .sort((a, b) => (a.d?.startDate || "").localeCompare(b.d?.startDate || ""));

  const past = enriched
    .filter(f => {
      const sd = f.d?.startDate;
      if (!sd) return false;
      const end = getEndDate(sd, f.d?.dayCount);
      return end && end < todayMidnight;
    })
    .sort((a, b) => (b.d?.startDate || "").localeCompare(a.d?.startDate || ""));

  const planning = enriched
    .filter(f => !f.d?.startDate)
    .sort((a, b) => (a.d?.title || a.name).localeCompare(b.d?.title || b.name));

  // ── Nav items ─────────────────────────────────────────────────────────────

  const NAV_ITEMS = [
    { id: "trips",    label: "Trips",     icon: PinIcon,    count: files.length },
    { id: "inbox",    label: "Inbox",     icon: NoteIcon,   count: 0 },
    { id: "places",   label: "Places",    icon: PinIcon,    count: 0 },
    { id: "people",   label: "Travelers", icon: PersonIcon, count: 0 },
    { id: "vehicles", label: "Vehicles",  icon: CarIcon,    count: Object.values(vehiclesByDb).reduce((s, a) => s + a.length, 0) },
  ];

  const activeLabel = NAV_ITEMS.find(n => n.id === activePage)?.label ?? "Trips";

  function navigate(id) {
    setActivePage(id);
    setDrawerOpen(false);
  }

  // ── Next-trip card data ────────────────────────────────────────────────────

  const nextTrip = upcoming[0] ?? null;
  const nextTripCountdown = nextTrip?.d?.startDate ? (() => {
    const d = nextTrip.d;
    const gap = daysBetween(todayMidnight, parseDate(d.startDate));
    if (gap > 1)  return { label: `${gap} days away`, num: gap,   color: T.accent };
    if (gap === 1) return { label: "tomorrow",          num: null,  color: T.accent };
    if (gap === 0) return { label: "today",             num: null,  color: T.amber  };
    // gap < 0 = currently traveling
    const dayN = -gap + 1;
    return { label: `day ${dayN} of ${d.dayCount}`, num: null, color: T.amber };
  })() : null;

  // ── Card renderer ──────────────────────────────────────────────────────────

  function renderCard(f, { featured = false, dim = false } = {}) {
    const fileKey      = `${f.dbId}:${f.path}`;
    const d            = f.d;
    const displayTitle = d?.title || f.name;
    const isLoading    = loadingPath === fileKey;
    const busy         = !!loadingPath;
    const color        = dbColor(f.dbIdx);
    const hasTodos     = (d?.todos?.length ?? 0) > 0;

    const dateRange = d?.startDate && d?.dayCount ? formatDateRange(d.startDate, d.dayCount) : null;
    const daysCount = d?.dayCount ? `${d.dayCount} day${d.dayCount !== 1 ? "s" : ""}` : null;

    // Countdown badge
    let countdown = null;
    if (d?.startDate) {
      const tripStart = parseDate(d.startDate);
      const gap = daysBetween(todayMidnight, tripStart);
      if (gap > 0) {
        countdown = { value: gap, unit: "DAYS" };
      } else if (gap === 0) {
        countdown = { value: "Today", unit: null };
      }
    }

    const summaryParts = [];
    if (d?.locations) summaryParts.push(d.locations);
    if (d?.drivingKm) {
      const useMi = settings.distanceUnit === "mi";
      const val = useMi ? Math.round(d.drivingKm * 0.621371) : d.drivingKm;
      summaryParts.push(`${val} ${useMi ? "mi" : "km"} driving`);
    }

    return (
      <button
        key={fileKey}
        onClick={() => !busy && handleLoad(f)}
        style={{
          display: "block", width: "100%", textAlign: "left",
          background: T.surface,
          border: `1px solid ${T.border}`,
          borderRadius: 12, padding: "14px 16px",
          cursor: busy ? "default" : "pointer",
          opacity: dim && !isLoading ? 0.6 : 1,
          fontFamily: T.font, color: T.text,
          position: "relative", overflow: "hidden",
          transition: "box-shadow 0.12s",
        }}
      >
        {/* Accent stripe for featured/upcoming */}
        {featured && (
          <div style={{
            position: "absolute", top: 0, left: 0, bottom: 0, width: 3,
            background: T.accent,
          }} />
        )}

        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            {/* Title row */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
              <span style={{ fontSize: 15, fontWeight: 600, letterSpacing: -0.1, color: T.text }}>
                {displayTitle}
              </span>
              {multiDb && (
                <span style={{
                  fontSize: 10, color, border: `1px solid ${color}44`,
                  borderRadius: 4, padding: "1px 6px", letterSpacing: "0.06em",
                  textTransform: "uppercase", flexShrink: 0, fontWeight: 500,
                }}>
                  {f.dbLabel}
                </span>
              )}
              {isLoading && (
                <span style={{ fontSize: 11, color: T.textMuted }}>Loading…</span>
              )}
            </div>

            {/* Date + day count */}
            {(dateRange || daysCount) && (
              <div style={{
                fontSize: 12, color: T.textMuted, marginBottom: summaryParts.length || hasTodos ? 4 : 0,
                fontVariantNumeric: "tabular-nums",
                display: "flex", gap: 6, alignItems: "center",
              }}>
                {dateRange && <span>{dateRange}</span>}
                {dateRange && daysCount && <span style={{ color: T.textFaint }}>·</span>}
                {daysCount && <span>{daysCount}</span>}
              </div>
            )}

            {/* Route/location summary */}
            {summaryParts.length > 0 && (
              <div style={{
                fontSize: 12, color: T.textMuted,
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                marginBottom: hasTodos ? 6 : 0,
              }}>
                {summaryParts.join(" · ")}
              </div>
            )}

            {/* TODOs */}
            {hasTodos && (
              <div style={{ marginTop: 6 }}>
                {d.todos.slice(0, 3).map((t, i) => (
                  <div key={i} style={{ display: "flex", gap: 6, alignItems: "baseline", marginBottom: 2 }}>
                    <span style={{ color: T.accent, fontSize: 10, flexShrink: 0 }}>□</span>
                    <div style={{ fontSize: 11, color: T.textMuted, lineHeight: 1.4 }}>
                      <NoteMarkdown>{t}</NoteMarkdown>
                    </div>
                  </div>
                ))}
                {d.todos.length > 3 && (
                  <div style={{ fontSize: 11, color: T.textFaint, marginTop: 2 }}>
                    +{d.todos.length - 3} more
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Countdown badge */}
          {countdown && (
            <div style={{
              background: T.accentSoft, color: T.accent,
              padding: "6px 10px", borderRadius: 8, flexShrink: 0,
              display: "flex", flexDirection: "column", alignItems: "center",
              minWidth: 50,
            }}>
              <div style={{ fontSize: countdown.unit ? 18 : 12, fontWeight: 700, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>
                {countdown.value}
              </div>
              {countdown.unit && (
                <div style={{ fontSize: 9, letterSpacing: "0.08em", marginTop: 2 }}>
                  {countdown.unit}
                </div>
              )}
            </div>
          )}
        </div>
      </button>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  const dbSubtitle = multiDb
    ? databases.map(db => db.label || db.githubRepo || "—").join(" · ")
    : databases[0]
      ? `${databases[0].githubRepo || inferRepo() || "—"} / ${ITINERARIES_FOLDER}/`
      : null;

  return (
    <div style={{ fontFamily: T.font, background: T.bg, minHeight: "100vh", color: T.text }}>

      {/* ── Page layout: sidebar + main on desktop ── */}
      <div style={{ display: "flex", minHeight: "100vh" }}>

        {/* Sidebar — hidden on mobile */}
        <aside className="picker-sidebar" style={{
          width: 240, flexShrink: 0,
          borderRight: `1px solid ${T.border}`,
          background: T.surface2,
          padding: "24px 16px",
          display: "flex", flexDirection: "column",
          position: "sticky", top: 0, height: "100vh", overflowY: "auto",
        }}>
          {/* Brand mark + wordmark */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
            <div style={{
              width: 28, height: 28, borderRadius: 7, background: T.accent,
              display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
            }}>
              <svg width="16" height="16" viewBox="0 0 256 256" fill="none">
                <line x1="128" y1="50" x2="128" y2="206" stroke="white" strokeOpacity="0.5" strokeWidth="18" strokeLinecap="round"/>
                <circle cx="128" cy="56" r="16" fill="white"/>
                <circle cx="128" cy="200" r="16" fill="white"/>
                <circle cx="128" cy="128" r="38" fill={T.amber}/>
              </svg>
            </div>
            <span style={{ fontSize: 14, fontWeight: 700, letterSpacing: -0.2, color: T.text }}>
              Headway.
            </span>
          </div>

          {/* Nav list */}
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {NAV_ITEMS.map(item => (
              <NavRow
                key={item.id}
                label={item.label}
                count={item.count}
                active={activePage === item.id}
                onClick={() => navigate(item.id)}
              />
            ))}
          </div>

          {/* Spacer */}
          <div style={{ flex: 1 }} />

          {/* Next-trip card */}
          {nextTrip && nextTripCountdown && (
            <div
              role="button"
              onClick={() => handleLoad(nextTrip)}
              style={{
                padding: 14, borderRadius: 10, background: T.surface,
                border: `1px solid ${T.border}`, cursor: "pointer", marginBottom: 8,
              }}
            >
              <div style={{ fontSize: 10, fontWeight: 600, color: T.textMuted, letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: 4 }}>
                NEXT TRIP
              </div>
              <div style={{ fontSize: 14, fontWeight: 600, color: T.text, marginBottom: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {nextTrip.d?.title || nextTrip.name}
              </div>
              {nextTrip.d?.startDate && nextTrip.d?.dayCount && (
                <div style={{ fontSize: 12, color: T.textMuted, marginBottom: 6 }}>
                  {formatDateRange(nextTrip.d.startDate, nextTrip.d.dayCount)}
                </div>
              )}
              <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
                <span style={{ fontSize: 22, fontWeight: 700, fontVariantNumeric: "tabular-nums", color: nextTripCountdown.color }}>
                  {nextTripCountdown.num ?? nextTripCountdown.label}
                </span>
                {nextTripCountdown.num != null && (
                  <span style={{ fontSize: 11, color: T.textMuted }}>days away</span>
                )}
              </div>
            </div>
          )}

          {/* Settings footer */}
          <button
            onClick={() => setShowSettings(p => !p)}
            style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "8px 12px", borderRadius: 8, width: "100%",
              border: showSettings ? `1px solid ${T.accent}44` : "1px solid transparent",
              background: showSettings ? T.accentSoft : "transparent",
              color: showSettings ? T.accent : T.textMuted,
              cursor: "pointer", fontFamily: T.font, fontSize: 13, fontWeight: 500,
              transition: "background 0.1s, color 0.1s",
            }}
          >
            {GearIcon}
            Settings
          </button>
        </aside>

        {/* Main content */}
        <main className="picker-main" style={{ flex: 1, padding: "40px 48px 80px", maxWidth: 760, minWidth: 0 }}>

          {/* Page header */}
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 36 }}>
            <div>
              <div style={{ fontSize: 11, color: T.textMuted, letterSpacing: "0.12em", textTransform: "uppercase", fontWeight: 500, marginBottom: 6 }}>
                {new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
              </div>
              <h1 style={{ fontSize: 34, fontWeight: 700, margin: 0, letterSpacing: -0.6, color: T.text }}>
                {activeLabel}
              </h1>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              {/* Hamburger — visible on mobile where sidebar is hidden */}
              <button
                className="picker-settings-btn"
                onClick={() => setDrawerOpen(true)}
                title="Menu"
                style={{ ...btn.icon, background: T.surface2, color: T.textMuted, borderColor: T.border }}
              >
                <svg width="16" height="14" viewBox="0 0 18 14" fill="none">
                  <line x1="0" y1="1" x2="18" y2="1" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
                  <line x1="0" y1="7" x2="18" y2="7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
                  <line x1="0" y1="13" x2="18" y2="13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
                </svg>
              </button>
              {hasAnyDb && (
                <button
                  onClick={handlePull}
                  disabled={pullStatus === "pulling" || !files.length}
                  title="Pull all trips from GitHub into local storage"
                  style={{
                    ...btn.ghost,
                    opacity: pullStatus === "pulling" || !files.length ? 0.55 : 1,
                    color: pullStatus === "done" ? T.accent : T.textMuted,
                    borderColor: pullStatus === "done" ? T.accent + "66" : T.border,
                    minWidth: 70,
                  }}
                >
                  {pullStatus === "pulling"
                    ? `${pullProgress.done}/${pullProgress.total}`
                    : pullStatus === "done" ? "✓ Pulled"
                    : "↓ Pull"}
                </button>
              )}
              {canWrite && (
                <button
                  onClick={() => document.getElementById("new-itinerary-input")?.focus()}
                  style={btn.primary}
                >
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                    <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
                  </svg>
                  New trip
                </button>
              )}
            </div>
          </div>

          {/* Settings panel (inline, full-width) */}
          {showSettings && (
            <div style={{ marginBottom: 28, padding: "20px 24px", background: T.surface2, border: `1px solid ${T.border}`, borderRadius: 12 }}>
              <Settings
                settings={settings}
                onSave={draft => { onSettingsChange(draft); setShowSettings(false); }}
                onClose={() => setShowSettings(false)}
              />
            </div>
          )}

          {activePage === "trips" ? (<>
          {/* Status / errors */}
          {listStatus === "loading" && (
            <div style={{ color: T.textMuted, fontSize: 13, padding: "12px 0" }}>Loading…</div>
          )}
          {loadError && (
            <div style={{
              padding: "10px 14px", background: T.redSoft, border: `1px solid ${T.redBorder}`,
              borderRadius: 8, fontSize: 13, color: T.red, marginBottom: 16,
            }}>
              {loadError}
            </div>
          )}
          {listStatus === "idle" && !hasAnyDb && (
            <div style={{
              padding: "20px 24px", background: T.surface2, border: `1px solid ${T.border}`,
              borderRadius: 12, fontSize: 14, color: T.textMuted, lineHeight: 1.6,
            }}>
              Open Settings to connect a GitHub repository and sync your itineraries.
            </div>
          )}
          {listStatus === "idle" && hasAnyDb && files.length === 0 && !canWrite && (
            <div style={{ fontSize: 13, color: T.textMuted, padding: "12px 0", fontStyle: "italic" }}>
              Add a GitHub token in Settings to load your itineraries.
            </div>
          )}

          {/* Local unsaved session */}
          {localCache && (
            <div style={{ marginBottom: 28 }}>
              <SectionLabel label="Unsaved local session" />
              <div style={{ marginTop: 8 }}>
                <div style={{
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                  padding: "14px 16px", background: T.surface,
                  border: `1px solid ${T.border}`, borderRadius: 12,
                }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 2 }}>
                      {localCache.title || "Untitled"}
                    </div>
                    {localCache.days?.length > 0 && (
                      <div style={{ fontSize: 12, color: T.textMuted }}>
                        {localCache.days.length} day{localCache.days.length !== 1 ? "s" : ""}
                      </div>
                    )}
                  </div>
                  <button onClick={() => onLoad("__local__", localCache)} style={btn.ghost}>
                    Resume →
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ── Upcoming ── */}
          {upcoming.length > 0 && (
            <div style={{ marginBottom: 32 }}>
              <SectionLabel label="Upcoming" count={upcoming.length} />
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
                {upcoming.map((f, i) => renderCard(f, { featured: i === 0 }))}
              </div>
            </div>
          )}

          {/* ── Planning ── */}
          {planning.length > 0 && (
            <div style={{ marginBottom: 32 }}>
              <SectionLabel label="Planning" count={planning.length} />
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
                {planning.map(f => renderCard(f))}
              </div>
            </div>
          )}

          {/* ── Past ── */}
          {past.length > 0 && (
            <div style={{ marginBottom: 32 }}>
              <SectionLabel label="Past" count={past.length} />
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
                {past.map(f => renderCard(f, { dim: true }))}
              </div>
            </div>
          )}

          {/* ── Create new ── */}
          {canWrite && (
            <div style={{
              padding: "20px 24px", background: T.surface2,
              border: `1px solid ${T.border}`, borderRadius: 12,
            }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: T.textMuted, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 12 }}>
                New Itinerary
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <input
                  id="new-itinerary-input"
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && handleCreate()}
                  placeholder="Name — e.g. Pacific Northwest 2027"
                  style={{ ...input, flex: 1, minWidth: 160 }}
                />
                {multiDb && writableDbs.length > 1 && (
                  <select
                    value={createDbId ?? defaultCreateDbId ?? ""}
                    onChange={e => setCreateDbId(e.target.value)}
                    style={{ ...input, width: "auto", cursor: "pointer", background: T.bg }}
                  >
                    {writableDbs.map((db, i) => (
                      <option key={db.id} value={db.id}>{db.label || `DB ${i + 1}`}</option>
                    ))}
                  </select>
                )}
                <button
                  onClick={handleCreate}
                  disabled={!newName.trim()}
                  style={{ ...btn.primary, opacity: !newName.trim() ? 0.45 : 1 }}
                >
                  Create
                </button>
              </div>
            </div>
          )}
          </>) : activePage === "vehicles" ? (
            <VehiclesPage
              vehicles={vehiclesByDb[vehiclesDbId] ?? []}
              databases={writableDbs.map(db => ({ id: db.id, label: db.label || db.githubRepo || `DB ${db.id}` }))}
              activeDbId={vehiclesDbId}
              onDbChange={onVehiclesDbChange}
              onAdd={onAddVehicle}
              onUpdate={onUpdateVehicle}
              onDelete={onDeleteVehicle}
            />
          ) : (
            <div style={{
              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
              padding: "80px 0", gap: 12, color: T.textMuted,
            }}>
              <div style={{ fontSize: 32, opacity: 0.25 }}>
                {NAV_ITEMS.find(n => n.id === activePage)?.icon}
              </div>
              <div style={{ fontSize: 15, fontWeight: 600, color: T.textMuted }}>{activeLabel}</div>
              <div style={{ fontSize: 13, color: T.textFaint }}>Coming soon</div>
            </div>
          )}
        </main>
      </div>

      {/* ── Mobile drawer ─────────────────────────────────────────────────── */}
      {drawerOpen && (
        <>
          {/* Scrim */}
          <div
            onClick={() => setDrawerOpen(false)}
            style={{
              position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)",
              zIndex: 1000,
            }}
          />
          {/* Drawer panel */}
          <div style={{
            position: "fixed", top: 0, left: 0, bottom: 0,
            width: "min(86vw, 320px)",
            background: T.surface2,
            boxShadow: "8px 0 32px rgba(0,0,0,0.18), 1px 0 4px rgba(0,0,0,0.06)",
            zIndex: 1001,
            display: "flex", flexDirection: "column",
            padding: "max(56px, 18px) 16px max(22px, 12px)",
            overflowY: "auto",
            animation: "drawerSlideIn 280ms cubic-bezier(0.22, 1, 0.36, 1) forwards",
          }}>
            {/* Header: brand + close */}
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 22 }}>
              <div style={{
                width: 36, height: 36, borderRadius: 9, background: T.accent,
                display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
              }}>
                <svg width="18" height="18" viewBox="0 0 256 256" fill="none">
                  <line x1="128" y1="50" x2="128" y2="206" stroke="white" strokeOpacity="0.5" strokeWidth="18" strokeLinecap="round"/>
                  <circle cx="128" cy="56" r="16" fill="white"/>
                  <circle cx="128" cy="200" r="16" fill="white"/>
                  <circle cx="128" cy="128" r="38" fill={T.amber}/>
                </svg>
              </div>
              <span style={{ fontSize: 15, fontWeight: 700, letterSpacing: -0.2, color: T.text, flex: 1 }}>
                Headway.
              </span>
              <button
                onClick={() => setDrawerOpen(false)}
                style={{
                  width: 32, height: 32, borderRadius: 8, border: `1px solid ${T.border}`,
                  background: "transparent", cursor: "pointer", color: T.textMuted,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 14, fontFamily: T.font,
                }}
              >
                ✕
              </button>
            </div>

            {/* Nav rows */}
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {NAV_ITEMS.map(item => (
                <MobileNavRow
                  key={item.id}
                  label={item.label}
                  icon={item.icon}
                  count={item.count}
                  active={activePage === item.id}
                  onClick={() => navigate(item.id)}
                />
              ))}
            </div>

            {/* Spacer */}
            <div style={{ flex: 1 }} />

            {/* Next-trip card (mobile, slightly larger) */}
            {nextTrip && nextTripCountdown && (
              <div
                role="button"
                onClick={() => { setDrawerOpen(false); setTimeout(() => handleLoad(nextTrip), 80); }}
                style={{
                  padding: 16, borderRadius: 12, background: T.surface,
                  border: `1px solid ${T.border}`, cursor: "pointer", marginBottom: 16,
                }}
              >
                <div style={{ fontSize: 10, fontWeight: 600, color: T.textMuted, letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: 4 }}>
                  NEXT TRIP
                </div>
                <div style={{ fontSize: 15, fontWeight: 600, color: T.text, marginBottom: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {nextTrip.d?.title || nextTrip.name}
                </div>
                {nextTrip.d?.startDate && nextTrip.d?.dayCount && (
                  <div style={{ fontSize: 12, color: T.textMuted, marginBottom: 6 }}>
                    {formatDateRange(nextTrip.d.startDate, nextTrip.d.dayCount)}
                  </div>
                )}
                <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
                  <span style={{ fontSize: 24, fontWeight: 700, fontVariantNumeric: "tabular-nums", color: nextTripCountdown.color }}>
                    {nextTripCountdown.num ?? nextTripCountdown.label}
                  </span>
                  {nextTripCountdown.num != null && (
                    <span style={{ fontSize: 11, color: T.textMuted }}>days away</span>
                  )}
                </div>
              </div>
            )}

            {/* User footer */}
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{
                width: 36, height: 36, borderRadius: "50%", flexShrink: 0,
                background: `linear-gradient(135deg, ${T.accent}, ${T.amber})`,
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <span style={{ color: "#fff", fontSize: 14, fontWeight: 700 }}>
                  {(databases[0]?.label || databases[0]?.githubRepo || "?")[0]?.toUpperCase() ?? "?"}
                </span>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {databases[0]?.label || databases[0]?.githubRepo || "Not connected"}
                </div>
                {databases[0]?.githubBranch && (
                  <div style={{ fontSize: 11, color: T.textMuted }}>{databases[0].githubBranch}</div>
                )}
              </div>
              <button
                onClick={() => { setDrawerOpen(false); setShowSettings(true); }}
                style={{
                  width: 30, height: 30, borderRadius: 8, border: `1px solid ${T.border}`,
                  background: "transparent", cursor: "pointer", color: T.textMuted,
                  display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                }}
              >
                {GearIcon}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
