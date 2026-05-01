# Travel Itinerary

A personal travel planning app that stores itineraries as JSON files in a GitHub repository. Built with React and Vite, deployed to GitHub Pages, and designed to work on iPhone without any backend server.

---

## How It Works

All data lives in two places:

- **Your browser's localStorage** — changes are written here immediately, acting as a local cache
- **A GitHub repository** — changes are pushed asynchronously (2-second debounce after every edit) as individual commits

There is no server. The app talks directly to the GitHub Contents API from the browser.

---

## Deployment

The app is deployed automatically to GitHub Pages on every push to `main` via `.github/workflows/deploy.yml`.

**To enable for a new repo:**

1. Go to `Settings → Pages → Source → GitHub Actions` in the GitHub repo
2. Push to `main` — the workflow builds with Vite and deploys `dist/` to Pages
3. The app will be live at `https://{user}.github.io/{repo}/`

The app automatically detects its own GitHub repo from the hostname, so no configuration is needed just to read itineraries from a public repo.

---

## Settings

All credentials are stored **only in your browser's localStorage** — they are never committed to the repository. Open Settings (⚙) to configure:

| Setting | Required for | Notes |
|---|---|---|
| **GitHub Token** | Saving, creating, deleting itineraries | `repo` scope (classic PAT) or `contents: read+write` (fine-grained) |
| **GitHub Repository** | Read/write on non-GitHub-Pages hosts | Auto-detected from hostname on `*.github.io` — leave blank there |
| **Branch** | Storing itineraries on a non-default branch | Defaults to `data` |
| **Maps Provider** | Place search and directions | Google Maps or Apple Maps — page reload required after changing |
| **Google Maps API Key** | Google Maps provider | Enable Maps JavaScript API, Places API, Directions API |
| **Apple MapKit JS Token** | Apple Maps provider | JWT generated from Apple Developer account (see below) |

### Generating an Apple MapKit JS Token

1. Sign in to [developer.apple.com](https://developer.apple.com)
2. Go to **Certificates, IDs & Profiles → Identifiers → +** → choose **Maps IDs** → create one
3. Go to **Keys → +** → enable **MapKit JS** → associate the Maps ID → download the `.p8` file
4. Note your **Key ID** (10 chars on the Keys list) and **Team ID** (top-right corner of any developer page)
5. Run the included token generator from the project root:

```bash
node generate-mapkit-token.js TEAM_ID KEY_ID ~/Downloads/AuthKey_KEYID.p8
```

6. Paste the printed JWT into Settings → Apple MapKit JS Token

The token is valid for one year. Re-run the script to renew it.

---

## Data Structure

### Itinerary files

Stored on the configured branch (default: `data`) under `Itineraries/`:

```
Itineraries/
  it-a1b2c3d4.json    ← itinerary data
  it-a1b2c3d4.ics     ← calendar file (auto-generated when a start date is set)
  it-e5f6g7h8.json
  it-e5f6g7h8.ics
```

Filenames are stable UUIDs (`it-` + 8 hex chars) generated at creation time. The itinerary's display name is stored as `title` inside the JSON — renaming never changes the filename.

### JSON format

```json
{
  "title": "Seattle to the Broughton Islands",
  "subtitle": "...",
  "startDate": "2026-06-01",
  "openDay": 3,
  "itineraryNotes": "...",
  "days": [ ... ],
  "places": { "1": [ ... ], "2": [ ... ] },
  "directions": { "1": [ ... ] },
  "routes": { "1": [ ... ] },
  "highlights": { "1": ["...", "..."] },
  "notes": { "1": "captain's note for day 1" }
}
```

Each **day** object:
```json
{
  "day": 1,
  "leg": "Seattle to Port Townsend",
  "overnight": "Port Townsend",
  "nm": 30,
  "hrs": 4.5,
  "tags": ["fuel", "provision"],
  "highlights": ["..."],
  "note": "built-in captain's note"
}
```

### localStorage keys

| Key | Contents |
|---|---|
| `travelCurrentFile` | Path of the open itinerary (e.g. `Itineraries/it-abc123.json`) |
| `travelItinerary` | Full itinerary JSON (written on every change, acts as offline cache) |
| `travelSettings` | User settings: token, repo, branch, maps provider, API keys |
| `itineraryMetadata` | Per-file metadata cache: `{ [path]: { title, startDate, dayCount, locations } }` used to populate the itinerary list without re-fetching every file |

---

## Features

### Itinerary list (picker screen)

- Lists all `.json` files from the `Itineraries/` folder on GitHub
- Shows title, date range, day count, and first→last overnight location for each entry
- Metadata is cached in localStorage so the list appears instantly on return visits
- **Create** — generates a new UUID filename, sets the title from what you typed
- **Duplicate** — copies the full itinerary under a new filename with "Copy of …" title
- **Delete** — two-step confirmation, removes `.json` and `.ics` from GitHub
- **Resume** — if an unsaved local session exists, offers to resume it

### Itinerary view

**Header** — editable title and subtitle. The browser tab title tracks the itinerary title.

**Tabs:**
- **Day by Day** — main planning view
- **Fuel** — fuel stop summary with VHF channels and notes
- **Tides** — critical tidal passages with timing notes

**Per-day sections** (all hidden in read-only mode if no GitHub token is set):
- **Highlights** — bullet points for the day
- **Captain's Note** — free-form markdown note
- **Places** — searchable place cards (restaurants, marinas, hotels, provisioning, activities, other) with phone, website, and notes. Links open in Google Maps or Apple Maps depending on provider.
- **Directions** — turn-by-turn routes between two locations. Collapsed steps, travel mode selector, notes per route.
- **Boating Routes** — NM + speed → calculated hours. "Use these values" applies to the day's distance/time fields.

**Day management:** add, duplicate, insert, delete days. Each day has core fields (leg name, overnight location, distance, hours).

**Departure date** — set a start date to see calendar dates alongside day numbers across the whole itinerary.

**ICS calendar:**
- **Export .ics** — downloads a calendar file for importing into any calendar app
- **Subscribe URL** — copies a `raw.githubusercontent.com` URL you can subscribe to in Apple Calendar or Google Calendar for live updates

**Sync status** — shows Pending → Saving → Saved in the toolbar. Conflicts (concurrent edits from another device) are detected and flagged.

### History panel (⏱)

Opened from the toolbar when a GitHub token is configured. Shows all commits for the current file, newest first.

- **Auto-saves** ("`Update itinerary - YYYY-MM-DD HH:mm`") are collapsed into groups — click to expand individual saves
- **Milestones** (custom commit messages) are always visible, styled with a gold border and 🏁 prefix
- **Restore** — loads a historical version back into the editor (triggers an immediate save)
- **+ Milestone** — saves the current state with a custom title as the commit message, creating a named checkpoint in the history

### Sharing

- The URL updates to `?i={filename}` whenever you open an itinerary
- Tapping **Share** (⬆, shown on browsers that support the Web Share API) invokes the native iOS/macOS share sheet with the itinerary title and URL
- Anyone opening the shared URL lands directly on that itinerary. No token is needed to read from a public repo.
- Invalid `?i=` values show a styled "Not Found" page instead of silently loading stale data

### Read-only mode

When no GitHub token is configured, the app is fully read-only:
- All edit controls (add, delete, note editing, title editing, day actions) are hidden
- Empty sections (no places, no directions, etc.) are hidden entirely
- The Subscribe URL button and Export .ics button remain visible
- The itinerary list still loads from a public repo without a token

### Maps providers

Both providers support place search with autocomplete and turn-by-turn directions. Provider is toggled in Settings and takes effect after a page reload.

| Feature | Google Maps | Apple Maps |
|---|---|---|
| Autocomplete | ✓ | ✓ |
| Place details (phone, website) | ✓ | — |
| Driving directions | ✓ | ✓ |
| Walking directions | ✓ | ✓ |
| Cycling directions | ✓ | — |
| Transit directions | ✓ | — |
| Location bias | Salish Sea (500 km radius) | Salish Sea |

Place search results and saved records are tagged with their provider (`mapsProvider: "google" | "apple"`). Legacy records (saved before the provider field was added) default to Google Maps links.

---

## Project Structure

```
src/
  main.jsx                  — app entry point
  components/
    Itinerary.jsx           — root component; all state, sync, and tab logic
    ItineraryPicker.jsx     — file list, create/duplicate/delete
    Settings.jsx            — settings panel
    HistoryPanel.jsx        — version history and milestones
    DayPlaces.jsx           — place search and cards
    DayDirections.jsx       — directions search and cards
    DayRoute.jsx            — boating route calculator
    NoteMarkdown.jsx        — markdown renderer for notes
  lib/
    github.js               — GitHub Contents API wrapper
    mapkit.js               — Apple MapKit JS loader and adapters
  data/
    itinerary.js            — built-in sample data (Broughton Islands voyage)

generate-mapkit-token.js    — CLI script to generate Apple MapKit JS JWT
.github/workflows/
  deploy.yml                — GitHub Actions: build + deploy to Pages
.claude/
  memory/                   — persistent project memory for the AI assistant
```

---

## Tech Stack

- **React 18** with Vite
- **GitHub Contents API** — file storage, commit history
- **Google Maps JavaScript API** — Places autocomplete, Directions
- **Apple MapKit JS** — place search, directions (alternative to Google Maps)
- **Web Share API** — native share sheet on iOS/macOS/Android
- **`react-markdown`** with `remark-gfm` and `remark-breaks` — note rendering
- No backend, no database, no authentication server
