import { useState, useEffect, useRef, useCallback } from "react";
import NoteMarkdown from "./NoteMarkdown.jsx";

// ─── Spark icon (Claude brand glyph) ─────────────────────────────────────────
function SparkIcon({ size = 14, color = "currentColor" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" style={{ flexShrink: 0 }}>
      <path d="M7 1.2l1.2 3.6L11.8 6 8.2 7.2 7 10.8 5.8 7.2 2.2 6l3.6-1.2z" fill={color} />
      <circle cx="11.5" cy="2.5" r="0.8" fill={color} />
      <circle cx="2.6" cy="10.6" r="0.6" fill={color} />
    </svg>
  );
}

// ─── Claude badge chip ────────────────────────────────────────────────────────
function ClaudeBadge() {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      padding: "2px 7px 2px 6px", borderRadius: 4,
      background: "var(--accent-soft)", color: "var(--accent)",
      fontSize: 10, fontWeight: 600, letterSpacing: 0.3, textTransform: "uppercase",
    }}>
      <SparkIcon size={11} color="var(--accent)" />
      Claude
    </span>
  );
}

// ─── Starter chip rows ────────────────────────────────────────────────────────
function ChipRow({ label, items, accent, onChipClick }) {
  return (
    <div>
      <div style={{
        fontSize: 10, fontWeight: 600, letterSpacing: 1.2, color: "var(--text-faint)",
        textTransform: "uppercase", marginBottom: 7,
      }}>{label}</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {items.map((chip, i) => (
          <button key={i} onClick={() => onChipClick(chip)} style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            padding: "6px 11px", borderRadius: 7, cursor: "pointer",
            background: accent ? "var(--accent-soft)" : "var(--surface)",
            color: accent ? "var(--accent)" : "var(--text)",
            border: `1px solid ${accent ? "var(--accent-soft)" : "var(--border)"}`,
            fontSize: 12, fontWeight: 500, fontFamily: "inherit", textAlign: "left",
          }}>{chip}</button>
        ))}
      </div>
    </div>
  );
}

// ─── Empty state (no messages yet) ───────────────────────────────────────────
function EmptyState({ tripContext, onChipClick }) {
  const dest = tripContext?.currentDay?.overnight || tripContext?.title || "your trip";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, padding: "4px 0" }}>
      <div style={{ fontSize: 13, color: "var(--text)", lineHeight: 1.55 }}>
        Hi! Here to help plan. Tell me what you're after — places for a day, a full draft, packing list, anything.
      </div>
      <ChipRow label="Plan" accent onChipClick={onChipClick} items={[
        `Draft a day-by-day plan for ${tripContext?.title || "this trip"}`,
        "Suggest activities for an upcoming day",
        "Optimize the route to reduce travel time",
      ]} />
      <ChipRow label="Suggest" onChipClick={onChipClick} items={[
        `Find great restaurants near ${dest}`,
        "What to do on a rainy day",
        `Hidden gems near ${dest}`,
        "Kid-friendly activities",
      ]} />
      <ChipRow label="Learn" onChipClick={onChipClick} items={[
        `Tell me about ${dest}`,
        "Tipping etiquette",
        "Best local food to try",
      ]} />
      <ChipRow label="Pack" onChipClick={onChipClick} items={[
        `Make a packing list for ${tripContext?.title || "this trip"}`,
      ]} />
    </div>
  );
}

// ─── Thread message list ──────────────────────────────────────────────────────
function ThreadBody({ thread, sending, tripContext, onChipClick, scrollRef }) {
  return (
    <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: "14px 16px" }}>
      {thread.length === 0 ? (
        <EmptyState tripContext={tripContext} onChipClick={onChipClick} />
      ) : (
        <>
          {thread.map((msg, i) => (
            <div key={i} style={{ marginBottom: 14 }}>
              {msg.role === "user" ? (
                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                  <div style={{
                    maxWidth: "78%", padding: "9px 13px",
                    borderRadius: 12, borderBottomRightRadius: 4,
                    background: "var(--accent)", color: "#fff",
                    fontSize: 13, lineHeight: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-word",
                  }}>{msg.content}</div>
                </div>
              ) : (
                <div>
                  <div style={{
                    display: "flex", alignItems: "center", gap: 8, marginBottom: 5,
                  }}>
                    <ClaudeBadge />
                  </div>
                  <div style={{ fontSize: 13, color: "var(--text)", lineHeight: 1.6 }}>
                    <NoteMarkdown>{msg.content}</NoteMarkdown>
                  </div>
                </div>
              )}
            </div>
          ))}
          {sending && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
                <ClaudeBadge />
                <span style={{ fontSize: 10.5, color: "var(--text-faint)", letterSpacing: 0.3 }}>thinking…</span>
              </div>
              <div style={{ display: "flex", gap: 4, paddingLeft: 2 }}>
                {[0, 1, 2].map(n => (
                  <div key={n} style={{
                    width: 6, height: 6, borderRadius: "50%", background: "var(--text-faint)",
                    animation: `concierge-pulse 1.2s ease-in-out ${n * 0.2}s infinite`,
                  }} />
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Input composer ───────────────────────────────────────────────────────────
function InputBar({ onSend, disabled, placeholder, compact = false }) {
  const [text, setText] = useState("");
  const taRef = useRef(null);

  const submit = useCallback(() => {
    if (!text.trim() || disabled) return;
    onSend(text.trim());
    setText("");
    if (taRef.current) taRef.current.style.height = "auto";
  }, [text, disabled, onSend]);

  function handleKey(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  function handleInput(e) {
    setText(e.target.value);
    const ta = taRef.current;
    if (ta) { ta.style.height = "auto"; ta.style.height = Math.min(ta.scrollHeight, 120) + "px"; }
  }

  return (
    <div style={{
      padding: compact ? "8px 12px 10px" : "12px 14px",
      borderTop: "1px solid var(--border)", background: "var(--surface)", flexShrink: 0,
    }}>
      <div style={{
        display: "flex", alignItems: "flex-end", gap: 8,
        padding: "8px 10px 8px 12px", borderRadius: compact ? 999 : 9,
        background: "var(--surface2)", border: "1px solid var(--border)",
      }}>
        {!compact && <span style={{ color: "var(--accent)", paddingBottom: 1 }}><SparkIcon /></span>}
        <textarea
          ref={taRef}
          value={text}
          onChange={handleInput}
          onKeyDown={handleKey}
          placeholder={placeholder || "Ask Claude…"}
          disabled={disabled}
          rows={1}
          style={{
            flex: 1, background: "transparent", border: "none", outline: "none",
            resize: "none", fontSize: 13, fontFamily: "inherit", color: "var(--text)",
            lineHeight: 1.5, padding: 0, minHeight: 20, maxHeight: 120, overflowY: "auto",
          }}
        />
        <button
          onClick={submit}
          disabled={disabled || !text.trim()}
          style={{
            width: 28, height: 28, borderRadius: 7, border: "none", cursor: "pointer",
            background: disabled || !text.trim() ? "var(--border)" : "var(--accent)",
            color: "#fff", display: "flex", alignItems: "center", justifyContent: "center",
            flexShrink: 0, transition: "background 0.15s",
          }}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M2 9.5L10 6 2 2.5l1.2 3.2L7 6l-3.8.3z" fill="currentColor" />
          </svg>
        </button>
      </div>
      {!compact && (
        <div style={{ fontSize: 10.5, color: "var(--text-faint)", marginTop: 6, lineHeight: 1.4 }}>
          Knows your trip, travelers, and saved places. Won't book or pay.
        </div>
      )}
    </div>
  );
}

// ─── No API key prompt ────────────────────────────────────────────────────────
function NoApiKeyPrompt() {
  return (
    <div style={{
      flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
      padding: "24px 20px", textAlign: "center",
    }}>
      <div>
        <div style={{ marginBottom: 10 }}>
          <SparkIcon size={28} color="var(--text-faint)" />
        </div>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", marginBottom: 6 }}>
          Concierge not configured
        </div>
        <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
          Add an Anthropic API key in{" "}
          <strong>Settings → Integrations</strong> to enable the Claude concierge.
        </div>
      </div>
    </div>
  );
}

// ─── New conversation confirm ─────────────────────────────────────────────────
function NewConversationButton({ thread, onClear }) {
  const [confirming, setConfirming] = useState(false);

  if (thread.length <= 2) {
    return (
      <button onClick={onClear} title="New conversation" style={iconBtn}>
        <RefreshIcon />
      </button>
    );
  }

  if (confirming) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>Clear thread?</span>
        <button onClick={() => { onClear(); setConfirming(false); }} style={{
          ...iconBtn, background: "#fef2f2", border: "1px solid #fecaca", color: "#dc2626",
        }}>✓</button>
        <button onClick={() => setConfirming(false)} style={iconBtn}>✕</button>
      </div>
    );
  }

  return (
    <button onClick={() => setConfirming(true)} title="New conversation" style={iconBtn}>
      <RefreshIcon />
    </button>
  );
}

const iconBtn = {
  width: 26, height: 26, borderRadius: 5, background: "transparent",
  border: "1px solid var(--border)", color: "var(--text-faint)", cursor: "pointer",
  display: "inline-flex", alignItems: "center", justifyContent: "center",
  padding: 0,
};

function RefreshIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <path d="M2 6a4 4 0 016.5-3.1L10 1.5M10 6a4 4 0 01-6.5 3.1L2 10.5M10 1.5v2.5h-2.5M2 10.5v-2.5h2.5"
        stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// 1. Desktop right rail
// ═════════════════════════════════════════════════════════════════════════════
export function ConciergeRail({ open, onClose, thread, sending, onSend, onClearThread, tripContext, hasApiKey }) {
  const scrollRef = useRef(null);
  const placeholder = thread.length > 0
    ? "Ask a follow-up…"
    : `Ask Claude about ${tripContext?.title || "your trip"}…`;

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [thread, sending]);

  function handleChipClick(text) { onSend(text); }

  return (
    <aside style={{
      position: "fixed", top: 0, right: 0, bottom: 0,
      width: open ? 380 : 0,
      overflow: "hidden",
      transition: "width 260ms cubic-bezier(0.22,1,0.36,1)",
      borderLeft: open ? "1px solid var(--border)" : "none",
      display: "flex",
      background: "var(--surface2)",
      zIndex: 1100,
    }}>
      <div style={{
        width: 380, display: "flex", flexDirection: "column",
        height: "100%", background: "var(--surface2)", overflow: "hidden",
      }}>
        {/* Header */}
        <div style={{
          padding: "13px 14px", display: "flex", alignItems: "center", gap: 8,
          borderBottom: "1px solid var(--border)", background: "var(--surface)", flexShrink: 0,
        }}>
          <ClaudeBadge />
          <div style={{ flex: 1, fontSize: 12.5, fontWeight: 600, color: "var(--text)" }}>Concierge</div>
          <NewConversationButton thread={thread} onClear={onClearThread} />
          <button onClick={onClose} title="Close" style={iconBtn}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M8 4l-4 4M4 4l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Body */}
        {hasApiKey ? (
          <ThreadBody
            thread={thread} sending={sending} tripContext={tripContext}
            onChipClick={handleChipClick} scrollRef={scrollRef}
          />
        ) : (
          <NoApiKeyPrompt />
        )}

        {/* Input */}
        {hasApiKey && (
          <InputBar
            onSend={onSend} disabled={sending} placeholder={placeholder}
          />
        )}
      </div>
    </aside>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// 2. ⌘K command bar
// ═════════════════════════════════════════════════════════════════════════════
export function ConciergeBar({ open, onClose, thread, sending, onSend, onClearThread, tripContext, hasApiKey }) {
  const scrollRef = useRef(null);
  const placeholder = thread.length > 0
    ? "Ask a follow-up…"
    : `Ask Claude about ${tripContext?.title || "your trip"}…`;

  useEffect(() => {
    if (!open) return;
    const handler = e => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    document.addEventListener("keydown", handler, true);
    return () => document.removeEventListener("keydown", handler, true);
  }, [open, onClose]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [thread, sending, open]);

  // Lock body scroll while open
  useEffect(() => {
    if (open) { document.body.style.overflow = "hidden"; }
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  if (!open) return null;

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 2000,
      background: "rgba(14,16,20,0.42)",
      display: "flex", justifyContent: "center", alignItems: "flex-start",
      padding: "64px 24px 24px",
    }}>
      {/* Scrim */}
      <div onClick={onClose} style={{ position: "absolute", inset: 0 }} />

      {/* Panel */}
      <div style={{
        position: "relative", zIndex: 1,
        width: "min(680px, calc(100vw - 48px))",
        maxHeight: "calc(100vh - 128px)",
        borderRadius: 14, background: "var(--surface)", border: "1px solid var(--border)",
        boxShadow: "0 24px 64px rgba(0,0,0,0.25), 0 4px 12px rgba(0,0,0,0.08)",
        display: "flex", flexDirection: "column", overflow: "hidden",
      }}>
        {/* Header */}
        <div style={{
          padding: "13px 18px", display: "flex", alignItems: "center", gap: 10,
          borderBottom: "1px solid var(--border)", flexShrink: 0,
        }}>
          <ClaudeBadge />
          <div style={{ flex: 1, fontSize: 12, color: "var(--text-muted)" }}>
            Concierge
            {tripContext?.title && (
              <span style={{ color: "var(--text)", fontWeight: 500 }}> · {tripContext.title}</span>
            )}
            {tripContext?.currentDay && (
              <span> · Day {tripContext.currentDay.day}</span>
            )}
          </div>
          <NewConversationButton thread={thread} onClear={onClearThread} />
          <span style={{
            display: "inline-flex", alignItems: "center", gap: 3,
            padding: "3px 6px", borderRadius: 4, background: "var(--surface2)",
            border: "1px solid var(--border-soft)", color: "var(--text-faint)",
            fontSize: 10.5, fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace",
          }}>⌘K</span>
        </div>

        {/* Body */}
        {hasApiKey ? (
          <ThreadBody
            thread={thread} sending={sending} tripContext={tripContext}
            onChipClick={text => onSend(text)} scrollRef={scrollRef}
          />
        ) : (
          <NoApiKeyPrompt />
        )}

        {/* Input */}
        {hasApiKey && <InputBar onSend={onSend} disabled={sending} placeholder={placeholder} />}

        {/* Hint strip */}
        <div style={{
          padding: "6px 14px", background: "var(--surface2)", borderTop: "1px solid var(--border-soft)",
          fontSize: 10.5, color: "var(--text-faint)", display: "flex", alignItems: "center", gap: 12,
          flexShrink: 0,
        }}>
          {[["↵", "send"], ["⇧↵", "new line"], ["esc", "dismiss"]].map(([key, label]) => (
            <span key={key}>
              <kbd style={{
                fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace",
                background: "var(--surface)", border: "1px solid var(--border)",
                borderRadius: 3, padding: "0 4px", fontSize: 10,
              }}>{key}</kbd>{" "}{label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// 3. Mobile peek sheet
// ═════════════════════════════════════════════════════════════════════════════
export function PeekSheet({ peekState, onPeekStateChange, thread, sending, onSend, onClearThread, tripContext, hasApiKey }) {
  const scrollRef = useRef(null);
  const grabberRef = useRef(null);
  const touchStartY = useRef(null);
  const touchStartState = useRef(null);
  const isMobile = typeof window !== "undefined" && window.innerWidth <= 640;

  const isPeek = peekState === "peek";
  const isHalf = peekState === "half";
  const isFull = peekState === "full";

  const heights = { peek: 64, half: "55vh", full: "95vh" };
  const scrims  = { peek: 0, half: 0.28, full: 0.55 };

  const placeholder = thread.length > 0
    ? "Ask a follow-up…"
    : tripContext?.currentDay
      ? `Ask Claude about Day ${tripContext.currentDay.day}…`
      : `Ask Claude about ${tripContext?.title || "your trip"}…`;

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [thread, sending, peekState]);

  // Touch drag on grabber
  useEffect(() => {
    const el = grabberRef.current;
    if (!el) return;
    function onStart(e) {
      touchStartY.current = e.touches[0].clientY;
      touchStartState.current = peekState;
    }
    function onEnd(e) {
      if (touchStartY.current === null) return;
      const dy = touchStartY.current - e.changedTouches[0].clientY; // positive = dragged up
      const state = touchStartState.current;
      touchStartY.current = null;
      if (Math.abs(dy) < 8) {
        // tap
        if (state === "peek") onPeekStateChange("half");
        return;
      }
      if (dy > 40) {
        if (state === "peek") onPeekStateChange("half");
        else if (state === "half") onPeekStateChange("full");
      } else if (dy < -40) {
        if (state === "full") onPeekStateChange("half");
        else if (state === "half") onPeekStateChange("peek");
      }
    }
    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchend", onEnd, { passive: true });
    return () => { el.removeEventListener("touchstart", onStart); el.removeEventListener("touchend", onEnd); };
  }, [peekState, onPeekStateChange]);

  // Don't render on desktop
  if (!isMobile) return null;

  return (
    <>
      {/* CSS for pulse animation */}
      <style>{`
        @keyframes concierge-pulse {
          0%, 100% { opacity: 0.3; transform: scale(0.8); }
          50% { opacity: 1; transform: scale(1); }
        }
      `}</style>

      {/* Scrim */}
      <div
        onClick={() => !isPeek && onPeekStateChange("peek")}
        style={{
          position: "fixed", inset: 0, zIndex: 1490,
          background: `rgba(10,12,16,${scrims[peekState]})`,
          pointerEvents: isPeek ? "none" : "auto",
          transition: "background 240ms ease",
        }}
      />

      {/* Sheet */}
      <div style={{
        position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 1500,
        height: heights[peekState],
        background: "var(--surface)",
        borderTopLeftRadius: isPeek ? 16 : 20,
        borderTopRightRadius: isPeek ? 16 : 20,
        borderTop: "1px solid var(--border)",
        borderLeft: "1px solid var(--border)",
        borderRight: "1px solid var(--border)",
        boxShadow: isPeek
          ? "0 -8px 24px rgba(0,0,0,0.08)"
          : "0 -16px 48px rgba(0,0,0,0.20)",
        display: "flex", flexDirection: "column", overflow: "hidden",
        transition: "height 280ms cubic-bezier(0.22,1,0.36,1)",
      }}>
        {/* Grabber + peek bar */}
        <div
          ref={grabberRef}
          onClick={() => isPeek && onPeekStateChange("half")}
          style={{
            cursor: "pointer", flexShrink: 0,
            padding: isPeek ? "6px 12px 8px" : "8px 14px 10px",
            display: "flex", flexDirection: "column", alignItems: "center",
            borderBottom: isPeek ? "none" : "1px solid #e2e5ea",
          }}
        >
          <div style={{
            width: isPeek ? 32 : 40, height: 4, borderRadius: 2,
            background: isPeek ? "var(--border-soft)" : "var(--border)", marginBottom: 8,
          }} />
          <div style={{ display: "flex", alignItems: "center", gap: 10, width: "100%" }}>
            {/* Spark tile */}
            <div style={{
              width: 30, height: 30, borderRadius: 8,
              background: "var(--accent)", color: "#fff", flexShrink: 0,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <SparkIcon size={14} color="#fff" />
            </div>

            {isPeek ? (
              <div style={{
                flex: 1, padding: "7px 12px", borderRadius: 999,
                background: "var(--surface2)", border: "1px solid var(--border-soft)",
                fontSize: 13, color: "var(--text-faint)",
              }}>
                {placeholder}
              </div>
            ) : (
              <>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: -0.1 }}>Concierge</div>
                  {tripContext?.title && (
                    <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 1 }}>
                      {tripContext.title}{tripContext.currentDay ? ` · Day ${tripContext.currentDay.day}` : ""}
                    </div>
                  )}
                </div>
                {isFull && (
                  <button onClick={e => { e.stopPropagation(); onPeekStateChange("half"); }} style={iconBtn}>
                    <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
                      <path d="M2 4l3.5 3 3.5-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                )}
                <NewConversationButton thread={thread} onClear={onClearThread} />
              </>
            )}
          </div>
        </div>

        {/* Content (hidden when peek) */}
        {!isPeek && (
          <>
            {hasApiKey ? (
              <ThreadBody
                thread={thread} sending={sending} tripContext={tripContext}
                onChipClick={text => { onSend(text); }} scrollRef={scrollRef}
              />
            ) : (
              <NoApiKeyPrompt />
            )}
            {hasApiKey && (
              <InputBar
                onSend={text => { onSend(text); if (!isFull) onPeekStateChange("full"); }}
                disabled={sending}
                placeholder={placeholder}
                compact
              />
            )}
          </>
        )}
      </div>

      {/* Pulse animation for dots */}
      <style>{`
        @keyframes concierge-pulse {
          0%, 100% { opacity: 0.3; transform: scale(0.8); }
          50% { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </>
  );
}

// ─── "Ask Claude" toggle button for desktop header ────────────────────────────
export function ConciergeToggleButton({ open, onClick }) {
  return (
    <button
      onClick={onClick}
      title={open ? "Close concierge" : "Ask Claude (⌘K)"}
      style={{
        display: "inline-flex", alignItems: "center", gap: 6,
        padding: "5px 10px 5px 8px", borderRadius: 7, cursor: "pointer",
        background: open ? "var(--accent-soft)" : "transparent",
        color: open ? "var(--accent)" : "var(--text-muted)",
        border: `1px solid ${open ? "#c7ddf0" : "var(--border)"}`,
        fontSize: 12, fontWeight: 500, fontFamily: "inherit",
        transition: "background 0.15s, color 0.15s",
      }}
    >
      <SparkIcon size={13} color={open ? "var(--accent)" : "var(--text-faint)"} />
      {open ? "Close" : "Ask Claude"}
    </button>
  );
}
