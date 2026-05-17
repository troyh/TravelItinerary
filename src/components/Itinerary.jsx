import { useState, useEffect, useRef } from "react";
import NoteMarkdown from "./NoteMarkdown.jsx";
import { days as initialDays, tagConfig, fuelStops, fuelSummary, tideWarnings } from "../data/itinerary.js";
import DayPlaces from "./DayPlaces.jsx";
import DayDirections from "./DayDirections.jsx";
import DayRoute from "./DayRoute.jsx";
import DayFlights from "./DayFlights.jsx";
import DayRentalCar from "./DayRentalCar.jsx";
import ClaudePrompt from "./ClaudePrompt.jsx";
import ItineraryMap from "./ItineraryMap.jsx";
import Settings from "./Settings.jsx";
import { loadFromGitHub, saveToGitHub, deleteFromGitHub, ITINERARIES_FOLDER, inferRepo } from "../lib/github.js";
import ItineraryPicker from "./ItineraryPicker.jsx";
import HistoryPanel from "./HistoryPanel.jsx";

function sanitizeFilename(name) {
  return name.trim().replace(/[^\w\s-]/g, "").replace(/\s+/g, " ").trim().slice(0, 80);
}

// Migrate old scattered keys → single travelItinerary key, or return null for fresh start
const _db = (() => {
  try {
    const s = localStorage.getItem("travelItinerary");
    if (s) return JSON.parse(s);
    const oldKeys = ["travelDays","travelPlaces","travelHighlights","travelNotes","travelStartDate","travelOpenDay"];
    if (!oldKeys.some(k => localStorage.getItem(k) !== null)) return null;
    const dy = localStorage.getItem("travelDays");
    const migrated = {
      days:       (() => { try { const p = JSON.parse(dy); return Array.isArray(p) && p.length > 0 && typeof p[0].day === "number" ? p : null; } catch { return null; } })(),
      places:     (() => { try { return JSON.parse(localStorage.getItem("travelPlaces"))     ?? {}; } catch { return {}; } })(),
      highlights: (() => { try { return JSON.parse(localStorage.getItem("travelHighlights")) ?? {}; } catch { return {}; } })(),
      notes:      (() => { try { return JSON.parse(localStorage.getItem("travelNotes"))      ?? {}; } catch { return {}; } })(),
      startDate:  localStorage.getItem("travelStartDate") ?? "",
      openDay:    (() => { const s = localStorage.getItem("travelOpenDay"); return s ? Number(s) : null; })(),
    };
    localStorage.setItem("travelItinerary", JSON.stringify(migrated));
    oldKeys.forEach(k => localStorage.removeItem(k));
    return migrated;
  } catch { return null; }
})();

// Handles both old format (top-level keyed dicts) and new format (per-day arrays embedded in each day).
function extractPerDayState(data) {
  if (!data) return { days: [], places: {}, directions: {}, routes: {}, flights: {}, rentalCars: {}, highlights: {}, notes: {} };
  const rawDays = data.days ?? [];
  if ("places" in data || "directions" in data) {
    // Old format: top-level keyed dicts
    return {
      days:       rawDays.map((d, i) => ({ day: i + 1, ...d })),
      places:     data.places     ?? {},
      directions: data.directions ?? {},
      routes:     data.routes     ?? {},
      flights:    data.flights    ?? {},
      rentalCars: data.rentalCars ?? {},
      highlights: data.highlights ?? {},
      notes:      data.notes      ?? {},
    };
  }
  // New format: per-day data embedded; `day` derived from array position if absent
  const daysArr = rawDays.map((d, i) => ({ day: i + 1, ...d }));
  return {
    days: daysArr.map(({ places, directions, routes, flights, rentalCars, highlights: _h, note: _n, ...rest }) => ({
      ...rest, highlights: [], note: "",
    })),
    places:     Object.fromEntries(daysArr.map(d => [String(d.day), d.places     ?? []])),
    directions: Object.fromEntries(daysArr.map(d => [String(d.day), d.directions ?? []])),
    routes:     Object.fromEntries(daysArr.map(d => [String(d.day), d.routes     ?? []])),
    flights:    Object.fromEntries(daysArr.map(d => [String(d.day), d.flights    ?? []])),
    rentalCars: Object.fromEntries(daysArr.map(d => [String(d.day), d.rentalCars ?? []])),
    highlights: Object.fromEntries(daysArr.map(d => [String(d.day), d.highlights ?? []])),
    notes:      Object.fromEntries(daysArr.map(d => [String(d.day), d.note       ?? ""])),
  };
}

const _extracted = extractPerDayState(_db);

function remapKeys(obj, pivot, delta) {
  const result = {};
  for (const [k, v] of Object.entries(obj)) {
    const n = Number(k);
    if (delta === -1 && n === pivot) continue;
    const shifted = (delta === +1 && n >= pivot) || (delta === -1 && n > pivot);
    result[shifted ? n + delta : n] = v;
  }
  return result;
}

const BLANK_DAY = {
  leg: "New Day", nm: 0, hrs: 0, overnight: "",
  tags: ["layover"], fuelStop: false, tideWarning: false,
  highlights: [], note: "",
};


export default function Itinerary() {
  const [openDay,          setOpenDay]          = useState(() => {
    const urlDay = parseInt(new URLSearchParams(window.location.search).get("day"));
    if (Number.isInteger(urlDay) && urlDay >= 1 && urlDay <= (_db?.days?.length ?? 0)) return urlDay;
    const file = localStorage.getItem("travelCurrentFile");
    if (!file) return null;
    try {
      const map = JSON.parse(localStorage.getItem("itineraryOpenDay") || "{}");
      const n = map[file];
      if (Number.isInteger(n) && n >= 1 && n <= (_db?.days?.length ?? 0)) return n;
    } catch {}
    return null;
  });
  const [activeTab,        setActiveTab]        = useState("itinerary");
  const [startDate,        setStartDate]        = useState(() => _db?.startDate ?? "");
  const [customHighlights, setCustomHighlights] = useState(() => _extracted.highlights);
  const [newHighlight,     setNewHighlight]     = useState("");
  const [customNotes,      setCustomNotes]      = useState(() => _extracted.notes);
  const [editingNoteDay,   setEditingNoteDay]   = useState(null);
  const [noteDraft,        setNoteDraft]        = useState("");
  const [savedPlaces,      setSavedPlaces]      = useState(() => _extracted.places);
  const [savedDirections,  setSavedDirections]  = useState(() => _extracted.directions);
  const [savedRoutes,      setSavedRoutes]      = useState(() => _extracted.routes);
  const [savedFlights,     setSavedFlights]     = useState(() => _extracted.flights);
  const [savedRentalCars,  setSavedRentalCars]  = useState(() => _extracted.rentalCars);
  const [days,             setDays]             = useState(() => _extracted.days);
  const [editingCoreDay,   setEditingCoreDay]   = useState(null);
  const [coreDraft,        setCoreDraft]        = useState({});
  const [confirmDeleteDay, setConfirmDeleteDay] = useState(null);
  const [settings,         setSettings]         = useState(() => {
    try {
      let p = {};
      const s = localStorage.getItem("travelSettings");
      if (s) {
        p = JSON.parse(s);
        // Migrate old flat githubToken/Repo/Branch into databases array
        if ((p.githubToken || p.githubRepo || p.githubBranch) && !p.databases) {
          p.databases = [{ id: crypto.randomUUID(), label: "Default",
            githubToken: p.githubToken ?? "", githubRepo: p.githubRepo ?? "", githubBranch: p.githubBranch ?? "" }];
          delete p.githubToken; delete p.githubRepo; delete p.githubBranch;
        }
      }
      // Auto-configure from URL when hosted on GitHub Pages and no databases set yet
      if (!p.databases?.length) {
        const repo = inferRepo();
        if (repo) {
          p.databases = [{ id: crypto.randomUUID(), label: "Personal",
            githubToken: "", githubRepo: repo, githubBranch: "data" }];
        }
      }
      if (p.databases?.length) localStorage.setItem("travelSettings", JSON.stringify(p));
      return p;
    } catch { return {}; }
  });
  const [showSettings,     setShowSettings]     = useState(false);
  const [showHistory,      setShowHistory]      = useState(false);
  const [showCommitForm,   setShowCommitForm]   = useState(false);
  const [commitDraft,      setCommitDraft]      = useState("");
  const [showCloseWarn,    setShowCloseWarn]    = useState(false);
  const [syncStatus,       setSyncStatus]       = useState("idle");
  const [syncError,        setSyncError]        = useState("");
  const [title,            setTitle]            = useState(() => _db?.title    ?? "");
  const [subtitle,         setSubtitle]         = useState(() => _db?.subtitle ?? "Princess Louisa Inlet · Vancouver · Salt Spring · Desolation Sound · Johnstone Strait · Broughtons · Gulf Islands");
  const [itineraryNotes,   setItineraryNotes]   = useState(() => _db?.itineraryNotes ?? "");
  const [editingHeader,    setEditingHeader]    = useState(false);
  const [headerDraft,      setHeaderDraft]      = useState({});
  const [editingNotes,     setEditingNotes]     = useState(false);
  const [currentFile,      setCurrentFile]      = useState(() => localStorage.getItem("travelCurrentFile"));
  const [currentDbId,      setCurrentDbId]      = useState(() => localStorage.getItem("travelCurrentDb") ?? null);
  const [urlLoad,          setUrlLoad]          = useState(() => {
    const params = new URLSearchParams(window.location.search);
    const name  = params.get("i");
    const dbId  = params.get("db") ?? null;
    if (!name) return null;
    const file = `${ITINERARIES_FOLDER}/${name}.json`;
    if (file === localStorage.getItem("travelCurrentFile")) return null;
    return { file, status: "loading", dbId };
  });
  const [saveAsName,       setSaveAsName]       = useState("");
  const [copiedICS,        setCopiedICS]        = useState(false);
  const [pickerKey,        setPickerKey]        = useState(0);
  const [showMenu,         setShowMenu]         = useState(false);
  const [confirmDelete,    setConfirmDelete]    = useState(false);
  const [menuWorking,      setMenuWorking]      = useState(false);
  const [moveToDbId,       setMoveToDbId]       = useState(null);
  const [lockedFiles,      setLockedFiles]      = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem("itineraryLocked") || "[]")); }
    catch { return new Set(); }
  });
  const inputRef          = useRef(null);
  const syncTimerRef       = useRef(null);
  const dirtyRef           = useRef(false);
  const skipNextLoadRef    = useRef(false);
  const saveImmediatelyRef = useRef(false);

  const databases     = settings.databases ?? [];
  const currentDb     = databases.find(db => db.id === currentDbId) ?? databases[0] ?? {};
  const effectiveRepo   = currentDb.githubRepo   || inferRepo() || "";
  const effectiveBranch = currentDb.githubBranch || "data";
  const appBase = (() => {
    if (!effectiveRepo) return null;
    const [user, repo] = effectiveRepo.split("/");
    return user && repo ? `https://${user}.github.io/${repo}/` : null;
  })();
  const isLocked = !!(currentFile && currentFile !== "__local__" && lockedFiles.has(currentFile));
  const readOnly = !currentDb.githubToken || isLocked;
  const ghSettings = { githubToken: currentDb.githubToken ?? "", githubRepo: effectiveRepo, githubBranch: effectiveBranch };

  useEffect(() => {
    setNewHighlight(""); setEditingNoteDay(null);
    setEditingCoreDay(null); setConfirmDeleteDay(null);
  }, [openDay]);

  // Save to localStorage immediately on every change; GitHub is manual only.
  useEffect(() => {
    if (!currentFile) return;
    const data = {
      startDate, title, subtitle, itineraryNotes,
      days: days.map(d => {
        const { day: _, ...rest } = d;
        return {
          ...rest,
          highlights: customHighlights[String(d.day)] ?? d.highlights ?? [],
          note:       customNotes[String(d.day)]       ?? d.note       ?? "",
          places:     savedPlaces[String(d.day)]        ?? [],
          directions: savedDirections[String(d.day)]    ?? [],
          routes:     savedRoutes[String(d.day)]         ?? [],
          flights:    savedFlights[String(d.day)]        ?? [],
          rentalCars: savedRentalCars[String(d.day)]     ?? [],
        };
      }),
    };
    localStorage.setItem("travelItinerary", JSON.stringify(data));
    if (currentFile !== "__local__") {
      try {
        const meta = JSON.parse(localStorage.getItem("itineraryMetadata") || "{}");
        const overnights = days.map(d => d.overnight).filter(Boolean);
        const legs       = days.map(d => d.leg).filter(Boolean);
        const locations  = overnights.length >= 2 ? `${overnights[0]} → ${overnights[overnights.length - 1]}`
                         : overnights[0] ?? legs[0] ?? null;
        const todoLines = line => line.split("\n").filter(l => /^TODO:/i.test(l.trim())).map(l => l.trim().replace(/^TODO:\s*/i, ""));
        const todos = [
          ...todoLines(itineraryNotes || ""),
          ...days.flatMap(d => todoLines((customNotes[d.day] !== undefined ? customNotes[d.day] : d.note) || "")),
        ];
        let drivingKm = 0;
        Object.values(savedDirections).forEach(dirs => (dirs ?? []).forEach(d => {
          const km = d.distance?.match(/^([\d.]+)\s*km/i);
          const mi = d.distance?.match(/^([\d.]+)\s*mi/i);
          const m  = d.distance?.match(/^(\d+)\s*m\b/i);
          if (km) drivingKm += parseFloat(km[1]);
          else if (mi) drivingKm += parseFloat(mi[1]) * 1.60934;
          else if (m)  drivingKm += parseFloat(m[1]) / 1000;
        }));
        meta[`${currentDbId}:${currentFile}`] = { title, startDate, dayCount: days.length, locations, todos, drivingKm: drivingKm > 0 ? Math.round(drivingKm) : null };
        localStorage.setItem("itineraryMetadata", JSON.stringify(meta));
      } catch {}
    }
    if (dirtyRef.current && ghSettings.githubToken && effectiveRepo && currentFile !== "__local__") {
      setSyncStatus("unsaved");
    }
    dirtyRef.current = true;
  }, [currentFile, days, savedPlaces, savedDirections, savedRoutes, savedFlights, savedRentalCars, customHighlights, customNotes, startDate, title, subtitle, itineraryNotes]);

  useEffect(() => { localStorage.setItem("travelSettings", JSON.stringify(settings)); }, [settings]);

  useEffect(() => { document.title = title || "Travel Itinerary"; }, [title]);

  useEffect(() => { if (!currentFile) setPickerKey(k => k + 1); }, [currentFile]);

  // Persist openDay to localStorage per file
  useEffect(() => {
    if (!currentFile || currentFile === "__local__") return;
    try {
      const map = JSON.parse(localStorage.getItem("itineraryOpenDay") || "{}");
      if (openDay !== null) map[currentFile] = openDay; else delete map[currentFile];
      localStorage.setItem("itineraryOpenDay", JSON.stringify(map));
    } catch {}
  }, [openDay, currentFile]);

  // Clamp openDay to valid range after days load
  useEffect(() => {
    if (openDay === null || !days.length) return;
    if (openDay < 1 || openDay > days.length) setOpenDay(null);
  }, [days]);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (currentFile && currentFile !== "__local__") {
      url.searchParams.set("i", currentFile.replace(/^.*\//, "").replace(/\.json$/i, ""));
      if (currentDbId) url.searchParams.set("db", currentDbId);
      else url.searchParams.delete("db");
    } else {
      url.searchParams.delete("i");
      url.searchParams.delete("db");
    }
    history.replaceState(null, "", url);
  }, [currentFile, currentDbId]);

  // Verify and load a file that arrived via ?i= URL param (tries ?db= database first, then all others)
  useEffect(() => {
    if (!urlLoad || urlLoad.status !== "loading") return;
    const dbs = settings.databases ?? [];
    const candidates = urlLoad.dbId
      ? [...dbs.filter(db => db.id === urlLoad.dbId), ...dbs.filter(db => db.id !== urlLoad.dbId)]
      : dbs;
    if (!candidates.length) { setUrlLoad(s => ({ ...s, status: "notfound" })); return; }
    (async () => {
      for (const db of candidates) {
        const repo = db.githubRepo || inferRepo() || "";
        if (!repo) continue;
        const ghs = { githubToken: db.githubToken ?? "", githubRepo: repo, githubBranch: db.githubBranch || "data" };
        const data = await loadFromGitHub({ ...ghs, githubFile: urlLoad.file }).catch(() => null);
        if (!data) continue;
        applyData(data);
        localStorage.setItem("travelCurrentFile", urlLoad.file);
        localStorage.setItem("travelCurrentDb", db.id);
        skipNextLoadRef.current = true;
        setCurrentDbId(db.id);
        setCurrentFile(urlLoad.file);
        setUrlLoad(null);
        setSyncStatus("synced");
        const urlDay = parseInt(new URLSearchParams(window.location.search).get("day"));
        const dayCount = data.days?.length ?? 0;
        if (Number.isInteger(urlDay) && urlDay >= 1 && urlDay <= dayCount) setOpenDay(urlDay);
        return;
      }
      setUrlLoad(s => ({ ...s, status: "notfound" }));
    })();
  }, [urlLoad?.status]);

  // Load from GitHub on mount (localStorage already loaded synchronously above)
  useEffect(() => {
    if (!effectiveRepo || !currentFile || currentFile === "__local__") return;
    if (skipNextLoadRef.current) { skipNextLoadRef.current = false; return; }
    setSyncStatus("loading");
    loadFromGitHub({ ...ghSettings, githubFile: currentFile })
      .then(data => {
        if (!data) {
          setCurrentFile(null);
          localStorage.removeItem("travelCurrentFile");
          return;
        }
        applyData(data);
        setSyncStatus("synced");
      })
      .catch(() => setSyncStatus("offline"));
  }, []);

  function startEditNote(dayNum, current) {
    setEditingNoteDay(dayNum);
    setNoteDraft(current);
    setEditingCoreDay(null);
  }

  function saveNote(dayNum) {
    setCustomNotes(prev => ({ ...prev, [dayNum]: noteDraft }));
    setEditingNoteDay(null);
  }

  function cancelEditNote() {
    setEditingNoteDay(null);
  }

  function addHighlight(dayNum) {
    const text = newHighlight.trim();
    if (!text) return;
    setCustomHighlights(prev => ({
      ...prev,
      [dayNum]: [...(prev[dayNum] ?? []), text],
    }));
    setNewHighlight("");
    inputRef.current?.focus();
  }

  function removeHighlight(dayNum, index) {
    setCustomHighlights(prev => ({
      ...prev,
      [dayNum]: prev[dayNum].filter((_, i) => i !== index),
    }));
  }

  function addPlace(dayNum, place) {
    setSavedPlaces(prev => ({ ...prev, [dayNum]: [...(prev[dayNum] ?? []), place] }));
  }

  function updatePlace(dayNum, id, updates) {
    setSavedPlaces(prev => ({
      ...prev,
      [dayNum]: (prev[dayNum] ?? []).map(p => p.id === id ? { ...p, ...updates } : p),
    }));
  }

  function deletePlace(dayNum, id) {
    setSavedPlaces(prev => ({
      ...prev,
      [dayNum]: (prev[dayNum] ?? []).filter(p => p.id !== id),
    }));
  }

  function updateDayFields(dayNum, updates) {
    setDays(prev => prev.map(d => d.day === dayNum ? { ...d, ...updates } : d));
  }

  function addFlight(dayNum, flight) {
    setSavedFlights(prev => ({ ...prev, [dayNum]: [...(prev[dayNum] ?? []), flight] }));
  }
  function updateFlight(dayNum, id, updates) {
    setSavedFlights(prev => ({
      ...prev,
      [dayNum]: (prev[dayNum] ?? []).map(f => f.id === id ? { ...f, ...updates } : f),
    }));
  }
  function deleteFlight(dayNum, id) {
    setSavedFlights(prev => ({
      ...prev,
      [dayNum]: (prev[dayNum] ?? []).filter(f => f.id !== id),
    }));
  }

  function addRentalCar(dayNum, car) {
    setSavedRentalCars(prev => ({ ...prev, [dayNum]: [...(prev[dayNum] ?? []), car] }));
  }
  function updateRentalCar(dayNum, id, updates) {
    setSavedRentalCars(prev => ({
      ...prev,
      [dayNum]: (prev[dayNum] ?? []).map(c => c.id === id ? { ...c, ...updates } : c),
    }));
  }
  function deleteRentalCar(dayNum, id) {
    setSavedRentalCars(prev => ({
      ...prev,
      [dayNum]: (prev[dayNum] ?? []).filter(c => c.id !== id),
    }));
  }

  function addRoute(dayNum, route) {
    setSavedRoutes(prev => ({ ...prev, [dayNum]: [...(prev[dayNum] ?? []), route] }));
  }
  function updateRoute(dayNum, id, updates) {
    setSavedRoutes(prev => ({
      ...prev,
      [dayNum]: (prev[dayNum] ?? []).map(r => r.id === id ? { ...r, ...updates } : r),
    }));
  }
  function deleteRoute(dayNum, id) {
    setSavedRoutes(prev => ({
      ...prev,
      [dayNum]: (prev[dayNum] ?? []).filter(r => r.id !== id),
    }));
  }

  function addDirection(dayNum, dir) {
    setSavedDirections(prev => ({ ...prev, [dayNum]: [...(prev[dayNum] ?? []), dir] }));
  }
  function updateDirection(dayNum, id, updates) {
    setSavedDirections(prev => ({
      ...prev,
      [dayNum]: (prev[dayNum] ?? []).map(d => d.id === id ? { ...d, ...updates } : d),
    }));
  }
  function deleteDirection(dayNum, id) {
    setSavedDirections(prev => ({
      ...prev,
      [dayNum]: (prev[dayNum] ?? []).filter(d => d.id !== id),
    }));
  }

  function duplicateDay(dayNum) {
    const newNum = dayNum + 1;
    setDays(prev => {
      const idx = prev.findIndex(d => d.day === dayNum);
      const orig = prev[idx];
      const copy = { ...orig, day: newNum, highlights: [...orig.highlights], tags: [...orig.tags] };
      return [...prev.slice(0, idx + 1), copy, ...prev.slice(idx + 1).map(d => ({ ...d, day: d.day + 1 }))];
    });
    setCustomHighlights(prev => { const s = remapKeys(prev, newNum, +1); if (prev[dayNum]) s[newNum] = [...prev[dayNum]]; return s; });
    setCustomNotes(prev => { const s = remapKeys(prev, newNum, +1); if (prev[dayNum] !== undefined) s[newNum] = prev[dayNum]; return s; });
    setSavedPlaces(prev => { const s = remapKeys(prev, newNum, +1); if (prev[dayNum]) s[newNum] = prev[dayNum].map(p => ({ ...p, id: crypto.randomUUID() })); return s; });
    setSavedDirections(prev => remapKeys(prev, newNum, +1));
    setSavedRoutes(prev => remapKeys(prev, newNum, +1));
    setSavedFlights(prev => remapKeys(prev, newNum, +1));
    setSavedRentalCars(prev => remapKeys(prev, newNum, +1));
    setOpenDay(newNum);
  }

  function addBlankDay(afterDayNum) {
    const newNum = afterDayNum + 1;
    setDays(prev => {
      const idx = prev.findIndex(d => d.day === afterDayNum);
      return [...prev.slice(0, idx + 1), { ...BLANK_DAY, day: newNum }, ...prev.slice(idx + 1).map(d => ({ ...d, day: d.day + 1 }))];
    });
    setCustomHighlights(prev => remapKeys(prev, newNum, +1));
    setCustomNotes(prev => remapKeys(prev, newNum, +1));
    setSavedPlaces(prev => remapKeys(prev, newNum, +1));
    setSavedDirections(prev => remapKeys(prev, newNum, +1));
    setSavedRoutes(prev => remapKeys(prev, newNum, +1));
    setSavedFlights(prev => remapKeys(prev, newNum, +1));
    setSavedRentalCars(prev => remapKeys(prev, newNum, +1));
    setOpenDay(newNum);
    setEditingCoreDay(newNum);
    setCoreDraft({ leg: "New Day", overnight: "", nm: 0, hrs: 0 });
  }

  function removeDay(dayNum) {
    if (days.length <= 1) return;
    setDays(prev => prev.filter(d => d.day !== dayNum).map((d, i) => ({ ...d, day: i + 1 })));
    setCustomHighlights(prev => remapKeys(prev, dayNum, -1));
    setCustomNotes(prev => remapKeys(prev, dayNum, -1));
    setSavedPlaces(prev => remapKeys(prev, dayNum, -1));
    setSavedDirections(prev => remapKeys(prev, dayNum, -1));
    setSavedRoutes(prev => remapKeys(prev, dayNum, -1));
    setSavedFlights(prev => remapKeys(prev, dayNum, -1));
    setSavedRentalCars(prev => remapKeys(prev, dayNum, -1));
    setOpenDay(prev => prev === dayNum ? Math.max(1, dayNum - 1) : prev > dayNum ? prev - 1 : prev);
    setConfirmDeleteDay(null);
    setEditingCoreDay(null);
  }

  function moveDay(dayIdx, direction) {
    const otherIdx = direction === "up" ? dayIdx - 1 : dayIdx + 1;
    if (otherIdx < 0 || otherIdx >= days.length) return;
    const kA = days[dayIdx].day;
    const kB = days[otherIdx].day;
    const swapArr = (obj, empty) => {
      const c = { ...obj };
      const tmp = c[kA];
      c[kA] = c[kB] ?? empty;
      c[kB] = tmp   ?? empty;
      return c;
    };
    setSavedPlaces(     p => swapArr(p, []));
    setSavedDirections( p => swapArr(p, []));
    setSavedRoutes(     p => swapArr(p, []));
    setSavedFlights(    p => swapArr(p, []));
    setSavedRentalCars( p => swapArr(p, []));
    setCustomHighlights(p => swapArr(p, []));
    setCustomNotes(     p => swapArr(p, ""));
    setDays(prev => {
      const arr = [...prev];
      [arr[dayIdx], arr[otherIdx]] = [arr[otherIdx], arr[dayIdx]];
      return arr.map((d, i) => ({ ...d, day: i + 1 }));
    });
    setOpenDay(prev => {
      if (prev === kA) return kB;
      if (prev === kB) return kA;
      return prev;
    });
  }

  function startEditCore(dayNum, d) {
    setEditingCoreDay(dayNum);
    setCoreDraft({ leg: d.leg });
    setEditingNoteDay(null);
  }

  function saveCore(dayNum) {
    setDays(prev => prev.map(d =>
      d.day === dayNum
        ? { ...d, leg: coreDraft.leg.trim() || d.leg }
        : d
    ));
    setEditingCoreDay(null);
  }

  function applyClaudeFullItinerary(data) {
    if (data.title)     setTitle(data.title);
    if (data.subtitle)  setSubtitle(data.subtitle);
    if (data.startDate) setStartDate(data.startDate);
    if (data.days?.length) {
      setDays(data.days.map(d => ({
        day: d.day, leg: d.leg ?? "", overnight: d.overnight ?? "",
        nm: 0, hrs: 0, highlights: [], tags: [], note: "",
      })));
    }
    if (data.highlights) {
      setCustomHighlights(
        Object.fromEntries(Object.entries(data.highlights).map(([k, v]) => [Number(k), v]))
      );
    }
    if (data.places) {
      setSavedPlaces(
        Object.fromEntries(Object.entries(data.places).map(([k, arr]) => [
          Number(k),
          arr.map(p => ({
            id: crypto.randomUUID(), name: p.name ?? "", address: "", phone: "",
            website: "", placeId: "", category: p.category ?? "activity",
            notes: p.notes ?? "", addedAt: new Date().toISOString(), mapsProvider: null,
          })),
        ]))
      );
    }
    dirtyRef.current = true;
    if (data.days?.length) setOpenDay(1);
  }

  function applyClaudeDaySuggestions(dayNum, data) {
    if (data.places?.length) {
      setSavedPlaces(prev => ({
        ...prev,
        [dayNum]: [...(prev[dayNum] ?? []), ...data.places.map(p => ({
          id: crypto.randomUUID(), name: p.name ?? "", address: "", phone: "",
          website: "", placeId: "", category: p.category ?? "activity",
          notes: p.notes ?? "", addedAt: new Date().toISOString(), mapsProvider: null,
        }))],
      }));
    }
    if (data.highlights?.length) {
      setCustomHighlights(prev => ({
        ...prev,
        [dayNum]: [...(prev[dayNum] ?? []), ...data.highlights],
      }));
    }
  }

  function applyData(data) {
    const x = extractPerDayState(data);
    setDays(x.days.length ? x.days : []);
    setSavedPlaces(x.places);
    setSavedDirections(x.directions);
    setSavedRoutes(x.routes);
    setSavedFlights(x.flights);
    setSavedRentalCars(x.rentalCars);
    setCustomHighlights(x.highlights);
    setCustomNotes(x.notes);
    setStartDate(data?.startDate ?? "");
    setTitle(data?.title ?? "New Itinerary");
    setSubtitle(data?.subtitle ?? "");
    setItineraryNotes(data?.itineraryNotes ?? "");
  }

  function handleLoad(path, data, dbId) {
    dirtyRef.current = false;
    if (data) {
      applyData(data);
      localStorage.setItem("travelItinerary", JSON.stringify(data));
    }
    const resolvedDbId = dbId ?? databases[0]?.id ?? null;
    setCurrentDbId(resolvedDbId);
    if (resolvedDbId) localStorage.setItem("travelCurrentDb", resolvedDbId);
    setCurrentFile(path);
    if (path === "__local__") localStorage.removeItem("travelCurrentFile");
    else localStorage.setItem("travelCurrentFile", path);
    setSyncStatus(path === "__local__" ? "idle" : "synced");
  }

  function handleCreate(name, dbId) {
    const path = `${ITINERARIES_FOLDER}/it-${crypto.randomUUID().slice(0, 8)}.json`;
    dirtyRef.current = false;
    setDays([]); setSavedPlaces({}); setSavedDirections({}); setSavedRoutes({}); setSavedFlights({}); setSavedRentalCars({});
    setCustomHighlights({}); setCustomNotes({});
    setStartDate(""); setOpenDay(null);
    setTitle(name); setSubtitle(""); setItineraryNotes("");
    localStorage.removeItem("travelItinerary");
    const resolvedDbId = dbId ?? databases[0]?.id ?? null;
    setCurrentDbId(resolvedDbId);
    if (resolvedDbId) localStorage.setItem("travelCurrentDb", resolvedDbId);
    setCurrentFile(path);
    localStorage.setItem("travelCurrentFile", path);
    setSyncStatus("idle");
  }

  function handleClose() {
    // Don't cancel the pending save — let it complete in the background
    // so any unsaved changes (e.g. direction times) are not lost
    setCurrentFile(null);
    localStorage.removeItem("travelCurrentFile");
    localStorage.removeItem("travelItinerary");
    setSyncStatus("idle");
  }

  function toggleLock() {
    setLockedFiles(prev => {
      const next = new Set(prev);
      next.has(currentFile) ? next.delete(currentFile) : next.add(currentFile);
      try { localStorage.setItem("itineraryLocked", JSON.stringify([...next])); } catch {}
      return next;
    });
    setShowMenu(false);
  }

  async function handleDuplicate() {
    setMenuWorking(true);
    try {
      const newPath = `${ITINERARIES_FOLDER}/it-${crypto.randomUUID().slice(0, 8)}.json`;
      const data = {
        startDate, subtitle, itineraryNotes, title: `Copy of ${title}`,
        days: days.map(d => {
          const { day: _, ...rest } = d;
          return {
            ...rest,
            highlights: customHighlights[String(d.day)] ?? d.highlights ?? [],
            note:       customNotes[String(d.day)]       ?? d.note       ?? "",
            places:     savedPlaces[String(d.day)]        ?? [],
            directions: savedDirections[String(d.day)]    ?? [],
            routes:     savedRoutes[String(d.day)]         ?? [],
            flights:    savedFlights[String(d.day)]        ?? [],
            rentalCars: savedRentalCars[String(d.day)]     ?? [],
          };
        }),
      };
      await saveToGitHub(data, { ...ghSettings, githubFile: newPath });
      const overnights = days.map(d => d.overnight).filter(Boolean);
      const legs       = days.map(d => d.leg).filter(Boolean);
      const locations  = overnights.length >= 2 ? `${overnights[0]} → ${overnights[overnights.length - 1]}`
                       : overnights[0] ?? legs[0] ?? null;
      try {
        const meta = JSON.parse(localStorage.getItem("itineraryMetadata") || "{}");
        meta[newPath] = { title: data.title, startDate, dayCount: days.length, locations };
        localStorage.setItem("itineraryMetadata", JSON.stringify(meta));
      } catch {}
      // Navigate to the duplicate
      applyData(data);
      setCurrentFile(newPath);
      localStorage.setItem("travelCurrentFile", newPath);
      localStorage.setItem("travelItinerary", JSON.stringify(data));
      dirtyRef.current = false;
      setSyncStatus("saved");
      setShowMenu(false);
    } catch {
      setShowMenu(false);
    } finally {
      setMenuWorking(false);
    }
  }

  async function handleMoveItinerary(toDbId) {
    setMenuWorking(true);
    try {
      const toDb  = databases.find(d => d.id === toDbId);
      const toGhs = { githubToken: toDb.githubToken ?? "", githubRepo: toDb.githubRepo || inferRepo() || "", githubBranch: toDb.githubBranch || "data" };
      const newPath = `${ITINERARIES_FOLDER}/it-${crypto.randomUUID().slice(0, 8)}.json`;
      const data = {
        startDate, title, subtitle, itineraryNotes,
        days: days.map(d => ({
          ...d,
          highlights: customHighlights[String(d.day)] ?? d.highlights ?? [],
          note:       customNotes[String(d.day)]       ?? d.note       ?? "",
          places:     savedPlaces[String(d.day)]        ?? [],
          directions: savedDirections[String(d.day)]    ?? [],
          routes:     savedRoutes[String(d.day)]         ?? [],
          flights:    savedFlights[String(d.day)]        ?? [],
          rentalCars: savedRentalCars[String(d.day)]     ?? [],
        })),
      };
      await saveToGitHub(data, { ...toGhs, githubFile: newPath });
      await deleteFromGitHub({ ...ghSettings, githubFile: currentFile });
      try { await deleteFromGitHub({ ...ghSettings, githubFile: currentFile.replace(/\.json$/i, ".ics") }); } catch {}
      try {
        const meta = JSON.parse(localStorage.getItem("itineraryMetadata") || "{}");
        const newKey = `${toDbId}:${newPath}`;
        meta[newKey] = { title, startDate, dayCount: days.length };
        delete meta[`${currentDbId}:${currentFile}`];
        localStorage.setItem("itineraryMetadata", JSON.stringify(meta));
        const deleted = new Set(JSON.parse(localStorage.getItem("itineraryDeletedPaths") || "[]"));
        deleted.add(`${currentDbId}:${currentFile}`);
        localStorage.setItem("itineraryDeletedPaths", JSON.stringify([...deleted]));
      } catch {}
      clearTimeout(syncTimerRef.current);
      setCurrentDbId(toDbId);
      localStorage.setItem("travelCurrentDb", toDbId);
      setCurrentFile(newPath);
      localStorage.setItem("travelCurrentFile", newPath);
      dirtyRef.current = false;
      setSyncStatus("saved");
      setShowMenu(false);
      setMoveToDbId(null);
    } catch {
      setMoveToDbId(null);
      setShowMenu(false);
    } finally {
      setMenuWorking(false);
    }
  }

  async function handleDeleteItinerary() {
    setMenuWorking(true);
    try {
      await deleteFromGitHub({ ...ghSettings, githubFile: currentFile });
      try { await deleteFromGitHub({ ...ghSettings, githubFile: currentFile.replace(/\.json$/i, ".ics") }); } catch {}
      try {
        const cacheKey = `${currentDbId}:${currentFile}`;
        const meta = JSON.parse(localStorage.getItem("itineraryMetadata") || "{}");
        delete meta[cacheKey];
        localStorage.setItem("itineraryMetadata", JSON.stringify(meta));
        // Record the deletion so the picker can filter it out even if GitHub CDN returns stale data
        const deleted = new Set(JSON.parse(localStorage.getItem("itineraryDeletedPaths") || "[]"));
        deleted.add(cacheKey);
        localStorage.setItem("itineraryDeletedPaths", JSON.stringify([...deleted]));
      } catch {}
      clearTimeout(syncTimerRef.current);
      setCurrentFile(null);
      localStorage.removeItem("travelCurrentFile");
      localStorage.removeItem("travelItinerary");
      setSyncStatus("idle");
    } catch {
      setConfirmDelete(false);
      setShowMenu(false);
    } finally {
      setMenuWorking(false);
    }
  }

  function handleSaveAs() {
    const newTitle = saveAsName.trim() || title;
    if (!newTitle) return;
    const path = `${ITINERARIES_FOLDER}/it-${crypto.randomUUID().slice(0, 8)}.json`;
    setTitle(newTitle);
    setCurrentFile(path);
    localStorage.setItem("travelCurrentFile", path);
    dirtyRef.current = true;
    setSyncStatus("pending");
    setSaveAsName("");
  }

  function buildICSContent(daysArr, sd, ttl, highlights, notes, fileId, appBase,
                           flights, rentalCars, savedPlaces, savedDirections, savedRoutes) {
    if (!sd || !daysArr.length) return null;
    const [sy, sm, sday] = sd.split("-").map(Number);
    const toICSDate = n => {
      const d = new Date(sy, sm - 1, sday + n - 1);
      return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,"0")}${String(d.getDate()).padStart(2,"0")}`;
    };
    const esc = s => (s ?? "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
    const toICSDateTime = (dateStr, hhmm) => {
      const [h, m] = hhmm.split(":").map(Number);
      return `${dateStr}T${String(h).padStart(2,"0")}${String(m).padStart(2,"0")}00`;
    };
    const addMins = (dt, mins) => {
      const y = +dt.slice(0,4), mo = +dt.slice(4,6)-1, day = +dt.slice(6,8);
      const h = +dt.slice(9,11), m = +dt.slice(11,13);
      const d = new Date(y, mo, day, h, m + mins);
      return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,"0")}${String(d.getDate()).padStart(2,"0")}` +
             `T${String(d.getHours()).padStart(2,"0")}${String(d.getMinutes()).padStart(2,"0")}00`;
    };
    const ampmTo24 = str => {
      if (!str) return null;
      const m = str.match(/(\d+):(\d+)\s*(AM|PM)/i);
      if (!m) return null;
      let h = +m[1];
      if (m[3].toUpperCase() === "PM" && h !== 12) h += 12;
      if (m[3].toUpperCase() === "AM" && h === 12) h = 0;
      return `${String(h).padStart(2,"0")}:${m[2]}`;
    };
    const parseDurMins = str => {
      if (!str) return 60;
      let total = 0;
      const hm = str.match(/(\d+)\s*h/i); const mm = str.match(/(\d+)\s*m/i);
      if (hm) total += +hm[1] * 60; if (mm) total += +mm[1];
      return total || 60;
    };

    const cal = [
      "BEGIN:VCALENDAR", "VERSION:2.0",
      `PRODID:-//${esc(ttl || "Travel Itinerary")}//EN`,
      "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
      `X-WR-CALNAME:${esc(ttl || "Travel Itinerary")}`,
    ];

    daysArr.forEach(d => {
      const dateStr = toICSDate(d.day);
      const parts = [];
      const _rNm = (savedRoutes?.[d.day] ?? []).reduce((s, r) => s + (r.nm || 0), 0);
      const _rHrs = (savedRoutes?.[d.day] ?? []).reduce((s, r) => s + (r.hrs || 0), 0);
      const _nm = _rNm > 0 ? _rNm : d.nm;
      const _hrs = _rHrs > 0 ? _rHrs : d.hrs;
      if (_nm > 0) parts.push(`${_nm} NM · ~${_hrs.toFixed(1)} hrs`);
      if (d.overnight) parts.push(`Overnight: ${d.overnight}`);
      const hl = [...(d.highlights ?? []), ...(highlights[d.day] ?? [])];
      if (hl.length) parts.push("\nHighlights:\n" + hl.map(h => `• ${h}`).join("\n"));
      const note = notes[d.day] !== undefined ? notes[d.day] : d.note;
      if (note) parts.push(`\nNote: ${note}`);
      const fl = (flights ?? {})[d.day] ?? [];
      if (fl.length) parts.push("\nFlights:\n" + fl.map(f =>
        `✈ ${f.flightNumber}: ${f.departure} → ${f.arrival}` +
        (f.miles ? ` · ${f.miles.toLocaleString()} mi` : "") +
        (f.confirmation ? ` (Conf: ${f.confirmation})` : "")
      ).join("\n"));
      const cars = (rentalCars ?? {})[d.day] ?? [];
      if (cars.length) parts.push("\nRental Cars:\n" + cars.map(c =>
        `🚗 ${c.agency}` +
        (c.confirmation ? ` · Conf: ${c.confirmation}` : "") +
        (c.pickupLocation ? `\n   Pick-up: ${c.pickupLocation}` : "") +
        (c.dropoffLocation ? `\n   Drop-off: ${c.dropoffLocation}` : "")
      ).join("\n"));

      // All-day summary event for the day
      cal.push("BEGIN:VEVENT");
      cal.push(`DTSTART;VALUE=DATE:${dateStr}`);
      cal.push(`DTEND;VALUE=DATE:${toICSDate(d.day + 1)}`);
      cal.push(`SUMMARY:${esc(`Day ${d.day}: ${d.leg}`)}`);
      if (d.overnight) cal.push(`LOCATION:${esc(d.overnight)}`);
      if (parts.length) cal.push(`DESCRIPTION:${esc(parts.join("\n"))}`);
      if (fileId && appBase) cal.push(`URL:${appBase}?i=${encodeURIComponent(fileId)}&day=${d.day}`);
      cal.push(`UID:day-${d.day}-${dateStr}@travelitinerary`);
      cal.push("END:VEVENT");

      // Timed event: flights
      fl.forEach(f => {
        const dep24 = ampmTo24(f.departureTime);
        const arr24 = ampmTo24(f.arrivalTime);
        if (!dep24) return;
        const dtStart = toICSDateTime(dateStr, dep24);
        const dtEnd   = arr24 ? toICSDateTime(dateStr, arr24) : addMins(dtStart, 180);
        const desc = [
          f.airline && f.aircraft ? `${f.airline} · ${f.aircraft}` : f.airline || f.aircraft || "",
          f.departureName && f.arrivalName ? `${f.departureName} → ${f.arrivalName}` : "",
          f.confirmation ? `Confirmation: ${f.confirmation}` : "",
          f.notes || "",
        ].filter(Boolean).join("\n");
        cal.push("BEGIN:VEVENT");
        cal.push(`DTSTART:${dtStart}`);
        cal.push(`DTEND:${dtEnd}`);
        cal.push(`SUMMARY:${esc(`✈ ${f.flightNumber}: ${f.departure} → ${f.arrival}`)}`);
        if (desc) cal.push(`DESCRIPTION:${esc(desc)}`);
        cal.push(`UID:flight-${f.id}@travelitinerary`);
        cal.push("END:VEVENT");
      });

      // Timed event: places
      (savedPlaces?.[d.day] ?? []).forEach(p => {
        if (!p.time) return;
        const dtStart = toICSDateTime(dateStr, p.time);
        const dtEnd   = addMins(dtStart, 60);
        const desc = [
          p.phone ? `Phone: ${p.phone}` : "",
          p.website ? `Website: ${p.website}` : "",
          p.notes || "",
        ].filter(Boolean).join("\n");
        cal.push("BEGIN:VEVENT");
        cal.push(`DTSTART:${dtStart}`);
        cal.push(`DTEND:${dtEnd}`);
        cal.push(`SUMMARY:${esc(p.name)}`);
        if (p.address) cal.push(`LOCATION:${esc(p.address)}`);
        if (desc) cal.push(`DESCRIPTION:${esc(desc)}`);
        cal.push(`UID:place-${p.id}@travelitinerary`);
        cal.push("END:VEVENT");
      });

      // Timed event: directions
      (savedDirections?.[d.day] ?? []).forEach(dir => {
        if (!dir.time) return;
        const dtStart = toICSDateTime(dateStr, dir.time);
        const dtEnd   = addMins(dtStart, parseDurMins(dir.duration));
        const desc = [
          [dir.distance, dir.duration].filter(Boolean).join(" · "),
          dir.notes || "",
        ].filter(Boolean).join("\n");
        const TMODE = { DRIVING: "driving", WALKING: "walking", BICYCLING: "bicycling", TRANSIT: "transit" };
        const mapsUrl = (dir.mapsProvider ?? "google") === "apple"
          ? `https://maps.apple.com/?saddr=${encodeURIComponent(dir.origin.name)}&daddr=${encodeURIComponent(dir.destination.name)}&dirflg=${dir.travelMode === "WALKING" ? "w" : "d"}`
          : `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(dir.origin.name)}&destination=${encodeURIComponent(dir.destination.name)}&travelmode=${TMODE[dir.travelMode] ?? "driving"}`;
        cal.push("BEGIN:VEVENT");
        cal.push(`DTSTART:${dtStart}`);
        cal.push(`DTEND:${dtEnd}`);
        cal.push(`SUMMARY:${esc(`${dir.origin.name} → ${dir.destination.name}`)}`);
        cal.push(`LOCATION:${esc(dir.destination.name)}`);
        if (desc) cal.push(`DESCRIPTION:${esc(desc)}`);
        cal.push(`URL:${mapsUrl}`);
        cal.push(`UID:dir-${dir.id}@travelitinerary`);
        cal.push("END:VEVENT");
      });

      // Timed event: boating routes
      (savedRoutes?.[d.day] ?? []).forEach(r => {
        if (!r.time) return;
        const dtStart = toICSDateTime(dateStr, r.time);
        const dtEnd   = addMins(dtStart, Math.round((r.hrs || 0) * 60));
        const desc = [
          `${r.nm} NM at ${r.speedKts} kts · ~${r.hrs} hrs`,
          r.notes || "",
        ].filter(Boolean).join("\n");
        cal.push("BEGIN:VEVENT");
        cal.push(`DTSTART:${dtStart}`);
        cal.push(`DTEND:${dtEnd}`);
        cal.push(`SUMMARY:${esc(`🚢 ${r.name || "Boating Route"}`)}`);
        if (desc) cal.push(`DESCRIPTION:${esc(desc)}`);
        cal.push(`UID:route-${r.id}@travelitinerary`);
        cal.push("END:VEVENT");
      });

      // Timed event: rental cars
      cars.forEach(c => {
        if (!c.time) return;
        const dtStart = toICSDateTime(dateStr, c.time);
        const dtEnd   = addMins(dtStart, 60);
        const desc = [
          c.confirmation ? `Confirmation: ${c.confirmation}` : "",
          c.pickupLocation ? `Pick-up: ${c.pickupLocation}` : "",
          c.dropoffLocation ? `Drop-off: ${c.dropoffLocation}` : "",
          c.notes || "",
        ].filter(Boolean).join("\n");
        cal.push("BEGIN:VEVENT");
        cal.push(`DTSTART:${dtStart}`);
        cal.push(`DTEND:${dtEnd}`);
        cal.push(`SUMMARY:${esc(`🚗 ${c.agency} Car Rental`)}`);
        if (c.pickupLocation) cal.push(`LOCATION:${esc(c.pickupLocation)}`);
        if (desc) cal.push(`DESCRIPTION:${esc(desc)}`);
        cal.push(`UID:rental-${c.id}@travelitinerary`);
        cal.push("END:VEVENT");
      });
    });
    cal.push("END:VCALENDAR");
    return cal.join("\r\n");
  }

  function generateICS() {
    const content = buildICSContent(days, startDate, title, customHighlights, customNotes, currentFile?.replace(/^.*\//, "").replace(/\.json$/i, ""), appBase, savedFlights, savedRentalCars, savedPlaces, savedDirections, savedRoutes);
    if (!content) return;
    const blob = new Blob([content], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${sanitizeFilename(title || "itinerary")}.ics`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async function handleCommit(message = "") {
    if (!ghSettings.githubToken || !effectiveRepo || !currentFile || currentFile === "__local__") return;
    setSyncStatus("saving");
    setSyncError("");
    const msg = message.trim() ||
      `Saved ${new Date().toLocaleString("en-US", { month:"short", day:"numeric", year:"numeric", hour:"numeric", minute:"2-digit" })}`;
    const data = {
      startDate, title, subtitle, itineraryNotes,
      days: days.map(d => {
        const { day: _, ...rest } = d;
        return {
          ...rest,
          highlights: customHighlights[String(d.day)] ?? d.highlights ?? [],
          note:       customNotes[String(d.day)]       ?? d.note       ?? "",
          places:     savedPlaces[String(d.day)]        ?? [],
          directions: savedDirections[String(d.day)]    ?? [],
          routes:     savedRoutes[String(d.day)]         ?? [],
          flights:    savedFlights[String(d.day)]        ?? [],
          rentalCars: savedRentalCars[String(d.day)]     ?? [],
        };
      }),
    };
    try {
      await saveToGitHub(data, { ...ghSettings, githubFile: currentFile, message: msg });
      const icsContent = buildICSContent(days, startDate, title, customHighlights, customNotes,
        currentFile?.replace(/^.*\//, "").replace(/\.json$/i, ""), appBase, savedFlights, savedRentalCars,
        savedPlaces, savedDirections, savedRoutes);
      if (icsContent) {
        await saveToGitHub(icsContent, { ...ghSettings, githubFile: currentFile.replace(/\.json$/i, ".ics") });
      }
      setSyncStatus("saved");
      dirtyRef.current = false;
      setShowCommitForm(false);
      setCommitDraft("");
      // Reload from GitHub after commit to keep localStorage in sync with what was actually saved
      try {
        const fresh = await loadFromGitHub({ ...ghSettings, githubFile: currentFile });
        if (fresh) {
          applyData(fresh);
          localStorage.setItem("travelItinerary", JSON.stringify(fresh));
        }
      } catch {} // non-fatal — UI already shows committed state
    } catch (err) {
      setSyncStatus(err.message === "conflict" ? "conflict" : "error");
      setSyncError(err.message);
    }
  }

  function handleCloseRequest() {
    if (syncStatus === "unsaved") { setShowCloseWarn(true); return; }
    handleClose();
  }

  async function handleRestore(sha) {
    const data = await loadFromGitHub({ ...ghSettings, githubFile: currentFile, githubBranch: sha });
    if (data) {
      applyData(data);
      dirtyRef.current = true;
    }
    setShowHistory(false);
  }

  function reloadFromGitHub() {
    if (!currentFile || currentFile === "__local__") return;
    setSyncStatus("loading");
    loadFromGitHub({ ...settings, githubFile: currentFile })
      .then(data => {
        if (!data) { setSyncStatus("idle"); return; }
        applyData(data);
        setSyncStatus("synced");
      })
      .catch(() => setSyncStatus("error"));
  }

  function getDayDate(dayNum) {
    if (!startDate) return null;
    const [y, m, d] = startDate.split("-").map(Number);
    const date = new Date(y, m - 1, d + dayNum - 1);
    return {
      dow:  date.toLocaleDateString("en-US", { weekday: "short" }),
      date: date.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    };
  }

  const SKIP_COUNTRY = /^(United States|USA|US|Canada|Australia|New Zealand|United Kingdom|UK|Mexico|France|Germany|Italy|Spain|Japan|China|Brazil|Ireland|Netherlands|Sweden|Norway|Denmark|Finland|Switzerland|Austria|Belgium|Portugal|Greece|Poland)$/i;
  const SKIP_STATE   = /^[A-Z]{1,3}(\s+[\dA-Z][\dA-Z\s-]{2,8})?$/;

  function cityFromAddress(text) {
    if (!text?.trim()) return null;
    const parts = text.split(",").map(p => p.trim()).filter(Boolean);
    if (!parts.length) return null;
    let end = parts.length - 1;
    while (end > 0 && (SKIP_COUNTRY.test(parts[end]) || SKIP_STATE.test(parts[end]))) end--;
    return parts[end] || null;
  }

  function getDayCities(dayNum) {
    const seen = new Set();
    const add = (text) => { const c = cityFromAddress(text); if (c) seen.add(c); };
    (savedFlights[dayNum]    ?? []).forEach(f => {
      if (f.departureName) seen.add(f.departureName);
      if (f.arrivalName)   seen.add(f.arrivalName);
    });
    (savedDirections[dayNum] ?? []).forEach(dir => { add(dir.origin?.name); add(dir.destination?.name); });
    (savedPlaces[dayNum]     ?? []).forEach(p   => add(p.address));
    (savedRentalCars[dayNum] ?? []).forEach(c   => { add(c.pickupLocation); add(c.dropoffLocation); });
    return [...seen].filter(Boolean);
  }

  const dateRange = (() => {
    if (!startDate || !days.length) return null;
    const [y, m, d] = startDate.split("-").map(Number);
    const start = new Date(y, m - 1, d);
    const end   = new Date(y, m - 1, d + days.length - 1);
    const fmtShort = dt => dt.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    const fmtFull  = dt => dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    return `${fmtShort(start)} – ${fmtFull(end)}`;
  })();

  const effNm  = d => { const rn = (savedRoutes[d.day] ?? []).reduce((s, r) => s + (r.nm  || 0), 0); return rn > 0 ? rn : d.nm; };
  const effHrs = d => { const rh = (savedRoutes[d.day] ?? []).reduce((s, r) => s + (r.hrs || 0), 0); return rh > 0 ? rh : d.hrs; };

  const totalNM  = days.reduce((s, d) => s + effNm(d), 0);
  const travelDays = days.filter(d =>
    effNm(d) > 0 ||
    (savedFlights[d.day] ?? []).length > 0 ||
    (savedDirections[d.day] ?? []).length > 0
  ).length;

  const totalFlightMiles = Math.round(
    Object.values(savedFlights).flat().reduce((s, f) => s + (f.miles || 0), 0)
  );

  const totalDrivingMiles = Math.round(
    Object.values(savedDirections).flat().reduce((s, d) => {
      if (!d.distance) return s;
      const m = d.distance.match(/([\d,.]+)\s*(km|mi|miles)?/i);
      if (!m) return s;
      const val = parseFloat(m[1].replace(/,/g, ""));
      const unit = (m[2] || "mi").toLowerCase();
      return s + (unit === "km" ? val * 0.621371 : val);
    }, 0)
  );
  const todos = [
    ...(itineraryNotes ? itineraryNotes.split("\n")
      .filter(line => /^TODO:/i.test(line.trim()))
      .map(line => ({ day: null, text: line.trim().replace(/^TODO:\s*/i, "") })) : []),
    ...days.flatMap(d => {
      const note = customNotes[d.day] !== undefined ? customNotes[d.day] : d.note;
      if (!note) return [];
      return note.split("\n")
        .filter(line => /^TODO:/i.test(line.trim()))
        .map(line => ({ day: d.day, text: line.trim().replace(/^TODO:\s*/i, "") }));
    }),
  ];

  // Compute local cache for picker (only meaningful data)
  const localCache = (() => {
    if (currentFile) return null; // already have a file open
    try {
      const s = localStorage.getItem("travelItinerary");
      const d = s ? JSON.parse(s) : null;
      if (!d || (!d.days?.length && !d.title)) return null;
      return d;
    } catch { return null; }
  })();

  if (urlLoad?.status === "loading") {
    return (
      <div style={{ display:"flex", justifyContent:"center", alignItems:"center",
        minHeight:"100vh", background:"#ffffff", color:"#5c6470",
        fontFamily:"inherit", fontSize:".9rem" }}>
        Loading…
      </div>
    );
  }

  if (urlLoad?.status === "notfound") {
    const name = urlLoad.file.replace(/^.*\//, "").replace(/\.json$/i, "");
    return (
      <div style={{ display:"flex", flexDirection:"column", justifyContent:"center",
        alignItems:"center", minHeight:"100vh", background:"#ffffff",
        fontFamily:"inherit", gap:"1rem", padding:"2rem" }}>
        <div style={{ fontSize:".62rem", color:"#0b3d6b", letterSpacing:".2em",
          textTransform:"uppercase" }}>Not Found</div>
        <div style={{ fontSize:"1.1rem", color:"#5c6470", textAlign:"center" }}>
          "{name}" doesn't exist.
        </div>
        <button onClick={() => {
            const url = new URL(window.location.href);
            url.searchParams.delete("i");
            history.replaceState(null, "", url);
            setUrlLoad(null);
          }}
          style={{ background:"none", border:"1px solid #2e5070", color:"#6b7a8a",
            borderRadius:4, padding:".5rem 1.25rem", fontSize:".82rem",
            fontFamily:"inherit", cursor:"pointer" }}>
          ← All Itineraries
        </button>
      </div>
    );
  }

  if (!currentFile) {
    return (
      <ItineraryPicker
        key={pickerKey}
        settings={settings}
        onSettingsChange={setSettings}
        onLoad={handleLoad}
        onCreate={handleCreate}
        localCache={localCache}
      />
    );
  }

  return (
    <div style={{ fontFamily: "inherit", background: "#ffffff", minHeight: "100vh", color: "#0e1014" }}>

      {/* ── HEADER ── */}
      <div style={{ background: "#ffffff", borderBottom: "1px solid #e2e5ea", padding: "1rem 2rem" }}>
        <div style={{ maxWidth: 820, margin: "0 auto" }}>
          {/* Subtitle row: back button + file name + sync status + settings gear */}
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:".5rem" }}>
            <div style={{ display:"flex", alignItems:"center", gap:".75rem" }}>
              <button onClick={handleCloseRequest}
                style={{ background:"none", border:"none", color:"#6b7a8a", cursor:"pointer",
                  fontSize:".7rem", fontFamily:"inherit", padding:0 }}>
                ← All Itineraries
              </button>
              <span style={{ color:"#9ba1ac", fontSize:".7rem", fontFamily:"inherit" }}>·</span>
              <div style={{ fontSize:".7rem", color:"#0b3d6b", fontFamily:"inherit",
                letterSpacing: dateRange ? ".03em" : ".15em",
                textTransform: dateRange ? "none" : "uppercase" }}>
                {dateRange
                  ? <>{dateRange} <span style={{ opacity:.6 }}>· {days.length} days</span></>
                  : <>{days.length} Days</>}
                {currentFile === "__local__" &&
                  <span style={{ color:"#d97706", marginLeft:".5rem" }}>· Local only</span>}
              </div>
            </div>
            <div style={{ display:"flex", alignItems:"center", gap:".75rem" }}>
              {syncStatus !== "idle" && (() => {
                const map = {
                  loading:  ["Loading…",        "#5c6470"],
                  saving:   ["Saving…",          "#d97706"],
                  saved:    ["● Synced",         "#16a34a"],
                  synced:   ["● Synced",         "#16a34a"],
                  unsaved:  ["● Unsaved",        "#d97706"],
                  offline:  ["Offline",          "#6b7a8a"],
                  error:    ["⚠ Error",          "#dc2626"],
                  conflict: ["⚠ Conflict",       "#dc2626"],
                };
                const [label, color] = map[syncStatus] ?? ["", "#5c6470"];
                const canCommit = ghSettings.githubToken && effectiveRepo && syncStatus !== "saving";
                const showCommit = ["unsaved", "error", "conflict"].includes(syncStatus) && canCommit;
                return (
                  <div style={{ display:"flex", alignItems:"center", gap:".4rem" }}>
                    <span style={{ fontSize:".62rem", color, fontFamily:"inherit" }}
                      title={syncError || undefined}>
                      {label}{syncError && syncStatus === "error" ? ` — ${syncError}` : ""}
                    </span>
                    {showCommit && (
                      <button onClick={() => setShowCommitForm(p => !p)}
                        style={{ background: showCommitForm ? "#f0f4f8" : "none",
                          border:"1px solid #2e5070", color:"#0b3d6b",
                          borderRadius:3, padding:".15rem .5rem", fontSize:".62rem",
                          fontFamily:"inherit", cursor:"pointer", whiteSpace:"nowrap" }}>
                        Commit{showCommitForm ? " ▲" : "…"}
                      </button>
                    )}
                  </div>
                );
              })()}
              {ghSettings.githubToken && currentFile && currentFile !== "__local__" && (
                <div style={{ position: "relative" }}>
                  <button onClick={() => { setShowMenu(p => !p); setShowSettings(false); setShowHistory(false); setConfirmDelete(false); }}
                    title="More options"
                    style={{ background:"none", border:"none", color: showMenu ? "#0b3d6b" : "#5c6470",
                      cursor:"pointer", fontSize:"1rem", padding:0, lineHeight:1, letterSpacing:".05em" }}>
                    ···
                  </button>
                  {showMenu && (
                    <div style={{ position:"absolute", right:0, top:"1.6rem", zIndex:100,
                      background:"#ffffff", border:"1px solid #e2e5ea", borderRadius:6,
                      minWidth:140, boxShadow:"0 4px 20px rgba(0,0,0,0.1)", overflow:"hidden" }}>
                      {!confirmDelete ? (
                        <>
                          {ghSettings.githubToken && (
                            <button onClick={() => { setShowHistory(p => !p); setShowMenu(false); }}
                              style={{ display:"block", width:"100%", textAlign:"left",
                                background:"none", border:"none", borderBottom:"1px solid #1e3a5230",
                                color: showHistory ? "#0b3d6b" : "#0e1014", fontFamily:"inherit", fontSize:".82rem",
                                padding:".65rem 1rem", cursor:"pointer" }}>
                              History
                            </button>
                          )}
                          <button onClick={handleDuplicate} disabled={menuWorking}
                            style={{ display:"block", width:"100%", textAlign:"left",
                              background:"none", border:"none", borderBottom:"1px solid #1e3a5230",
                              color:"#0e1014", fontFamily:"inherit", fontSize:".82rem",
                              padding:".65rem 1rem", cursor:"pointer", opacity: menuWorking ? 0.5 : 1 }}>
                            {menuWorking ? "Duplicating…" : "Duplicate"}
                          </button>
                          {databases.length > 1 && !moveToDbId && (
                            <div style={{ borderBottom:"1px solid #1e3a5230" }}>
                              <button onClick={() => setMoveToDbId("pick")} disabled={menuWorking}
                                style={{ display:"block", width:"100%", textAlign:"left",
                                  background:"none", border:"none",
                                  color:"#0e1014", fontFamily:"inherit", fontSize:".82rem",
                                  padding:".65rem 1rem", cursor:"pointer", opacity: menuWorking ? 0.5 : 1 }}>
                                Move to…
                              </button>
                            </div>
                          )}
                          {databases.length > 1 && moveToDbId === "pick" && (
                            <div style={{ padding:".5rem 1rem", borderBottom:"1px solid #1e3a5230" }}>
                              <div style={{ fontSize:".72rem", color:"#5c6470", fontFamily:"inherit", marginBottom:".4rem" }}>Move to:</div>
                              <div style={{ display:"flex", flexDirection:"column", gap:".25rem" }}>
                                {databases.filter(d => d.id !== currentDbId).map(d => (
                                  <button key={d.id} onClick={() => handleMoveItinerary(d.id)} disabled={menuWorking}
                                    style={{ background:"none", border:"1px solid #2e5070", color:"#0e1014",
                                      borderRadius:4, padding:".3rem .75rem", fontSize:".75rem",
                                      fontFamily:"inherit", cursor:"pointer", textAlign:"left",
                                      opacity: menuWorking ? 0.5 : 1 }}>
                                    {menuWorking ? "Moving…" : (d.label || d.githubRepo || "Database")}
                                  </button>
                                ))}
                                <button onClick={() => setMoveToDbId(null)} disabled={menuWorking}
                                  style={{ background:"none", border:"none", color:"#9ba1ac",
                                    fontFamily:"inherit", fontSize:".72rem", cursor:"pointer",
                                    textAlign:"left", padding:".2rem 0" }}>
                                  Cancel
                                </button>
                              </div>
                            </div>
                          )}
                          <button onClick={() => setConfirmDelete(true)} disabled={menuWorking}
                            style={{ display:"block", width:"100%", textAlign:"left",
                              background:"none", border:"none",
                              color:"#dc2626", fontFamily:"inherit", fontSize:".82rem",
                              padding:".65rem 1rem", cursor:"pointer", opacity: menuWorking ? 0.5 : 1 }}>
                            Delete
                          </button>
                        </>
                      ) : (
                        <div style={{ padding:".65rem 1rem" }}>
                          <div style={{ fontSize:".75rem", color:"#d97706", fontFamily:"inherit",
                            marginBottom:".5rem" }}>
                            Delete this itinerary?
                          </div>
                          <div style={{ display:"flex", gap:".4rem" }}>
                            <button onClick={handleDeleteItinerary} disabled={menuWorking}
                              style={{ background:"#fef2f2", border:"1px solid #dc354566",
                                color:"#dc2626", borderRadius:4, padding:".3rem .6rem",
                                fontSize:".72rem", fontFamily:"inherit", cursor:"pointer",
                                opacity: menuWorking ? 0.5 : 1 }}>
                              {menuWorking ? "Deleting…" : "Yes, delete"}
                            </button>
                            <button onClick={() => setConfirmDelete(false)} disabled={menuWorking}
                              style={{ background:"none", border:"1px solid #2e3a4a",
                                color:"#6b7a8a", borderRadius:4, padding:".3rem .6rem",
                                fontSize:".72rem", fontFamily:"inherit", cursor:"pointer" }}>
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
              {currentFile && currentFile !== "__local__" && typeof navigator.share === "function" && (
                <button
                  onClick={() => navigator.share({ title, url: window.location.href })}
                  title="Share itinerary"
                  style={{ background:"none", border:"none", color:"#5c6470",
                    cursor:"pointer", fontSize:".95rem", padding:0, lineHeight:1 }}>
                  ⬆
                </button>
              )}
              <button onClick={() => { setShowSettings(p => !p); setShowHistory(false); setShowMenu(false); }} title="Settings"
                style={{ background:"none", border:"none", color: showSettings ? "#0b3d6b" : "#5c6470",
                  cursor:"pointer", fontSize:"1rem", padding:0, lineHeight:1 }}>
                ⚙
              </button>
            </div>
          </div>

          {/* Settings panel */}
          {showSettings && (
            <Settings
              settings={settings}
              onSave={draft => { setSettings(draft); setShowSettings(false); }}
              onClose={() => setShowSettings(false)}
            />
          )}

          {/* History panel */}
          {showHistory && (
            <HistoryPanel
              key={currentFile}
              settings={ghSettings}
              currentFile={currentFile}
              onRestore={handleRestore}
              onClose={() => setShowHistory(false)}
            />
          )}

          {/* Commit form */}
          {showCommitForm && (
            <div style={{ margin: ".75rem 0 1rem", padding: ".75rem 1rem", background: "#f0f4f8",
              border: "1px solid #2e5070", borderRadius: 6 }}>
              <div style={{ fontSize: ".62rem", color: "#0b3d6b", letterSpacing: ".1em",
                textTransform: "uppercase", fontFamily: "inherit", marginBottom: ".6rem" }}>
                Commit to GitHub
              </div>
              <div style={{ display: "flex", gap: ".5rem", flexWrap: "wrap" }}>
                <input
                  autoFocus
                  value={commitDraft}
                  onChange={e => setCommitDraft(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === "Enter") handleCommit(commitDraft);
                    if (e.key === "Escape") { setShowCommitForm(false); setCommitDraft(""); }
                  }}
                  placeholder="Commit message (optional)"
                  style={{ flex: 1, minWidth: 180, background: "#ffffff", border: "1px solid #e2e5ea",
                    color: "#0e1014", borderRadius: 4, padding: ".35rem .65rem",
                    fontSize: ".82rem", fontFamily: "inherit", outline: "none" }}
                />
                <button onClick={() => handleCommit(commitDraft)}
                  disabled={syncStatus === "saving"}
                  style={{ background: "#f0f4f8", border: "1px solid #2e5070", color: "#0b3d6b",
                    borderRadius: 4, padding: ".35rem .85rem", fontSize: ".75rem",
                    fontFamily: "inherit", cursor: "pointer", whiteSpace: "nowrap",
                    opacity: syncStatus === "saving" ? 0.5 : 1 }}>
                  {syncStatus === "saving" ? "Committing…" : "Commit"}
                </button>
                <button onClick={() => { setShowCommitForm(false); setCommitDraft(""); }}
                  style={{ background: "none", border: "1px solid #2e3a4a", color: "#6b7a8a",
                    borderRadius: 4, padding: ".35rem .85rem", fontSize: ".75rem",
                    fontFamily: "inherit", cursor: "pointer" }}>
                  Cancel
                </button>
              </div>
              {syncError && (
                <div style={{ marginTop: ".5rem", fontSize: ".72rem", color: "#dc2626",
                  fontFamily: "inherit" }}>{syncError}</div>
              )}
            </div>
          )}

          {/* Navigation warning */}
          {showCloseWarn && (
            <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 2000,
              display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }}>
              <div style={{ background: "#ffffff", border: "1px solid #e2e5ea", borderRadius: 8,
                padding: "1.5rem", maxWidth: 360, width: "100%", fontFamily: "inherit" }}>
                <div style={{ fontSize: ".88rem", color: "#0e1014", marginBottom: ".75rem",
                  fontWeight: 500 }}>
                  Uncommitted changes
                </div>
                <div style={{ fontSize: ".78rem", color: "#5c6470", marginBottom: "1.25rem",
                  lineHeight: 1.5 }}>
                  You have local changes that haven't been committed to GitHub. They're saved in
                  your browser but will be lost if you clear your data.
                </div>
                <div style={{ display: "flex", gap: ".5rem", flexWrap: "wrap" }}>
                  <button onClick={() => { setShowCloseWarn(false); setShowCommitForm(true); }}
                    style={{ background: "#f0f4f8", border: "1px solid #2e5070", color: "#0b3d6b",
                      borderRadius: 4, padding: ".4rem .9rem", fontSize: ".78rem", cursor: "pointer" }}>
                    Commit now
                  </button>
                  <button onClick={() => { setShowCloseWarn(false); handleClose(); }}
                    style={{ background: "none", border: "1px solid #2e3a4a", color: "#6b7a8a",
                      borderRadius: 4, padding: ".4rem .9rem", fontSize: ".78rem", cursor: "pointer" }}>
                    Leave anyway
                  </button>
                  <button onClick={() => setShowCloseWarn(false)}
                    style={{ background: "none", border: "none", color: "#9ba1ac",
                      fontSize: ".78rem", cursor: "pointer", padding: ".4rem .5rem" }}>
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Save-to-GitHub banner (local session only) */}
          {currentFile === "__local__" && (
            <div style={{ margin: ".75rem 0 1rem", padding: ".75rem 1rem",
              background: "#fffbeb", border: "1px solid #e8a83844", borderRadius: 6,
              display: "flex", alignItems: "center", gap: ".75rem", flexWrap: "wrap" }}>
              <span style={{ fontSize: ".78rem", color: "#d97706", fontFamily: "inherit",
                flexShrink: 0 }}>
                Not saved to GitHub yet.
              </span>
              <input
                value={saveAsName || title}
                onChange={e => setSaveAsName(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleSaveAs()}
                placeholder="Itinerary name…"
                style={{ flex: 1, minWidth: 160, background: "#ffffff", border: "1px solid #e2e5ea",
                  color: "#0e1014", borderRadius: 4, padding: ".35rem .65rem",
                  fontSize: ".82rem", fontFamily: "inherit", outline: "none" }}
              />
              <button onClick={handleSaveAs}
                disabled={!ghSettings.githubToken || !effectiveRepo}
                title={(!ghSettings.githubToken || !effectiveRepo) ? "Configure GitHub in Settings ⚙ first" : ""}
                style={{ background: "#f0f4f8", border: "1px solid #2e5070", color: "#0b3d6b",
                  borderRadius: 4, padding: ".35rem .85rem", fontSize: ".75rem",
                  fontFamily: "inherit", cursor: "pointer", whiteSpace: "nowrap",
                  opacity: (!ghSettings.githubToken || !effectiveRepo) ? 0.45 : 1 }}>
                Save to GitHub
              </button>
            </div>
          )}

          {editingHeader ? (
            <div style={{ marginBottom: "1.5rem" }}>
              <input autoFocus value={headerDraft.title}
                onChange={e => setHeaderDraft(p => ({ ...p, title: e.target.value }))}
                onKeyDown={e => {
                  if (e.key === "Escape") setEditingHeader(false);
                  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                    setTitle(headerDraft.title.trim() || title);
                    setSubtitle(headerDraft.subtitle);
                    setEditingHeader(false);
                  }
                }}
                style={{ width:"100%", background:"#f0f4f8", border:"1px solid #2e5070", color:"#0e1014",
                  borderRadius:4, padding:".45rem .75rem", fontSize:"clamp(1.2rem,3vw,1.8rem)",
                  fontFamily:"inherit", fontWeight:400, letterSpacing:"-.02em",
                  outline:"none", boxSizing:"border-box", marginBottom:".5rem" }} />
              <input value={headerDraft.subtitle}
                onChange={e => setHeaderDraft(p => ({ ...p, subtitle: e.target.value }))}
                onKeyDown={e => {
                  if (e.key === "Escape") setEditingHeader(false);
                  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                    setTitle(headerDraft.title.trim() || title);
                    setSubtitle(headerDraft.subtitle);
                    setEditingHeader(false);
                  }
                }}
                placeholder="Subtitle / tagline (optional)"
                style={{ width:"100%", background:"#f0f4f8", border:"1px solid #2e5070", color:"#9ba1ac",
                  borderRadius:4, padding:".4rem .75rem", fontSize:".9rem",
                  fontFamily:"inherit", fontStyle:"italic",
                  outline:"none", boxSizing:"border-box", marginBottom:".6rem" }} />
              <div style={{ display:"flex", gap:".5rem" }}>
                <button onClick={() => { setTitle(headerDraft.title.trim() || title); setSubtitle(headerDraft.subtitle); setEditingHeader(false); }}
                  style={{ background:"#f0f4f8", border:"1px solid #2e5070", color:"#0b3d6b",
                    borderRadius:4, padding:".3rem .75rem", fontSize:".75rem", fontFamily:"inherit", cursor:"pointer" }}>
                  Save
                </button>
                <button onClick={() => setEditingHeader(false)}
                  style={{ background:"none", border:"1px solid #2e3a4a", color:"#6b7a8a",
                    borderRadius:4, padding:".3rem .75rem", fontSize:".75rem", fontFamily:"inherit", cursor:"pointer" }}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <>
              <div style={{ display:"flex", alignItems:"flex-start", gap:".5rem", marginBottom:".4rem" }}>
                <h1 style={{ fontSize:"clamp(1.6rem,4vw,2.4rem)", fontWeight:400, color:"#0e1014",
                  margin:0, letterSpacing:"-.02em", lineHeight:1.15, flex:1 }}>
                  {title}
                </h1>
                {!readOnly && (
                  <button onClick={() => { setEditingHeader(true); setHeaderDraft({ title, subtitle }); }}
                    style={{ background:"none", border:"none", color:"#6b7a8a", cursor:"pointer",
                      fontSize:".7rem", fontFamily:"inherit", padding:0, flexShrink:0, marginTop:".35rem" }}>
                    Edit
                  </button>
                )}
              </div>
              {subtitle && (
                <p style={{ color:"#9ba1ac", margin:"0 0 1.5rem", fontSize:".95rem", fontStyle:"italic" }}>
                  {subtitle}
                </p>
              )}
            </>
          )}

          {/* Overview map */}
          <ItineraryMap days={days} savedFlights={savedFlights} savedDirections={savedDirections} savedPlaces={savedPlaces} savedRoutes={savedRoutes} />

          {/* Stats */}
          <div style={{ display: "flex", gap: "2rem", flexWrap: "wrap", marginBottom: "1.25rem" }}>
            {[
              totalNM > 0          && { label: "Boating",  val: `${Math.round(totalNM)} NM` },
              totalFlightMiles > 0 && { label: "Flying",   val: `${totalFlightMiles.toLocaleString()} mi` },
              totalDrivingMiles > 0 && { label: "Driving",  val: `${totalDrivingMiles.toLocaleString()} mi` },
              { label: "Travel Days",    val: String(travelDays) },
              { label: "Fuel Stops",     val: String(days.filter(d => d.fuelStop).length) },
            ].filter(Boolean).map(s => (
              <div key={s.label}>
                <div style={{ fontSize: "1.3rem", color: "#0b3d6b" }}>{s.val}</div>
                <div style={{ fontSize: ".7rem", color: "#5c6470", letterSpacing: ".1em", textTransform: "uppercase" }}>{s.label}</div>
              </div>
            ))}
          </div>

          {/* Departure date */}
          <div style={{ display:"flex", alignItems:"center", gap:".65rem", marginBottom:"1.25rem", fontFamily:"inherit" }}>
            <span style={{ fontSize:".7rem", color:"#5c6470", letterSpacing:".1em", textTransform:"uppercase" }}>Departure</span>
            <input
              type="date"
              value={startDate}
              onChange={e => setStartDate(e.target.value)}
              style={{ background:"#f0f4f8", border:"1px solid #2e5070", color:"#0b3d6b",
                padding:"3px 8px", borderRadius:4, fontSize:".78rem", fontFamily:"inherit", cursor:"pointer" }}
            />
            {startDate && (
              <>
                <button onClick={() => setStartDate("")}
                  style={{ background:"none", border:"none", color:"#6b7a8a", cursor:"pointer",
                    fontSize:".7rem", fontFamily:"inherit", padding:0 }}>
                  clear
                </button>
                {days.length > 0 && (
                  <>
                    <button onClick={generateICS}
                      style={{ background:"none", border:"1px solid #2e5070", color:"#5c6470",
                        cursor:"pointer", fontSize:".7rem", fontFamily:"inherit",
                        padding:"2px 8px", borderRadius:4 }}>
                      Export .ics
                    </button>
                    {effectiveRepo && currentFile && currentFile !== "__local__" && (
                      <button onClick={() => {
                          const icsFile = currentFile.replace(/\.json$/i, ".ics");
                          const url = `https://raw.githubusercontent.com/${effectiveRepo}/${effectiveBranch}/${icsFile}`;
                          navigator.clipboard.writeText(url);
                          setCopiedICS(true);
                          setTimeout(() => setCopiedICS(false), 2000);
                        }}
                        title="Copy subscription URL — paste into Apple Calendar or Google Calendar"
                        style={{ background:"none", border:"1px solid #2e5070", color: copiedICS ? "#16a34a" : "#5c6470",
                          cursor:"pointer", fontSize:".7rem", fontFamily:"inherit",
                          padding:"2px 8px", borderRadius:4 }}>
                        {copiedICS ? "Copied!" : "Subscribe URL"}
                      </button>
                    )}
                  </>
                )}
              </>
            )}
          </div>

          {/* Itinerary notes */}
          <div style={{ marginBottom:"1.25rem" }}>
            {editingNotes ? (
              <div>
                <textarea
                  autoFocus
                  value={itineraryNotes}
                  onChange={e => setItineraryNotes(e.target.value)}
                  onKeyDown={e => { if (e.key === "Escape") setEditingNotes(false); }}
                  placeholder="Notes about this trip — crew, budget, packing list, pre-departure checklist…"
                  rows={4}
                  style={{ width:"100%", background:"#f0f4f8", border:"1px solid #2e5070", color:"#0e1014",
                    borderRadius:4, padding:".5rem .75rem", fontSize:".82rem", fontFamily:"inherit",
                    lineHeight:1.6, resize:"vertical", boxSizing:"border-box", outline:"none",
                    marginBottom:".5rem" }}
                />
                <button onClick={() => setEditingNotes(false)}
                  style={{ background:"#f0f4f8", border:"1px solid #2e5070", color:"#0b3d6b",
                    borderRadius:4, padding:".3rem .75rem", fontSize:".75rem", fontFamily:"inherit",
                    cursor:"pointer" }}>
                  Done
                </button>
              </div>
            ) : itineraryNotes ? (
              <div style={{ display:"flex", gap:".75rem", alignItems:"flex-start" }}>
                <div style={{ flex:1 }}>
                  <NoteMarkdown>{itineraryNotes}</NoteMarkdown>
                </div>
                {!readOnly && (
                  <button onClick={() => setEditingNotes(true)}
                    style={{ background:"none", border:"none", color:"#6b7a8a", cursor:"pointer",
                      fontSize:".7rem", fontFamily:"inherit", padding:0, flexShrink:0 }}>
                    Edit
                  </button>
                )}
              </div>
            ) : !readOnly ? (
              <button onClick={() => setEditingNotes(true)}
                style={{ background:"none", border:"none", color:"#9ba1ac", cursor:"pointer",
                  fontSize:".75rem", fontFamily:"inherit", fontStyle:"italic", padding:0 }}>
                + Add itinerary notes
              </button>
            ) : null}
          </div>

          {/* TODOs */}
          {todos.length > 0 && (
            <div style={{ marginBottom:"1.25rem", padding:".65rem .85rem",
              background:"#fffbeb", border:"1px solid #e8a83844", borderRadius:5 }}>
              <div style={{ fontSize:".62rem", color:"#d97706", letterSpacing:".12em",
                textTransform:"uppercase", fontFamily:"inherit", marginBottom:".5rem" }}>
                {todos.length} TODO{todos.length !== 1 ? "s" : ""}
              </div>
              <ul style={{ margin:0, paddingLeft:"1.1rem" }}>
                {todos.map((t, i) => (
                  <li key={i}
                    onClick={t.day != null ? () => { setOpenDay(t.day); setActiveTab("itinerary"); } : undefined}
                    style={{ fontSize:".78rem", color:"#0e1014", fontFamily:"inherit",
                      lineHeight:1.5, cursor: t.day != null ? "pointer" : "default",
                      marginBottom: i < todos.length - 1 ? ".15rem" : 0 }}>
                    {t.day != null && (
                      <span style={{ fontSize:".65rem", color:"#d97706", marginRight:".4rem", opacity:.8 }}>
                        Day {t.day}
                      </span>
                    )}
                    <NoteMarkdown>{t.text}</NoteMarkdown>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Day-strip */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center" }}>
            {days.map(d => {
              const lay  = effNm(d) === 0;
              const fuel = d.fuelStop;
              const tide = d.tideWarning;
              const bg   = tide ? "#fee2e2" : fuel ? "#fff7ed" : lay ? "#dcfce7" : "#e2e5ea";
              const col  = tide ? "#dc2626" : fuel ? "#d97706" : lay ? "#16a34a" : "#5c6470";
              const info = getDayDate(d.day);
              return (
                <div key={d.day}
                  onClick={() => { setOpenDay(d.day); setActiveTab("itinerary"); }}
                  title={info ? `${d.leg} · ${info.dow}, ${info.date}` : d.leg}
                  style={{ width:32, minHeight:32, borderRadius:4, background:bg,
                    display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center",
                    fontSize:".6rem", color:col, cursor:"pointer", fontFamily:"inherit",
                    padding: info ? "4px 0" : 0, gap:1,
                    border: openDay === d.day ? "2px solid #0b3d6b" : "1px solid transparent" }}>
                  <span>D{d.day}</span>
                  {info && <span style={{ fontSize:".5rem", opacity:.9, lineHeight:1 }}>{info.dow}</span>}
                  {info && <span style={{ fontSize:".5rem", opacity:.7, lineHeight:1 }}>{info.date}</span>}
                </div>
              );
            })}
            <div style={{ display:"flex", gap:10, marginLeft:8, flexWrap:"wrap", alignItems:"center" }}>
              {[["#e2e5ea","#5c6470","Underway"],["#dcfce7","#16a34a","Layover"],["#fff7ed","#d97706","⛽ Fuel"],["#fee2e2","#dc2626","⚠ Tides"]].map(([bg,col,lbl])=>(
                <div key={lbl} style={{ display:"flex", alignItems:"center", gap:4 }}>
                  <div style={{ width:10, height:10, borderRadius:2, background:bg, border:`1px solid ${col}` }}/>
                  <span style={{ fontSize:".62rem", color:col, fontFamily:"inherit" }}>{lbl}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── CONFLICT BANNER ── */}
      {syncStatus === "conflict" && (
        <div style={{ background:"#fef2f2", borderBottom:"1px solid #dc354566", padding:".6rem 1rem",
          display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <span style={{ fontSize:".78rem", color:"#dc2626", fontFamily:"inherit" }}>
            ⚠ Conflict — GitHub has a newer version.
          </span>
          <button onClick={reloadFromGitHub}
            style={{ background:"none", border:"1px solid #dc354566", color:"#dc2626",
              borderRadius:4, padding:".25rem .65rem", fontSize:".72rem",
              fontFamily:"inherit", cursor:"pointer" }}>
            Reload from GitHub
          </button>
        </div>
      )}

      {/* ── TABS ── */}
      <div style={{ borderBottom:"1px solid #e2e5ea", background:"#ffffff" }}>
        <div style={{ maxWidth:820, margin:"0 auto", display:"flex" }}>
          {[["itinerary","Day by Day"],["fuel","Fuel Plan"],["tides","Tide Warnings"]].map(([t,lbl])=>(
            <button key={t} onClick={()=>setActiveTab(t)} style={{
              background:"none", border:"none",
              borderBottom: activeTab===t ? "2px solid #0b3d6b" : "2px solid transparent",
              color: activeTab===t ? "#0b3d6b" : "#5c6470",
              padding:".85rem 1.5rem", fontSize:".78rem", letterSpacing:".12em",
              textTransform:"uppercase", cursor:"pointer", fontFamily:"inherit" }}>
              {lbl}
            </button>
          ))}
        </div>
      </div>

      <div style={{ maxWidth:820, margin:"0 auto", padding:"1.5rem 1rem 3rem" }}>

        {/* ── ITINERARY TAB ── */}
        {activeTab === "itinerary" && days.length === 0 && (
          <div style={{ padding: "2rem 1rem", fontFamily: "inherit" }}>
            {settings.anthropicKey ? (
              <ClaudePrompt
                mode="full"
                onApplyFull={applyClaudeFullItinerary}
                apiKey={settings.anthropicKey}
                model={settings.claudeModel ?? "claude-sonnet-4-6"}
              />
            ) : (
              <div style={{ textAlign: "center", color: "#6b7a8a", marginBottom: "1.25rem",
                fontSize: ".9rem" }}>
                No itinerary yet.
              </div>
            )}
            <div style={{ textAlign: "center", marginTop: "1.25rem" }}>
              <button onClick={() => { setDays(initialDays); setOpenDay(1); }}
                style={{ background: "#f0f4f8", border: "1px solid #2e5070", color: "#0b3d6b",
                  borderRadius: 6, padding: ".55rem 1.5rem", fontSize: ".82rem",
                  fontFamily: "inherit", cursor: "pointer" }}>
                Load sample itinerary
              </button>
            </div>
          </div>
        )}
        {activeTab === "itinerary" && (<>
        {days.map(d => {
          const isOpen    = openDay === d.day;
          const isLayover = effNm(d) === 0;
          const dayInfo   = getDayDate(d.day);
          return (
            <div key={d.day} style={{
              marginBottom:".5rem",
              border: isOpen ? "1px solid #0b3d6b33" : "1px solid #e2e5ea",
              borderRadius:8, background: isOpen ? "#f8f9fb" : "#ffffff", overflow:"hidden" }}>

              {/* Row */}
              <button onClick={()=>setOpenDay(isOpen ? null : d.day)} style={{
                width:"100%", background:"none", border:"none", padding:"1rem 1.25rem",
                cursor:"pointer", display:"flex", alignItems:"center", gap:"1rem", textAlign:"left" }}>
                <div style={{
                  minWidth:38, height: dayInfo ? 56 : 38,
                  borderRadius: dayInfo ? 7 : "50%",
                  background: isOpen ? "#0b3d6b" : "#f0f4f8",
                  color: isOpen ? "#ffffff" : "#0b3d6b",
                  display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center",
                  fontSize:".75rem", fontWeight:700, flexShrink:0, gap:1 }}>
                  <span>{d.day}</span>
                  {dayInfo && <span style={{ fontSize:".6rem", fontWeight:600, opacity: isOpen ? .85 : .75, lineHeight:1 }}>{dayInfo.dow}</span>}
                  {dayInfo && <span style={{ fontSize:".58rem", fontWeight:400, opacity: isOpen ? .65 : .55, lineHeight:1 }}>{dayInfo.date}</span>}
                </div>
                <div style={{ flex:1 }}>
                  <div style={{ color: isOpen ? "#0e1014" : "#0e1014", fontSize:".95rem", lineHeight:1.3 }}>
                    {d.leg}
                    {d.fuelStop    && <span style={{ marginLeft:8,  background:"#fff7ed", color:"#d97706", fontSize:".63rem", padding:"2px 7px", borderRadius:10, fontFamily:"inherit", verticalAlign:"middle" }}>⛽ {d.fuelLabel}</span>}
                    {d.tideWarning && <span style={{ marginLeft:6,  background:"#fee2e2", color:"#dc2626", fontSize:".63rem", padding:"2px 7px", borderRadius:10, fontFamily:"inherit", verticalAlign:"middle" }}>⚠ Tide Critical</span>}
                    {d.tags.includes("combined-leg") && <span style={{ marginLeft:6, background:"#e8f1f9", color:"#0b3d6b", fontSize:".63rem", padding:"2px 7px", borderRadius:10, fontFamily:"inherit", verticalAlign:"middle" }}>Combined</span>}
                  </div>
                  <div style={{ color:"#6b7a8a", fontSize:".75rem", marginTop:2, fontFamily:"inherit" }}>
                    {(() => {
                      const parts = [];
                      if (!isLayover) { const nm=effNm(d), hrs=effHrs(d); parts.push(`${nm} NM · ~${(() => { const h=Math.floor(hrs), m=Math.round((hrs-h)*60); return h===0?`${m}m`:m===0?`${h}h`:`${h}h ${m}m`; })()} `); }
                      let dKm = 0;
                      (savedDirections[d.day] ?? []).forEach(dir => {
                        const km = dir.distance?.match(/^([\d.]+)\s*km/i);
                        const mi = dir.distance?.match(/^([\d.]+)\s*mi/i);
                        const mo = dir.distance?.match(/^(\d+)\s*m\b/i);
                        if (km) dKm += parseFloat(km[1]);
                        else if (mi) dKm += parseFloat(mi[1]) * 1.60934;
                        else if (mo) dKm += parseFloat(mo[1]) / 1000;
                      });
                      if (dKm > 0) {
                        const useMi = settings.distanceUnit === "mi";
                        const val = useMi ? Math.round(dKm * 0.621371) : Math.round(dKm);
                        parts.push(`${val} ${useMi ? "mi" : "km"} driving`);
                      }
                      return parts.join(" · ") || "Layover";
                    })()}
                    {" · "}
                    <span style={{ fontStyle:"italic", color:"#5c6470" }}>{d.overnight}</span>
                  </div>
                  {(() => {
                    const cities = getDayCities(d.day);
                    if (!cities.length) return null;
                    return (
                      <div style={{ fontSize:".7rem", color:"#5c6470", fontFamily:"inherit",
                        marginTop:2, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                        {cities.join(" · ")}
                      </div>
                    );
                  })()}
                </div>
                <div style={{ color:"#6b7a8a", transform: isOpen ? "rotate(180deg)" : "none" }}>▾</div>
              </button>

              {/* Expanded */}
              {isOpen && (
                <div style={{ padding:"0 1.25rem 1.25rem", borderTop:"1px solid #1e3a5240" }}>
                  {/* Tags */}
                  <div style={{ display:"flex", flexWrap:"wrap", gap:6, margin:".85rem 0 1rem" }}>
                    {d.tags.filter(t=>tagConfig[t]).map(t => {
                      const c = tagConfig[t];
                      return <span key={t} style={{ fontSize:".63rem", padding:"3px 9px", borderRadius:12,
                        background:c.color+"22", color:c.color, border:`1px solid ${c.color}44`,
                        letterSpacing:".07em", fontFamily:"inherit", textTransform:"uppercase" }}>{c.label}</span>;
                    })}
                  </div>
                  {/* Core fields edit */}
                  {editingCoreDay === d.day ? (
                    <div style={{ marginBottom:"1rem", padding:".75rem 1rem", background:"#f0f4f8",
                      borderLeft:"3px solid #6b8fa866", borderRadius:"0 4px 4px 0" }}>
                      <div style={{ fontSize:".62rem", color:"#5c6470", letterSpacing:".1em",
                        textTransform:"uppercase", fontFamily:"inherit", marginBottom:".65rem" }}>
                        Edit Day
                      </div>
                      <input autoFocus value={coreDraft.leg}
                        onChange={e => setCoreDraft(p => ({ ...p, leg: e.target.value }))}
                        onKeyDown={e => { if (e.key === "Escape") setEditingCoreDay(null); if ((e.metaKey||e.ctrlKey) && e.key === "Enter") saveCore(d.day); }}
                        style={{ width:"100%", background:"#ffffff", border:"1px solid #e2e5ea", color:"#0e1014",
                          borderRadius:4, padding:".4rem .65rem", fontSize:".85rem", fontFamily:"inherit",
                          outline:"none", boxSizing:"border-box", marginBottom:".65rem" }} />
                      <div style={{ display:"flex", gap:".5rem", marginTop:".65rem" }}>
                        <button onClick={() => saveCore(d.day)}
                          style={{ background:"#f0f4f8", border:"1px solid #2e5070", color:"#0b3d6b",
                            borderRadius:4, padding:".3rem .75rem", fontSize:".75rem", fontFamily:"inherit", cursor:"pointer" }}>
                          Save
                        </button>
                        <button onClick={() => setEditingCoreDay(null)}
                          style={{ background:"none", border:"1px solid #2e3a4a", color:"#6b7a8a",
                            borderRadius:4, padding:".3rem .75rem", fontSize:".75rem", fontFamily:"inherit", cursor:"pointer" }}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : !readOnly ? (
                    <div style={{ display:"flex", justifyContent:"flex-end", marginBottom:".75rem", marginTop:"-.25rem" }}>
                      <button onClick={() => startEditCore(d.day, d)}
                        style={{ background:"none", border:"none", color:"#6b7a8a", cursor:"pointer",
                          fontSize:".7rem", fontFamily:"inherit", padding:0 }}>
                        Edit day title
                      </button>
                    </div>
                  ) : null}

                  {/* Highlights */}
                  <ul style={{ margin:0, padding:0, listStyle:"none" }}>
                    {d.highlights.map((h,i) => (
                      <li key={i} style={{ display:"flex", gap:".75rem", marginBottom:".55rem",
                        fontSize:".875rem", lineHeight:1.5, color:"#b8cfe0", fontFamily:"inherit" }}>
                        <span style={{ color:"#0b3d6b", flexShrink:0, marginTop:2 }}>◆</span>
                        <span>{h}</span>
                      </li>
                    ))}
                    {(customHighlights[d.day] ?? []).map((h,i) => (
                      <li key={`c${i}`} style={{ display:"flex", gap:".75rem", marginBottom:".55rem",
                        fontSize:".875rem", lineHeight:1.5, color:"#c8e0c8", fontFamily:"inherit" }}>
                        <span style={{ color:"#16a34a", flexShrink:0, marginTop:2 }}>◆</span>
                        <span style={{ flex:1 }}>{h}</span>
                        {!readOnly && (
                          <button onClick={() => removeHighlight(d.day, i)}
                            style={{ background:"none", border:"none", color:"#3d6050", cursor:"pointer",
                              fontSize:".85rem", lineHeight:1, padding:"0 0 0 .25rem", flexShrink:0, marginTop:2 }}>
                            ×
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                  {/* Add highlight */}
                  {!readOnly && (
                    <div style={{ display:"flex", gap:".5rem", marginTop:".75rem", marginBottom:".25rem" }}>
                      <input
                        ref={inputRef}
                        value={newHighlight}
                        onChange={e => setNewHighlight(e.target.value)}
                        onKeyDown={e => e.key === "Enter" && addHighlight(d.day)}
                        placeholder="Add a highlight…"
                        style={{ flex:1, background:"#f0f4f8", border:"1px solid #2e5070", color:"#0e1014",
                          borderRadius:4, padding:".4rem .65rem", fontSize:".82rem", fontFamily:"inherit",
                          outline:"none" }}
                      />
                      <button onClick={() => addHighlight(d.day)}
                        style={{ background:"#f0f4f8", border:"1px solid #2e5070", color:"#0b3d6b",
                          borderRadius:4, padding:".4rem .85rem", fontSize:".78rem", fontFamily:"inherit",
                          cursor:"pointer", whiteSpace:"nowrap" }}>
                        Add
                      </button>
                    </div>
                  )}
                  {/* Captain's note */}
                  {(() => {
                    const note = customNotes[d.day] !== undefined ? customNotes[d.day] : d.note;
                    const isEditing = editingNoteDay === d.day;
                    return (
                      <div style={{ marginTop:"1rem", padding:".75rem 1rem", background:"#f0f4f8",
                        borderLeft:"3px solid rgba(11,61,107,0.2)", borderRadius:"0 4px 4px 0" }}>
                        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:4 }}>
                          <div style={{ fontSize:".62rem", color:"#0b3d6b", letterSpacing:".1em", textTransform:"uppercase", fontFamily:"inherit" }}>Notes</div>
                          {!isEditing && !readOnly && (
                            <button onClick={() => startEditNote(d.day, note)}
                              style={{ background:"none", border:"none", color:"#6b7a8a", cursor:"pointer",
                                fontSize:".7rem", fontFamily:"inherit", padding:0 }}>
                              Edit
                            </button>
                          )}
                        </div>
                        {isEditing && !readOnly ? (
                          <>
                            <textarea
                              autoFocus
                              value={noteDraft}
                              onChange={e => setNoteDraft(e.target.value)}
                              onKeyDown={e => {
                                if (e.key === "Escape") cancelEditNote();
                                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") saveNote(d.day);
                              }}
                              style={{ width:"100%", background:"#ffffff", border:"1px solid #e2e5ea",
                                color:"#0e1014", borderRadius:4, padding:".4rem .65rem",
                                fontSize:".82rem", fontFamily:"inherit", lineHeight:1.55,
                                resize:"vertical", minHeight:80, boxSizing:"border-box", outline:"none" }}
                            />
                            <div style={{ display:"flex", gap:".5rem", marginTop:".5rem" }}>
                              <button onClick={() => saveNote(d.day)}
                                style={{ background:"#f0f4f8", border:"1px solid #2e5070", color:"#0b3d6b",
                                  borderRadius:4, padding:".3rem .75rem", fontSize:".75rem",
                                  fontFamily:"inherit", cursor:"pointer" }}>
                                Save
                              </button>
                              <button onClick={cancelEditNote}
                                style={{ background:"none", border:"1px solid #2e3a4a", color:"#6b7a8a",
                                  borderRadius:4, padding:".3rem .75rem", fontSize:".75rem",
                                  fontFamily:"inherit", cursor:"pointer" }}>
                                Cancel
                              </button>
                            </div>
                          </>
                        ) : (
                          <div><NoteMarkdown>{note}</NoteMarkdown></div>
                        )}
                      </div>
                    );
                  })()}
                  {/* Places */}
                  <DayPlaces
                    dayNum={d.day}
                    places={savedPlaces[d.day] ?? []}
                    onAdd={place => addPlace(d.day, place)}
                    onUpdate={(id, updates) => updatePlace(d.day, id, updates)}
                    onDelete={id => deletePlace(d.day, id)}
                    readOnly={readOnly}
                  />

                  {/* Directions */}
                  <DayDirections
                    dayNum={d.day}
                    directions={savedDirections[d.day] ?? []}
                    onAdd={dir => addDirection(d.day, dir)}
                    onUpdate={(id, updates) => updateDirection(d.day, id, updates)}
                    onDelete={id => deleteDirection(d.day, id)}
                    readOnly={readOnly}
                    distanceUnit={settings.distanceUnit ?? "km"}
                  />

                  {/* Boating Routes */}
                  <DayRoute
                    routes={savedRoutes[d.day] ?? []}
                    onAdd={route => addRoute(d.day, route)}
                    onUpdate={(id, updates) => updateRoute(d.day, id, updates)}
                    onDelete={id => deleteRoute(d.day, id)}
                    readOnly={readOnly}
                    routeServerUrl={settings.routeServerUrl ?? "https://waypoint.troyhakala.com"}
                  />

                  {/* Flights */}
                  <DayFlights
                    flights={savedFlights[d.day] ?? []}
                    onAdd={flight => addFlight(d.day, flight)}
                    onUpdate={(id, updates) => updateFlight(d.day, id, updates)}
                    onDelete={id => deleteFlight(d.day, id)}
                    readOnly={readOnly}
                    startDate={startDate}
                    dayNum={d.day}
                    aeroDataBoxKey={settings.aeroDataBoxKey ?? ""}
                  />

                  {/* Rental Cars */}
                  <DayRentalCar
                    rentalCars={savedRentalCars[d.day] ?? []}
                    onAdd={car => addRentalCar(d.day, car)}
                    onUpdate={(id, updates) => updateRentalCar(d.day, id, updates)}
                    onDelete={id => deleteRentalCar(d.day, id)}
                    readOnly={readOnly}
                  />

                  {/* Claude suggestions */}
                  {settings.anthropicKey && !readOnly && (
                    <ClaudePrompt
                      mode="day"
                      dayNum={d.day}
                      dayContext={{ leg: d.leg, overnight: d.overnight }}
                      itineraryContext={{ title, startDate, days }}
                      onApplyDay={applyClaudeDaySuggestions}
                      apiKey={settings.anthropicKey}
                      model={settings.claudeModel ?? "claude-sonnet-4-6"}
                    />
                  )}

                  {/* Tide warning */}
                  {d.tideWarning && d.tideNote && (
                    <div style={{ marginTop:".75rem", padding:".75rem 1rem", background:"#fef2f2",
                      borderLeft:"3px solid #dc3545", borderRadius:"0 4px 4px 0" }}>
                      <div style={{ fontSize:".62rem", color:"#dc2626", letterSpacing:".1em", textTransform:"uppercase", marginBottom:4, fontFamily:"inherit" }}>⚠ Tide Warning</div>
                      <div style={{ fontSize:".82rem", color:"#ef4444", fontFamily:"inherit", lineHeight:1.55 }}>{d.tideNote}</div>
                    </div>
                  )}

                  {/* Day actions */}
                  {!readOnly && (
                    <div style={{ marginTop:"1.25rem", paddingTop:".85rem", borderTop:"1px solid #1e3a5240",
                      display:"flex", alignItems:"center", gap:".5rem", flexWrap:"wrap" }}>
                      {days.length > 1 && (() => {
                        const idx = days.findIndex(x => x.day === d.day);
                        return (
                          <>
                            <button onClick={() => moveDay(idx, "up")} disabled={idx === 0}
                              style={{ background:"#ffffff", border:"1px solid #e2e5ea", color:"#5c6470",
                                borderRadius:4, padding:".3rem .55rem", fontSize:".82rem", fontFamily:"inherit",
                                cursor: idx === 0 ? "not-allowed" : "pointer", opacity: idx === 0 ? 0.35 : 1 }}>
                              ↑
                            </button>
                            <button onClick={() => moveDay(idx, "down")} disabled={idx === days.length - 1}
                              style={{ background:"#ffffff", border:"1px solid #e2e5ea", color:"#5c6470",
                                borderRadius:4, padding:".3rem .55rem", fontSize:".82rem", fontFamily:"inherit",
                                cursor: idx === days.length - 1 ? "not-allowed" : "pointer", opacity: idx === days.length - 1 ? 0.35 : 1 }}>
                              ↓
                            </button>
                          </>
                        );
                      })()}
                      <button onClick={() => duplicateDay(d.day)}
                        style={{ background:"#ffffff", border:"1px solid #e2e5ea", color:"#5c6470",
                          borderRadius:4, padding:".3rem .75rem", fontSize:".72rem", fontFamily:"inherit", cursor:"pointer" }}>
                        Duplicate day
                      </button>
                      <button onClick={() => addBlankDay(d.day)}
                        style={{ background:"#ffffff", border:"1px solid #e2e5ea", color:"#5c6470",
                          borderRadius:4, padding:".3rem .75rem", fontSize:".72rem", fontFamily:"inherit", cursor:"pointer" }}>
                        Insert day after
                      </button>
                      <div style={{ marginLeft:"auto", display:"flex", alignItems:"center", gap:".5rem" }}>
                        {confirmDeleteDay === d.day ? (
                          <>
                            <span style={{ fontSize:".72rem", color:"#dc2626", fontFamily:"inherit" }}>Delete Day {d.day}?</span>
                            <button onClick={() => removeDay(d.day)}
                              style={{ background:"#fef2f2", border:"1px solid #dc354566", color:"#dc2626",
                                borderRadius:4, padding:".3rem .65rem", fontSize:".72rem", fontFamily:"inherit", cursor:"pointer" }}>
                              Yes, delete
                            </button>
                            <button onClick={() => setConfirmDeleteDay(null)}
                              style={{ background:"none", border:"1px solid #2e3a4a", color:"#6b7a8a",
                                borderRadius:4, padding:".3rem .65rem", fontSize:".72rem", fontFamily:"inherit", cursor:"pointer" }}>
                              Cancel
                            </button>
                          </>
                        ) : (
                          <button onClick={() => setConfirmDeleteDay(d.day)} disabled={days.length <= 1}
                            style={{ background:"none", border:"1px solid #3a1a1a",
                              color: days.length <= 1 ? "#3d2020" : "#7a3838",
                              borderRadius:4, padding:".3rem .65rem", fontSize:".72rem", fontFamily:"inherit",
                              cursor: days.length <= 1 ? "not-allowed" : "pointer" }}>
                            Delete day
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {!readOnly && (
          <div style={{ display:"flex", justifyContent:"center", marginTop:"1rem" }}>
            <button onClick={() => addBlankDay(days.length > 0 ? days[days.length - 1].day : 0)}
              style={{ background:"none", border:"1px dashed #2e5070", color:"#6b7a8a",
                borderRadius:6, padding:".55rem 1.5rem", fontSize:".78rem",
                fontFamily:"inherit", cursor:"pointer", letterSpacing:".05em" }}>
              + Add day at end
            </button>
          </div>
        )}
        </>)}

        {/* ── FUEL TAB ── */}
        {activeTab === "fuel" && (
          <div>
            <div style={{ marginBottom:"1.5rem", padding:"1.25rem", background:"#f8f9fb", border:"1px solid #1e3a52", borderRadius:6 }}>
              <div style={{ fontSize:".7rem", color:"#0b3d6b", letterSpacing:".15em", textTransform:"uppercase", marginBottom:"1rem", fontFamily:"inherit" }}>Fuel Plan Summary</div>
              {fuelSummary.map(f => (
                <div key={f.label} style={{ display:"flex", justifyContent:"space-between", padding:".6rem 0", borderBottom:"1px solid #1e3a5240", fontFamily:"inherit" }}>
                  <span style={{ fontSize:".85rem", color:"#5c6470" }}>{f.label}</span>
                  <span style={{ fontSize:".85rem", color:"#0e1014" }}>{f.value}</span>
                </div>
              ))}
            </div>
            <div style={{ padding:"1.25rem", background:"#f8f9fb", border:"1px solid #e8553844", borderRadius:6, marginBottom:"1rem" }}>
              <div style={{ fontSize:".7rem", color:"#d97706", letterSpacing:".15em", textTransform:"uppercase", marginBottom:".75rem", fontFamily:"inherit" }}>⛽ Fuel Stop Details</div>
              {fuelStops.map(s => (
                <div key={s.stop} style={{ marginBottom:"1.25rem", paddingBottom:"1.25rem", borderBottom:"1px solid #1e3a5230" }}>
                  <div style={{ fontSize:".9rem", color:"#0e1014", fontFamily:"inherit", marginBottom:4 }}>{s.stop}</div>
                  <div style={{ fontSize:".8rem", color:"#9ba1ac", fontFamily:"inherit", marginBottom:3 }}>{s.marina}</div>
                  <div style={{ fontSize:".75rem", color:"#5c6470", fontFamily:"inherit", marginBottom:6 }}>VHF: {s.vhf}</div>
                  <div style={{ fontSize:".8rem", color:"#7a9ab8", fontFamily:"inherit", fontStyle:"italic" }}>{s.notes}</div>
                </div>
              ))}
            </div>
            <div style={{ padding:".85rem 1rem", background:"#f0f4f8", border:"1px solid #c9a84c33", borderRadius:6, fontSize:".8rem", color:"#5c6470", fontFamily:"inherit", lineHeight:1.6 }}>
              <strong style={{ color:"#0b3d6b" }}>Note:</strong> All calculations assume 15 kts / 33 gal·hr. Running at 20 kts increases consumption ~50–70%. Maintain a 15–20% reserve minimum. Fuel Stop #4 at Victoria on Day 17 is easy insurance — you're stopping there for lunch anyway.
            </div>
          </div>
        )}

        {/* ── TIDES TAB ── */}
        {activeTab === "tides" && (
          <div>
            <div style={{ padding:".85rem 1rem", background:"#fef2f2", border:"1px solid #dc354566", borderRadius:6, marginBottom:"1.25rem", fontSize:".82rem", color:"#ef4444", fontFamily:"inherit", lineHeight:1.6 }}>
              <strong style={{ color:"#dc2626" }}>Critical:</strong> This route has two non-negotiable tidal rapids (Malibu and Seymour) and one high-traffic channel (Active Pass). Plan exact passage times the night before using official CHS tables. Cross-check with at least two sources.
            </div>
            {tideWarnings.map(t => (
              <div key={t.passage} style={{ marginBottom:".75rem", padding:"1.1rem 1.25rem", background:"#f8f9fb", border:"1px solid #dc354533", borderRadius:6 }}>
                <div style={{ fontSize:".9rem", color:"#0e1014", fontFamily:"inherit", marginBottom:".4rem" }}>{t.passage}</div>
                <div style={{ fontSize:".82rem", color:"#9ba1ac", fontFamily:"inherit", lineHeight:1.55 }}>{t.detail}</div>
              </div>
            ))}
            <div style={{ marginTop:"1.5rem", padding:"1.25rem", background:"#f8f9fb", border:"1px solid #1e3a52", borderRadius:6 }}>
              <div style={{ fontSize:".7rem", color:"#0b3d6b", letterSpacing:".15em", textTransform:"uppercase", marginBottom:".85rem", fontFamily:"inherit" }}>Apps & Resources</div>
              {[
                ["Navionics Boating App",      "Best all-in-one: charts, tides, ActiveCaptain community notes"],
                ["XTide / Tides Near Me",       "Precise slack water timing for BC passages"],
                ["tides.gc.ca (CHS)",           "Official Canadian Hydrographic Service tide predictions"],
                ["PredictWind or SailFlow",     "Weather routing — critical for Johnstone Strait & Haro Strait"],
                ["VHF Channel 16",              "Monitor at all times underway; 66A for BC marinas"],
                ["CBP ROAM App (US Customs)",   "Required for US re-entry — register all passengers before departure"],
              ].map(([tool,desc]) => (
                <div key={tool} style={{ display:"flex", gap:".75rem", marginBottom:".7rem", fontFamily:"inherit" }}>
                  <span style={{ color:"#0b3d6b", flexShrink:0, marginTop:2 }}>◆</span>
                  <div>
                    <div style={{ fontSize:".85rem", color:"#0e1014" }}>{tool}</div>
                    <div style={{ fontSize:".78rem", color:"#5c6470", marginTop:1 }}>{desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Lock/unlock toggle — bottom of page content */}
        {currentDb.githubToken && currentFile && currentFile !== "__local__" && (
          <div style={{ display: "flex", justifyContent: "center", alignItems: "center",
            gap: ".75rem", marginTop: "1.5rem", paddingTop: "1rem",
            borderTop: "1px solid #1e3a5230" }}>
            <span style={{ fontSize: ".72rem", fontFamily: "inherit", letterSpacing: ".04em",
              minWidth: 48, textAlign: "right",
              color: isLocked ? "#8338e8" : "#6b7a8a" }}>
              {isLocked ? "Locked" : "Editing"}
            </span>
            <div onClick={toggleLock}
              style={{ width: 44, height: 26, borderRadius: 13, cursor: "pointer",
                background: isLocked ? "#e2e5ea" : "#2e7050", position: "relative",
                flexShrink: 0, transition: "background 0.2s",
                border: `1px solid ${isLocked ? "#3a4a5a" : "#3a8060"}` }}>
              <div style={{
                width: 20, height: 20, borderRadius: "50%", background: "white",
                position: "absolute", top: 2, left: isLocked ? 2 : 20,
                transition: "left 0.2s", boxShadow: "0 1px 3px rgba(0,0,0,0.4)",
              }} />
            </div>
            <span style={{ fontSize: ".72rem", fontFamily: "inherit", letterSpacing: ".04em",
              minWidth: 48, color: isLocked ? "#6b7a8a" : "#3a9060" }}>
              {isLocked ? "Unlock" : "🔒 Lock"}
            </span>
          </div>
        )}

      </div>
    </div>
  );
}
