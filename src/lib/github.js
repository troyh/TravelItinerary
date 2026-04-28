let currentSha = null;

export async function loadFromGitHub({ githubToken, githubRepo, githubFile = "itinerary-data.json" }) {
  const res = await fetch(
    `https://api.github.com/repos/${githubRepo}/contents/${githubFile}`,
    { headers: { Authorization: `Bearer ${githubToken}`, Accept: "application/vnd.github+json" } }
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${res.status}`);
  const json = await res.json();
  currentSha = json.sha;
  return JSON.parse(atob(json.content.replace(/\s/g, "")));
}

export async function saveToGitHub(data, { githubToken, githubRepo, githubFile = "itinerary-data.json" }) {
  const content = btoa(JSON.stringify(data, null, 2));
  const res = await fetch(
    `https://api.github.com/repos/${githubRepo}/contents/${githubFile}`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${githubToken}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: `Update itinerary — ${new Date().toISOString().slice(0, 16).replace("T", " ")}`,
        content,
        ...(currentSha ? { sha: currentSha } : {}),
      }),
    }
  );
  if (res.status === 409) throw new Error("conflict");
  if (!res.ok) throw new Error(`${res.status}`);
  currentSha = (await res.json()).content.sha;
}
