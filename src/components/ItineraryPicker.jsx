import { useState, useEffect } from "react";
import { listItineraries, loadFromGitHub, ITINERARIES_FOLDER, inferRepo } from "../lib/github.js";
import Settings from "./Settings.jsx";

function sanitizeFilename(name) {
  return name.trim().replace(/[^\w\s-]/g, "").replace(/\s+/g, " ").trim().slice(0, 80);
}

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

export default function ItineraryPicker({ settings, onSettingsChange, onLoad, onCreate, localCache }) {
  const [files,        setFiles]        = useState([]);
  const [listStatus,   setListStatus]   = useState("idle"); // idle|loading|error
  const [newName,      setNewName]      = useState("");
  const [creating,     setCreating]     = useState(false);
  const [loadingPath,  setLoadingPath]  = useState(null);
  const [loadError,    setLoadError]    = useState(null);
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => { document.title = "Travel Itinerary"; }, []);

  const effectiveRepo = settings.githubRepo || inferRepo() || "";
  const ghSettings = { ...settings, githubRepo: effectiveRepo, githubBranch: settings.githubBranch || "data" };
  const canRead  = !!effectiveRepo;
  const canWrite = !!(settings.githubToken && effectiveRepo);
  const hasGitHub = canRead;

  useEffect(() => {
    if (!hasGitHub) return;
    setListStatus("loading");
    listItineraries(ghSettings)
      .then(f => { setFiles(f); setListStatus("idle"); })
      .catch(() => setListStatus("error"));
  }, []);

  async function handleLoad(path) {
    setLoadingPath(path);
    setLoadError(null);
    try {
      const data = await loadFromGitHub({ ...ghSettings, githubFile: path });
      onLoad(path, data);
    } catch {
      setLoadError(`Failed to load — check your connection and token.`);
    } finally {
      setLoadingPath(null);
    }
  }

  function handleCreate() {
    const name = sanitizeFilename(newName);
    if (!name) return;
    onCreate(name);
  }

  const nameConflict = newName.trim() &&
    files.some(f => f.name.toLowerCase() === sanitizeFilename(newName).toLowerCase());

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
            {files.map(f => (
              <div key={f.path} style={{ display: "flex", justifyContent: "space-between",
                alignItems: "center", padding: ".85rem 1.1rem", marginBottom: ".4rem",
                background: "#0d2035", border: "1px solid #1e3a52", borderRadius: 6 }}>
                <span style={{ fontSize: ".95rem", color: "#e8dcc8" }}>{f.name}</span>
                <button onClick={() => handleLoad(f.path)}
                  disabled={loadingPath !== null}
                  style={{ ...S.btnGhost, opacity: loadingPath ? 0.5 : 1 }}>
                  {loadingPath === f.path ? "Loading…" : "Open →"}
                </button>
              </div>
            ))}
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
              <span style={{ fontSize: ".9rem", color: "#c8daea" }}>
                {localCache.title || "Untitled"}{" "}
                <span style={{ fontSize: ".75rem", color: "#4e7a9e", fontFamily: "sans-serif" }}>
                  · {localCache.days?.length ?? 0} days
                </span>
              </span>
              <button onClick={() => onLoad("__local__", localCache)} style={S.btnGhost}>
                Resume →
              </button>
            </div>
          </div>
        )}

        {/* Create new */}
        {canWrite && (<div style={{ padding: "1.25rem", background: "#0a1a2a",
          border: "1px solid #1e3a52", borderRadius: 6 }}>
          <div style={{ fontSize: ".62rem", color: "#c9a84c", letterSpacing: ".12em",
            textTransform: "uppercase", fontFamily: "sans-serif", marginBottom: ".85rem" }}>
            New Itinerary
          </div>
          <div style={{ display: "flex", gap: ".5rem" }}>
            <input
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => e.key === "Enter" && !nameConflict && handleCreate()}
              placeholder="Name — e.g. Pacific Northwest 2027"
              style={{ ...S.input, flex: 1 }}
            />
            <button onClick={handleCreate}
              disabled={!newName.trim() || nameConflict}
              style={{ ...S.btnPrimary, opacity: (!newName.trim() || nameConflict) ? 0.45 : 1 }}>
              Create
            </button>
          </div>
          {nameConflict && (
            <div style={{ fontSize: ".72rem", color: "#e8a838", fontFamily: "sans-serif",
              marginTop: ".4rem" }}>
              An itinerary with this name already exists — open it from the list above.
            </div>
          )}
        </div>)}

      </div>
    </div>
  );
}
