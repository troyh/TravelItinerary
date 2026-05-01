import { useState, useEffect } from "react";
import { listCommits } from "../lib/github.js";

function fmt(iso) {
  return new Date(iso).toLocaleString("en-US", {
    month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit",
  });
}

function fmtShort(iso) {
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric" });
}

const isAutoSave = msg => /^Update itinerary - \d{4}-\d{2}-\d{2}/.test(msg);

// Group flat commit list into milestone and auto-save groups (newest first)
function groupCommits(commits) {
  const groups = [];
  let autoGroup = null;
  for (const c of commits) {
    if (isAutoSave(c.message)) {
      if (!autoGroup) { autoGroup = { type: "auto", commits: [] }; groups.push(autoGroup); }
      autoGroup.commits.push(c);
    } else {
      autoGroup = null;
      groups.push({ type: "milestone", commit: c });
    }
  }
  return groups;
}

const S = {
  btnPrimary: { background: "#1a3352", border: "1px solid #2e5070", color: "#c9a84c",
    borderRadius: 4, padding: ".3rem .7rem", fontSize: ".72rem", fontFamily: "sans-serif",
    cursor: "pointer", whiteSpace: "nowrap" },
  btnGhost: { background: "none", border: "1px solid #2e3a4a", color: "#4e7a9e",
    borderRadius: 4, padding: ".3rem .7rem", fontSize: ".72rem", fontFamily: "sans-serif",
    cursor: "pointer", whiteSpace: "nowrap" },
  input: { width: "100%", background: "#0d1f33", border: "1px solid #2e5070", color: "#e8dcc8",
    borderRadius: 4, padding: ".4rem .65rem", fontSize: ".82rem", fontFamily: "sans-serif",
    outline: "none", boxSizing: "border-box" },
};

export default function HistoryPanel({ settings, currentFile, onRestore, onMilestone, onClose }) {
  const [commits,          setCommits]          = useState([]);
  const [loading,          setLoading]          = useState(true);
  const [error,            setError]            = useState(null);
  const [page,             setPage]             = useState(1);
  const [hasMore,          setHasMore]          = useState(false);
  const [loadingMore,      setLoadingMore]      = useState(false);
  const [confirmSha,       setConfirmSha]       = useState(null);
  const [restoring,        setRestoring]        = useState(false);
  const [expandedGroups,   setExpandedGroups]   = useState(new Set());
  const [showMilestoneForm,setShowMilestoneForm]= useState(false);
  const [milestoneTitle,   setMilestoneTitle]   = useState("");
  const [milestoning,      setMilestoning]      = useState(false);

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

  async function handleMilestone() {
    if (!milestoneTitle.trim()) return;
    setMilestoning(true);
    setError(null);
    try {
      await onMilestone(milestoneTitle.trim());
      // Reload to show the new milestone commit at the top
      const fresh = await listCommits({ ...settings, githubFile: currentFile });
      setCommits(fresh);
      setHasMore(fresh.length === 30);
      setPage(1);
      setShowMilestoneForm(false);
      setMilestoneTitle("");
    } catch (e) {
      setError(`Milestone failed: ${e.message}`);
    } finally {
      setMilestoning(false);
    }
  }

  function toggleGroup(key) {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  const canWrite = !!settings.githubToken;
  const hasAutoSaves = commits.some(c => isAutoSave(c.message));
  const canMilestone = canWrite && !loading && hasAutoSaves;
  const groups = groupCommits(commits);

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
        <div style={{ display: "flex", gap: ".5rem", alignItems: "center" }}>
          {canMilestone && !showMilestoneForm && (
            <button onClick={() => setShowMilestoneForm(true)}
              style={{ ...S.btnGhost, fontSize: ".68rem", padding: ".2rem .55rem" }}>
              + Milestone
            </button>
          )}
          <button onClick={onClose} style={{ background: "none", border: "none",
            color: "#4e7a9e", cursor: "pointer", fontSize: ".85rem", padding: 0 }}>
            ×
          </button>
        </div>
      </div>

      {/* Milestone form */}
      {showMilestoneForm && (
        <div style={{ marginBottom: "1rem", padding: ".75rem", background: "#071520",
          borderLeft: "3px solid #c9a84c66", borderRadius: "0 4px 4px 0" }}>
          <input
            autoFocus
            value={milestoneTitle}
            onChange={e => setMilestoneTitle(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter") handleMilestone();
              if (e.key === "Escape") { setShowMilestoneForm(false); setMilestoneTitle(""); }
            }}
            placeholder="Milestone title…"
            style={S.input}
          />
          <div style={{ display: "flex", gap: ".5rem", marginTop: ".6rem" }}>
            <button onClick={handleMilestone}
              disabled={!milestoneTitle.trim() || milestoning}
              style={{ ...S.btnPrimary, opacity: (!milestoneTitle.trim() || milestoning) ? 0.45 : 1 }}>
              {milestoning ? "Saving…" : "Save Milestone"}
            </button>
            <button onClick={() => { setShowMilestoneForm(false); setMilestoneTitle(""); }}
              disabled={milestoning} style={S.btnGhost}>
              Cancel
            </button>
          </div>
        </div>
      )}

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

      {groups.map((group, gi) => {
        const isLast = gi === groups.length - 1;

        if (group.type === "milestone") {
          const c = group.commit;
          return (
            <div key={c.sha} style={{ paddingBottom: ".75rem", marginBottom: ".75rem",
              borderBottom: !isLast ? "1px solid #1e3a5230" : "none",
              borderLeft: "3px solid #c9a84c66", paddingLeft: ".65rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between",
                alignItems: "flex-start", gap: ".5rem" }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: ".72rem", color: "#c9a84c", fontFamily: "sans-serif",
                    marginBottom: ".2rem" }}>
                    🏁 {fmt(c.date)}
                  </div>
                  <div style={{ fontSize: ".78rem", color: "#f5edd8", fontFamily: "sans-serif",
                    lineHeight: 1.4, fontWeight: 500 }}>
                    {c.message}
                  </div>
                </div>
                {confirmSha !== c.sha && (
                  <button onClick={() => setConfirmSha(c.sha)} disabled={restoring}
                    style={{ ...S.btnGhost, opacity: restoring ? 0.45 : 1, flexShrink: 0 }}>
                    Restore
                  </button>
                )}
              </div>
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
          );
        }

        // Auto-save group
        const { commits: ac } = group;
        const key = ac[0].sha;
        const expanded = expandedGroups.has(key);
        const oldest = ac[ac.length - 1];
        const newest = ac[0];
        const dateRange = ac.length > 1
          ? `${fmtShort(oldest.date)} – ${fmtShort(newest.date)}`
          : fmt(newest.date);

        return (
          <div key={key} style={{ paddingBottom: ".75rem", marginBottom: ".75rem",
            borderBottom: !isLast ? "1px solid #1e3a5230" : "none" }}>

            {/* Collapsed summary row */}
            <div style={{ display: "flex", justifyContent: "space-between",
              alignItems: "center", gap: ".5rem" }}>
              <button onClick={() => toggleGroup(key)}
                style={{ background: "none", border: "none", color: "#4e7a9e",
                  cursor: "pointer", fontFamily: "sans-serif", fontSize: ".78rem",
                  padding: 0, textAlign: "left", flex: 1 }}>
                {expanded ? "▾" : "▸"} {ac.length} auto-save{ac.length !== 1 ? "s" : ""} · {dateRange}
              </button>
            </div>

            {/* Expanded individual commits */}
            {expanded && ac.map((c, i) => (
              <div key={c.sha} style={{ marginTop: ".5rem", paddingLeft: ".75rem",
                borderLeft: "1px solid #1e3a5240" }}>
                <div style={{ display: "flex", justifyContent: "space-between",
                  alignItems: "flex-start", gap: ".5rem" }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: ".68rem", color: "#4e7a9e", fontFamily: "sans-serif" }}>
                      {fmt(c.date)}
                    </div>
                  </div>
                  {confirmSha !== c.sha && (
                    <button onClick={() => setConfirmSha(c.sha)} disabled={restoring}
                      style={{ ...S.btnGhost, opacity: restoring ? 0.45 : 1, flexShrink: 0,
                        fontSize: ".68rem", padding: ".15rem .45rem" }}>
                      Restore
                    </button>
                  )}
                </div>
                {confirmSha === c.sha && (
                  <div style={{ display: "flex", alignItems: "center", gap: ".5rem",
                    marginTop: ".35rem", flexWrap: "wrap" }}>
                    <span style={{ fontSize: ".68rem", color: "#e8a838", fontFamily: "sans-serif" }}>
                      Restore this version?
                    </span>
                    <button onClick={() => handleRestore(c.sha)} disabled={restoring}
                      style={{ ...S.btnPrimary, opacity: restoring ? 0.5 : 1,
                        fontSize: ".68rem", padding: ".15rem .45rem" }}>
                      {restoring ? "Restoring…" : "Confirm"}
                    </button>
                    <button onClick={() => setConfirmSha(null)} disabled={restoring}
                      style={{ ...S.btnGhost, fontSize: ".68rem", padding: ".15rem .45rem" }}>
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        );
      })}

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
