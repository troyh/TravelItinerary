const API = "https://api.anthropic.com/v1/messages";

export const CLAUDE_MODELS = [
  { id: "claude-sonnet-4-6",          label: "Sonnet 4.6" },
  { id: "claude-haiku-4-5-20251001",  label: "Haiku 4.5"  },
];

export const SYSTEM_FULL_ITINERARY = `You are a travel planning assistant. Generate a complete travel itinerary from the user's description.

Return ONLY valid JSON (no markdown, no explanation):
{
  "title": "Trip title",
  "subtitle": "Short route or tagline",
  "startDate": "YYYY-MM-DD or null if not specified",
  "days": [{ "day": 1, "leg": "From → To", "overnight": "City, ST/Country" }],
  "highlights": { "1": ["text", ...], "2": [...] },
  "places": {
    "1": [{ "name": "Place name", "category": "restaurant|activity|accommodation|other", "notes": "1-2 sentence description" }]
  }
}

Include 2–4 highlights and 2–4 places per day. Use day numbers as string keys in highlights and places.`;

export const SYSTEM_DAY_SUGGESTIONS = `You are a travel assistant suggesting activities and places for a single travel day.

Return ONLY valid JSON (no markdown, no explanation):
{
  "places": [{ "name": "Place name", "category": "restaurant|marina|accommodation|provisioning|activity|other", "notes": "1-2 sentence description" }],
  "highlights": ["text", ...]
}

Suggest 2–5 places and 2–4 highlights. Be specific and practical.`;

export function buildConciergeSystem({ title, subtitle, startDate, days, vehicles = [] }) {
  const dateStr = startDate
    ? (() => {
        const [y, m, d] = startDate.split("-").map(Number);
        const end = new Date(y, m - 1, d + days.length - 1);
        const fmt = (dt, yr) => dt.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(yr ? { year: "numeric" } : {}) });
        return `${fmt(new Date(y, m - 1, d))} – ${fmt(end, true)}`;
      })()
    : "dates TBD";

  const dayLines = days.map(d =>
    `Day ${d.day}: ${d.leg || "untitled"}${d.overnight ? ` · ${d.overnight}` : ""}`
  ).join("\n");

  const vehicleStr = vehicles.length
    ? `\nVehicles: ${vehicles.map(v => v.name).join(", ")}`
    : "";

  return `You are a knowledgeable travel concierge for the trip "${title}${subtitle ? ` — ${subtitle}` : ""}".
Dates: ${dateStr} (${days.length} ${days.length === 1 ? "day" : "days"})

${dayLines}${vehicleStr}

Help the user plan: suggest places, draft days, answer travel questions, create packing lists. Be direct and opinionated — give specific recommendations with reasons. You cannot book reservations or make payments. Do not start responses with "I" or filler phrases like "Of course!" or "Great question!". Format responses as plain prose; use short lists when listing places or items.`;
}

export async function chatClaude({ messages, system, apiKey, model = "claude-sonnet-4-6" }) {
  const res = await fetch(API, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model,
      max_tokens: 1500,
      system,
      messages,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message ?? `API error ${res.status}`);
  }
  const data = await res.json();
  return data.content?.[0]?.text ?? "";
}

export async function askClaude({ prompt, system, apiKey, model = "claude-sonnet-4-6", maxTokens = 2000 }) {
  const res = await fetch(API, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message ?? `API error ${res.status}`);
  }
  const data = await res.json();
  const text = data.content?.[0]?.text ?? "";
  // Extract outermost {...} — handles preamble text and markdown fences
  const start = text.indexOf("{");
  const end   = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) throw new Error("No JSON in response");
  return JSON.parse(text.slice(start, end + 1));
}
