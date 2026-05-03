import { useState, useEffect, useRef } from "react";
import NoteMarkdown from "./NoteMarkdown.jsx";
import { listItineraries, loadFromGitHub, ITINERARIES_FOLDER, inferRepo } from "../lib/github.js";
import Settings from "./Settings.jsx";

const S = {
  input: { background: "#0d1f33", border: "1px solid #2e5070", color: "#e8dcc8",
    borderRadius: 4, padding: ".45rem .75rem", fontSize: ".88rem", fontFamily: "sans-serif",
    outline: "none", boxSizing: "border-box" },
  btnPrimary: { background: "#1a3352", border: "1px solid #2e5070", color: "#c9a84c",
    borderRadius: 4, padding: ".4rem .9rem", fontSize: ".78rem", fontFamily: "sans-serif",
    cursor: "pointer", whiteSpace: "nowrap" },
  btnGhost: { background: "none", border: "1px solid #2e3a4a", color: "#4e7a9e",
    borderRadius: 4, padding: ".4rem .9rem", fontSize: ".78rem", fontFamily: "sans-serif",
    cursor: "pointer", whiteSpace: "nowrap" },
};

const DB_COLORS = ["#c9a84c", "#4a9eff", "#5cb85c", "#e83870", "#8338e8", "#38a8e8"];
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

// ── Date helpers ──────────────────────────────────────────────────────────────

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

function GapSeparator({ label }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: ".6rem",
      margin: ".35rem 0", fontFamily: "sans-serif" }}>
      <div style={{ flex: 1, height: 1, background: "#1a3040" }} />
      <span style={{ fontSize: ".62rem", color: "#3d5868", letterSpacing: ".1em",
        textTransform: "uppercase", flexShrink: 0 }}>{label}</span>
      <div style={{ flex: 1, height: 1, background: "#1a3040" }} />
    </div>
  );
}

function SectionHeader({ label }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: ".6rem",
      margin: "1.5rem 0 .6rem", fontFamily: "sans-serif" }}>
      <div style={{ width: 16, height: 1, background: "#2e5070" }} />
      <span style={{ fontSize: ".62rem", color: "#4e7a9e", letterSpacing: ".15em",
        textTransform: "uppercase", flexShrink: 0 }}>{label}</span>
      <div style={{ flex: 1, height: 1, background: "#2e5070" }} />
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ItineraryPicker({ settings, onSettingsChange, onLoad, onCreate, localCache }) {
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
  const [expanded,     setExpanded]     = useState(new Set()); // card keys with todos open

  useEffect(() => { document.title = "Travel Itinerary"; }, []);

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
        updates[key] = {
          title:     data.title || null,
          startDate: data.startDate,
          dayCount:  data.days?.length ?? 0,
          locations: overnights.length >= 2 ? `${overnights[0]} → ${overnights[overnights.length - 1]}`
                   : overnights[0] ?? legs[0] ?? null,
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
      const data = await loadFromGitHub({ ...f.ghs, githubFile: f.path });
      onLoad(f.path, data, f.dbId);
    } catch {
      setLoadError("Failed to load — check your connection and token.");
    } finally {
      setLoadingPath(null);
    }
  }

  function handleCreate() {
    if (!newName.trim()) return;
    const dbId = createDbId ?? defaultCreateDbId;
    onCreate(newName.trim(), dbId);
  }

  function toggleExpanded(key, e) {
    e.stopPropagation();
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
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

  const showSectionHeaders = (upcoming.length > 0 && (past.length > 0 || planning.length > 0));

  // ── Card renderer ──────────────────────────────────────────────────────────

  function renderCard(f) {
    const fileKey      = `${f.dbId}:${f.path}`;
    const d            = f.d;
    const displayTitle = d?.title || f.name;
    const isLoading    = loadingPath === fileKey;
    const busy         = !!loadingPath;
    const color        = dbColor(f.dbIdx);
    const hasTodos     = (d?.todos?.length ?? 0) > 0;
    const isExpanded   = expanded.has(fileKey);

    const summaryLine = (() => {
      const parts = [];
      if (d?.startDate && d?.dayCount) {
        parts.push(formatDateRange(d.startDate, d.dayCount));
        parts.push(`${d.dayCount} day${d.dayCount !== 1 ? "s" : ""}`);
      } else if (d?.dayCount) {
        parts.push(`${d.dayCount} day${d.dayCount !== 1 ? "s" : ""}`);
      }
      if (d?.locations) parts.push(d.locations);
      return parts.join(" · ") || null;
    })();

    return (
      <div key={fileKey} onClick={() => !busy && handleLoad(f)}
        style={{ padding: ".75rem 1rem", marginBottom: ".4rem",
          background: "#0d2035", border: "1px solid #1e3a52", borderRadius: 6,
          cursor: busy ? "default" : "pointer",
          opacity: busy && !isLoading ? 0.5 : 1 }}>

        <div style={{ display: "flex", justifyContent: "space-between",
          alignItems: "center", gap: ".5rem" }}>

          {/* Title + badge */}
          <div style={{ flex: 1, minWidth: 0, display: "flex",
            alignItems: "center", gap: ".5rem", flexWrap: "wrap" }}>
            <span style={{ fontSize: ".95rem", color: "#e8dcc8", fontWeight: 500 }}>
              {displayTitle}
            </span>
            {multiDb && (
              <span style={{ fontSize: ".6rem", color, border: `1px solid ${color}55`,
                borderRadius: 3, padding: "1px 5px", fontFamily: "sans-serif",
                letterSpacing: ".06em", textTransform: "uppercase", flexShrink: 0 }}>
                {f.dbLabel}
              </span>
            )}
          </div>

          {/* Right side: loading indicator or expand toggle */}
          {isLoading ? (
            <span style={{ fontSize: ".75rem", fontFamily: "sans-serif",
              flexShrink: 0, color: "#e8dcc8" }}>Loading…</span>
          ) : hasTodos ? (
            <button
              type="button"
              onClick={e => toggleExpanded(fileKey, e)}
              style={{ background: "none", border: "none", color: "#4e7a9e",
                cursor: "pointer", fontSize: ".75rem", flexShrink: 0, padding: "0 .2rem",
                lineHeight: 1 }}>
              {isExpanded ? "▾" : "▸"}
            </button>
          ) : null}
        </div>

        {/* Summary line */}
        {summaryLine && (
          <div style={{ fontFamily: "sans-serif", fontSize: ".72rem", color: "#4e7a9e",
            marginTop: ".25rem", overflow: "hidden", textOverflow: "ellipsis",
            whiteSpace: "nowrap" }}>
            {summaryLine}
          </div>
        )}

        {/* Todos — shown when expanded */}
        {hasTodos && isExpanded && (
          <div style={{ marginTop: ".45rem" }}>
            {d.todos.map((t, i) => (
              <div key={i} style={{ display: "flex", gap: ".4rem",
                alignItems: "baseline", marginBottom: 2 }}>
                <span style={{ color: "#c9a84c", fontSize: ".65rem",
                  flexShrink: 0, marginTop: 2 }}>□</span>
                <div style={{ fontSize: ".72rem", color: "#8fb0cc",
                  lineHeight: 1.4, fontFamily: "sans-serif" }}>
                  <NoteMarkdown>{t}</NoteMarkdown>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  const subtitleText = multiDb
    ? databases.map(db => db.label || db.githubRepo || "—").join(" · ")
    : databases[0]
      ? `${databases[0].githubRepo || inferRepo() || "—"} · ${ITINERARIES_FOLDER}/`
      : "Configure a database in Settings to sync";

  return (
    <div style={{ fontFamily: "Georgia, 'Times New Roman', serif", background: "#0b1929",
      minHeight: "100vh", color: "#e8dcc8" }}>

      {/* Header */}
      <div style={{ background: "linear-gradient(135deg,#0b1929 0%,#112a44 50%,#0b1929 100%)",
        borderBottom: "1px solid #c9a84c33", padding: "2.5rem 2rem 2rem" }}>
        <div style={{ maxWidth: 640, margin: "0 auto" }}>
          <div style={{ display: "flex", justifyContent: "space-between",
            alignItems: "center", marginBottom: ".5rem" }}>
            <div style={{ fontSize: ".7rem", letterSpacing: ".25em", color: "#c9a84c",
              textTransform: "uppercase" }}>Travel Itinerary</div>
            <button onClick={() => setShowSettings(p => !p)} title="Settings"
              style={{ background: "none", border: "none",
                color: showSettings ? "#c9a84c" : "#6b8fa8",
                cursor: "pointer", fontSize: "1rem", padding: 0 }}>⚙</button>
          </div>
          <h1 style={{ fontSize: "clamp(1.4rem,4vw,2rem)", fontWeight: 400,
            color: "#f5edd8", margin: "0 0 .3rem", letterSpacing: "-.02em" }}>
            Your Itineraries
          </h1>
          <p style={{ color: "#6b8fa8", margin: 0, fontSize: ".85rem",
            fontFamily: "sans-serif" }}>{subtitleText}</p>
          {showSettings && (
            <div style={{ marginTop: "1.25rem" }}>
              <Settings settings={settings}
                onSave={draft => { onSettingsChange(draft); setShowSettings(false); }}
                onClose={() => setShowSettings(false)} />
            </div>
          )}
        </div>
      </div>

      <div style={{ maxWidth: 640, margin: "0 auto", padding: "1.5rem 1rem 3rem" }}>

        {/* File list */}
        {hasAnyDb && (
          <div style={{ marginBottom: "2rem" }}>
            {listStatus === "loading" && (
              <div style={{ color: "#4e7a9e", fontFamily: "sans-serif",
                fontSize: ".85rem", padding: ".75rem 0" }}>Loading…</div>
            )}
            {listStatus === "error" && (
              <div style={{ color: "#e87878", fontFamily: "sans-serif",
                fontSize: ".82rem", padding: ".75rem 0" }}>
                Could not load list from GitHub — check your token and repo name.
              </div>
            )}
            {listStatus === "idle" && files.length === 0 && (
              <div style={{ color: "#4e7a9e", fontFamily: "sans-serif",
                fontSize: ".85rem", padding: ".75rem 0", fontStyle: "italic" }}>
                {canWrite
                  ? "No itineraries yet — create one below."
                  : "Add a GitHub token in Settings ⚙ to load your itineraries."}
              </div>
            )}

            {/* ── Upcoming ── */}
            {showSectionHeaders && upcoming.length > 0 && (
              <SectionHeader label="Upcoming" />
            )}
            {upcoming.map((f, i) => {
              const sd = f.d?.startDate;
              const nodes = [];

              // Gap separator before this card
              if (i === 0 && sd) {
                const tripStart = parseDate(sd);
                const gap = daysBetween(todayMidnight, tripStart);
                if (gap > 0)      nodes.push(<GapSeparator key="gap-today" label={`In ${gap} day${gap !== 1 ? "s" : ""}`} />);
                else if (gap === 0) nodes.push(<GapSeparator key="gap-today" label="Starts today" />);
              } else if (i > 0) {
                const prev = upcoming[i - 1];
                const prevEnd = getEndDate(prev.d?.startDate, prev.d?.dayCount);
                if (prevEnd && sd) {
                  const gap = daysBetween(prevEnd, parseDate(sd));
                  if (gap > 0) nodes.push(
                    <GapSeparator key={`gap-${i}`} label={`${gap}-day gap`} />
                  );
                }
              }

              nodes.push(renderCard(f));
              return nodes;
            })}

            {/* ── Planning ── */}
            {planning.length > 0 && <SectionHeader label="Planning" />}
            {planning.map(f => renderCard(f))}

            {/* ── Past ── */}
            {past.length > 0 && <SectionHeader label="Past" />}
            {past.map(f => renderCard(f))}

            {loadError && (
              <div style={{ color: "#e87878", fontFamily: "sans-serif",
                fontSize: ".78rem", marginTop: ".5rem" }}>
                {loadError}
              </div>
            )}
          </div>
        )}

        {/* Local unsaved session */}
        {localCache && (
          <div style={{ marginBottom: "2rem" }}>
            <div style={{ fontSize: ".62rem", color: "#6b8fa8", letterSpacing: ".1em",
              textTransform: "uppercase", fontFamily: "sans-serif", marginBottom: ".5rem" }}>
              Unsaved Local Session
            </div>
            <div style={{ display: "flex", justifyContent: "space-between",
              alignItems: "center", padding: ".85rem 1.1rem",
              background: "#0d2035", border: "1px solid #2e5070", borderRadius: 6 }}>
              <div>
                <div style={{ fontSize: ".9rem", color: "#c8daea", fontWeight: 500 }}>
                  {localCache.title || "Untitled"}
                </div>
                {localCache.days?.length > 0 && (
                  <div style={{ fontSize: ".72rem", color: "#4e7a9e",
                    fontFamily: "sans-serif", marginTop: 2 }}>
                    {localCache.days.length} day{localCache.days.length !== 1 ? "s" : ""}
                  </div>
                )}
              </div>
              <button onClick={() => onLoad("__local__", localCache)}
                style={S.btnGhost}>Resume →</button>
            </div>
          </div>
        )}

        {/* Create new */}
        {canWrite && (
          <div style={{ padding: "1.25rem", background: "#0a1a2a",
            border: "1px solid #1e3a52", borderRadius: 6 }}>
            <div style={{ fontSize: ".62rem", color: "#c9a84c", letterSpacing: ".12em",
              textTransform: "uppercase", fontFamily: "sans-serif", marginBottom: ".85rem" }}>
              New Itinerary
            </div>
            <div style={{ display: "flex", gap: ".5rem", flexWrap: "wrap" }}>
              <input value={newName} onChange={e => setNewName(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleCreate()}
                placeholder="Name — e.g. Pacific Northwest 2027"
                style={{ ...S.input, flex: 1, minWidth: 160 }} />
              {multiDb && writableDbs.length > 1 && (
                <select value={createDbId ?? defaultCreateDbId ?? ""}
                  onChange={e => setCreateDbId(e.target.value)}
                  style={{ ...S.input, width: "auto", cursor: "pointer" }}>
                  {writableDbs.map((db, i) => (
                    <option key={db.id} value={db.id}>{db.label || `DB ${i + 1}`}</option>
                  ))}
                </select>
              )}
              <button onClick={handleCreate} disabled={!newName.trim()}
                style={{ ...S.btnPrimary, opacity: !newName.trim() ? 0.45 : 1 }}>
                Create
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
