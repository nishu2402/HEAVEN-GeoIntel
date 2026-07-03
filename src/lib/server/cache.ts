import type { LookupResponse } from "../types";

const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const MAX_SIZE = 1000; // cap memory — evict oldest entry when full

interface CacheEntry {
  data: LookupResponse;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

export function getCached(e164: string): LookupResponse | null {
  const entry = cache.get(e164);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(e164);
    return null;
  }
  return entry.data;
}

export function setCached(e164: string, data: LookupResponse): void {
  // Evict the oldest inserted entry when at capacity
  if (cache.size >= MAX_SIZE && !cache.has(e164)) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey !== undefined) cache.delete(oldestKey);
  }
  cache.set(e164, {
    data: { ...data, cachedAt: Date.now() },
    expiresAt: Date.now() + TTL_MS,
  });
}
