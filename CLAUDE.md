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

`Itinerary.jsx` is the root component and owns all state. It renders either `ItineraryPicker` (when no file is open) or the itinerary editing view. State is written to `localStorage` immediately on every change and pushed to GitHub manually via a Commit button.

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
- `reverseGeocode(lat, lng)` — Nominatim reverse lookup, cached in `localStorage["geocodeCache"]`, used to auto-name the day's general location.
- The centroid `useEffect` runs in two passes: (1) immediately sets `centerLat/centerLng` when GPS data changes, (2) async reverse-geocodes `centerName` with Nominatim rate-limit spacing.

### Day object shape

```js
{
  day: number,
  leg: string,           // day title
  nm: number, hrs: number,  // boating distance/time (legacy)
  overnight: string,     // text location (geocoded for overview map)
  fuelStop: boolean, tideWarning: boolean,
  note: "",              // legacy; actual notes in customNotes state
  centerName: string,    // auto-geocoded or user-set location name; displayed in left column
  centerLat: number|null, centerLng: number|null,  // null = auto-compute; set = user override
}
```

`centerLat/Lng` being null means "use the computed centroid"; once the user sets a location via the autocomplete dropdown, they become numbers and the auto-compute skips that day.

### GitHub API (`src/lib/github.js`)

All GitHub functions take a `{ githubToken, githubRepo, githubBranch, githubFile }` options object. The module caches blob SHAs in `shaByPath` (keyed `branch:path`) to avoid conflicts. A `savingPaths` set prevents `loadFromGitHub` from overwriting a stale SHA while a save is in-flight.

### Flight lookup (in `AddTravelPanel` inside `Itinerary.jsx`)

If `settings.aeroDataBoxKey` is configured, the "Look up" button calls the AeroDataBox API via RapidAPI (`aerodatabox.p.rapidapi.com/flights/number/{flightNumber}/{date}`) to pre-fill departure/arrival IATA codes, city names, times, airline, aircraft model. Distance is calculated client-side with the Haversine formula from the airport coordinates returned by the API. `applyFlightResult()` also auto-computes the great-circle distance and sets `routeDistance`/`routeDuration` immediately — no need to click "Get Distance" after a lookup.

### Maps (`src/lib/mapkit.js`)

Supports Google Maps (via `@googlemaps/js-api-loader`) and Apple Maps (MapKit JS loaded from Apple CDN). Provider is set in Settings and takes effect after page reload. Each provider is a module-level singleton promise. Apple Maps directions resolve autocomplete results to coordinates via `search.search()` before calling `Directions.route()`.

**Location bias**: `DayPlaces` and `DayDirections` both accept a `locationBias: { lat, lng } | null` prop. When set, it is passed to the map provider's autocomplete API (`locationBias` for Google, `region` for Apple). `Itinerary.jsx` computes the per-day centroid and passes it.

### Overview map (`src/components/ItineraryMap.jsx`)

Renders a single Leaflet map at the top of the itinerary page. Stop markers come from two sources (merged and sorted by day number):
1. Days with `overnight` text → geocoded via Nominatim (cached in `localStorage["geocodeCache"]`)
2. Days with `centerLat/Lng` but no `overnight` text → used directly, no geocoding needed

Route lines use sequential spectrum colors via golden-angle hue stepping (`nextRouteColor()`, defined inside the map `useEffect`). Each route (flight arc, driving direction, boat route) gets a unique color. Gray dashed lines are approximate connectors only.

Clicking a route line shows a popup with **Day N** header and route details (origin→destination, distance, duration). Boat route popups also show cruising speed.

### Design system (`src/theme.js`)

Exports `T` (design tokens), `btn` (button style presets), and `input` (input style). Light theme: white background, `#0b3d6b` navy accent, `#f5b544` amber, Geist font. CSS custom properties are defined in `index.html` for global use.

### Responsive layout

CSS classes in `index.html` handle breakpoints (≤640 px = mobile):
- `.picker-sidebar` — hidden on mobile; Settings button `.picker-settings-btn` shown instead
- `.day-expanded-grid` — collapses from `180px 1fr` grid to single column on mobile
- `.day-expanded-right` — removes left border and adds top border on mobile
- `.day-date-desktop` / `.day-date-mobile` — toggle which date header variant shows

The day location field (📍 centerName) is rendered in **both** the desktop and mobile date sections so it appears in portrait mode on iOS.

### Metadata cache

`localStorage["itineraryMetadata"]` caches `{ title, startDate, dayCount, locations, todos, drivingKm }` per file, keyed as `"dbId:filePath"`. The picker uses this for instant display without re-fetching. Updated on every save from `Itinerary.jsx`. The picker re-fetches all entries every 5 minutes to pick up external changes.

### Pull cache (`ItineraryPicker.jsx`)

The "↓ Pull" button in the picker header fetches all itinerary JSON files from GitHub and stores each under `localStorage["itinerary:dbId:path"]`. This syncs local storage with GitHub and enables offline fallback: `handleLoad` tries GitHub first, then falls back to the pull cache on network failure.

**⚠️ Stale-read after commit**: GitHub's CDN caches file contents aggressively for several minutes after a write. If the user commits a change and immediately returns to the picker and re-opens the trip, `handleLoad` would fetch from GitHub and get the old version. Fix pattern:

1. In `handleCommit` (after a successful `saveToGitHub`), write the committed data to the pull cache with a timestamp:
   ```js
   localStorage.setItem(`itinerary:${currentDbId}:${currentFile}`,
     JSON.stringify({ ...data, _savedAt: Date.now() }));
   ```
2. In `handleLoad`, before hitting GitHub, check if the pull cache entry has `_savedAt` within the last 10 minutes. If so, use it directly and skip the network call:
   ```js
   if (cached._savedAt && Date.now() - cached._savedAt < 10 * 60 * 1000) {
     const { _savedAt, ...clean } = cached;
     onLoad(f.path, clean, f.dbId);
     return;
   }
   ```

This same pattern applies to any operation that writes to GitHub and then immediately reads back: always prefer the local committed copy over a potentially-stale GitHub response within the cache window.

---

## Add/Edit Panel System

### AddTravelPanel (travel routes)

Unified panel for all travel modes (flight, car, walk, train, ferry, boat). Key behaviors:
- **`defaultFrom` prop**: when opening a new travel item (not editing), the previous day's centroid is passed as `defaultFrom` so the From field pre-fills automatically.
- **`_origType` on editItem**: set in `openEditPanel()` as `"flight"`, `"direction"`, `"route"`, or `"rentalcar"`. Used in `onUpdate` to route correctly — do NOT use `item.mode` for routing since both directions and rental cars use `mode: "car"`.
- **Coordinate input**: From/To fields accept GPS coordinates in various formats (DMS, DM, decimal). `parseCoordinates(str)` and `looksLikeCoordinates(str)` handle detection and parsing; autocomplete is suppressed when input looks like coordinates.
- **Arrival time auto-calc**: `applyEta(dur, explicitDepartTime?)` computes arrival from departure + duration. Called after `fetchRoute` returns and when the departure time field changes (so changing departure time auto-updates arrival without re-fetching the route).
- **Cruising speed**: changing the speed field on a boat route immediately recalculates duration and arrival time from stored nm without re-fetching the route.
- **Distance units**: `distanceUnit` prop controls km/mi conversion. Apple Maps returns km; the panel converts if needed.

### AddPlacePanel (places)

- Time fields use `parseNaturalTime(str)` on blur to accept formats like `"7pm"`, `"7:30 PM"`, `"19:00"`.
- `parseDurMins` returns 60 (default) for empty/unparseable durations.

### Panel UX

- **Esc key** closes the panel instead of exiting browser fullscreen. Uses capture-phase listener with `preventDefault()`.
- **Body scroll lock**: `document.body.style.overflow = "hidden"` while any panel or sheet is open.
- **Double-tap to edit**: inline text fields (trip title, subtitle, trip notes, day title, day notes) require double-tap/double-click to activate editing, preventing accidental edits.

---

## Known Bug Patterns — Read Before Editing

### ⚠️ Edit panel data round-trip

**Every field that can be edited in a panel must be stored AND reloaded.** This has been a repeated source of bugs. The full cycle is:

1. **`onAdd`** — save ALL relevant fields to the stored record (not just a subset)
2. **`onUpdate` `d` object** — include ALL same fields; use `|| undefined` only for truly optional fields like `routePath`/`distance`/`duration` (so existing values aren't overwritten if the user didn't re-fetch). Use explicit values (never `|| undefined`) for time/date fields: `departDate`, `time`, `arriveDate`, `arriveTime`.
3. **`openEditPanel`** — map ALL stored fields back to `editItem` so the panel initializes with the saved values.
4. **`AddTravelPanel` state init** — uses `editItem?.field || defaultValue`; if a field is missing from `editItem`, the user sees blank/default on re-edit.

**Checklist for any new travel field:**
- Added to `handleAdd()`'s `item` object? (`boatVessel, cruisingSpeed, aircraft`, etc.)
- Saved in `onAdd` handler for the correct type?
- In `onUpdate`'s `d` object?
- In `openEditPanel`'s `editItem` mapping for the correct `_type`?
- Initialized from `editItem?.newField` in `AddTravelPanel`'s `useState`?

**Rental car vs direction routing**: Both use `mode: "car"`. Always route `onUpdate` by `item._origType` (set in `openEditPanel`), never by `item.mode`. Rental cars live in `savedRentalCars`; directions in `savedDirections` — calling the wrong `updateX` silently does nothing.

**Rental car field names**: Old data uses `pickupLocation`/`dropoffLocation`/`agency`. New panel saves `origin.name`/`destination.name` as well. Always try both when reading: `c.pickupLocation || c.origin?.name || ""`.

### ⚠️ ICS calendar event bugs

The ICS builder (`buildICSContent` in `Itinerary.jsx`) has had repeated "undefined" text bugs. Rules to follow:

**1. Never use unguarded template literals with possibly-undefined fields:**
```js
// BAD — produces "✈ undefined: undefined → undefined"
`✈ ${f.flightNumber}: ${f.departure} → ${f.arrival}`

// GOOD
const parts = [f.flightNumber, f.departure && f.arrival ? `${f.departure} → ${f.arrival}` : ""].filter(Boolean);
```

**2. Always run times through `ampmTo24()` before passing to `toICSDateTime()`:**
Old place data stores times as `"7:00 PM"` (12-hour). `toICSDateTime` splits on `:` and parses as numbers — `"00 PM"` becomes `NaN`, producing `T07NaN00`. The `ampmTo24()` helper handles both `"HH:MM"` (passes through) and `"H:MM AM/PM"` (converts). The places timed event section previously skipped this step.

**3. `buildICSContent` parameter order** — the function signature must match all call sites exactly. A past bug: a `_highlights` ghost parameter at position 4 shifted every subsequent parameter, causing `flights` to receive `rentalCars` data and vice versa. Current signature:
```js
function buildICSContent(daysArr, sd, ttl, notes, fileId, appBase,
                         flights, rentalCars, savedPlaces, savedDirections, savedRoutes)
```

**4. Guard `d.leg` in day summary**: `d.leg` can be undefined for days without a title. Use `d.leg ? \`Day ${d.day}: ${d.leg}\` : \`Day ${d.day}\`` — not `\`Day ${d.day}: ${d.leg}\``.

### ⚠️ Dirty-flag / false "unsaved changes" prompt

**Problem**: After loading an itinerary, the app would immediately mark it as "unsaved", causing a save prompt when the user tries to close without making any changes.

**Root cause**: The save effect sets `dirtyRef.current = true` at the end of every run. Cascading effects after load (especially the centroid `useEffect` calling `setDays`) trigger additional save effect runs while `dirtyRef` is already `true`.

**Fix pattern**: Call `markLoadStart()` before every `applyData()` call in load paths. `markLoadStart()` sets `justLoadedRef.current = true` for 2 seconds, suppressing dirty-marking. The save effect checks `!justLoadedRef.current` before setting `dirtyRef = true` or calling `setSyncStatus("unsaved")`.

All `applyData` load call sites: `handleLoad`, URL load effect, GitHub mount load effect, duplicate-creation flow. Post-commit `dirtyRef.current = false` resets (no `applyData` involved) do NOT need `markLoadStart`.

### ⚠️ `setCustomHighlights` (removed — do not re-add)

Highlights were removed from the UI. `setCustomHighlights` is no longer declared. Any call to it throws `ReferenceError` at runtime, silently killing the containing function. This broke `handleCreate` (new itinerary button did nothing), `addDay`, `removeDay`, and `swapDays`. Do not re-introduce `customHighlights` state or calls.

### ⚠️ GitHub post-commit reload

After a successful commit, do NOT reload from GitHub to "sync localStorage". The GitHub Contents API caches aggressively and returns stale content for minutes after a write, which overwrites the user's just-committed changes with old data. The correct state is already in React memory and localStorage.

---

## Boat Route specifics

- `nm` (nautical miles) and `hrs` (decimal hours) are stored as numeric fields on route records. They are parsed from `routeDistance` (e.g. `"47.3 nm"`) and `routeDuration` (e.g. `"~5h 30m"`) strings in both `onAdd` and `onUpdate`.
- `routePath` (array of `[lat, lng]` pairs from GPX) must be saved in `addRoute` — without it the map shows a dashed straight line.
- `cruisingSpeed` is stored on the route record and displayed in the timeline as `"47.3 NM · ~5h 35m @ 8.5 kn"`.
- Changing cruising speed recalculates duration/arrival immediately from stored nm without re-fetching the route.

## Flight specifics

- `aircraft`, `distance`, and `miles` (numeric) are stored on flight records. `miles` is used by `totalFlightMiles` for the itinerary stats.
- `applyFlightResult()` auto-computes Haversine distance immediately when an AeroDataBox lookup provides coordinates — no "Get Distance" click required.
- Flight times are stored as 24-hour `"HH:MM"` strings. `ampmTo24()` in the ICS builder handles legacy 12-hour format too.

## Time field handling

- `<input type="time">` with `value=""` renders a browser-default time on some platforms (especially iOS Safari). Use the transparent-overlay pattern: set `color: transparent` when value is empty, show a `"—"` span overlay with `pointerEvents: none`, so clicking activates the native picker while the display shows empty.
- Time fields in `AddPlacePanel` use `parseNaturalTime(str)` on blur to normalize entries like `"7pm"` → `"19:00"`.
- `AddTravelPanel` departure time `onChange` calls `applyEta(routeDuration, newValue)` so arrival recalculates live as the user changes departure time.

## GPS coordinate input

`parseCoordinates(str)` (module-level in `Itinerary.jsx`) accepts these formats:
- `N47° 37' 17.30'' W122° 31' 14.68''` (DMS prefix)
- `47° 37' 17.30'' N, 122° 31' 14.68'' W` (DMS suffix)
- `N47° 37.288' W122° 31.245'` (DM prefix/suffix)
- `N47.621472 W122.520744` or `47.621472N 122.520744W` (decimal with direction)
- `47.621472, -122.520744` or `47.621472 -122.520744` (plain decimal)

`looksLikeCoordinates(str)` suppresses autocomplete search when the input appears to be coordinates.
