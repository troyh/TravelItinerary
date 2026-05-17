import { readFileSync, writeFileSync, readdirSync } from "fs";
import { join } from "path";

const DIR = process.argv[2] ?? "./Itineraries";

export function migrate(data) {
  // Already migrated — days have per-day arrays embedded directly
  if (data.days?.[0] !== undefined && "places" in (data.days[0] ?? {})) return data;

  const {
    days       = [],
    places     = {},
    directions = {},
    routes     = {},
    flights    = {},
    rentalCars = {},
    highlights = {},
    notes      = {},
    ...rest
  } = data;

  const newDays = days.map(day => {
    const k = String(day.day);

    // Merge top-level highlights[k] into day.highlights (deduplicate)
    const mergedHighlights = [
      ...(day.highlights ?? []),
      ...(highlights[k] ?? []),
    ].filter((v, i, arr) => arr.indexOf(v) === i);

    // Merge top-level notes[k] string into day.note
    const extraNote = notes[k] ?? "";
    const mergedNote = [day.note, extraNote].filter(Boolean).join("\n\n");

    return {
      ...day,
      highlights: mergedHighlights,
      note:       mergedNote,
      places:     places[k]     ?? [],
      directions: directions[k] ?? [],
      routes:     routes[k]     ?? [],
      flights:    flights[k]    ?? [],
      rentalCars: rentalCars[k] ?? [],
    };
  });

  return { ...rest, days: newDays };
}

// When run directly as a script
if (process.argv[1] === new URL(import.meta.url).pathname) {
  const files = readdirSync(DIR).filter(f => f.endsWith(".json"));
  if (files.length === 0) {
    console.log(`No JSON files found in ${DIR}`);
    process.exit(0);
  }
  for (const file of files) {
    const path = join(DIR, file);
    const data = JSON.parse(readFileSync(path, "utf8"));
    const migrated = migrate(data);
    writeFileSync(path, JSON.stringify(migrated, null, 2));
    console.log(`✓ ${file}`);
  }
}
