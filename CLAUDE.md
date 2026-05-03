# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # Start dev server (http://localhost:5173/TravelItinerary/)
npm run build    # Production build → dist/
npm run preview  # Preview production build locally
```

No test suite. Verify changes with `npm run build` (must be clean) and manual browser testing.

## Architecture

Single-page React app (Vite, no router) deployed to GitHub Pages at `https://troyh.github.io/TravelItinerary/`. No backend — all persistence is via the GitHub Contents API and `localStorage`.

### Data flow

`Itinerary.jsx` is the root component and owns all state. It renders either `ItineraryPicker` (when no file is open) or the itinerary editing view. State is written to `localStorage` immediately on every change and pushed to GitHub with a 2-second debounce.

**Itinerary files** are stored as `Itineraries/it-{uuid8}.json` on the configured git branch (default: `data`) of the configured repo. A companion `.ics` calendar file is saved alongside each JSON. The `?i=filename&db=dbId` URL parameters deep-link to a specific itinerary.

### Settings & databases

Settings live in `localStorage` key `"travelSettings"`. GitHub connections are stored as a `databases` array — each entry has `{ id, label, githubToken, githubRepo, githubBranch }`. Old flat `githubToken/Repo/Branch` fields are auto-migrated on first load. `currentDbId` in localStorage tracks which database the open file belongs to.

### Read-only mode

`readOnly = !currentDb.githubToken || isLocked` — computed in `Itinerary.jsx` and passed as a prop to all day components.

**Always handle both states when adding UI features:**
- Hide add/edit/delete buttons: `{!readOnly && <button ...>}`
- Guard editing forms: `{isEditing && !readOnly ? <form> : <display>}`
- Hide empty sections in read-only: `if (readOnly && items.length === 0) return null`
- Read-only-safe actions (export, copy, subscribe URL) stay visible regardless
- Pass `readOnly={readOnly}` to any new child component with editable controls

### Per-day data sections

Each day can have: Places, Directions, Boating Routes, Flights. They all follow the same pattern:

- State in `Itinerary.jsx`: `const [savedX, setSavedX] = useState(() => _db?.x ?? {})`
- Shape: `{ [dayNum]: RecordArray }`
- Three handlers: `addX(dayNum, item)`, `updateX(dayNum, id, updates)`, `deleteX(dayNum, id)`
- Included in the save `data` object and in `applyData()`
- Cleared in `handleCreate()`
- Rendered as `<DayX ... readOnly={readOnly} />`

`DayRoute.jsx` is the simplest example of this pattern.

### GitHub API (`src/lib/github.js`)

All GitHub functions take a `{ githubToken, githubRepo, githubBranch, githubFile }` options object. The module caches blob SHAs in `shaByPath` (keyed `branch:path`) to avoid conflicts. A `savingPaths` set prevents `loadFromGitHub` from overwriting a stale SHA while a save is in-flight.

### Flight lookup (`src/components/DayFlights.jsx`)

If `settings.aeroDataBoxKey` is configured, the "Look up" button calls the AeroDataBox API via RapidAPI (`aerodatabox.p.rapidapi.com/flights/number/{flightNumber}/{date}`) to pre-fill departure/arrival IATA codes, city names, times, airline, aircraft model, and flight status. Distance is calculated client-side with the Haversine formula from the airport coordinates returned by the API. The key is stored in settings under `aeroDataBoxKey` and entered in Settings → Connections.

### Maps (`src/lib/mapkit.js`)

Supports Google Maps (via `@googlemaps/js-api-loader`) and Apple Maps (MapKit JS loaded from Apple CDN). Provider is set in Settings and takes effect after page reload. Each provider is a module-level singleton promise. Apple Maps directions resolve autocomplete results to coordinates via `search.search()` before calling `Directions.route()`.

### Metadata cache

`localStorage["itineraryMetadata"]` caches `{ title, startDate, dayCount, locations, todos }` per file, keyed as `"dbId:filePath"`. The picker uses this for instant display without re-fetching. Updated on every save from `Itinerary.jsx`. The picker re-fetches all entries every 5 minutes to pick up external changes.
