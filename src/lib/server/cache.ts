import type { LookupResponse, EmailLookupResponse } from "../types";
import { phoneCacheConfig, emailCacheConfig, type CacheConfig } from "./config";

// ── Result caches ────────────────────────────────────────────────────────────
// Both lookup caches live here (rather than one in a route module) so that a
// single call can invalidate every cached result. That matters because a cached
// result is only valid for the API-key set that produced it: adding a key must
// not keep serving the thinner keyless answer for the rest of the TTL.

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

/** A fixed-capacity, TTL'd, insertion-ordered cache. */
class ResultCache<T extends { cachedAt?: number }> {
  private readonly map = new Map<string, CacheEntry<T>>();

  constructor(private readonly config: () => CacheConfig) {}

  get(key: string): T | null {
    const entry = this.map.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.map.delete(key);
      return null;
    }
    return entry.data;
  }

  set(key: string, data: T): void {
    const { ttlMs, maxEntries } = this.config();
    // Evict the oldest inserted entry when at capacity. size >= maxEntries (≥1)
    // guarantees at least one key, so the iterator always yields one.
    if (this.map.size >= maxEntries && !this.map.has(key)) {
      this.map.delete(this.map.keys().next().value!);
    }
    this.map.set(key, {
      data: { ...data, cachedAt: Date.now() },
      expiresAt: Date.now() + ttlMs,
    });
  }

  clear(): void {
    this.map.clear();
  }

  get size(): number {
    return this.map.size;
  }
}

const phone = new ResultCache<LookupResponse>(phoneCacheConfig);
const email = new ResultCache<EmailLookupResponse>(emailCacheConfig);

export function getCached(e164: string): LookupResponse | null {
  return phone.get(e164);
}

export function setCached(e164: string, data: LookupResponse): void {
  phone.set(e164, data);
}

export function getCachedEmail(address: string): EmailLookupResponse | null {
  return email.get(address);
}

export function setCachedEmail(address: string, data: EmailLookupResponse): void {
  email.set(address, data);
}

/**
 * Drop every cached result.
 *
 * Called whenever the configured API-key set changes (see keyStore). A result
 * fetched with no keys is not a valid answer once a key exists — without this,
 * adding a key in the UI appeared to do nothing until the 24 h TTL expired.
 *
 * Only the UI key endpoints can change keys on a running process; keys supplied
 * via .env.local need a restart, which empties these in-memory maps anyway.
 */
export function clearAllCaches(): void {
  phone.clear();
  email.clear();
}

/** Observability for /api/sources — entry counts, never contents. */
export function cacheStats(): { phone: number; email: number } {
  return { phone: phone.size, email: email.size };
}
