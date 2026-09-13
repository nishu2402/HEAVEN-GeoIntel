// ── Bounded fan-out ──────────────────────────────────────────────────────────
//
// `FANOUT_CONCURRENCY` was documented, defaulted and tested for three releases
// while being imported by nothing: the username sweep fired every site at once
// and the domain fanout had no cap at all. That is survivable at 40 sites and
// is not at 670, where an unbounded sweep opens hundreds of sockets, trips
// per-IP throttles on the way through, and reads to the far end as a scan.
//
// This is the missing piece: a worker pool of exactly `limit` slots, plus an
// optional per-key serialisation so two rows that share a HOST are never in
// flight together. That second part is politeness rather than throughput —
// WhatsMyName carries several entries per site (three WordPress.com rows, three
// Pornhub rows), and hitting one host three times in the same millisecond is
// what earns a block for the whole sweep.
//
// Rejections propagate, exactly like `Promise.all`. Every caller here hands in a
// function that catches its own failures and resolves to an "unknown" row, which
// is what keeps one dead site from failing a sweep.

/** The host part of a URL, or null when it will not parse (never throws). */
export function hostKey(url: string): string | null {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * `items.map(fn)` with at most `limit` calls in flight.
 *
 * Results come back in INPUT order regardless of completion order, so a caller
 * can zip them against the input list. `key`, when supplied, names a resource
 * that must not be used concurrently: items sharing a key run one after another
 * while everything else keeps overlapping.
 */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
  key?: (item: T) => string | null,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  if (items.length === 0) return out;

  const width = Math.max(1, Math.min(Math.trunc(limit), items.length));
  const chains = new Map<string, Promise<void>>();
  let next = 0;

  const runOne = async (index: number): Promise<void> => {
    const item = items[index] as T;
    const k = key ? key(item) : null;
    if (k === null) {
      out[index] = await fn(item, index);
      return;
    }
    // Registered synchronously, before the first await, so two workers that
    // pick up the same host cannot both read an empty chain and then race.
    const mine = (chains.get(k) ?? Promise.resolve()).then(async () => {
      out[index] = await fn(item, index);
    });
    chains.set(k, mine.catch(() => {}));
    await mine;
  };

  const worker = async (): Promise<void> => {
    for (let index = next++; index < items.length; index = next++) {
      await runOne(index);
    }
  };

  await Promise.all(Array.from({ length: width }, () => worker()));
  return out;
}
