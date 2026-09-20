// ── Bulk lookups across every mode, as a queued job ──────────────────────────
//
// Bulk used to be phone-only, offline-only and capped at 25 rows, on the
// reasoning that fanning 25 rows out to quota'd APIs would burn a day's budget.
// That reasoning still holds for the APIs; it does not hold for the tool, whose
// keyless sources are most of what it runs on. Real triage is 200 domains or
// 500 emails out of a spreadsheet, and a console that cannot take a list is a
// console you use one row at a time.
//
// Three properties make that safe:
//
//   • It REUSES the real lookup handlers. No second implementation to drift, no
//     mode that behaves differently in bulk, and every row goes through the
//     same validation, the same budget gate and the same provenance.
//   • It is a JOB, not a request. A 200-row run takes minutes; the client polls
//     progress and rows stream in, instead of one request timing out.
//   • The upstream budget gate already parks an exhausted provider, so a long
//     run degrades into "that source was skipped for these rows" rather than
//     into a ban.

import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { mapLimit } from "./concurrency";
import { fanoutConcurrency } from "./config";
import { internalHeaders } from "./rateLimit";

export type BulkMode = "phone" | "email" | "username" | "ip" | "domain" | "wallet" | "hash";

/** Which endpoint and body field each mode uses. */
const ROUTES: Record<BulkMode, { path: string; field: string }> = {
  phone: { path: "/api/lookup", field: "number" },
  email: { path: "/api/email-lookup", field: "email" },
  username: { path: "/api/username-lookup", field: "username" },
  ip: { path: "/api/ip-lookup", field: "ip" },
  domain: { path: "/api/domain-lookup", field: "domain" },
  wallet: { path: "/api/wallet-lookup", field: "address" },
  hash: { path: "/api/hash-lookup", field: "hash" },
};

export const BULK_MODES = Object.keys(ROUTES) as BulkMode[];
/** Rows per job. Beyond this a run stops being triage and becomes a crawl. */
export const MAX_BULK_ROWS = 500;
/** Finished jobs are kept this long so a slow poller can still collect them. */
const JOB_TTL_MS = 30 * 60_000;
/**
 * Jobs allowed to be RUNNING at once.
 *
 * `MAX_BULK_ROWS` bounds one job and `width` bounds the rows in flight within
 * it, but nothing bounded the number of jobs — and the rate limiter permits 60
 * requests a minute, so sixty 500-row jobs could be queued in one. Each row
 * fans out to a dozen upstreams, so that is ~360,000 outbound calls in flight
 * from one process: a self-inflicted flood that gets the operator's address
 * banned by every free source before it exhausts memory.
 *
 * Four concurrent jobs is ~16 rows in flight, already ~190 concurrent upstream
 * calls. An analyst does not run five bulk jobs at once; a script does.
 */
export const MAX_ACTIVE_JOBS = 4;

export interface BulkRow {
  mode: BulkMode;
  input: string;
  ok: boolean;
  /** HTTP status the underlying lookup returned. */
  status: number;
  /** Short reason when `ok` is false. */
  error?: string;
  /** The flattened, CSV-friendly summary of the result. */
  summary: Record<string, string | number | boolean | null>;
  /** Per-source provenance, so a thin row can be told from a failed one. */
  sources: { source: string; ok: boolean; skipped?: boolean }[];
  ms: number;
}

export interface BulkJob {
  id: string;
  state: "running" | "done" | "cancelled";
  total: number;
  done: number;
  rows: BulkRow[];
  startedAt: number;
  finishedAt?: number;
}

const jobs = new Map<string, BulkJob>();
const cancelled = new Set<string>();

/** Drop jobs that finished long enough ago that nobody is coming back for them. */
function sweep(now: number): void {
  for (const [id, job] of jobs) {
    if (job.finishedAt !== undefined && now - job.finishedAt > JOB_TTL_MS) {
      jobs.delete(id);
      cancelled.delete(id);
    }
  }
}

/** Test seam, and what a restart implies. */
export function resetJobs(): void {
  jobs.clear();
  cancelled.clear();
}

/**
 * How many jobs are still running, after dropping any that have aged out. The
 * bulk route admits a new job only while this is below `MAX_ACTIVE_JOBS`.
 */
export function activeJobCount(now: number = Date.now()): number {
  sweep(now);
  let active = 0;
  for (const job of jobs.values()) if (job.state === "running") active++;
  return active;
}

export function getJob(id: string): BulkJob | null {
  return jobs.get(id) ?? null;
}

export function cancelJob(id: string): boolean {
  const job = jobs.get(id);
  if (!job || job.state !== "running") return false;
  cancelled.add(id);
  job.state = "cancelled";
  job.finishedAt = Date.now();
  return true;
}

/** Pull the handful of fields a triage row actually needs out of a response. */
export function summarize(mode: BulkMode, body: unknown): BulkRow["summary"] {
  const d = (body ?? {}) as Record<string, unknown>;
  const pick = (path: string[]): string | number | boolean | null => {
    let cur: unknown = d;
    for (const key of path) {
      if (typeof cur !== "object" || cur === null) return null;
      cur = (cur as Record<string, unknown>)[key];
    }
    if (cur === null || cur === undefined) return null;
    if (typeof cur === "string" || typeof cur === "number" || typeof cur === "boolean") return cur;
    if (Array.isArray(cur)) return cur.length;
    return null;
  };

  switch (mode) {
    case "phone":
      return {
        e164: pick(["input", "e164"]),
        valid: pick(["input", "isValid"]),
        assignable: pick(["assignability", "assignable"]),
        country: pick(["analysis", "countryName"]),
        carrier: pick(["aggregated", "carrier"]),
        lineType: pick(["aggregated", "lineType"]),
        abuseScore: pick(["threatScore"]),
        exposureScore: pick(["exposureScore"]),
      };
    case "email":
      return {
        email: pick(["email"]),
        provider: pick(["analysis", "providerName"]),
        disposable: pick(["analysis", "isDisposable"]),
        gravatar: pick(["gravatar", "found"]),
        breaches: pick(["breachAggregate", "breaches"]),
        abuseScore: pick(["threatScore"]),
        exposureScore: pick(["exposureScore"]),
      };
    case "username":
      return {
        username: pick(["username"]),
        found: pick(["found"]),
        checked: pick(["checked"]),
        profiles: pick(["profiles"]),
        identity: pick(["resolvedIdentity", "name", "value"]),
        confidence: pick(["resolvedIdentity", "confidence"]),
      };
    case "ip":
      return {
        ip: pick(["input"]),
        country: pick(["ip", "country"]),
        asn: pick(["ip", "asnOrg"]),
        reverse: pick(["ip", "reverse"]),
        openPorts: pick(["ip", "ports"]),
        vulns: pick(["ip", "vulns"]),
        threatScore: pick(["threatScore"]),
      };
    case "domain":
      return {
        domain: pick(["domain"]),
        registrar: pick(["whois", "registrar"]),
        created: pick(["whois", "createdDate"]),
        aRecords: pick(["dns", "a"]),
        mx: pick(["dns", "mx"]),
        spf: pick(["emailSecurity", "hasSpf"]),
        dmarc: pick(["emailSecurity", "dmarcPolicy"]),
        subdomains: pick(["subdomains"]),
        grade: pick(["http", "security", "grade"]),
      };
    case "wallet":
      return {
        address: pick(["facts", "address"]),
        chain: pick(["chain"]),
        balance: pick(["facts", "balance"]),
        txCount: pick(["facts", "txCount"]),
        sanctioned: pick(["sanctions", "listed"]),
        lastActivity: pick(["activity", "lastActivity"]),
      };
    /* v8 ignore next -- the switch is exhaustive over BulkMode; `hash` is the
       last arm and TypeScript already proves nothing else reaches here. */
    case "hash":
    default:
      return {
        hash: pick(["input"]),
        kind: pick(["kind"]),
        known: pick(["facts", "known"]),
        fileName: pick(["facts", "fileName"]),
        product: pick(["facts", "productName"]),
      };
  }
}

function flattenSources(body: unknown): BulkRow["sources"] {
  const health = (body as { sourceHealth?: unknown } | null)?.sourceHealth;
  if (!Array.isArray(health)) return [];
  return health
    .filter((h): h is Record<string, unknown> => typeof h === "object" && h !== null)
    .map((h) => ({
      source: typeof h.source === "string" ? h.source : "unknown",
      ok: h.ok === true,
      ...(h.skipped === true ? { skipped: true } : {}),
    }));
}

/** How one row is executed. Injectable so tests do not need the real handlers. */
export type RowRunner = (mode: BulkMode, value: string) => Promise<{ status: number; body: unknown }>;

/**
 * Call the real route handler for one row.
 *
 * The handlers are imported lazily: pulling every lookup route into this module
 * at import time would drag their upstream clients into any bundle that touches
 * the job store.
 */
export const defaultRunner: RowRunner = async (mode, value) => {
  const route = ROUTES[mode];
  const handlers: Record<BulkMode, () => Promise<{ POST: (req: NextRequest) => Promise<Response> }>> = {
    phone: () => import("@/app/api/lookup/route"),
    email: () => import("@/app/api/email-lookup/route"),
    username: () => import("@/app/api/username-lookup/route"),
    ip: () => import("@/app/api/ip-lookup/route"),
    domain: () => import("@/app/api/domain-lookup/route"),
    wallet: () => import("@/app/api/wallet-lookup/route"),
    hash: () => import("@/app/api/hash-lookup/route"),
  };
  const mod = await handlers[mode]();
  const req = new NextRequest(`http://127.0.0.1${route.path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...internalHeaders() },
    body: JSON.stringify({ [route.field]: value }),
  });
  const res = await mod.POST(req);
  const body = (await res.json()) as unknown;
  return { status: res.status, body };
};

export interface StartInput {
  rows: { mode: BulkMode; value: string }[];
  runner?: RowRunner;
  concurrency?: number;
}

/**
 * Queue a job and start it. Returns immediately with the job id; progress is
 * read with `getJob`.
 */
export function startJob(input: StartInput): BulkJob {
  sweep(Date.now());
  const id = randomUUID();
  const job: BulkJob = {
    id,
    state: "running",
    total: input.rows.length,
    done: 0,
    rows: [],
    startedAt: Date.now(),
  };
  jobs.set(id, job);

  const runner = input.runner ?? defaultRunner;
  // Deliberately lower than the per-lookup fanout: each ROW is itself a fanout
  // of a dozen upstream calls, so running many rows at once multiplies out fast.
  const width = input.concurrency ?? Math.max(1, Math.min(4, fanoutConcurrency()));

  void mapLimit(input.rows, width, async (row) => {
    if (cancelled.has(id)) return;
    const at = Date.now();
    try {
      const { status, body } = await runner(row.mode, row.value);
      const b = body as { error?: unknown } | null;
      job.rows.push({
        mode: row.mode,
        input: row.value,
        ok: status === 200 && typeof b?.error !== "string",
        status,
        ...(typeof b?.error === "string" ? { error: b.error } : {}),
        summary: summarize(row.mode, body),
        sources: flattenSources(body),
        ms: Date.now() - at,
      });
    } catch {
      job.rows.push({
        mode: row.mode,
        input: row.value,
        ok: false,
        status: 0,
        error: "the lookup failed",
        summary: {},
        sources: [],
        ms: Date.now() - at,
      });
    }
    job.done++;
  }).then(() => {
    if (job.state === "running") {
      job.state = "done";
      job.finishedAt = Date.now();
    }
  });

  return job;
}

/** CSV of a job's rows: one column set per mode, so mixed jobs stay readable. */
export function jobCsv(job: BulkJob): string {
  const byMode = new Map<BulkMode, BulkRow[]>();
  for (const row of job.rows) {
    const list = byMode.get(row.mode) ?? [];
    if (list.length === 0) byMode.set(row.mode, list);
    list.push(row);
  }
  // Quote for CSV, and neutralise formula injection the same way the other two
  // builders do (caseReport.ts's `csvEsc`, BulkLookup.tsx's `toCsv`): a cell
  // beginning with = + - @ or a tab/CR is EXECUTED as a formula by Excel,
  // LibreOffice and Sheets. This one was the exception, and it is the copy a
  // script reaches — `GET /api/bulk-lookup?id=…&format=csv`. Its cells are the
  // least trustworthy of the three: `summary` carries page titles, WHOIS org
  // names and ASN descriptions, which the target's own server writes.
  const escape = (v: unknown): string => {
    let s = v === null || v === undefined ? "" : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const blocks: string[] = [];
  for (const rows of byMode.values()) {
    const keys = [...new Set(rows.flatMap((r) => Object.keys(r.summary)))];
    const header = ["mode", "input", "ok", "status", "error", ...keys].map(escape).join(",");
    const body = rows.map((r) =>
      [r.mode, r.input, r.ok, r.status, r.error ?? "", ...keys.map((k) => r.summary[k])].map(escape).join(","),
    );
    blocks.push([header, ...body].join("\n"));
  }
  return blocks.join("\n\n");
}
