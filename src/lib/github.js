// SHA is tracked per branch+path so switching branches doesn't cause conflicts
const shaByPath   = new Map();
// Tracks files currently being saved so loadFromGitHub doesn't overwrite a fresh SHA mid-save
const savingPaths = new Set();

export function inferRepo() {
  const { hostname, pathname } = window.location;
  const m = hostname.match(/^([^.]+)\.github\.io$/i);
  if (!m) return null;
  const user = m[1];
  const repo = pathname.split("/").filter(Boolean)[0];
  return repo ? `${user}/${repo}` : `${user}/${user}.github.io`;
}

export const ITINERARIES_FOLDER = "Itineraries";

function normalizeRepo(repo) {
  return repo.replace(/^https?:\/\/github\.com\//i, "").replace(/\.git$/i, "").trim();
}

function encodePath(path) {
  return path.split("/").map(encodeURIComponent).join("/");
}

function repoUrl(githubRepo, githubFile) {
  return `https://api.github.com/repos/${normalizeRepo(githubRepo)}/contents/${encodePath(githubFile)}`;
}

function authHeaders(githubToken) {
  const h = { Accept: "application/vnd.github+json" };
  if (githubToken) h.Authorization = `Bearer ${githubToken}`;
  return h;
}

async function throwIfNotOk(res, label) {
  if (res.ok) return;
  let detail = `${res.status}`;
  try { const body = await res.json(); detail = body.message ?? detail; } catch {}
  throw new Error(`${label}: ${detail}`);
}

export async function testConnection({ githubToken, githubRepo }) {
  const repo = normalizeRepo(githubRepo);
  const res = await fetch(
    `https://api.github.com/repos/${repo}`,
    { headers: authHeaders(githubToken) }
  );
  if (res.status === 401) throw new Error("Invalid token");
  if (res.status === 404) throw new Error(`Repo "${repo}" not found — check owner/repo format`);
  await throwIfNotOk(res, "testConnection");
}

export async function listCommits({ githubToken, githubRepo, githubFile, githubBranch = "main" }, page = 1) {
  const res = await fetch(
    `https://api.github.com/repos/${normalizeRepo(githubRepo)}/commits` +
    `?path=${encodePath(githubFile)}&sha=${encodeURIComponent(githubBranch)}&per_page=30&page=${page}`,
    { headers: authHeaders(githubToken) }
  );
  if (!res.ok) return [];
  const commits = await res.json();
  return commits.map(c => ({
    sha:     c.sha,
    message: c.commit.message,
    date:    c.commit.author.date,
  }));
}

export async function listItineraries({ githubToken, githubRepo, githubBranch = "main" }) {
  const res = await fetch(
    `https://api.github.com/repos/${normalizeRepo(githubRepo)}/contents/${ITINERARIES_FOLDER}?ref=${encodeURIComponent(githubBranch)}`,
    { headers: authHeaders(githubToken) }
  );
  if (res.status === 404) return [];
  await throwIfNotOk(res, "listItineraries");
  const items = await res.json();
  return items
    .filter(f => f.type === "file" && f.name.endsWith(".json"))
    .map(f => ({ name: f.name.replace(/\.json$/, ""), path: f.path }));
}

export async function loadFromGitHub({ githubToken, githubRepo, githubFile, githubBranch = "main" }) {
  const url = repoUrl(githubRepo, githubFile) + `?ref=${encodeURIComponent(githubBranch)}`;
  const res = await fetch(url, { headers: authHeaders(githubToken) });
  if (res.status === 404) return null;
  await throwIfNotOk(res, "loadFromGitHub");
  const json = await res.json();
  const shaKey = `${githubBranch}:${githubFile}`;
  if (!savingPaths.has(shaKey)) shaByPath.set(shaKey, json.sha);
  return JSON.parse(decodeURIComponent(escape(atob(json.content.replace(/\s/g, "")))));
}

export async function deleteFromGitHub({ githubToken, githubRepo, githubFile, githubBranch = "main" }) {
  const shaKey = `${githubBranch}:${githubFile}`;
  let sha = shaByPath.get(shaKey);
  if (!sha) {
    const r = await fetch(
      repoUrl(githubRepo, githubFile) + `?ref=${encodeURIComponent(githubBranch)}`,
      { headers: authHeaders(githubToken) }
    );
    if (r.status === 404) return; // file already gone — treat as success
    await throwIfNotOk(r, "deleteFromGitHub (fetch sha)");
    sha = (await r.json()).sha;
  }
  const res = await fetch(repoUrl(githubRepo, githubFile), {
    method: "DELETE",
    headers: { ...authHeaders(githubToken), "Content-Type": "application/json" },
    body: JSON.stringify({
      message: `Remove ${githubFile.replace(/^.*\//, "")}`,
      sha,
      branch: githubBranch,
    }),
  });
  await throwIfNotOk(res, "deleteFromGitHub");
  shaByPath.delete(shaKey);
}

export async function saveToGitHub(data, { githubToken, githubRepo, githubFile, githubBranch = "main", message }) {
  const text = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  const content = btoa(unescape(encodeURIComponent(text)));
  const shaKey = `${githubBranch}:${githubFile}`;

  savingPaths.add(shaKey);
  try {
    // If SHA isn't cached the file may already exist (e.g. placed externally after the app loaded).
    // Fetch it now so the PUT includes the required sha field.
    if (!shaByPath.has(shaKey)) {
      try {
        const r = await fetch(
          repoUrl(githubRepo, githubFile) + `?ref=${encodeURIComponent(githubBranch)}`,
          { headers: authHeaders(githubToken) }
        );
        if (r.ok) shaByPath.set(shaKey, (await r.json()).sha);
      } catch {}
    }

    const putBody = sha => JSON.stringify({
      message: message || `Update itinerary - ${new Date().toISOString().slice(0, 16).replace("T", " ")}`,
      content,
      branch: githubBranch,
      ...(sha ? { sha } : {}),
    });

    let res = await fetch(repoUrl(githubRepo, githubFile), {
      method: "PUT",
      headers: { ...authHeaders(githubToken), "Content-Type": "application/json" },
      body: putBody(shaByPath.get(shaKey)),
    });

    // On 409, fetch the current SHA and retry once so stale-SHA conflicts self-heal.
    if (res.status === 409) {
      try {
        const r = await fetch(
          repoUrl(githubRepo, githubFile) + `?ref=${encodeURIComponent(githubBranch)}`,
          { headers: authHeaders(githubToken) }
        );
        if (r.ok) {
          const freshSha = (await r.json()).sha;
          shaByPath.set(shaKey, freshSha);
          res = await fetch(repoUrl(githubRepo, githubFile), {
            method: "PUT",
            headers: { ...authHeaders(githubToken), "Content-Type": "application/json" },
            body: putBody(freshSha),
          });
        }
      } catch {}
    }

    if (res.status === 409) throw new Error("conflict");
    await throwIfNotOk(res, "saveToGitHub");
    shaByPath.set(shaKey, (await res.json()).content.sha);
  } finally {
    savingPaths.delete(shaKey);
  }
}
