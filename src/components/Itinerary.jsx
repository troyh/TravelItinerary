import { useState, useEffect, useRef } from "react";
import NoteMarkdown from "./NoteMarkdown.jsx";
import { days as initialDays, tagConfig, fuelStops, fuelSummary, tideWarnings } from "../data/itinerary.js";
import DayPlaces from "./DayPlaces.jsx";
import DayDirections from "./DayDirections.jsx";
import DayRoute from "./DayRoute.jsx";
import Settings from "./Settings.jsx";
import { loadFromGitHub, saveToGitHub, ITINERARIES_FOLDER, inferRepo } from "../lib/github.js";
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
  const [openDay,          setOpenDay]          = useState(() => _db?.openDay ?? null);
  const [activeTab,        setActiveTab]        = useState("itinerary");
  const [startDate,        setStartDate]        = useState(() => _db?.startDate ?? "");
  const [customHighlights, setCustomHighlights] = useState(() => _db?.highlights ?? {});
  const [newHighlight,     setNewHighlight]     = useState("");
  const [customNotes,      setCustomNotes]      = useState(() => _db?.notes ?? {});
  const [editingNoteDay,   setEditingNoteDay]   = useState(null);
  const [noteDraft,        setNoteDraft]        = useState("");
  const [savedPlaces,      setSavedPlaces]      = useState(() => _db?.places ?? {});
  const [savedDirections,  setSavedDirections]  = useState(() => _db?.directions ?? {});
  const [savedRoutes,      setSavedRoutes]      = useState(() => _db?.routes ?? {});
  const [days,             setDays]             = useState(() => _db?.days ?? []);
  const [editingCoreDay,   setEditingCoreDay]   = useState(null);
  const [coreDraft,        setCoreDraft]        = useState({});
  const [confirmDeleteDay, setConfirmDeleteDay] = useState(null);
  const [settings,         setSettings]         = useState(() => { try { const s = localStorage.getItem("travelSettings"); return s ? JSON.parse(s) : {}; } catch { return {}; } });
  const [showSettings,     setShowSettings]     = useState(false);
  const [showHistory,      setShowHistory]      = useState(false);
  const [syncStatus,       setSyncStatus]       = useState("idle");
  const [syncError,        setSyncError]        = useState("");
  const [title,            setTitle]            = useState(() => _db?.title    ?? "");
  const [subtitle,         setSubtitle]         = useState(() => _db?.subtitle ?? "Princess Louisa Inlet · Vancouver · Salt Spring · Desolation Sound · Johnstone Strait · Broughtons · Gulf Islands");
  const [itineraryNotes,   setItineraryNotes]   = useState(() => _db?.itineraryNotes ?? "");
  const [editingHeader,    setEditingHeader]    = useState(false);
  const [headerDraft,      setHeaderDraft]      = useState({});
  const [editingNotes,     setEditingNotes]     = useState(false);
  const [currentFile,      setCurrentFile]      = useState(() => localStorage.getItem("travelCurrentFile"));
  const [urlLoad,          setUrlLoad]          = useState(() => {
    const name = new URLSearchParams(window.location.search).get("i");
    return name ? { file: `${ITINERARIES_FOLDER}/${name}.json`, status: "loading" } : null;
  });
  const [saveAsName,       setSaveAsName]       = useState("");
  const [copiedICS,        setCopiedICS]        = useState(false);
  const inputRef          = useRef(null);
  const syncTimerRef      = useRef(null);
  const dirtyRef          = useRef(false);
  const skipNextLoadRef   = useRef(false);

  const effectiveRepo   = settings.githubRepo   || inferRepo() || "";
  const effectiveBranch = settings.githubBranch || "data";
  const readOnly = !settings.githubToken;
  const ghSettings = { ...settings, githubRepo: effectiveRepo, githubBranch: effectiveBranch };

  useEffect(() => {
    setNewHighlight(""); setEditingNoteDay(null);
    setEditingCoreDay(null); setConfirmDeleteDay(null);
  }, [openDay]);

  // Single combined save: localStorage immediately + debounced GitHub push
  useEffect(() => {
    if (!currentFile) return;
    const data = { days, places: savedPlaces, directions: savedDirections, routes: savedRoutes,
                   highlights: customHighlights, notes: customNotes, startDate, openDay,
                   title, subtitle, itineraryNotes };
    localStorage.setItem("travelItinerary", JSON.stringify(data));
    const canSync = settings.githubToken && effectiveRepo &&
                    currentFile !== "__local__" && dirtyRef.current;
    dirtyRef.current = true; // any render after first is a user change
    if (canSync) {
      clearTimeout(syncTimerRef.current);
      setSyncStatus("pending");
      syncTimerRef.current = setTimeout(async () => {
        setSyncStatus("saving");
        try {
          await saveToGitHub(data, { ...ghSettings, githubFile: currentFile });
          // Also save .ics alongside the JSON when a start date is set
          const icsContent = buildICSContent(days, startDate, title, customHighlights, customNotes);
          if (icsContent) {
            const icsFile = currentFile.replace(/\.json$/i, ".ics");
            await saveToGitHub(icsContent, { ...ghSettings, githubFile: icsFile });
          }
          setSyncStatus("saved");
          setSyncError("");
        } catch (err) {
          setSyncStatus(err.message === "conflict" ? "conflict" : "error");
          setSyncError(err.message);
        }
      }, 2000);
    }
  }, [currentFile, days, savedPlaces, savedDirections, savedRoutes, customHighlights, customNotes, startDate, openDay, title, subtitle, itineraryNotes]);

  useEffect(() => { localStorage.setItem("travelSettings", JSON.stringify(settings)); }, [settings]);

  useEffect(() => { document.title = title || "Travel Itinerary"; }, [title]);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (currentFile && currentFile !== "__local__") {
      const name = currentFile.replace(/^.*\//, "").replace(/\.json$/i, "");
      url.searchParams.set("i", name);
    } else {
      url.searchParams.delete("i");
    }
    history.replaceState(null, "", url);
  }, [currentFile]);

  // Verify and load a file that arrived via ?i= URL param
  useEffect(() => {
    if (!urlLoad || urlLoad.status !== "loading") return;
    if (!effectiveRepo) { setUrlLoad(s => ({ ...s, status: "notfound" })); return; }
    loadFromGitHub({ ...ghSettings, githubFile: urlLoad.file })
      .then(data => {
        if (!data) { setUrlLoad(s => ({ ...s, status: "notfound" })); return; }
        if (data.days?.length)              setDays(data.days);
        if (data.places)                    setSavedPlaces(data.places);
        if (data.directions)                setSavedDirections(data.directions);
        if (data.routes)                    setSavedRoutes(data.routes);
        if (data.highlights)                setCustomHighlights(data.highlights);
        if (data.notes)                     setCustomNotes(data.notes);
        if (data.startDate !== undefined)   setStartDate(data.startDate);
        if (data.openDay != null)           setOpenDay(data.openDay);
        if (data.title !== undefined)       setTitle(data.title);
        if (data.subtitle !== undefined)    setSubtitle(data.subtitle);
        if (data.itineraryNotes !== undefined) setItineraryNotes(data.itineraryNotes);
        localStorage.setItem("travelCurrentFile", urlLoad.file);
        skipNextLoadRef.current = true;
        setCurrentFile(urlLoad.file);
        setUrlLoad(null);
        setSyncStatus("synced");
      })
      .catch(() => setUrlLoad(s => ({ ...s, status: "notfound" })));
  }, [urlLoad?.status, effectiveRepo]);

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
        if (data.days?.length)              setDays(data.days);
        if (data.places)                    setSavedPlaces(data.places);
        if (data.directions)                setSavedDirections(data.directions);
        if (data.routes)                    setSavedRoutes(data.routes);
        if (data.highlights)                setCustomHighlights(data.highlights);
        if (data.notes)                     setCustomNotes(data.notes);
        if (data.startDate !== undefined)          setStartDate(data.startDate);
        if (data.openDay != null)                  setOpenDay(data.openDay);
        if (data.title !== undefined)              setTitle(data.title);
        if (data.subtitle !== undefined)           setSubtitle(data.subtitle);
        if (data.itineraryNotes !== undefined)     setItineraryNotes(data.itineraryNotes);
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
    setOpenDay(prev => prev === dayNum ? Math.max(1, dayNum - 1) : prev > dayNum ? prev - 1 : prev);
    setConfirmDeleteDay(null);
    setEditingCoreDay(null);
  }

  function startEditCore(dayNum, d) {
    setEditingCoreDay(dayNum);
    setCoreDraft({ leg: d.leg, overnight: d.overnight, nm: d.nm, hrs: d.hrs });
    setEditingNoteDay(null);
  }

  function saveCore(dayNum) {
    setDays(prev => prev.map(d =>
      d.day === dayNum
        ? { ...d, leg: coreDraft.leg.trim() || d.leg, overnight: coreDraft.overnight,
               nm: Number(coreDraft.nm) || 0, hrs: Number(coreDraft.hrs) || 0 }
        : d
    ));
    setEditingCoreDay(null);
  }

  function applyData(data) {
    setDays(data.days?.length ? data.days : []);
    setSavedPlaces(data.places ?? {});
    setSavedDirections(data.directions ?? {});
    setSavedRoutes(data.routes ?? {});
    setCustomHighlights(data.highlights ?? {});
    setCustomNotes(data.notes ?? {});
    setStartDate(data.startDate ?? "");
    setOpenDay(data.openDay ?? null);
    setTitle(data.title ?? "New Itinerary");
    setSubtitle(data.subtitle ?? "");
    setItineraryNotes(data.itineraryNotes ?? "");
  }

  function handleLoad(path, data) {
    dirtyRef.current = false;
    if (data) {
      applyData(data);
      localStorage.setItem("travelItinerary", JSON.stringify(data));
    }
    setCurrentFile(path);
    if (path === "__local__") localStorage.removeItem("travelCurrentFile");
    else localStorage.setItem("travelCurrentFile", path);
    setSyncStatus(path === "__local__" ? "idle" : "synced");
  }

  function handleCreate(name) {
    const filename = sanitizeFilename(name);
    const path = `${ITINERARIES_FOLDER}/${filename}.json`;
    dirtyRef.current = false;
    setDays([]); setSavedPlaces({}); setSavedDirections({}); setSavedRoutes({});
    setCustomHighlights({}); setCustomNotes({});
    setStartDate(""); setOpenDay(null);
    setTitle(name); setSubtitle(""); setItineraryNotes("");
    localStorage.removeItem("travelItinerary");
    setCurrentFile(path);
    localStorage.setItem("travelCurrentFile", path);
    setSyncStatus("idle");
  }

  function handleClose() {
    clearTimeout(syncTimerRef.current);
    setCurrentFile(null);
    localStorage.removeItem("travelCurrentFile");
    localStorage.removeItem("travelItinerary");
    setSyncStatus("idle");
  }

  function handleSaveAs() {
    const name = sanitizeFilename(saveAsName.trim() || title);
    if (!name) return;
    const path = `${ITINERARIES_FOLDER}/${name}.json`;
    setCurrentFile(path);
    localStorage.setItem("travelCurrentFile", path);
    dirtyRef.current = true; // force immediate GitHub push
    setSyncStatus("pending");
    setSaveAsName("");
  }

  function buildICSContent(daysArr, sd, ttl, highlights, notes) {
    if (!sd || !daysArr.length) return null;
    const [sy, sm, sday] = sd.split("-").map(Number);
    const toICSDate = n => {
      const d = new Date(sy, sm - 1, sday + n - 1);
      return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,"0")}${String(d.getDate()).padStart(2,"0")}`;
    };
    const esc = s => (s ?? "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");

    const cal = [
      "BEGIN:VCALENDAR", "VERSION:2.0",
      `PRODID:-//${esc(ttl || "Travel Itinerary")}//EN`,
      "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
      `X-WR-CALNAME:${esc(ttl || "Travel Itinerary")}`,
    ];

    daysArr.forEach(d => {
      const parts = [];
      if (d.nm > 0) parts.push(`${d.nm} NM · ~${d.hrs.toFixed(1)} hrs`);
      if (d.overnight) parts.push(`Overnight: ${d.overnight}`);
      const hl = [...(d.highlights ?? []), ...(highlights[d.day] ?? [])];
      if (hl.length) parts.push("\nHighlights:\n" + hl.map(h => `• ${h}`).join("\n"));
      const note = notes[d.day] !== undefined ? notes[d.day] : d.note;
      if (note) parts.push(`\nNote: ${note}`);
      cal.push("BEGIN:VEVENT");
      cal.push(`DTSTART;VALUE=DATE:${toICSDate(d.day)}`);
      cal.push(`DTEND;VALUE=DATE:${toICSDate(d.day + 1)}`);
      cal.push(`SUMMARY:${esc(`Day ${d.day}: ${d.leg}`)}`);
      if (d.overnight) cal.push(`LOCATION:${esc(d.overnight)}`);
      if (parts.length) cal.push(`DESCRIPTION:${esc(parts.join("\n"))}`);
      cal.push(`UID:day-${d.day}-${toICSDate(d.day)}@travelitinerary`);
      cal.push("END:VEVENT");
    });
    cal.push("END:VCALENDAR");
    return cal.join("\r\n");
  }

  function generateICS() {
    const content = buildICSContent(days, startDate, title, customHighlights, customNotes);
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
        if (data.days?.length)            setDays(data.days);
        if (data.places)                  setSavedPlaces(data.places);
        if (data.directions)              setSavedDirections(data.directions);
        if (data.highlights)              setCustomHighlights(data.highlights);
        if (data.notes)                   setCustomNotes(data.notes);
        if (data.startDate !== undefined)      setStartDate(data.startDate);
        if (data.openDay != null)              setOpenDay(data.openDay);
        if (data.title !== undefined)          setTitle(data.title);
        if (data.subtitle !== undefined)       setSubtitle(data.subtitle);
        if (data.itineraryNotes !== undefined) setItineraryNotes(data.itineraryNotes);
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

  const dateRange = (() => {
    if (!startDate || !days.length) return null;
    const [y, m, d] = startDate.split("-").map(Number);
    const start = new Date(y, m - 1, d);
    const end   = new Date(y, m - 1, d + days.length - 1);
    const fmtShort = dt => dt.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    const fmtFull  = dt => dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    return `${fmtShort(start)} – ${fmtFull(end)}`;
  })();

  const totalNM  = days.reduce((s, d) => s + d.nm, 0);
  const underway = days.filter(d => d.nm > 0).length;
  const layovers = days.filter(d => d.nm === 0).length;
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
        minHeight:"100vh", background:"#0b1929", color:"#6b8fa8",
        fontFamily:"sans-serif", fontSize:".9rem" }}>
        Loading…
      </div>
    );
  }

  if (urlLoad?.status === "notfound") {
    const name = urlLoad.file.replace(/^.*\//, "").replace(/\.json$/i, "");
    return (
      <div style={{ display:"flex", flexDirection:"column", justifyContent:"center",
        alignItems:"center", minHeight:"100vh", background:"#0b1929",
        fontFamily:"sans-serif", gap:"1rem", padding:"2rem" }}>
        <div style={{ fontSize:".62rem", color:"#c9a84c", letterSpacing:".2em",
          textTransform:"uppercase" }}>Not Found</div>
        <div style={{ fontSize:"1.1rem", color:"#8fb0cc", textAlign:"center" }}>
          "{name}" doesn't exist.
        </div>
        <button onClick={() => {
            const url = new URL(window.location.href);
            url.searchParams.delete("i");
            history.replaceState(null, "", url);
            setUrlLoad(null);
          }}
          style={{ background:"none", border:"1px solid #2e5070", color:"#4e7a9e",
            borderRadius:4, padding:".5rem 1.25rem", fontSize:".82rem",
            fontFamily:"sans-serif", cursor:"pointer" }}>
          ← All Itineraries
        </button>
      </div>
    );
  }

  if (!currentFile) {
    return (
      <ItineraryPicker
        settings={settings}
        onSettingsChange={setSettings}
        onLoad={handleLoad}
        onCreate={handleCreate}
        localCache={localCache}
      />
    );
  }

  return (
    <div style={{ fontFamily: "Georgia, 'Times New Roman', serif", background: "#0b1929", minHeight: "100vh", color: "#e8dcc8" }}>

      {/* ── HEADER ── */}
      <div style={{ background: "linear-gradient(135deg,#0b1929 0%,#112a44 50%,#0b1929 100%)", borderBottom: "1px solid #c9a84c33", padding: "2.5rem 2rem 2rem" }}>
        <div style={{ maxWidth: 820, margin: "0 auto" }}>
          {/* Subtitle row: back button + file name + sync status + settings gear */}
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:".5rem" }}>
            <div style={{ display:"flex", alignItems:"center", gap:".75rem" }}>
              <button onClick={handleClose}
                style={{ background:"none", border:"none", color:"#4e7a9e", cursor:"pointer",
                  fontSize:".7rem", fontFamily:"sans-serif", padding:0 }}>
                ← All Itineraries
              </button>
              <span style={{ color:"#2e4a5e", fontSize:".7rem", fontFamily:"sans-serif" }}>·</span>
              <div style={{ fontSize:".7rem", color:"#c9a84c", fontFamily:"sans-serif",
                letterSpacing: dateRange ? ".03em" : ".15em",
                textTransform: dateRange ? "none" : "uppercase" }}>
                {dateRange
                  ? <>{dateRange} <span style={{ opacity:.6 }}>· {days.length} days</span></>
                  : <>{days.length} Days</>}
                {currentFile === "__local__" &&
                  <span style={{ color:"#e8a838", marginLeft:".5rem" }}>· Local only</span>}
              </div>
            </div>
            <div style={{ display:"flex", alignItems:"center", gap:".75rem" }}>
              {syncStatus !== "idle" && (() => {
                const map = {
                  loading: ["Loading…",  "#6b8fa8"],
                  pending: ["Pending",   "#e8a838"],
                  saving:  ["Saving…",   "#e8a838"],
                  saved:   ["● Synced",  "#5cb85c"],
                  synced:  ["● Synced",  "#5cb85c"],
                  offline: ["Offline",   "#4e7a9e"],
                  error:   ["⚠ Error",   "#e87878"],
                  conflict:["⚠ Conflict","#e87878"],
                };
                const [label, color] = map[syncStatus] ?? ["", "#6b8fa8"];
                return (
                  <span style={{ fontSize:".62rem", color, fontFamily:"sans-serif" }}
                    title={syncError || undefined}>
                    {label}{syncError && syncStatus === "error" ? ` — ${syncError}` : ""}
                  </span>
                );
              })()}
              {currentFile && currentFile !== "__local__" && settings.githubToken && (
                <button onClick={() => { setShowHistory(p => !p); setShowSettings(false); }}
                  title="Version history"
                  style={{ background:"none", border:"none",
                    color: showHistory ? "#c9a84c" : "#6b8fa8",
                    cursor:"pointer", fontSize:".9rem", padding:0, lineHeight:1 }}>
                  ⏱
                </button>
              )}
              <button onClick={() => { setShowSettings(p => !p); setShowHistory(false); }} title="Settings"
                style={{ background:"none", border:"none", color: showSettings ? "#c9a84c" : "#6b8fa8",
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
              settings={ghSettings}
              currentFile={currentFile}
              onRestore={handleRestore}
              onClose={() => setShowHistory(false)}
            />
          )}

          {/* Save-to-GitHub banner (local session only) */}
          {currentFile === "__local__" && (
            <div style={{ margin: ".75rem 0 1rem", padding: ".75rem 1rem",
              background: "#1a1800", border: "1px solid #e8a83844", borderRadius: 6,
              display: "flex", alignItems: "center", gap: ".75rem", flexWrap: "wrap" }}>
              <span style={{ fontSize: ".78rem", color: "#e8a838", fontFamily: "sans-serif",
                flexShrink: 0 }}>
                Not saved to GitHub yet.
              </span>
              <input
                value={saveAsName || title}
                onChange={e => setSaveAsName(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleSaveAs()}
                placeholder="Itinerary name…"
                style={{ flex: 1, minWidth: 160, background: "#0d1f33", border: "1px solid #2e5070",
                  color: "#e8dcc8", borderRadius: 4, padding: ".35rem .65rem",
                  fontSize: ".82rem", fontFamily: "sans-serif", outline: "none" }}
              />
              <button onClick={handleSaveAs}
                disabled={!settings.githubToken || !effectiveRepo}
                title={(!settings.githubToken || !effectiveRepo) ? "Configure GitHub in Settings ⚙ first" : ""}
                style={{ background: "#1a3352", border: "1px solid #2e5070", color: "#c9a84c",
                  borderRadius: 4, padding: ".35rem .85rem", fontSize: ".75rem",
                  fontFamily: "sans-serif", cursor: "pointer", whiteSpace: "nowrap",
                  opacity: (!settings.githubToken || !effectiveRepo) ? 0.45 : 1 }}>
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
                style={{ width:"100%", background:"#112a44", border:"1px solid #2e5070", color:"#f5edd8",
                  borderRadius:4, padding:".45rem .75rem", fontSize:"clamp(1.2rem,3vw,1.8rem)",
                  fontFamily:"Georgia,serif", fontWeight:400, letterSpacing:"-.02em",
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
                style={{ width:"100%", background:"#112a44", border:"1px solid #2e5070", color:"#9ab8d4",
                  borderRadius:4, padding:".4rem .75rem", fontSize:".9rem",
                  fontFamily:"Georgia,serif", fontStyle:"italic",
                  outline:"none", boxSizing:"border-box", marginBottom:".6rem" }} />
              <div style={{ display:"flex", gap:".5rem" }}>
                <button onClick={() => { setTitle(headerDraft.title.trim() || title); setSubtitle(headerDraft.subtitle); setEditingHeader(false); }}
                  style={{ background:"#1a3352", border:"1px solid #2e5070", color:"#c9a84c",
                    borderRadius:4, padding:".3rem .75rem", fontSize:".75rem", fontFamily:"sans-serif", cursor:"pointer" }}>
                  Save
                </button>
                <button onClick={() => setEditingHeader(false)}
                  style={{ background:"none", border:"1px solid #2e3a4a", color:"#4e7a9e",
                    borderRadius:4, padding:".3rem .75rem", fontSize:".75rem", fontFamily:"sans-serif", cursor:"pointer" }}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <>
              <div style={{ display:"flex", alignItems:"flex-start", gap:".5rem", marginBottom:".4rem" }}>
                <h1 style={{ fontSize:"clamp(1.6rem,4vw,2.4rem)", fontWeight:400, color:"#f5edd8",
                  margin:0, letterSpacing:"-.02em", lineHeight:1.15, flex:1 }}>
                  {title}
                </h1>
                {!readOnly && (
                  <button onClick={() => { setEditingHeader(true); setHeaderDraft({ title, subtitle }); }}
                    style={{ background:"none", border:"none", color:"#4e7a9e", cursor:"pointer",
                      fontSize:".7rem", fontFamily:"sans-serif", padding:0, flexShrink:0, marginTop:".35rem" }}>
                    Edit
                  </button>
                )}
              </div>
              {subtitle && (
                <p style={{ color:"#9ab8d4", margin:"0 0 1.5rem", fontSize:".95rem", fontStyle:"italic" }}>
                  {subtitle}
                </p>
              )}
            </>
          )}

          {/* Stats */}
          <div style={{ display: "flex", gap: "2rem", flexWrap: "wrap", marginBottom: "1.25rem" }}>
            {[
              { label: "Total Distance", val: `${totalNM} NM` },
              { label: "Underway Days",  val: String(underway)  },
              { label: "Layover Days",   val: String(layovers)  },
              { label: "Fuel Stops",     val: String(days.filter(d => d.fuelStop).length) },
            ].map(s => (
              <div key={s.label}>
                <div style={{ fontSize: "1.3rem", color: "#c9a84c" }}>{s.val}</div>
                <div style={{ fontSize: ".7rem", color: "#6b8fa8", letterSpacing: ".1em", textTransform: "uppercase" }}>{s.label}</div>
              </div>
            ))}
          </div>

          {/* Departure date */}
          <div style={{ display:"flex", alignItems:"center", gap:".65rem", marginBottom:"1.25rem", fontFamily:"sans-serif" }}>
            <span style={{ fontSize:".7rem", color:"#6b8fa8", letterSpacing:".1em", textTransform:"uppercase" }}>Departure</span>
            <input
              type="date"
              value={startDate}
              onChange={e => setStartDate(e.target.value)}
              style={{ background:"#1a3352", border:"1px solid #2e5070", color:"#c9a84c",
                padding:"3px 8px", borderRadius:4, fontSize:".78rem", fontFamily:"sans-serif", cursor:"pointer" }}
            />
            {startDate && (
              <>
                <button onClick={() => setStartDate("")}
                  style={{ background:"none", border:"none", color:"#4e7a9e", cursor:"pointer",
                    fontSize:".7rem", fontFamily:"sans-serif", padding:0 }}>
                  clear
                </button>
                {days.length > 0 && (
                  <>
                    <button onClick={generateICS}
                      style={{ background:"none", border:"1px solid #2e5070", color:"#6b8fa8",
                        cursor:"pointer", fontSize:".7rem", fontFamily:"sans-serif",
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
                        style={{ background:"none", border:"1px solid #2e5070", color: copiedICS ? "#5cb85c" : "#6b8fa8",
                          cursor:"pointer", fontSize:".7rem", fontFamily:"sans-serif",
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
                  style={{ width:"100%", background:"#112a44", border:"1px solid #2e5070", color:"#e8dcc8",
                    borderRadius:4, padding:".5rem .75rem", fontSize:".82rem", fontFamily:"sans-serif",
                    lineHeight:1.6, resize:"vertical", boxSizing:"border-box", outline:"none",
                    marginBottom:".5rem" }}
                />
                <button onClick={() => setEditingNotes(false)}
                  style={{ background:"#1a3352", border:"1px solid #2e5070", color:"#c9a84c",
                    borderRadius:4, padding:".3rem .75rem", fontSize:".75rem", fontFamily:"sans-serif",
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
                    style={{ background:"none", border:"none", color:"#4e7a9e", cursor:"pointer",
                      fontSize:".7rem", fontFamily:"sans-serif", padding:0, flexShrink:0 }}>
                    Edit
                  </button>
                )}
              </div>
            ) : !readOnly ? (
              <button onClick={() => setEditingNotes(true)}
                style={{ background:"none", border:"none", color:"#3d5060", cursor:"pointer",
                  fontSize:".75rem", fontFamily:"sans-serif", fontStyle:"italic", padding:0 }}>
                + Add itinerary notes
              </button>
            ) : null}
          </div>

          {/* TODOs */}
          {todos.length > 0 && (
            <div style={{ marginBottom:"1.25rem", padding:".65rem .85rem",
              background:"#1a1400", border:"1px solid #e8a83844", borderRadius:5 }}>
              <div style={{ fontSize:".62rem", color:"#e8a838", letterSpacing:".12em",
                textTransform:"uppercase", fontFamily:"sans-serif", marginBottom:".5rem" }}>
                {todos.length} TODO{todos.length !== 1 ? "s" : ""}
              </div>
              {todos.map((t, i) => (
                <div key={i}
                  onClick={t.day != null ? () => { setOpenDay(t.day); setActiveTab("itinerary"); } : undefined}
                  style={{ display:"flex", gap:".65rem", marginBottom: i < todos.length - 1 ? ".3rem" : 0,
                    cursor: t.day != null ? "pointer" : "default", alignItems:"baseline" }}>
                  <span style={{ fontSize:".65rem", color:"#e8a838", fontFamily:"sans-serif",
                    flexShrink:0, opacity:.8 }}>
                    {t.day != null ? `Day ${t.day}` : "General"}
                  </span>
                  <span style={{ fontSize:".78rem", color:"#e8dcc8", fontFamily:"sans-serif",
                    lineHeight:1.4 }}>{t.text}</span>
                </div>
              ))}
            </div>
          )}

          {/* Day-strip */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center" }}>
            {days.map(d => {
              const lay  = d.nm === 0;
              const fuel = d.fuelStop;
              const tide = d.tideWarning;
              const bg   = tide ? "#5c1a1a" : fuel ? "#5c3010" : lay ? "#1a3d1a" : "#1e3a52";
              const col  = tide ? "#e87878" : fuel ? "#e8a838" : lay ? "#5cb85c" : "#6b8fa8";
              const info = getDayDate(d.day);
              return (
                <div key={d.day}
                  onClick={() => { setOpenDay(d.day); setActiveTab("itinerary"); }}
                  title={info ? `${d.leg} · ${info.dow}, ${info.date}` : d.leg}
                  style={{ width:32, minHeight:32, borderRadius:4, background:bg,
                    display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center",
                    fontSize:".6rem", color:col, cursor:"pointer", fontFamily:"sans-serif",
                    padding: info ? "4px 0" : 0, gap:1,
                    border: openDay === d.day ? "1px solid #c9a84c" : "1px solid transparent" }}>
                  <span>D{d.day}</span>
                  {info && <span style={{ fontSize:".5rem", opacity:.9, lineHeight:1 }}>{info.dow}</span>}
                  {info && <span style={{ fontSize:".5rem", opacity:.7, lineHeight:1 }}>{info.date}</span>}
                </div>
              );
            })}
            <div style={{ display:"flex", gap:10, marginLeft:8, flexWrap:"wrap", alignItems:"center" }}>
              {[["#1e3a52","#6b8fa8","Underway"],["#1a3d1a","#5cb85c","Layover"],["#5c3010","#e8a838","⛽ Fuel"],["#5c1a1a","#e87878","⚠ Tides"]].map(([bg,col,lbl])=>(
                <div key={lbl} style={{ display:"flex", alignItems:"center", gap:4 }}>
                  <div style={{ width:10, height:10, borderRadius:2, background:bg, border:`1px solid ${col}` }}/>
                  <span style={{ fontSize:".62rem", color:col, fontFamily:"sans-serif" }}>{lbl}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── CONFLICT BANNER ── */}
      {syncStatus === "conflict" && (
        <div style={{ background:"#3a0a0a", borderBottom:"1px solid #dc354566", padding:".6rem 1rem",
          display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <span style={{ fontSize:".78rem", color:"#e87878", fontFamily:"sans-serif" }}>
            ⚠ Conflict — GitHub has a newer version.
          </span>
          <button onClick={reloadFromGitHub}
            style={{ background:"none", border:"1px solid #dc354566", color:"#e87878",
              borderRadius:4, padding:".25rem .65rem", fontSize:".72rem",
              fontFamily:"sans-serif", cursor:"pointer" }}>
            Reload from GitHub
          </button>
        </div>
      )}

      {/* ── TABS ── */}
      <div style={{ borderBottom:"1px solid #1e3a5240", background:"#0d1f33" }}>
        <div style={{ maxWidth:820, margin:"0 auto", display:"flex" }}>
          {[["itinerary","Day by Day"],["fuel","Fuel Plan"],["tides","Tide Warnings"]].map(([t,lbl])=>(
            <button key={t} onClick={()=>setActiveTab(t)} style={{
              background:"none", border:"none",
              borderBottom: activeTab===t ? "2px solid #c9a84c" : "2px solid transparent",
              color: activeTab===t ? "#c9a84c" : "#6b8fa8",
              padding:".85rem 1.5rem", fontSize:".78rem", letterSpacing:".12em",
              textTransform:"uppercase", cursor:"pointer" }}>
              {lbl}
            </button>
          ))}
        </div>
      </div>

      <div style={{ maxWidth:820, margin:"0 auto", padding:"1.5rem 1rem 3rem" }}>

        {/* ── ITINERARY TAB ── */}
        {activeTab === "itinerary" && days.length === 0 && (
          <div style={{ textAlign:"center", padding:"3rem 1rem", fontFamily:"sans-serif" }}>
            <div style={{ color:"#4e7a9e", marginBottom:"1.25rem", fontSize:".9rem" }}>No itinerary yet.</div>
            <button onClick={() => { setDays(initialDays); setOpenDay(1); }}
              style={{ background:"#1a3352", border:"1px solid #2e5070", color:"#c9a84c",
                borderRadius:6, padding:".55rem 1.5rem", fontSize:".82rem",
                fontFamily:"sans-serif", cursor:"pointer" }}>
              Load sample itinerary
            </button>
          </div>
        )}
        {activeTab === "itinerary" && (<>
        {days.map(d => {
          const isOpen    = openDay === d.day;
          const isLayover = d.nm === 0;
          const dayInfo   = getDayDate(d.day);
          return (
            <div key={d.day} style={{
              marginBottom:".5rem",
              border: isOpen ? "1px solid #c9a84c55" : "1px solid #1e3a5260",
              borderRadius:6, background: isOpen ? "#0d2035" : "#0b1929", overflow:"hidden" }}>

              {/* Row */}
              <button onClick={()=>setOpenDay(isOpen ? null : d.day)} style={{
                width:"100%", background:"none", border:"none", padding:"1rem 1.25rem",
                cursor:"pointer", display:"flex", alignItems:"center", gap:"1rem", textAlign:"left" }}>
                <div style={{
                  minWidth:38, height: dayInfo ? 56 : 38,
                  borderRadius: dayInfo ? 7 : "50%",
                  background: isOpen ? "#c9a84c" : "#1a3352",
                  color: isOpen ? "#0b1929" : "#c9a84c",
                  display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center",
                  fontSize:".75rem", fontWeight:700, flexShrink:0, gap:1 }}>
                  <span>{d.day}</span>
                  {dayInfo && <span style={{ fontSize:".6rem", fontWeight:600, opacity: isOpen ? .85 : .75, lineHeight:1 }}>{dayInfo.dow}</span>}
                  {dayInfo && <span style={{ fontSize:".58rem", fontWeight:400, opacity: isOpen ? .65 : .55, lineHeight:1 }}>{dayInfo.date}</span>}
                </div>
                <div style={{ flex:1 }}>
                  <div style={{ color: isOpen ? "#f5edd8" : "#c8daea", fontSize:".95rem", lineHeight:1.3 }}>
                    {d.leg}
                    {d.fuelStop    && <span style={{ marginLeft:8,  background:"#e8553822", color:"#e87758", fontSize:".63rem", padding:"2px 7px", borderRadius:10, fontFamily:"sans-serif", verticalAlign:"middle" }}>⛽ {d.fuelLabel}</span>}
                    {d.tideWarning && <span style={{ marginLeft:6,  background:"#dc354522", color:"#f87878", fontSize:".63rem", padding:"2px 7px", borderRadius:10, fontFamily:"sans-serif", verticalAlign:"middle" }}>⚠ Tide Critical</span>}
                    {d.tags.includes("combined-leg") && <span style={{ marginLeft:6, background:"#20c99722", color:"#20c997", fontSize:".63rem", padding:"2px 7px", borderRadius:10, fontFamily:"sans-serif", verticalAlign:"middle" }}>Combined</span>}
                  </div>
                  <div style={{ color:"#4e7a9e", fontSize:".75rem", marginTop:2, fontFamily:"sans-serif" }}>
                    {isLayover ? "Layover" : `${d.nm} NM · ~${d.hrs.toFixed(1)} hrs @ 15 kts`}
                    {" · "}
                    <span style={{ fontStyle:"italic", color:"#3d6680" }}>{d.overnight}</span>
                  </div>
                </div>
                <div style={{ color:"#4e7a9e", transform: isOpen ? "rotate(180deg)" : "none" }}>▾</div>
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
                        letterSpacing:".07em", fontFamily:"sans-serif", textTransform:"uppercase" }}>{c.label}</span>;
                    })}
                  </div>
                  {/* Core fields edit */}
                  {editingCoreDay === d.day ? (
                    <div style={{ marginBottom:"1rem", padding:".75rem 1rem", background:"#0a1a2a",
                      borderLeft:"3px solid #6b8fa866", borderRadius:"0 4px 4px 0" }}>
                      <div style={{ fontSize:".62rem", color:"#6b8fa8", letterSpacing:".1em",
                        textTransform:"uppercase", fontFamily:"sans-serif", marginBottom:".65rem" }}>
                        Edit Day
                      </div>
                      <div style={{ display:"flex", flexDirection:"column", gap:".5rem" }}>
                        <div>
                          <div style={{ fontSize:".62rem", color:"#6b8fa8", letterSpacing:".08em", textTransform:"uppercase", fontFamily:"sans-serif", marginBottom:3 }}>Route / Leg</div>
                          <input autoFocus value={coreDraft.leg}
                            onChange={e => setCoreDraft(p => ({ ...p, leg: e.target.value }))}
                            onKeyDown={e => { if (e.key === "Escape") setEditingCoreDay(null); if ((e.metaKey||e.ctrlKey) && e.key === "Enter") saveCore(d.day); }}
                            style={{ width:"100%", background:"#0d1f33", border:"1px solid #2e5070", color:"#e8dcc8",
                              borderRadius:4, padding:".4rem .65rem", fontSize:".85rem", fontFamily:"Georgia,serif",
                              outline:"none", boxSizing:"border-box" }} />
                        </div>
                        <div>
                          <div style={{ fontSize:".62rem", color:"#6b8fa8", letterSpacing:".08em", textTransform:"uppercase", fontFamily:"sans-serif", marginBottom:3 }}>Overnight / Anchorage</div>
                          <input value={coreDraft.overnight}
                            onChange={e => setCoreDraft(p => ({ ...p, overnight: e.target.value }))}
                            onKeyDown={e => { if (e.key === "Escape") setEditingCoreDay(null); if ((e.metaKey||e.ctrlKey) && e.key === "Enter") saveCore(d.day); }}
                            style={{ width:"100%", background:"#0d1f33", border:"1px solid #2e5070", color:"#e8dcc8",
                              borderRadius:4, padding:".4rem .65rem", fontSize:".82rem", fontFamily:"sans-serif",
                              outline:"none", boxSizing:"border-box" }} />
                        </div>
                        <div style={{ display:"flex", gap:".75rem" }}>
                          <div style={{ flex:1 }}>
                            <div style={{ fontSize:".62rem", color:"#6b8fa8", letterSpacing:".08em", textTransform:"uppercase", fontFamily:"sans-serif", marginBottom:3 }}>Distance (NM)</div>
                            <input type="number" min="0" step="1" value={coreDraft.nm}
                              onChange={e => setCoreDraft(p => ({ ...p, nm: e.target.value }))}
                              onKeyDown={e => { if (e.key === "Escape") setEditingCoreDay(null); if ((e.metaKey||e.ctrlKey) && e.key === "Enter") saveCore(d.day); }}
                              style={{ width:"100%", background:"#0d1f33", border:"1px solid #2e5070", color:"#e8dcc8",
                                borderRadius:4, padding:".4rem .65rem", fontSize:".82rem", fontFamily:"sans-serif",
                                outline:"none", boxSizing:"border-box" }} />
                          </div>
                          <div style={{ flex:1 }}>
                            <div style={{ fontSize:".62rem", color:"#6b8fa8", letterSpacing:".08em", textTransform:"uppercase", fontFamily:"sans-serif", marginBottom:3 }}>Hours @ 15 kts</div>
                            <input type="number" min="0" step="0.1" value={coreDraft.hrs}
                              onChange={e => setCoreDraft(p => ({ ...p, hrs: e.target.value }))}
                              onKeyDown={e => { if (e.key === "Escape") setEditingCoreDay(null); if ((e.metaKey||e.ctrlKey) && e.key === "Enter") saveCore(d.day); }}
                              style={{ width:"100%", background:"#0d1f33", border:"1px solid #2e5070", color:"#e8dcc8",
                                borderRadius:4, padding:".4rem .65rem", fontSize:".82rem", fontFamily:"sans-serif",
                                outline:"none", boxSizing:"border-box" }} />
                          </div>
                        </div>
                      </div>
                      <div style={{ display:"flex", gap:".5rem", marginTop:".65rem" }}>
                        <button onClick={() => saveCore(d.day)}
                          style={{ background:"#1a3352", border:"1px solid #2e5070", color:"#c9a84c",
                            borderRadius:4, padding:".3rem .75rem", fontSize:".75rem", fontFamily:"sans-serif", cursor:"pointer" }}>
                          Save
                        </button>
                        <button onClick={() => setEditingCoreDay(null)}
                          style={{ background:"none", border:"1px solid #2e3a4a", color:"#4e7a9e",
                            borderRadius:4, padding:".3rem .75rem", fontSize:".75rem", fontFamily:"sans-serif", cursor:"pointer" }}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : !readOnly ? (
                    <div style={{ display:"flex", justifyContent:"flex-end", marginBottom:".75rem", marginTop:"-.25rem" }}>
                      <button onClick={() => startEditCore(d.day, d)}
                        style={{ background:"none", border:"none", color:"#4e7a9e", cursor:"pointer",
                          fontSize:".7rem", fontFamily:"sans-serif", padding:0 }}>
                        Edit leg / overnight / distance
                      </button>
                    </div>
                  ) : null}

                  {/* Highlights */}
                  <ul style={{ margin:0, padding:0, listStyle:"none" }}>
                    {d.highlights.map((h,i) => (
                      <li key={i} style={{ display:"flex", gap:".75rem", marginBottom:".55rem",
                        fontSize:".875rem", lineHeight:1.5, color:"#b8cfe0", fontFamily:"sans-serif" }}>
                        <span style={{ color:"#c9a84c", flexShrink:0, marginTop:2 }}>◆</span>
                        <span>{h}</span>
                      </li>
                    ))}
                    {(customHighlights[d.day] ?? []).map((h,i) => (
                      <li key={`c${i}`} style={{ display:"flex", gap:".75rem", marginBottom:".55rem",
                        fontSize:".875rem", lineHeight:1.5, color:"#c8e0c8", fontFamily:"sans-serif" }}>
                        <span style={{ color:"#5cb85c", flexShrink:0, marginTop:2 }}>◆</span>
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
                        style={{ flex:1, background:"#0a1a2a", border:"1px solid #2e5070", color:"#e8dcc8",
                          borderRadius:4, padding:".4rem .65rem", fontSize:".82rem", fontFamily:"sans-serif",
                          outline:"none" }}
                      />
                      <button onClick={() => addHighlight(d.day)}
                        style={{ background:"#1a3352", border:"1px solid #2e5070", color:"#c9a84c",
                          borderRadius:4, padding:".4rem .85rem", fontSize:".78rem", fontFamily:"sans-serif",
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
                      <div style={{ marginTop:"1rem", padding:".75rem 1rem", background:"#0a1a2a",
                        borderLeft:"3px solid #c9a84c66", borderRadius:"0 4px 4px 0" }}>
                        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:4 }}>
                          <div style={{ fontSize:".62rem", color:"#c9a84c", letterSpacing:".1em", textTransform:"uppercase", fontFamily:"sans-serif" }}>Captain's Note</div>
                          {!isEditing && !readOnly && (
                            <button onClick={() => startEditNote(d.day, note)}
                              style={{ background:"none", border:"none", color:"#4e7a9e", cursor:"pointer",
                                fontSize:".7rem", fontFamily:"sans-serif", padding:0 }}>
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
                              style={{ width:"100%", background:"#0d1f33", border:"1px solid #2e5070",
                                color:"#e8dcc8", borderRadius:4, padding:".4rem .65rem",
                                fontSize:".82rem", fontFamily:"sans-serif", lineHeight:1.55,
                                resize:"vertical", minHeight:80, boxSizing:"border-box", outline:"none" }}
                            />
                            <div style={{ display:"flex", gap:".5rem", marginTop:".5rem" }}>
                              <button onClick={() => saveNote(d.day)}
                                style={{ background:"#1a3352", border:"1px solid #2e5070", color:"#c9a84c",
                                  borderRadius:4, padding:".3rem .75rem", fontSize:".75rem",
                                  fontFamily:"sans-serif", cursor:"pointer" }}>
                                Save
                              </button>
                              <button onClick={cancelEditNote}
                                style={{ background:"none", border:"1px solid #2e3a4a", color:"#4e7a9e",
                                  borderRadius:4, padding:".3rem .75rem", fontSize:".75rem",
                                  fontFamily:"sans-serif", cursor:"pointer" }}>
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
                  />

                  {/* Boating Routes */}
                  <DayRoute
                    routes={savedRoutes[d.day] ?? []}
                    onAdd={route => addRoute(d.day, route)}
                    onUpdate={(id, updates) => updateRoute(d.day, id, updates)}
                    onDelete={id => deleteRoute(d.day, id)}
                    onApplyToDay={updates => updateDayFields(d.day, updates)}
                    readOnly={readOnly}
                  />

                  {/* Tide warning */}
                  {d.tideWarning && d.tideNote && (
                    <div style={{ marginTop:".75rem", padding:".75rem 1rem", background:"#1a0a0a",
                      borderLeft:"3px solid #dc3545", borderRadius:"0 4px 4px 0" }}>
                      <div style={{ fontSize:".62rem", color:"#e87878", letterSpacing:".1em", textTransform:"uppercase", marginBottom:4, fontFamily:"sans-serif" }}>⚠ Tide Warning</div>
                      <div style={{ fontSize:".82rem", color:"#cc8888", fontFamily:"sans-serif", lineHeight:1.55 }}>{d.tideNote}</div>
                    </div>
                  )}

                  {/* Day actions */}
                  {!readOnly && (
                    <div style={{ marginTop:"1.25rem", paddingTop:".85rem", borderTop:"1px solid #1e3a5240",
                      display:"flex", alignItems:"center", gap:".5rem", flexWrap:"wrap" }}>
                      <button onClick={() => duplicateDay(d.day)}
                        style={{ background:"#0d2035", border:"1px solid #2e5070", color:"#6b8fa8",
                          borderRadius:4, padding:".3rem .75rem", fontSize:".72rem", fontFamily:"sans-serif", cursor:"pointer" }}>
                        Duplicate day
                      </button>
                      <button onClick={() => addBlankDay(d.day)}
                        style={{ background:"#0d2035", border:"1px solid #2e5070", color:"#6b8fa8",
                          borderRadius:4, padding:".3rem .75rem", fontSize:".72rem", fontFamily:"sans-serif", cursor:"pointer" }}>
                        Insert day after
                      </button>
                      <div style={{ marginLeft:"auto", display:"flex", alignItems:"center", gap:".5rem" }}>
                        {confirmDeleteDay === d.day ? (
                          <>
                            <span style={{ fontSize:".72rem", color:"#e87878", fontFamily:"sans-serif" }}>Delete Day {d.day}?</span>
                            <button onClick={() => removeDay(d.day)}
                              style={{ background:"#3a0a0a", border:"1px solid #dc354566", color:"#e87878",
                                borderRadius:4, padding:".3rem .65rem", fontSize:".72rem", fontFamily:"sans-serif", cursor:"pointer" }}>
                              Yes, delete
                            </button>
                            <button onClick={() => setConfirmDeleteDay(null)}
                              style={{ background:"none", border:"1px solid #2e3a4a", color:"#4e7a9e",
                                borderRadius:4, padding:".3rem .65rem", fontSize:".72rem", fontFamily:"sans-serif", cursor:"pointer" }}>
                              Cancel
                            </button>
                          </>
                        ) : (
                          <button onClick={() => setConfirmDeleteDay(d.day)} disabled={days.length <= 1}
                            style={{ background:"none", border:"1px solid #3a1a1a",
                              color: days.length <= 1 ? "#3d2020" : "#7a3838",
                              borderRadius:4, padding:".3rem .65rem", fontSize:".72rem", fontFamily:"sans-serif",
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
              style={{ background:"none", border:"1px dashed #2e5070", color:"#4e7a9e",
                borderRadius:6, padding:".55rem 1.5rem", fontSize:".78rem",
                fontFamily:"sans-serif", cursor:"pointer", letterSpacing:".05em" }}>
              + Add day at end
            </button>
          </div>
        )}
        </>)}

        {/* ── FUEL TAB ── */}
        {activeTab === "fuel" && (
          <div>
            <div style={{ marginBottom:"1.5rem", padding:"1.25rem", background:"#0d2035", border:"1px solid #1e3a52", borderRadius:6 }}>
              <div style={{ fontSize:".7rem", color:"#c9a84c", letterSpacing:".15em", textTransform:"uppercase", marginBottom:"1rem", fontFamily:"sans-serif" }}>Fuel Plan Summary</div>
              {fuelSummary.map(f => (
                <div key={f.label} style={{ display:"flex", justifyContent:"space-between", padding:".6rem 0", borderBottom:"1px solid #1e3a5240", fontFamily:"sans-serif" }}>
                  <span style={{ fontSize:".85rem", color:"#6b8fa8" }}>{f.label}</span>
                  <span style={{ fontSize:".85rem", color:"#e8dcc8" }}>{f.value}</span>
                </div>
              ))}
            </div>
            <div style={{ padding:"1.25rem", background:"#0d2035", border:"1px solid #e8553844", borderRadius:6, marginBottom:"1rem" }}>
              <div style={{ fontSize:".7rem", color:"#e87758", letterSpacing:".15em", textTransform:"uppercase", marginBottom:".75rem", fontFamily:"sans-serif" }}>⛽ Fuel Stop Details</div>
              {fuelStops.map(s => (
                <div key={s.stop} style={{ marginBottom:"1.25rem", paddingBottom:"1.25rem", borderBottom:"1px solid #1e3a5230" }}>
                  <div style={{ fontSize:".9rem", color:"#e8dcc8", fontFamily:"Georgia,serif", marginBottom:4 }}>{s.stop}</div>
                  <div style={{ fontSize:".8rem", color:"#9ab8d4", fontFamily:"sans-serif", marginBottom:3 }}>{s.marina}</div>
                  <div style={{ fontSize:".75rem", color:"#6b8fa8", fontFamily:"sans-serif", marginBottom:6 }}>VHF: {s.vhf}</div>
                  <div style={{ fontSize:".8rem", color:"#7a9ab8", fontFamily:"sans-serif", fontStyle:"italic" }}>{s.notes}</div>
                </div>
              ))}
            </div>
            <div style={{ padding:".85rem 1rem", background:"#0a1a2a", border:"1px solid #c9a84c33", borderRadius:6, fontSize:".8rem", color:"#8fb0cc", fontFamily:"sans-serif", lineHeight:1.6 }}>
              <strong style={{ color:"#c9a84c" }}>Note:</strong> All calculations assume 15 kts / 33 gal·hr. Running at 20 kts increases consumption ~50–70%. Maintain a 15–20% reserve minimum. Fuel Stop #4 at Victoria on Day 17 is easy insurance — you're stopping there for lunch anyway.
            </div>
          </div>
        )}

        {/* ── TIDES TAB ── */}
        {activeTab === "tides" && (
          <div>
            <div style={{ padding:".85rem 1rem", background:"#1a0a0a", border:"1px solid #dc354566", borderRadius:6, marginBottom:"1.25rem", fontSize:".82rem", color:"#cc8888", fontFamily:"sans-serif", lineHeight:1.6 }}>
              <strong style={{ color:"#e87878" }}>Critical:</strong> This route has two non-negotiable tidal rapids (Malibu and Seymour) and one high-traffic channel (Active Pass). Plan exact passage times the night before using official CHS tables. Cross-check with at least two sources.
            </div>
            {tideWarnings.map(t => (
              <div key={t.passage} style={{ marginBottom:".75rem", padding:"1.1rem 1.25rem", background:"#0d2035", border:"1px solid #dc354533", borderRadius:6 }}>
                <div style={{ fontSize:".9rem", color:"#f5edd8", fontFamily:"Georgia,serif", marginBottom:".4rem" }}>{t.passage}</div>
                <div style={{ fontSize:".82rem", color:"#9ab8d4", fontFamily:"sans-serif", lineHeight:1.55 }}>{t.detail}</div>
              </div>
            ))}
            <div style={{ marginTop:"1.5rem", padding:"1.25rem", background:"#0d2035", border:"1px solid #1e3a52", borderRadius:6 }}>
              <div style={{ fontSize:".7rem", color:"#c9a84c", letterSpacing:".15em", textTransform:"uppercase", marginBottom:".85rem", fontFamily:"sans-serif" }}>Apps & Resources</div>
              {[
                ["Navionics Boating App",      "Best all-in-one: charts, tides, ActiveCaptain community notes"],
                ["XTide / Tides Near Me",       "Precise slack water timing for BC passages"],
                ["tides.gc.ca (CHS)",           "Official Canadian Hydrographic Service tide predictions"],
                ["PredictWind or SailFlow",     "Weather routing — critical for Johnstone Strait & Haro Strait"],
                ["VHF Channel 16",              "Monitor at all times underway; 66A for BC marinas"],
                ["CBP ROAM App (US Customs)",   "Required for US re-entry — register all passengers before departure"],
              ].map(([tool,desc]) => (
                <div key={tool} style={{ display:"flex", gap:".75rem", marginBottom:".7rem", fontFamily:"sans-serif" }}>
                  <span style={{ color:"#c9a84c", flexShrink:0, marginTop:2 }}>◆</span>
                  <div>
                    <div style={{ fontSize:".85rem", color:"#e8dcc8" }}>{tool}</div>
                    <div style={{ fontSize:".78rem", color:"#6b8fa8", marginTop:1 }}>{desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
