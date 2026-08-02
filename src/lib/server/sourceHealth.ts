// ── Uniform source provenance + last-observed health ─────────────────────────
//
// Before this module each route reported source outcomes in its own shape: the
// phone route a keyed object of `{ok, error}`, the IP route an array with
// timing, the email route a mix of both at the top level. Nothing could consume
// them generically, and /api/sources could only report which keys were
// CONFIGURED — never whether a source had actually answered.
//
// Every lookup route now also emits the same `SourceProvenance[]` under
// `sourceHealth`, and every observation is recorded here so /api/sources can
// report what really happened on the last call.

import { describeError } from "./fetchSafe";
import type { SourceProvenance } from "../types";

export type { SourceProvenance };

/** The minimal envelope every keyed source already returns. */
interface Envelope {
  ok: boolean;
  error?: string;
}

/**
 * Run a set of named source calls in parallel, timing each one and converting a
 * rejection into a failed envelope. Replaces the per-route
 * `Promise.allSettled` + one ternary per source.
 */
export async function settleSources<T extends Record<string, Promise<Envelope>>>(
  jobs: T
): Promise<{ results: { [K in keyof T]: Awaited<T[K]> }; health: SourceProvenance[] }> {
  const names = Object.keys(jobs) as (keyof T & string)[];

  const settled = await Promise.all(
    names.map(async (name) => {
      const at = Date.now();
      try {
        return { name, value: await jobs[name], ms: Date.now() - at };
      } catch (reason) {
        return { name, value: { ok: false, error: describeError(reason) }, ms: Date.now() - at };
      }
    })
  );

  const results = {} as Record<string, Envelope>;
  const health: SourceProvenance[] = [];
  for (const { name, value, ms } of settled) {
    results[name] = value;
    health.push(provenance(name, value, ms));
  }
  return {
    results: results as { [K in keyof T]: Awaited<T[K]> },
    health: markAll(health),
  };
}

/**
 * Time a source that resolves to plain data rather than an `{ok}` envelope
 * (the DNS/WHOIS/subdomain fetchers, the username sweep). `ok` decides from the
 * value whether the source actually answered.
 */
export async function timedValue<T>(
  source: string,
  job: Promise<T>,
  ok: (value: T) => boolean
): Promise<{ value: T; provenance: SourceProvenance }> {
  const at = Date.now();
  const value = await job;
  return {
    value,
    provenance: mark({ source, ok: ok(value), ms: Date.now() - at, fetchedAt: Date.now() }),
  };
}

/**
 * Provenance for one already-resolved envelope.
 *
 * `NOT_CONFIGURED` becomes `skipped`, not a failure — a source the operator
 * never enabled is not a source that is down, and colouring it red in the UI
 * made a working keyless install look broken.
 */
export function provenance(source: string, result: Envelope, ms: number): SourceProvenance {
  const skipped = !result.ok && result.error === "NOT_CONFIGURED";
  return {
    source,
    ok: result.ok,
    ms,
    fetchedAt: Date.now(),
    ...(result.ok ? {} : { error: result.error }),
    ...(skipped ? { skipped: true } : {}),
  };
}

// ── Last-observed health ─────────────────────────────────────────────────────
// In-memory only, and deliberately so: this is a live diagnostic, not a metrics
// store. It resets on restart and never touches disk.

const observed = new Map<string, SourceProvenance>();

/** Record one observation and return it unchanged (so it can be used inline). */
export function mark(p: SourceProvenance): SourceProvenance {
  observed.set(p.source, p);
  return p;
}

/** Record a whole batch — the shape the IP and domain routes already build. */
export function markAll(batch: SourceProvenance[]): SourceProvenance[] {
  batch.forEach(mark);
  return batch;
}

/** What each source did the last time it was called, for /api/sources. */
export function healthSnapshot(): Record<string, SourceProvenance> {
  return Object.fromEntries(observed);
}

/** Test seam — drop all observations. */
export function resetHealth(): void {
  observed.clear();
}
