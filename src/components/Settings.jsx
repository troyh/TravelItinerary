import { useState } from "react";
import { testConnection } from "../lib/github.js";

const S = {
  label: { fontSize: ".62rem", color: "#6b8fa8", letterSpacing: ".08em",
    textTransform: "uppercase", fontFamily: "sans-serif", marginBottom: 3 },
  input: { width: "100%", background: "#0d1f33", border: "1px solid #2e5070", color: "#e8dcc8",
    borderRadius: 4, padding: ".4rem .65rem", fontSize: ".82rem", fontFamily: "sans-serif",
    outline: "none", boxSizing: "border-box" },
  btnPrimary: { background: "#1a3352", border: "1px solid #2e5070", color: "#c9a84c",
    borderRadius: 4, padding: ".35rem .8rem", fontSize: ".75rem", fontFamily: "sans-serif",
    cursor: "pointer" },
  btnGhost: { background: "none", border: "1px solid #2e3a4a", color: "#4e7a9e",
    borderRadius: 4, padding: ".35rem .8rem", fontSize: ".75rem", fontFamily: "sans-serif",
    cursor: "pointer" },
};

export default function Settings({ settings, onSave, onClose }) {
  const [draft, setDraft] = useState({
    googleMapsKey: settings.googleMapsKey ?? "",
    githubToken:   settings.githubToken   ?? "",
    githubRepo:    settings.githubRepo    ?? "",
  });
  const [showToken,  setShowToken]  = useState(false);
  const [testStatus, setTestStatus] = useState(""); // "" | "testing" | "ok" | error message

  const set = (k, v) => setDraft(p => ({ ...p, [k]: v }));

  async function handleTest() {
    setTestStatus("testing");
    try {
      await testConnection({ githubToken: draft.githubToken, githubRepo: draft.githubRepo });
      setTestStatus("ok");
    } catch (e) {
      setTestStatus(e.message);
    }
  }

  return (
    <div style={{ margin: "1rem 0", padding: "1rem 1.25rem", background: "#0a1a2a",
      borderLeft: "3px solid #6b8fa866", borderRadius: "0 6px 6px 0" }}>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
        marginBottom: "1rem" }}>
        <div style={{ fontSize: ".62rem", color: "#6b8fa8", letterSpacing: ".12em",
          textTransform: "uppercase", fontFamily: "sans-serif" }}>
          Settings
        </div>
        <button onClick={onClose} style={{ background: "none", border: "none",
          color: "#4e7a9e", cursor: "pointer", fontSize: ".85rem", padding: 0 }}>
          ×
        </button>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: ".85rem" }}>

        {/* Google Maps */}
        <div>
          <div style={S.label}>Google Maps API Key</div>
          <input value={draft.googleMapsKey} onChange={e => set("googleMapsKey", e.target.value)}
            placeholder="AIzaSy…" style={S.input} />
        </div>

        {/* GitHub Token */}
        <div>
          <div style={S.label}>GitHub Personal Access Token</div>
          <div style={{ display: "flex", gap: ".4rem" }}>
            <input value={draft.githubToken}
              onChange={e => set("githubToken", e.target.value)}
              type={showToken ? "text" : "password"}
              placeholder="ghp_…"
              style={{ ...S.input, flex: 1 }} />
            <button onClick={() => setShowToken(p => !p)}
              style={{ ...S.btnGhost, padding: ".35rem .6rem", flexShrink: 0 }}>
              {showToken ? "Hide" : "Show"}
            </button>
          </div>
        </div>

        {/* GitHub Repo */}
        <div>
          <div style={S.label}>GitHub Repository</div>
          <input value={draft.githubRepo} onChange={e => set("githubRepo", e.target.value)}
            placeholder="owner/repo" style={S.input} />
        </div>

      </div>

      <div style={{ marginTop: "1rem", display: "flex", justifyContent: "space-between",
        alignItems: "center", gap: ".5rem" }}>
        <div style={{ fontSize: ".68rem", color: "#3d5060", fontFamily: "sans-serif",
          fontStyle: "italic" }}>
          Stored in your browser only — never in the repo or build.
        </div>
        <div style={{ display: "flex", gap: ".5rem", flexShrink: 0, alignItems: "center" }}>
          {testStatus && testStatus !== "testing" && (
            <span style={{ fontSize: ".7rem", fontFamily: "sans-serif",
              color: testStatus === "ok" ? "#5cb85c" : "#e87878" }}>
              {testStatus === "ok" ? "✓ Connected" : testStatus}
            </span>
          )}
          <button onClick={handleTest}
            disabled={!draft.githubToken || !draft.githubRepo || testStatus === "testing"}
            style={{ ...S.btnGhost, opacity: (!draft.githubToken || !draft.githubRepo) ? 0.45 : 1 }}>
            {testStatus === "testing" ? "Testing…" : "Test"}
          </button>
          <button onClick={() => onSave(draft)} style={S.btnPrimary}>Save</button>
          <button onClick={onClose} style={S.btnGhost}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
