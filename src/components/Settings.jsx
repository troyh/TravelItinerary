import { useState } from "react";
import { testConnection, inferRepo } from "../lib/github.js";

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
  btnDanger: { background: "none", border: "1px solid #3a1a1a", color: "#7a3838",
    borderRadius: 4, padding: ".35rem .8rem", fontSize: ".75rem", fontFamily: "sans-serif",
    cursor: "pointer" },
};

function DbForm({ db, inferredRepo, onSave, onCancel }) {
  const [d, setD] = useState({
    label:       db?.label       ?? "",
    githubToken: db?.githubToken ?? "",
    githubRepo:  db?.githubRepo  ?? "",
    githubBranch:db?.githubBranch?? "",
  });
  const [showToken,  setShowToken]  = useState(false);
  const [testStatus, setTestStatus] = useState("");
  const set = (k, v) => setD(p => ({ ...p, [k]: v }));
  const effectiveRepo = d.githubRepo || inferredRepo || "";

  async function handleTest() {
    setTestStatus("testing");
    try {
      await testConnection({ githubToken: d.githubToken, githubRepo: effectiveRepo });
      setTestStatus("ok");
    } catch (e) { setTestStatus(e.message); }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: ".65rem",
      padding: ".75rem", background: "#071520", borderRadius: 4,
      border: "1px solid #2e5070", marginTop: ".5rem" }}>
      <div>
        <div style={S.label}>Label</div>
        <input value={d.label} onChange={e => set("label", e.target.value)}
          placeholder="e.g. Personal" style={S.input} autoFocus />
      </div>
      <div>
        <div style={S.label}>GitHub Personal Access Token</div>
        <div style={{ display: "flex", gap: ".4rem" }}>
          <input value={d.githubToken} onChange={e => set("githubToken", e.target.value)}
            type={showToken ? "text" : "password"} placeholder="ghp_…"
            style={{ ...S.input, flex: 1 }} />
          <button onClick={() => setShowToken(p => !p)}
            style={{ ...S.btnGhost, padding: ".35rem .6rem", flexShrink: 0 }}>
            {showToken ? "Hide" : "Show"}
          </button>
        </div>
      </div>
      <div>
        <div style={S.label}>Repository <span style={{ color: "#3d5060", fontStyle: "italic" }}>(optional)</span></div>
        <input value={d.githubRepo} onChange={e => set("githubRepo", e.target.value)}
          placeholder={inferredRepo || "owner/repo"} style={S.input} />
      </div>
      <div>
        <div style={S.label}>Branch <span style={{ color: "#3d5060", fontStyle: "italic" }}>(optional)</span></div>
        <input value={d.githubBranch} onChange={e => set("githubBranch", e.target.value)}
          placeholder="data" style={S.input} />
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: ".5rem", flexWrap: "wrap" }}>
        {testStatus && testStatus !== "testing" && (
          <span style={{ fontSize: ".7rem", fontFamily: "sans-serif",
            color: testStatus === "ok" ? "#5cb85c" : "#e87878" }}>
            {testStatus === "ok" ? "✓ Connected" : testStatus}
          </span>
        )}
        <button onClick={handleTest}
          disabled={!d.githubToken || !effectiveRepo || testStatus === "testing"}
          style={{ ...S.btnGhost, opacity: (!d.githubToken || !effectiveRepo) ? 0.45 : 1 }}>
          {testStatus === "testing" ? "Testing…" : "Test"}
        </button>
        <button onClick={() => onSave(d)} disabled={!d.label.trim()}
          style={{ ...S.btnPrimary, opacity: !d.label.trim() ? 0.45 : 1 }}>
          Save
        </button>
        <button onClick={onCancel} style={S.btnGhost}>Cancel</button>
      </div>
    </div>
  );
}

export default function Settings({ settings, onSave, onClose }) {
  const inferredRepo = inferRepo();
  const [tab, setTab] = useState("connections");

  // ── Connections draft ────────────────────────────────────────────────────
  const [draft, setDraft] = useState({
    mapsProvider:     settings.mapsProvider     ?? "google",
    googleMapsKey:    settings.googleMapsKey    ?? "",
    appleMapKitToken: settings.appleMapKitToken ?? "",
  });
  const set = (k, v) => setDraft(p => ({ ...p, [k]: v }));

  // ── Databases draft ──────────────────────────────────────────────────────
  const [dbs, setDbs] = useState(() => settings.databases ?? []);
  const [editingDbId, setEditingDbId] = useState(null); // db id or "new"

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

  function handleSave() {
    onSave({ ...settings, ...draft, databases: dbs,
      // Remove legacy top-level GitHub fields if present
      githubToken: undefined, githubRepo: undefined, githubBranch: undefined });
  }

  return (
    <div style={{ margin: "1rem 0", padding: "1rem 1.25rem", background: "#0a1a2a",
      borderLeft: "3px solid #6b8fa866", borderRadius: "0 6px 6px 0" }}>

      {/* Header */}
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

      {/* Tab toggle */}
      <div style={{ display: "flex", gap: ".4rem", marginBottom: "1rem" }}>
        {[["connections", "Connections"], ["databases", "Databases"]].map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)}
            style={tab === key ? S.btnPrimary : S.btnGhost}>
            {label}
          </button>
        ))}
      </div>

      {/* ── Connections tab ── */}
      {tab === "connections" && (
        <div style={{ display: "flex", flexDirection: "column", gap: ".85rem" }}>
          <div>
            <div style={S.label}>Maps Provider</div>
            <div style={{ display: "flex", gap: ".4rem", marginTop: 3 }}>
              {[{ key: "google", label: "Google Maps" }, { key: "apple", label: "Apple Maps" }].map(p => (
                <button key={p.key} onClick={() => set("mapsProvider", p.key)}
                  style={draft.mapsProvider === p.key ? S.btnPrimary : S.btnGhost}>
                  {p.label}
                </button>
              ))}
            </div>
          </div>
          {draft.mapsProvider === "google" && (
            <div>
              <div style={S.label}>Google Maps API Key</div>
              <input value={draft.googleMapsKey} onChange={e => set("googleMapsKey", e.target.value)}
                placeholder="AIzaSy…" style={S.input} />
            </div>
          )}
          {draft.mapsProvider === "apple" && (
            <div>
              <div style={S.label}>Apple MapKit JS Token</div>
              <input value={draft.appleMapKitToken} onChange={e => set("appleMapKitToken", e.target.value)}
                placeholder="eyJ…" style={S.input} />
              <div style={{ fontSize: ".68rem", color: "#3d5060", fontFamily: "sans-serif",
                fontStyle: "italic", marginTop: 4 }}>
                Generate in Apple Developer → Maps IDs &amp; Keys.
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Databases tab ── */}
      {tab === "databases" && (
        <div>
          {dbs.length === 0 && editingDbId !== "new" && (
            <div style={{ fontSize: ".82rem", color: "#4e7a9e", fontFamily: "sans-serif",
              fontStyle: "italic", marginBottom: ".75rem" }}>
              No databases configured. Add one to enable GitHub sync.
            </div>
          )}

          {dbs.map(db => (
            <div key={db.id} style={{ marginBottom: ".5rem" }}>
              {editingDbId === db.id ? (
                <DbForm db={db} inferredRepo={inferredRepo}
                  onSave={saveDb} onCancel={() => setEditingDbId(null)} />
              ) : (
                <div style={{ display: "flex", justifyContent: "space-between",
                  alignItems: "center", padding: ".6rem .85rem",
                  background: "#0d2035", border: "1px solid #1e3a52", borderRadius: 6 }}>
                  <div>
                    <div style={{ fontSize: ".88rem", color: "#e8dcc8", fontFamily: "sans-serif",
                      fontWeight: 500 }}>{db.label || "Unnamed"}</div>
                    <div style={{ fontSize: ".72rem", color: "#4e7a9e", fontFamily: "sans-serif",
                      marginTop: 2 }}>
                      {[db.githubRepo || inferredRepo || "—", db.githubBranch || "data"].join(" · ")}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: ".4rem" }}>
                    <button onClick={() => setEditingDbId(db.id)} style={{ ...S.btnGhost, fontSize: ".68rem", padding: ".2rem .55rem" }}>Edit</button>
                    <button onClick={() => deleteDb(db.id)} style={{ ...S.btnDanger, fontSize: ".68rem", padding: ".2rem .55rem" }}>✕</button>
                  </div>
                </div>
              )}
            </div>
          ))}

          {editingDbId === "new" ? (
            <DbForm db={null} inferredRepo={inferredRepo}
              onSave={saveDb} onCancel={() => setEditingDbId(null)} />
          ) : (
            <button onClick={() => setEditingDbId("new")}
              style={{ ...S.btnGhost, marginTop: ".25rem", fontSize: ".75rem" }}>
              + Add Database
            </button>
          )}
        </div>
      )}

      {/* Footer */}
      <div style={{ marginTop: "1rem", display: "flex", justifyContent: "space-between",
        alignItems: "center", gap: ".5rem" }}>
        <div style={{ fontSize: ".68rem", color: "#3d5060", fontFamily: "sans-serif",
          fontStyle: "italic" }}>
          Stored in your browser only. Changing providers takes effect after reload.
        </div>
        <div style={{ display: "flex", gap: ".5rem", flexShrink: 0 }}>
          <button onClick={handleSave} style={S.btnPrimary}>Save</button>
          <button onClick={onClose} style={S.btnGhost}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
