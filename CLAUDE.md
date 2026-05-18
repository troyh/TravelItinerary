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

Each day can have: Places, Directions, Boating Routes, Flights, Rental Cars. They all follow the same pattern:

- State in `Itinerary.jsx`: `const [savedX, setSavedX] = useState(() => _db?.x ?? {})`
- Shape: `{ [dayNum]: RecordArray }`
- Three handlers: `addX(dayNum, item)`, `updateX(dayNum, id, updates)`, `deleteX(dayNum, id)`
- Included in the save `data` object and in `applyData()`
- Cleared in `handleCreate()`
- Rendered with `hideList` prop (list display is in the unified timeline — see below)

`DayRoute.jsx` is the simplest example of this pattern.

### Unified day timeline (`Itinerary.jsx`)

Items from all five day sub-components are collected, sorted by time, and rendered as a single timeline in the right column of each expanded day. The sub-components receive `hideList={true}` to suppress their own list rendering — they only show their add/search forms.

- `computeDayCentroid(dayNum, savedPlaces, savedFlights, savedDirections, savedRoutes)` — module-level helper, returns `{ lat, lng }` mean of destination/arrival/endpoint coordinates only (departure coords are excluded to avoid pulling the centroid mid-route).
- The centroid is computed inline at render time for `dayBias` (passed to `DayPlaces` and `DayDirections` as `locationBias`).
- `reverseGeocode(lat, lng)` — Nominatim reverse lookup, cached in `localStorage["geocodeCache"]`, used to auto-name the day's general location.
- A `useEffect` debounced 1 s watches GPS-containing state; when the centroid changes and `d.centerLat === null`, it reverse-geocodes and writes `centerName/centerLat/centerLng` to the day via `setDays`.

### Day object shape

```js
{
  day: number,
  leg: string,           // day title
  nm: number, hrs: number,  // boating distance/time
  overnight: string,     // text location (geocoded for overview map)
  tags: string[],
  fuelStop: boolean, tideWarning: boolean,
  highlights: [],  note: "",   // legacy; actual data in customHighlights/customNotes state
  centerName: string,    // auto-geocoded or user-set location name; displayed in left column
  centerLat: number|null, centerLng: number|null,  // null = auto-compute; set = user override
}
```

`centerLat/Lng` being null means "use the computed centroid"; once the user sets a location via the autocomplete dropdown, they become numbers and the auto-compute skips that day.

### GitHub API (`src/lib/github.js`)

All GitHub functions take a `{ githubToken, githubRepo, githubBranch, githubFile }` options object. The module caches blob SHAs in `shaByPath` (keyed `branch:path`) to avoid conflicts. A `savingPaths` set prevents `loadFromGitHub` from overwriting a stale SHA while a save is in-flight.

### Flight lookup (`src/components/DayFlights.jsx`)

If `settings.aeroDataBoxKey` is configured, the "Look up" button calls the AeroDataBox API via RapidAPI (`aerodatabox.p.rapidapi.com/flights/number/{flightNumber}/{date}`) to pre-fill departure/arrival IATA codes, city names, times, airline, aircraft model, and flight status. Distance is calculated client-side with the Haversine formula from the airport coordinates returned by the API. The key is stored in settings under `aeroDataBoxKey` and entered in Settings → Connections.

### Maps (`src/lib/mapkit.js`)

Supports Google Maps (via `@googlemaps/js-api-loader`) and Apple Maps (MapKit JS loaded from Apple CDN). Provider is set in Settings and takes effect after page reload. Each provider is a module-level singleton promise. Apple Maps directions resolve autocomplete results to coordinates via `search.search()` before calling `Directions.route()`.

**Location bias**: `DayPlaces` and `DayDirections` both accept a `locationBias: { lat, lng } | null` prop. When set, it is passed to the map provider's autocomplete API (`locationBias` for Google, `region` for Apple). `Itinerary.jsx` computes the per-day centroid and passes it.

### Overview map (`src/components/ItineraryMap.jsx`)

Renders a single Leaflet map at the top of the itinerary page. Stop markers come from two sources (merged and sorted by day number):
1. Days with `overnight` text → geocoded via Nominatim (cached in `localStorage["geocodeCache"]`)
2. Days with `centerLat/Lng` but no `overnight` text → used directly, no geocoding needed

The map effect re-runs when `days[*].centerLat/Lng` changes (included in its dependency array).

### Design system (`src/theme.js`)

Exports `T` (design tokens), `btn` (button style presets), and `input` (input style). Light theme: white background, `#0b3d6b` navy accent, `#f5b544` amber, Geist font. CSS custom properties are defined in `index.html` for global use.

### Responsive layout

CSS classes in `index.html` handle breakpoints (≤640 px = mobile):
- `.picker-sidebar` — hidden on mobile; Settings button `.picker-settings-btn` shown instead
- `.day-expanded-grid` — collapses from `180px 1fr` grid to single column on mobile
- `.day-expanded-right` — removes left border and adds top border on mobile
- `.day-date-desktop` / `.day-date-mobile` — toggle which date header variant shows

### Metadata cache

`localStorage["itineraryMetadata"]` caches `{ title, startDate, dayCount, locations, todos }` per file, keyed as `"dbId:filePath"`. The picker uses this for instant display without re-fetching. Updated on every save from `Itinerary.jsx`. The picker re-fetches all entries every 5 minutes to pick up external changes.
