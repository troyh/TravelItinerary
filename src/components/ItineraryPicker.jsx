import { useState, useEffect } from "react";
import { listItineraries, loadFromGitHub, saveToGitHub, deleteFromGitHub, ITINERARIES_FOLDER, inferRepo } from "../lib/github.js";
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

export default function ItineraryPicker({ settings, onSettingsChange, onLoad, onCreate, localCache }) {
  const [files,        setFiles]        = useState([]);
  const [details,      setDetails]      = useState(() => {
    try { return JSON.parse(localStorage.getItem("itineraryMetadata") || "{}"); } catch { return {}; }
  });
  const [listStatus,   setListStatus]   = useState("idle");
  const [newName,      setNewName]      = useState("");
  const [loadingPath,  setLoadingPath]  = useState(null);
  const [loadError,    setLoadError]    = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [confirmDelete,setConfirmDelete]= useState(null);
  const [deleting,     setDeleting]     = useState(null);
  const [duplicating,  setDuplicating]  = useState(null);

  useEffect(() => { document.title = "Travel Itinerary"; }, []);

  const effectiveRepo = settings.githubRepo || inferRepo() || "";
  const ghSettings = { ...settings, githubRepo: effectiveRepo, githubBranch: settings.githubBranch || "data" };
  const canRead  = !!effectiveRepo;
  const canWrite = !!(settings.githubToken && effectiveRepo);
  const hasGitHub = canRead;

  // Load file list
  useEffect(() => {
    if (!hasGitHub) return;
    setListStatus("loading");
    listItineraries(ghSettings)
      .then(f => { setFiles(f); setListStatus("idle"); })
      .catch(() => setListStatus("error"));
  }, []);

  // Load details for files missing from local cache
  useEffect(() => {
    if (!files.length) return;
    const cached = details;
    const missing = files.filter(f => !cached[f.path]);
    if (!missing.length) return;
    Promise.all(
      missing.map(f =>
        loadFromGitHub({ ...ghSettings, githubFile: f.path })
          .then(data => data ? [f.path, data] : null)
          .catch(() => null)
      )
    ).then(results => {
      const updates = {};
      for (const r of results) {
        if (!r) continue;
        const [path, data] = r;
        const overnights = data.days?.map(d => d.overnight).filter(Boolean) ?? [];
        const legs       = data.days?.map(d => d.leg).filter(Boolean) ?? [];
        const locations  = overnights.length >= 2 ? `${overnights[0]} → ${overnights[overnights.length - 1]}`
                         : overnights[0] ?? legs[0] ?? null;
        updates[path] = {
          title:    data.title || null,
          startDate: data.startDate,
          dayCount: data.days?.length ?? 0,
          locations,
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

  async function handleLoad(path) {
    setLoadingPath(path);
    setLoadError(null);
    try {
      const data = await loadFromGitHub({ ...ghSettings, githubFile: path });
      onLoad(path, data);
    } catch {
      setLoadError("Failed to load — check your connection and token.");
    } finally {
      setLoadingPath(null);
    }
  }

  function handleCreate() {
    if (!newName.trim()) return;
    onCreate(newName.trim());
  }

  async function handleDuplicate(f) {
    setDuplicating(f.path);
    try {
      const data = await loadFromGitHub({ ...ghSettings, githubFile: f.path });
      if (!data) return;
      const newPath = `${ITINERARIES_FOLDER}/it-${crypto.randomUUID().slice(0, 8)}.json`;
      const copy = { ...data, title: `Copy of ${data.title || f.name}` };
      await saveToGitHub(copy, { ...ghSettings, githubFile: newPath });
      const newFile = { name: newPath.replace(/^.*\//, "").replace(/\.json$/i, ""), path: newPath };
      const overnights = data.days?.map(d => d.overnight).filter(Boolean) ?? [];
      const legs       = data.days?.map(d => d.leg).filter(Boolean) ?? [];
      const locations  = overnights.length >= 2 ? `${overnights[0]} → ${overnights[overnights.length - 1]}`
                       : overnights[0] ?? legs[0] ?? null;
      const newMeta = { title: copy.title, startDate: data.startDate,
                        dayCount: data.days?.length ?? 0, locations };
      setFiles(prev => [newFile, ...prev]);
      setDetails(prev => ({ ...prev, [newPath]: newMeta }));
      try {
        const meta = JSON.parse(localStorage.getItem("itineraryMetadata") || "{}");
        localStorage.setItem("itineraryMetadata", JSON.stringify({ ...meta, [newPath]: newMeta }));
      } catch {}
    } catch {
      setLoadError("Duplicate failed — check your connection.");
    } finally {
      setDuplicating(null);
    }
  }

  async function handleDelete(path) {
    setDeleting(path);
    try {
      await deleteFromGitHub({ ...ghSettings, githubFile: path });
      try { await deleteFromGitHub({ ...ghSettings, githubFile: path.replace(/\.json$/i, ".ics") }); } catch {}
      // Remove from local state immediately — don't re-fetch (GitHub CDN caches the directory listing)
      setFiles(prev => prev.filter(f => f.path !== path));
      setDetails(prev => { const n = { ...prev }; delete n[path]; return n; });
      setConfirmDelete(null);
      try {
        const meta = JSON.parse(localStorage.getItem("itineraryMetadata") || "{}");
        delete meta[path];
        localStorage.setItem("itineraryMetadata", JSON.stringify(meta));
      } catch {}
    } catch (e) {
      setLoadError(`Delete failed: ${e.message}`);
      setConfirmDelete(null);
    } finally {
      setDeleting(null);
    }
  }

  // Sort files by most recently modified (details loaded) — fall back to alphabetical
  const sortedFiles = [...files].sort((a, b) => {
    const da = details[a.path];
    const db = details[b.path];
    const dateA = da?.startDate;
    const dateB = db?.startDate;
    if (dateA && dateB) return dateA.localeCompare(dateB); // both dated: soonest first
    if (dateA) return -1;                                   // only A has date: A first
    if (dateB) return 1;                                    // only B has date: B first
    const na = da?.title || a.name;                         // neither dated: alphabetical
    const nb = db?.title || b.name;
    return na.localeCompare(nb);
  });


  return (
    <div style={{ fontFamily: "Georgia, 'Times New Roman', serif", background: "#0b1929",
      minHeight: "100vh", color: "#e8dcc8" }}>

      {/* Header */}
      <div style={{ background: "linear-gradient(135deg,#0b1929 0%,#112a44 50%,#0b1929 100%)",
        borderBottom: "1px solid #c9a84c33", padding: "2.5rem 2rem 2rem" }}>
        <div style={{ maxWidth: 640, margin: "0 auto" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
            marginBottom: ".5rem" }}>
            <div style={{ fontSize: ".7rem", letterSpacing: ".25em", color: "#c9a84c",
              textTransform: "uppercase" }}>
              Travel Itinerary
            </div>
            <button onClick={() => setShowSettings(p => !p)} title="Settings"
              style={{ background: "none", border: "none", color: showSettings ? "#c9a84c" : "#6b8fa8",
                cursor: "pointer", fontSize: "1rem", padding: 0 }}>
              ⚙
            </button>
          </div>
          <h1 style={{ fontSize: "clamp(1.4rem,4vw,2rem)", fontWeight: 400, color: "#f5edd8",
            margin: "0 0 .3rem", letterSpacing: "-.02em" }}>
            Your Itineraries
          </h1>
          <p style={{ color: "#6b8fa8", margin: 0, fontSize: ".85rem", fontFamily: "sans-serif" }}>
            {canRead
              ? `${effectiveRepo} · ${ITINERARIES_FOLDER}/`
              : "Configure GitHub in Settings to sync across devices"}
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

        {/* GitHub file list */}
        {hasGitHub && (
          <div style={{ marginBottom: "2rem" }}>
            {listStatus === "loading" && (
              <div style={{ color: "#4e7a9e", fontFamily: "sans-serif", fontSize: ".85rem",
                padding: ".75rem 0" }}>
                Loading…
              </div>
            )}
            {listStatus === "error" && (
              <div style={{ color: "#e87878", fontFamily: "sans-serif", fontSize: ".82rem",
                padding: ".75rem 0" }}>
                Could not load list from GitHub — check your token and repo name.
              </div>
            )}
            {listStatus === "idle" && files.length === 0 && (
              <div style={{ color: "#4e7a9e", fontFamily: "sans-serif", fontSize: ".85rem",
                padding: ".75rem 0", fontStyle: "italic" }}>
                {canWrite
                  ? "No itineraries yet — create one below."
                  : "Add a GitHub token in Settings ⚙ to load your itineraries."}
              </div>
            )}
            {sortedFiles.map(f => {
              const d = details[f.path];
              const displayTitle = d?.title || f.name;
              const isDeleting   = deleting === f.path;
              const isDuplicating = duplicating === f.path;
              const busy         = !!loadingPath || isDeleting || isDuplicating;
              return (
                <div key={f.path}
                  style={{ padding: ".85rem 1.1rem", marginBottom: ".4rem",
                    background: "#0d2035", border: "1px solid #1e3a52", borderRadius: 6,
                    opacity: busy && loadingPath !== f.path && !isDeleting && !isDuplicating ? 0.5 : 1 }}>

                  {/* Main row — click to open */}
                  <div onClick={() => !busy && handleLoad(f.path)}
                    style={{ display: "flex", justifyContent: "space-between",
                      alignItems: "flex-start", cursor: busy ? "default" : "pointer" }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: ".95rem", color: "#e8dcc8", fontWeight: 500,
                        lineHeight: 1.3 }}>
                        {displayTitle}
                      </div>
                      {d && (
                        <div style={{ fontFamily: "sans-serif", marginTop: 3 }}>
                          {(d.startDate || d.dayCount > 0) && (
                            <span style={{ fontSize: ".72rem", color: "#6b8fa8" }}>
                              {d.startDate && d.dayCount
                                ? `${formatDateRange(d.startDate, d.dayCount)} · ${d.dayCount} day${d.dayCount !== 1 ? "s" : ""}`
                                : `${d.dayCount} day${d.dayCount !== 1 ? "s" : ""}`}
                            </span>
                          )}
                          {d.locations && (
                            <span style={{ fontSize: ".72rem", color: "#4e7a9e",
                              display: "block", marginTop: 1,
                              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {d.locations}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                    <span style={{ fontSize: ".78rem", fontFamily: "sans-serif", flexShrink: 0,
                      marginLeft: ".75rem", color: loadingPath === f.path ? "#e8dcc8" : "#4e7a9e" }}>
                      {loadingPath === f.path ? "Loading…" : "Open →"}
                    </span>
                  </div>

                  {/* Action row — write-only */}
                  {canWrite && !confirmDelete && (
                    <div onClick={e => e.stopPropagation()}
                      style={{ display: "flex", gap: ".4rem", marginTop: ".6rem" }}>
                      <button onClick={() => !busy && handleDuplicate(f)}
                        disabled={busy}
                        style={{ ...S.btnGhost, fontSize: ".68rem", padding: ".2rem .55rem",
                          opacity: busy ? 0.45 : 1 }}>
                        {isDuplicating ? "Duplicating…" : "Duplicate"}
                      </button>
                      <button onClick={() => !busy && setConfirmDelete(f.path)}
                        disabled={busy}
                        style={{ ...S.btnGhost, fontSize: ".68rem", padding: ".2rem .55rem",
                          color: "#7a3838", borderColor: "#3a1a1a", opacity: busy ? 0.45 : 1 }}>
                        Delete
                      </button>
                    </div>
                  )}

                  {/* Delete confirmation */}
                  {confirmDelete === f.path && (
                    <div onClick={e => e.stopPropagation()}
                      style={{ display: "flex", alignItems: "center", gap: ".5rem",
                        marginTop: ".6rem", flexWrap: "wrap" }}>
                      <span style={{ fontSize: ".72rem", color: "#e8a838",
                        fontFamily: "sans-serif" }}>
                        Delete "{displayTitle}"?
                      </span>
                      <button onClick={() => handleDelete(f.path)} disabled={isDeleting}
                        style={{ ...S.btnGhost, fontSize: ".68rem", padding: ".2rem .55rem",
                          color: "#e87878", borderColor: "#5a1a1a",
                          opacity: isDeleting ? 0.5 : 1 }}>
                        {isDeleting ? "Deleting…" : "Yes, delete"}
                      </button>
                      <button onClick={() => setConfirmDelete(null)} disabled={isDeleting}
                        style={{ ...S.btnGhost, fontSize: ".68rem", padding: ".2rem .55rem" }}>
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
            {loadError && (
              <div style={{ color: "#e87878", fontFamily: "sans-serif", fontSize: ".78rem",
                marginTop: ".5rem" }}>
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
              padding: ".85rem 1.1rem", background: "#0d2035",
              border: "1px solid #2e5070", borderRadius: 6 }}>
              <div>
                <div style={{ fontSize: ".9rem", color: "#c8daea", fontWeight: 500 }}>
                  {localCache.title || "Untitled"}
                </div>
                {localCache.days?.length > 0 && (
                  <div style={{ fontSize: ".72rem", color: "#4e7a9e", fontFamily: "sans-serif",
                    marginTop: 2 }}>
                    {localCache.days.length} day{localCache.days.length !== 1 ? "s" : ""}
                  </div>
                )}
              </div>
              <button onClick={() => onLoad("__local__", localCache)} style={S.btnGhost}>
                Resume →
              </button>
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
            <div style={{ display: "flex", gap: ".5rem" }}>
              <input
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleCreate()}
                placeholder="Name — e.g. Pacific Northwest 2027"
                style={{ ...S.input, flex: 1 }}
              />
              <button onClick={handleCreate}
                disabled={!newName.trim()}
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
