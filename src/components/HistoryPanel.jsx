import { useState, useEffect } from "react";
import { listCommits } from "../lib/github.js";

function fmt(iso) {
  return new Date(iso).toLocaleString("en-US", {
    month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit",
  });
}

const S = {
  btnPrimary: { background: "#1a3352", border: "1px solid #2e5070", color: "#c9a84c",
    borderRadius: 4, padding: ".3rem .7rem", fontSize: ".72rem", fontFamily: "sans-serif",
    cursor: "pointer", whiteSpace: "nowrap" },
  btnGhost: { background: "none", border: "1px solid #2e3a4a", color: "#4e7a9e",
    borderRadius: 4, padding: ".3rem .7rem", fontSize: ".72rem", fontFamily: "sans-serif",
    cursor: "pointer", whiteSpace: "nowrap" },
};

export default function HistoryPanel({ settings, currentFile, onRestore, onClose }) {
  const [commits,    setCommits]    = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState(null);
  const [page,       setPage]       = useState(1);
  const [hasMore,    setHasMore]    = useState(false);
  const [loadingMore,setLoadingMore]= useState(false);
  const [confirmSha, setConfirmSha] = useState(null);
  const [restoring,  setRestoring]  = useState(false);

  useEffect(() => {
    listCommits({ ...settings, githubFile: currentFile })
      .then(c => { setCommits(c); setHasMore(c.length === 30); setLoading(false); })
      .catch(() => { setError("Could not load history — check your connection."); setLoading(false); });
  }, []);

  async function loadMore() {
    const next = page + 1;
    setLoadingMore(true);
    const more = await listCommits({ ...settings, githubFile: currentFile }, next);
    setCommits(prev => [...prev, ...more]);
    setHasMore(more.length === 30);
    setPage(next);
    setLoadingMore(false);
  }

  async function handleRestore(sha) {
    setRestoring(true);
    try { await onRestore(sha); }
    finally { setRestoring(false); setConfirmSha(null); }
  }

  return (
    <div style={{ margin: ".75rem 0 1rem", padding: "1rem 1.25rem", background: "#0a1a2a",
      borderLeft: "3px solid #6b8fa866", borderRadius: "0 6px 6px 0" }}>

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
        marginBottom: ".85rem" }}>
        <div style={{ fontSize: ".62rem", color: "#6b8fa8", letterSpacing: ".12em",
          textTransform: "uppercase", fontFamily: "sans-serif" }}>
          Version History
        </div>
        <button onClick={onClose} style={{ background: "none", border: "none",
          color: "#4e7a9e", cursor: "pointer", fontSize: ".85rem", padding: 0 }}>
          ×
        </button>
      </div>

      {/* Body */}
      {loading && (
        <div style={{ color: "#4e7a9e", fontFamily: "sans-serif", fontSize: ".82rem" }}>
          Loading…
        </div>
      )}
      {error && (
        <div style={{ color: "#e87878", fontFamily: "sans-serif", fontSize: ".78rem" }}>
          {error}
        </div>
      )}
      {!loading && !error && commits.length === 0 && (
        <div style={{ color: "#4e7a9e", fontFamily: "sans-serif", fontSize: ".82rem",
          fontStyle: "italic" }}>
          No version history yet.
        </div>
      )}

      {commits.map((c, i) => (
        <div key={c.sha} style={{ paddingBottom: ".75rem", marginBottom: ".75rem",
          borderBottom: i < commits.length - 1 ? "1px solid #1e3a5230" : "none" }}>

          {/* Date + message row */}
          <div style={{ display: "flex", justifyContent: "space-between",
            alignItems: "flex-start", gap: ".5rem" }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: ".72rem", color: "#c9a84c", fontFamily: "sans-serif",
                marginBottom: ".2rem" }}>
                {fmt(c.date)}
              </div>
              <div style={{ fontSize: ".78rem", color: "#8fb0cc", fontFamily: "sans-serif",
                lineHeight: 1.4 }}>
                {c.message}
              </div>
            </div>
            {confirmSha !== c.sha && (
              <button onClick={() => setConfirmSha(c.sha)}
                disabled={restoring}
                style={{ ...S.btnGhost, opacity: restoring ? 0.45 : 1, flexShrink: 0 }}>
                Restore
              </button>
            )}
          </div>

          {/* Inline confirm */}
          {confirmSha === c.sha && (
            <div style={{ display: "flex", alignItems: "center", gap: ".5rem",
              marginTop: ".5rem", flexWrap: "wrap" }}>
              <span style={{ fontSize: ".72rem", color: "#e8a838", fontFamily: "sans-serif" }}>
                Restore this version?
              </span>
              <button onClick={() => handleRestore(c.sha)} disabled={restoring}
                style={{ ...S.btnPrimary, opacity: restoring ? 0.5 : 1 }}>
                {restoring ? "Restoring…" : "Confirm"}
              </button>
              <button onClick={() => setConfirmSha(null)} disabled={restoring}
                style={S.btnGhost}>
                Cancel
              </button>
            </div>
          )}
        </div>
      ))}

      {hasMore && (
        <button onClick={loadMore} disabled={loadingMore}
          style={{ ...S.btnGhost, width: "100%", marginTop: ".25rem",
            opacity: loadingMore ? 0.5 : 1 }}>
          {loadingMore ? "Loading…" : "Load more"}
        </button>
      )}
    </div>
  );
}
