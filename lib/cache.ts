import type { LookupResponse } from "./types";

const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

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
  cache.set(e164, {
    data: { ...data, cachedAt: Date.now() },
    expiresAt: Date.now() + TTL_MS,
  });
}
