const BASE = "https://waypoint.troyhakala.com";
const TTL  = 24 * 60 * 60 * 1000; // 24 h — tide predictions are deterministic

async function waypointFetch(path, lat, lon, date) {
  const key = `waypoint:${path}:${lat.toFixed(4)}:${lon.toFixed(4)}:${date}`;
  const hit = localStorage.getItem(key);
  if (hit) {
    try {
      const { data, ts } = JSON.parse(hit);
      if (Date.now() - ts < TTL) return data;
    } catch { /* ignore corrupt cache */ }
  }
  const res = await fetch(`${BASE}/${path}?lat=${lat}&lon=${lon}&date=${date}`);
  if (!res.ok) throw new Error(`${path} API error ${res.status}`);
  const data = await res.json();
  localStorage.setItem(key, JSON.stringify({ data, ts: Date.now() }));
  return data;
}

export const fetchTides    = (lat, lon, date) => waypointFetch("tides",    lat, lon, date);
export const fetchCurrents = (lat, lon, date) => waypointFetch("currents", lat, lon, date);

export async function fetchTimezone(lat, lon) {
  const key = `waypoint:tz:${lat.toFixed(2)}:${lon.toFixed(2)}`;
  const hit = localStorage.getItem(key);
  if (hit) return hit;
  const res = await fetch(`https://timeapi.io/api/timezone/coordinate?latitude=${lat}&longitude=${lon}`);
  if (!res.ok) return null;
  const data = await res.json();
  const tz = data.timeZone ?? null;
  if (tz) localStorage.setItem(key, tz);
  return tz;
}
