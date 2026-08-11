// Shared test helpers for jsdom component tests.
//
// The jsdom environment configured here provides window/CustomEvent but NOT a
// working localStorage, so component tests that touch persisted client state
// install this minimal in-memory Storage first.

// cmdk (and other UI libs) call browser APIs jsdom doesn't implement:
// ResizeObserver and Element.scrollIntoView. No-op stubs are enough for
// interaction tests.
export function installResizeObserver(): void {
  class RO {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as unknown as { ResizeObserver: typeof RO }).ResizeObserver = RO;
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
}

// ── Rate-limit helpers for route tests ───────────────────────────────────────
// The shipped default is 60 requests/minute per client, which would make an
// "exhaust the bucket" test do 60 round-trips. These helpers pin a small limit
// for the duration of a test and hand out distinct client identities so a test
// can prove that one client's exhaustion doesn't affect another's.

import { CLIENT_ID_COOKIE, resetRateLimit } from "@/lib/server/rateLimit";
import { clearAllCaches } from "@/lib/server/cache";
import { resetBudgets } from "@/lib/server/upstreamBudget";

/** Pin RATE_LIMIT_MAX (and clear all buckets) for one test. */
export function useRateLimit(max: number): void {
  process.env.RATE_LIMIT_MAX = String(max);
  resetRateLimit();
}

/** Undo useRateLimit — call from afterEach. */
export function restoreRateLimit(): void {
  delete process.env.RATE_LIMIT_MAX;
  delete process.env.RATE_LIMIT_GLOBAL_MAX;
  resetRateLimit();
}

/** A Cookie header that puts a request in its own rate-limit bucket. */
export function clientCookie(id: string): string {
  return `${CLIENT_ID_COOKIE}=${id.padEnd(16, "0").slice(0, 32)}`;
}

/**
 * Reset the two module-level maps a route test can otherwise inherit.
 *
 * Both are process-wide by design — that is what makes them useful in
 * production — and both silently break test isolation. The result cache lets a
 * successful lookup in one test satisfy a later test that stubbed every
 * upstream to fail; the upstream budget lets a stubbed 429 suppress a real
 * call several tests later. Neither shows up as a clear failure, only as a
 * test that passes or fails depending on what ran before it.
 */
export function resetServerState(): void {
  clearAllCaches();
  resetBudgets();
}

export function installMemoryLocalStorage(): void {
  const store = new Map<string, string>();
  const mem: Storage = {
    get length() { return store.size; },
    clear: () => store.clear(),
    getItem: (k) => (store.has(k) ? store.get(k)! : null),
    key: (i) => Array.from(store.keys())[i] ?? null,
    removeItem: (k) => { store.delete(k); },
    setItem: (k, v) => { store.set(k, String(v)); },
  };
  Object.defineProperty(globalThis, "localStorage", { value: mem, configurable: true, writable: true });
}
