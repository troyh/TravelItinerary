import { useState, useEffect } from "react";
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

function getLocations(days) {
  if (!days?.length) return null;
  const overnights = days.map(d => d.overnight).filter(Boolean);
  if (overnights.length >= 2) return `${overnights[0]} → ${overnights[overnights.length - 1]}`;
  if (overnights.length === 1) return overnights[0];
  const legs = days.map(d => d.leg).filter(Boolean);
  return legs.length ? legs[0] : null;
}

function resolveDb(db) {
  const repo = db.githubRepo || inferRepo() || "";
  return { ...db, githubRepo: repo, githubBranch: db.githubBranch || "data" };
}

export default function ItineraryPicker({ settings, onSettingsChange, onLoad, onCreate, localCache }) {
  const [files,        setFiles]        = useState([]);
  const [deletedPaths] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem("itineraryDeletedPaths") || "[]")); }
    catch { return new Set(); }
  });
  const [details,      setDetails]      = useState(() => {
    try { return JSON.parse(localStorage.getItem("itineraryMetadata") || "{}"); } catch { return {}; }
  });
  const [listStatus,   setListStatus]   = useState("idle");
  const [newName,      setNewName]      = useState("");
  const [createDbId,   setCreateDbId]   = useState(null); // which db to create in
  const [loadingPath,  setLoadingPath]  = useState(null);
  const [loadError,    setLoadError]    = useState(null);
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => { document.title = "Travel Itinerary"; }, []);

  const databases   = settings.databases ?? [];
  const writableDbs = databases.filter(db => db.githubToken && (db.githubRepo || inferRepo()));
  const canWrite    = writableDbs.length > 0;
  const hasAnyDb    = databases.some(db => db.githubRepo || inferRepo());
  const multiDb     = databases.length > 1;

  // Default create-db to first writable db
  const defaultCreateDbId = writableDbs[0]?.id ?? null;

  // Load file lists from all databases in parallel
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
      // Filter out recently deleted files (GitHub CDN may still return stale listings)
      const live = allFiles.filter(f => !deletedPaths.has(`${f.dbId}:${f.path}`));
      // Prune confirmed-gone entries from the deleted set
      const stillPresent = new Set(allFiles.map(f => `${f.dbId}:${f.path}`));
      const toRemove = [...deletedPaths].filter(k => !stillPresent.has(k));
      if (toRemove.length) {
        toRemove.forEach(k => deletedPaths.delete(k));
        try { localStorage.setItem("itineraryDeletedPaths", JSON.stringify([...deletedPaths])); } catch {}
      }
      setFiles(live);
      setListStatus("idle");
    });
  }, []);

  // Load details for files missing from local cache (keyed by "dbId:path")
  useEffect(() => {
    if (!files.length) return;
    const missing = files.filter(f => !details[`${f.dbId}:${f.path}`]);
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
        const todoLines = str => (str || "").split("\n").filter(l => /^TODO:/i.test(l.trim())).map(l => l.trim().replace(/^TODO:\s*/i, ""));
        const todos = [
          ...todoLines(data.itineraryNotes),
          ...(data.days ?? []).flatMap(d => todoLines(data.notes?.[d.day] !== undefined ? data.notes[d.day] : d.note)),
        ];
        updates[key] = {
          title:    data.title || null,
          startDate: data.startDate,
          dayCount: data.days?.length ?? 0,
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

  // Sort: dated soonest first, then alphabetical
  const sortedFiles = [...files].sort((a, b) => {
    const da = details[`${a.dbId}:${a.path}`];
    const db = details[`${b.dbId}:${b.path}`];
    const dateA = da?.startDate;
    const dateB = db?.startDate;
    if (dateA && dateB) return dateA.localeCompare(dateB);
    if (dateA) return -1;
    if (dateB) return 1;
    return (da?.title || a.name).localeCompare(db?.title || b.name);
  });

  const subtitleText = multiDb
    ? `${databases.map(db => db.label || db.githubRepo || "—").join(" · ")}`
    : databases[0]
      ? `${databases[0].githubRepo || inferRepo() || "—"} · ${ITINERARIES_FOLDER}/`
      : "Configure a database in Settings to sync";

  return (
    <div style={{ fontFamily: "Georgia, 'Times New Roman', serif", background: "#0b1929",
      minHeight: "100vh", color: "#e8dcc8" }}>

      <div style={{ background: "linear-gradient(135deg,#0b1929 0%,#112a44 50%,#0b1929 100%)",
        borderBottom: "1px solid #c9a84c33", padding: "2.5rem 2rem 2rem" }}>
        <div style={{ maxWidth: 640, margin: "0 auto" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
            marginBottom: ".5rem" }}>
            <div style={{ fontSize: ".7rem", letterSpacing: ".25em", color: "#c9a84c",
              textTransform: "uppercase" }}>Travel Itinerary</div>
            <button onClick={() => setShowSettings(p => !p)} title="Settings"
              style={{ background: "none", border: "none", color: showSettings ? "#c9a84c" : "#6b8fa8",
                cursor: "pointer", fontSize: "1rem", padding: 0 }}>⚙</button>
          </div>
          <h1 style={{ fontSize: "clamp(1.4rem,4vw,2rem)", fontWeight: 400, color: "#f5edd8",
            margin: "0 0 .3rem", letterSpacing: "-.02em" }}>Your Itineraries</h1>
          <p style={{ color: "#6b8fa8", margin: 0, fontSize: ".85rem", fontFamily: "sans-serif" }}>
            {subtitleText}
          </p>
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
              <div style={{ color: "#4e7a9e", fontFamily: "sans-serif", fontSize: ".85rem", padding: ".75rem 0" }}>
                Loading…
              </div>
            )}
            {listStatus === "error" && (
              <div style={{ color: "#e87878", fontFamily: "sans-serif", fontSize: ".82rem", padding: ".75rem 0" }}>
                Could not load list from GitHub — check your token and repo name.
              </div>
            )}
            {listStatus === "idle" && files.length === 0 && (
              <div style={{ color: "#4e7a9e", fontFamily: "sans-serif", fontSize: ".85rem",
                padding: ".75rem 0", fontStyle: "italic" }}>
                {canWrite ? "No itineraries yet — create one below." : "Add a GitHub token in Settings ⚙ to load your itineraries."}
              </div>
            )}

            {sortedFiles.map(f => {
              const cacheKey   = `${f.dbId}:${f.path}`;
              const d          = details[cacheKey];
              const displayTitle = d?.title || f.name;
              const fileKey    = `${f.dbId}:${f.path}`;
              const isLoading  = loadingPath === fileKey;
              const busy       = !!loadingPath;
              const color      = dbColor(f.dbIdx);

              return (
                <div key={fileKey} onClick={() => !busy && handleLoad(f)}
                  style={{ padding: ".85rem 1.1rem", marginBottom: ".4rem",
                    background: "#0d2035", border: "1px solid #1e3a52", borderRadius: 6,
                    cursor: busy ? "default" : "pointer",
                    opacity: busy && !isLoading ? 0.5 : 1 }}>

                  <div style={{ display: "flex", justifyContent: "space-between",
                      alignItems: "flex-start" }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: ".5rem",
                        flexWrap: "wrap", marginBottom: ".15rem" }}>
                        <span style={{ fontSize: ".95rem", color: "#e8dcc8", fontWeight: 500 }}>
                          {displayTitle}
                        </span>
                        {multiDb && (
                          <span style={{ fontSize: ".6rem", color: color, border: `1px solid ${color}55`,
                            borderRadius: 3, padding: "1px 5px", fontFamily: "sans-serif",
                            letterSpacing: ".06em", textTransform: "uppercase", flexShrink: 0 }}>
                            {f.dbLabel}
                          </span>
                        )}
                      </div>
                      {d && (
                        <div style={{ fontFamily: "sans-serif", marginTop: 2 }}>
                          {(d.startDate || d.dayCount > 0) && (
                            <span style={{ fontSize: ".72rem", color: "#6b8fa8" }}>
                              {d.startDate && d.dayCount
                                ? `${formatDateRange(d.startDate, d.dayCount)} · ${d.dayCount} day${d.dayCount !== 1 ? "s" : ""}`
                                : `${d.dayCount} day${d.dayCount !== 1 ? "s" : ""}`}
                            </span>
                          )}
                          {d.locations && (
                            <span style={{ fontSize: ".72rem", color: "#4e7a9e", display: "block",
                              marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {d.locations}
                            </span>
                          )}
                          {d.todos?.length > 0 && (
                            <div style={{ marginTop: 5 }}>
                              {d.todos.map((t, i) => (
                                <div key={i} style={{ display: "flex", gap: ".4rem",
                                  alignItems: "baseline", marginBottom: 2 }}>
                                  <span style={{ color: "#c9a84c", fontSize: ".65rem", flexShrink: 0 }}>□</span>
                                  <span style={{ fontSize: ".72rem", color: "#8fb0cc",
                                    fontFamily: "sans-serif", lineHeight: 1.4 }}>{t}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                    <span style={{ fontSize: ".78rem", fontFamily: "sans-serif", flexShrink: 0,
                      marginLeft: ".75rem", color: isLoading ? "#e8dcc8" : "#4e7a9e" }}>
                      {isLoading ? "Loading…" : "Open →"}
                    </span>
                  </div>

                </div>
              );
            })}

            {loadError && (
              <div style={{ color: "#e87878", fontFamily: "sans-serif", fontSize: ".78rem", marginTop: ".5rem" }}>
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
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
              padding: ".85rem 1.1rem", background: "#0d2035", border: "1px solid #2e5070", borderRadius: 6 }}>
              <div>
                <div style={{ fontSize: ".9rem", color: "#c8daea", fontWeight: 500 }}>
                  {localCache.title || "Untitled"}
                </div>
                {localCache.days?.length > 0 && (
                  <div style={{ fontSize: ".72rem", color: "#4e7a9e", fontFamily: "sans-serif", marginTop: 2 }}>
                    {localCache.days.length} day{localCache.days.length !== 1 ? "s" : ""}
                  </div>
                )}
              </div>
              <button onClick={() => onLoad("__local__", localCache)} style={S.btnGhost}>Resume →</button>
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
