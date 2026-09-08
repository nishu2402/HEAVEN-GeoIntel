// ── The one update check, shared by every part of the UI ─────────────────────
//
// The header button and the top-of-page banner must never disagree about
// whether an update exists, and must never each fire their own request. So the
// check lives here once, as a tiny external store: the first component to mount
// bootstraps it (from a fresh localStorage answer, else one call to
// `/api/version`), and every component subscribes to the same result. Mount a
// second consumer and it reflects the first one's answer with no extra network.
//
// Like the endpoint behind it, this store never invents a version. It only ever
// holds what `/api/version` returned; a transport failure sets `failed` and
// leaves the last good `info` untouched, so a blip cannot fabricate an update.

import { useSyncExternalStore, useEffect } from "react";
import type { UpdateInfo } from "./semver";

/** Same key and window the server uses to stay gentle on the GitHub quota. */
const CACHE_KEY = "hv:update:v1";
const THROTTLE_MS = 6 * 60 * 60 * 1000; // 6h between automatic checks

export interface UpdateState {
  /** The last answer from `/api/version`, or null before the first check lands. */
  info: UpdateInfo | null;
  /** A check is in flight. */
  loading: boolean;
  /** The endpoint itself could not be reached (distinct from info.ok === false). */
  failed: boolean;
}

const INITIAL: UpdateState = { info: null, loading: false, failed: false };

let state: UpdateState = INITIAL;
let started = false;
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((l) => l());
}

function set(patch: Partial<UpdateState>): void {
  state = { ...state, ...patch };
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): UpdateState {
  return state;
}

/**
 * Server render has no store yet: it always sees the neutral initial state, so
 * the banner is absent and the button unadorned in the first HTML — exactly what
 * the client renders before its mount effect runs, which keeps hydration clean.
 */
export function getServerSnapshot(): UpdateState {
  return INITIAL;
}

interface Cached {
  at: number;
  info: UpdateInfo;
}

function readCache(): Cached | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Cached;
    if (parsed && typeof parsed.at === "number" && parsed.info) return parsed;
    return null;
  } catch {
    return null;
  }
}

/**
 * Ask `/api/version`. `force` (the "Check for updates" button) skips nothing on
 * the client — the server owns the one-hour cache — but does add `?force=1` so
 * the server bypasses its own cache. A non-2xx or a network error becomes
 * `failed`, never a silent "up to date".
 */
export function check(force: boolean): void {
  set({ loading: true, failed: false });
  fetch(force ? "/api/version?force=1" : "/api/version")
    .then((r) => {
      if (!r.ok) throw new Error(String(r.status));
      return r.json();
    })
    .then((j: UpdateInfo) => {
      set({ info: j, loading: false });
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), info: j }));
      } catch {
        /* unwritable store (private mode, quota): next load just checks again */
      }
    })
    .catch(() => set({ failed: true, loading: false }));
}

/**
 * Run the automatic check exactly once for the whole page, no matter how many
 * consumers mount. A fresh cached answer is adopted without a request so the
 * badge and banner are correct the instant the page loads.
 */
function bootstrap(): void {
  if (started) return;
  started = true;
  const cached = readCache();
  if (cached && Date.now() - cached.at < THROTTLE_MS) set({ info: cached.info });
  else check(false);
}

/**
 * Subscribe a component to the shared check and kick off the one-time bootstrap.
 * Returns the live state plus `check` for the manual "Check for updates" button.
 */
export function useUpdateCheck(): UpdateState & { check: (force: boolean) => void } {
  const snap = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  useEffect(() => {
    bootstrap();
  }, []);
  return { ...snap, check };
}

/**
 * Reset the module-level store between tests: the shared state, the run-once
 * latch, and any lingering subscriptions would otherwise leak across cases.
 */
export function resetUpdateStoreForTests(): void {
  state = INITIAL;
  started = false;
  listeners.clear();
}
