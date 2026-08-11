"use client";

import { useState, useSyncExternalStore } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Clock, Trash2, ChevronRight, ChevronDown } from "lucide-react";
import type { HistoryEntry } from "@/lib/types";

const STORAGE_KEY = "heaven-geointel-history";
const HISTORY_EVENT = "hv-history-changed";
const MAX_ENTRIES = 20;
const EMPTY: HistoryEntry[] = [];

interface Props {
  onSelect: (e164: string) => void;
  currentE164?: string;
}

// ── External-store plumbing ──────────────────────────────────────────────────
// History is persisted in localStorage; the sidebar reads it via
// useSyncExternalStore. getSnapshot must return a STABLE reference when the raw
// string is unchanged (React compares with Object.is), so we memoise the parsed
// array against the raw JSON — re-parsing on every render would loop forever.
let snapRaw: string | null = null;
let snapParsed: HistoryEntry[] = EMPTY;
function readHistory(): HistoryEntry[] {
  let raw: string | null = null;
  try { raw = localStorage.getItem(STORAGE_KEY); } catch { raw = null; }
  if (raw === snapRaw) return snapParsed;
  snapRaw = raw;
  try {
    const parsed = raw ? JSON.parse(raw) : [];
    snapParsed = Array.isArray(parsed) ? parsed : EMPTY;
  } catch {
    snapParsed = EMPTY;
  }
  return snapParsed;
}
function subscribeHistory(cb: () => void): () => void {
  window.addEventListener("storage", cb);       // cross-tab writes
  window.addEventListener("focus", cb);          // returning to the tab
  window.addEventListener(HISTORY_EVENT, cb);    // same-tab writes (instant)
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener("focus", cb);
    window.removeEventListener(HISTORY_EVENT, cb);
  };
}
function notifyHistoryChanged(): void {
  window.dispatchEvent(new CustomEvent(HISTORY_EVENT));
}

export function saveToHistory(entry: HistoryEntry): void {
  /* v8 ignore next -- SSR guard; saveToHistory is only ever called from client event handlers */
  if (typeof window === "undefined") return;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    // Tolerate a corrupt existing blob the same way readHistory does: start fresh
    // rather than letting a bad parse abort the save (which would silently drop
    // every future lookup until localStorage is cleared).
    let existing: HistoryEntry[] = [];
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) existing = parsed;
      } catch { /* corrupt existing history → overwrite with a clean array */ }
    }
    const filtered = existing.filter((e) => e.e164 !== entry.e164);
    const updated = [entry, ...filtered].slice(0, MAX_ENTRIES);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    notifyHistoryChanged(); // refresh any open sidebar in this tab immediately
  } catch {
    // localStorage unavailable
  }
}

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function HistorySidebar({ onSelect, currentE164 }: Props) {
  // getServerSnapshot → EMPTY so SSR + first paint match; the real persisted
  // history is read after hydration and on every storage/focus/same-tab change.
  const history = useSyncExternalStore(subscribeHistory, readHistory, () => EMPTY);
  const [open, setOpen] = useState(true);

  const clearHistory = () => {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // localStorage unavailable — the store re-read below still empties the view
    }
    notifyHistoryChanged();
  };

  if (history.length === 0) return null;

  return (
    <div className="terminal-card text-xs font-mono">
      <button
        onClick={() => setOpen((p) => !p)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-[#00ff41]/5 transition-colors"
      >
        <div className="flex items-center gap-2 text-[#00ff41]/60 uppercase tracking-widest text-[13px]">
          <Clock className="w-3 h-3" />[ RECENT QUERIES ] ({history.length})
        </div>
        {open ? <ChevronDown className="w-3 h-3 text-[#00ff41]/60" /> : <ChevronRight className="w-3 h-3 text-[#00ff41]/60" />}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="border-t border-[#00ff41]/15 max-h-56 overflow-y-auto">
              {history.map((entry) => (
                <button
                  key={`${entry.e164}-${entry.timestamp}`}
                  onClick={() => onSelect(entry.e164)}
                  className={`w-full text-left px-4 py-2.5 flex items-center justify-between hover:bg-[#00ff41]/[0.08] transition-colors border-b border-[#00ff41]/5 last:border-b-0 ${
                    entry.e164 === currentE164 ? "bg-[#00ff41]/10" : ""
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="text-base">{entry.flagEmoji}</span>
                    <span className="text-[#00ff41] truncate">{entry.e164}</span>
                  </div>
                  <span className="text-[#00ff41]/55 shrink-0 ml-2">{formatRelativeTime(entry.timestamp)}</span>
                </button>
              ))}
            </div>

            <div className="border-t border-[#00ff41]/15 px-4 py-2.5">
              <button
                onClick={clearHistory}
                className="flex items-center gap-1.5 text-[#ff3e3e]/92 hover:text-[#ff3e3e] transition-colors text-[13px] uppercase tracking-widest"
              >
                <Trash2 className="w-3 h-3" /> CLEAR HISTORY
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
