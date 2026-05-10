const WINDOW_MS = 60_000; // 1 minute
const MAX_REQUESTS = 10;

interface Bucket {
  count: number;
  windowStart: number;
}

const buckets = new Map<string, Bucket>();

export function checkRateLimit(ip: string): { allowed: boolean; remaining: number } {
  const now = Date.now();
  const bucket = buckets.get(ip);

  if (!bucket || now - bucket.windowStart > WINDOW_MS) {
    buckets.set(ip, { count: 1, windowStart: now });
    return { allowed: true, remaining: MAX_REQUESTS - 1 };
  }

  if (bucket.count >= MAX_REQUESTS) {
    return { allowed: false, remaining: 0 };
  }

  bucket.count += 1;
  return { allowed: true, remaining: MAX_REQUESTS - bucket.count };
}
