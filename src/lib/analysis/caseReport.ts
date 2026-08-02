// ── Case report export / import (chain-of-custody) ───────────────────────────
// Produces an analyst-grade, self-describing export of an investigation case in
// two formats:
//   • JSON  — machine-readable, re-importable, with a SHA-256 integrity hash
//             over the case payload so tampering is detectable.
//   • Markdown — human-readable report (entities table, notes, provenance).
// Pure functions + Web Crypto; runs entirely client-side.

import type { InvestigationCase, CaseEdge, CaseEntity, CaseSnapshot, EntityKind } from "../types";
import { BRAND, logoSvg } from "../brand/logo";
import { diffFacts } from "./caseSnapshot";
import { APP_VERSION } from "../version";

/**
 * Schema v2 adds the derived graph and the snapshot history to the export, so a
 * report is now "everything the case knows" rather than just its identifiers.
 *
 * v1 files remain verifiable: the integrity hash covers the payload, and adding
 * fields would change it, so `verifyCaseImport` re-hashes a v1 file against the
 * v1 payload shape. An old export therefore still reads as untampered.
 */
export const REPORT_SCHEMA_V1 = "heaven-geointel/case-report@1";
export const REPORT_SCHEMA = "heaven-geointel/case-report@2";


export interface CaseReportEnvelope {
  tool: "HEAVEN-GeoIntel";
  schema: typeof REPORT_SCHEMA;
  version: string;
  exportedAt: string;          // ISO-8601
  integrity: { algo: "SHA-256"; hash: string };
  case: CasePayload;
}

interface CasePayloadV1 {
  name: string;
  createdAt: number;
  updatedAt: number;
  entities: CaseEntity[];
  notes: string;
}

interface CasePayload extends CasePayloadV1 {
  edges: CaseEdge[];
  snapshots: CaseSnapshot[];
}

function sortedEntities(c: InvestigationCase): CaseEntity[] {
  return c.entities
    .map((e) => ({ kind: e.kind, value: e.value, addedAt: e.addedAt, note: e.note }))
    .sort((a, b) => a.kind.localeCompare(b.kind) || a.value.localeCompare(b.value));
}

// The v1 payload shape, kept verbatim so a report exported before v2 still
// hashes to the value recorded in its own integrity block.
function payloadOfV1(c: InvestigationCase): CasePayloadV1 {
  return {
    name: c.name,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    entities: sortedEntities(c),
    notes: c.notes ?? "",
  };
}

// Stable, key-ordered payload so the hash is deterministic across exports.
function payloadOf(c: InvestigationCase): CasePayload {
  return {
    ...payloadOfV1(c),
    edges: (c.edges ?? [])
      .map((e) => ({ from: e.from, to: e.to, reason: e.reason, addedAt: e.addedAt }))
      .sort((a, b) =>
        a.from.value.localeCompare(b.from.value) ||
        a.to.value.localeCompare(b.to.value) ||
        a.reason.localeCompare(b.reason)),
    // Chronological, NOT alphabetical: the order is load-bearing for diffing.
    snapshots: (c.snapshots ?? [])
      .map((s) => ({ kind: s.kind, value: s.value, takenAt: s.takenAt, facts: s.facts, fromCache: s.fromCache }))
      .sort((a, b) => a.takenAt - b.takenAt),
  };
}

function canonical(p: CasePayloadV1): string {
  // JSON.stringify with the object built in a fixed key order = canonical form.
  return JSON.stringify(p);
}

export async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function buildCaseJson(c: InvestigationCase): Promise<{ json: string; hash: string }> {
  const payload = payloadOf(c);
  const hash = await sha256Hex(canonical(payload));
  const envelope: CaseReportEnvelope = {
    tool: "HEAVEN-GeoIntel",
    schema: REPORT_SCHEMA,
    version: APP_VERSION,
    exportedAt: new Date().toISOString(),
    integrity: { algo: "SHA-256", hash },
    case: payload,
  };
  return { json: JSON.stringify(envelope, null, 2), hash };
}

/** Escape a value for a Markdown table cell. */
const md = (s: string) => s.replace(/\|/g, "\\|");

/**
 * Render the snapshot history as one section per identifier: the baseline, then
 * every fact that moved between consecutive re-runs. This is the "what changed"
 * view — the reason snapshots are stored at all.
 */
function changeHistory(snapshots: CaseSnapshot[]): string[] {
  if (snapshots.length === 0) return ["_No lookups have been snapshotted for this case._"];

  const byKey = new Map<string, CaseSnapshot[]>();
  for (const s of snapshots) {
    const key = `${s.kind}:${s.value.toLowerCase()}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key)!.push(s);
  }

  const out: string[] = [];
  for (const list of byKey.values()) {
    const first = list[0];
    out.push(`### ${first.kind} \`${md(first.value)}\``, "");
    out.push(`Snapshots: ${list.length} · first ${new Date(first.takenAt).toISOString()} · latest ${new Date(list[list.length - 1].takenAt).toISOString()}`, "");

    if (list.length === 1) {
      out.push("_Baseline only — re-run this identifier to see what changes._", "");
      continue;
    }
    out.push(`| When | Fact | Was | Now |`, `|------|------|-----|-----|`);
    let moved = 0;
    for (let i = 1; i < list.length; i++) {
      for (const ch of diffFacts(list[i - 1].facts, list[i].facts)) {
        moved++;
        out.push(`| ${new Date(list[i].takenAt).toISOString()} | ${md(ch.fact)} | ${md(String(ch.from ?? "—"))} | ${md(String(ch.to ?? "—"))} |`);
      }
    }
    if (moved === 0) out.push(`| — | _nothing changed across ${list.length} snapshots_ | — | — |`);
    out.push("");
  }
  return out;
}

export async function buildCaseMarkdown(c: InvestigationCase): Promise<string> {
  const payload = payloadOf(c);
  const hash = await sha256Hex(canonical(payload));
  const fmt = (ms: number) => new Date(ms).toISOString();
  const rows = payload.entities.length
    ? payload.entities.map((e) => `| ${e.kind} | \`${e.value.replace(/\|/g, "\\|")}\` | ${fmt(e.addedAt)} | ${(e.note ?? "").replace(/\|/g, "\\|")} |`).join("\n")
    : "| — | _no identifiers_ | — | — |";

  return [
    `# HEAVEN-GeoIntel — Investigation Report`,
    ``,
    `**Case:** ${payload.name}`,
    `**Created:** ${fmt(payload.createdAt)}`,
    `**Last updated:** ${fmt(payload.updatedAt)}`,
    `**Exported:** ${new Date().toISOString()}`,
    `**Identifiers:** ${payload.entities.length}`,
    `**Derived links:** ${payload.edges.length}`,
    `**Snapshots:** ${payload.snapshots.length}`,
    ``,
    `## Identifiers`,
    ``,
    `| Type | Value | Added | Note |`,
    `|------|-------|-------|------|`,
    rows,
    ``,
    `## Derived links`,
    ``,
    ...(payload.edges.length
      ? [
          `Relationships the tool derived from lookup results, with the source that produced each.`,
          ``,
          `| From | To | Derived from | Added |`,
          `|------|----|--------------|-------|`,
          ...payload.edges.map(
            (e) => `| ${e.from.kind} \`${md(e.from.value)}\` | ${e.to.kind} \`${md(e.to.value)}\` | ${md(e.reason)} | ${fmt(e.addedAt)} |`,
          ),
        ]
      : ["_No derived links recorded._"]),
    ``,
    `## Change history`,
    ``,
    ...changeHistory(payload.snapshots),
    ``,
    `## Analyst notes`,
    ``,
    payload.notes.trim() ? payload.notes.trim() : "_None._",
    ``,
    `---`,
    ``,
    `Integrity (SHA-256 of case payload): \`${hash}\``,
    ``,
    `_Generated by HEAVEN-GeoIntel v${APP_VERSION} — for authorized use only. Verify all intelligence before relying on it._`,
  ].join("\n");
}

// ── Interop exports ──────────────────────────────────────────────────────────
// Quote every field AND neutralise CSV formula-injection: a cell beginning with
// = + - @ (or a tab/CR) is executed as a formula by Excel / Google Sheets. OSINT
// values are attacker-influenced (a phone is "+1…", a note is free text), so we
// prefix those with a single quote — the standard, lossless mitigation.
const csvEsc = (s: unknown) => {
  /* v8 ignore next -- every caller pre-coalesces to a string; `?? ""` is defensive */
  let v = String(s ?? "");
  if (/^[=+\-@\t\r]/.test(v)) v = "'" + v;
  return `"${v.replace(/"/g, '""')}"`;
};

/** Plain CSV of the case's identifiers. */
export function buildCaseCsv(c: InvestigationCase): string {
  const p = payloadOf(c);
  const rows = [["kind", "value", "addedAt", "note"].join(",")];
  for (const e of p.entities) {
    rows.push([e.kind, e.value, new Date(e.addedAt).toISOString(), e.note ?? ""].map(csvEsc).join(","));
  }
  return rows.join("\r\n");
}

/** Maltego "paste table" CSV — Entity Type + Value, one row per identifier. */
export function buildMaltegoCsv(c: InvestigationCase): string {
  const TYPE: Record<string, string> = {
    phone: "maltego.PhoneNumber", email: "maltego.EmailAddress",
    username: "maltego.Alias", ip: "maltego.IPv4Address", domain: "maltego.Domain",
  };
  const rows = [["Entity Type", "Value"].join(",")];
  for (const e of payloadOf(c).entities) {
    /* v8 ignore next -- TYPE maps every EntityKind; the "maltego.Phrase" fallback is defensive */
    rows.push([TYPE[e.kind] ?? "maltego.Phrase", e.value].map(csvEsc).join(","));
  }
  return rows.join("\r\n");
}

/** STIX 2.1 bundle of Cyber-observable objects (SCOs) for the identifiers. */
export function buildStixBundle(c: InvestigationCase): string {
  const p = payloadOf(c);
  /* v8 ignore next -- crypto.randomUUID is always present on our Node runtimes;
     the Math.random fallback is defensive for exotic/old environments. */
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(16).slice(2));
  const objects: Record<string, unknown>[] = [
    { type: "identity", spec_version: "2.1", id: `identity--${uuid()}`, name: "HEAVEN-GeoIntel", identity_class: "system" },
  ];
  for (const e of p.entities) {
    const id = uuid();
    switch (e.kind) {
      case "email":    objects.push({ type: "email-addr",  spec_version: "2.1", id: `email-addr--${id}`,  value: e.value }); break;
      case "ip":       objects.push({ type: "ipv4-addr",   spec_version: "2.1", id: `ipv4-addr--${id}`,   value: e.value }); break;
      case "domain":   objects.push({ type: "domain-name", spec_version: "2.1", id: `domain-name--${id}`, value: e.value }); break;
      case "username": objects.push({ type: "user-account",spec_version: "2.1", id: `user-account--${id}`,account_login: e.value }); break;
      case "phone":    objects.push({ type: "x-phone-number", spec_version: "2.1", id: `x-phone-number--${id}`, value: e.value }); break;
    }
  }
  return JSON.stringify({ type: "bundle", id: `bundle--${uuid()}`, objects }, null, 2);
}

/** Self-contained printable HTML (for browser "Save as PDF"). */
export async function buildPrintableHtml(c: InvestigationCase): Promise<string> {
  const md = await buildCaseMarkdown(c);
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  // Bound for paper, so the mark is drawn in single-colour ink rather than neon.
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>${BRAND.name} — ${esc(c.name)}</title>
<style>
  body{font:13px/1.6 ui-monospace,Menlo,Consolas,monospace;max-width:820px;margin:32px auto;padding:0 20px;color:${BRAND.ink}}
  .masthead{display:flex;align-items:center;gap:16px;border-bottom:1.5px solid ${BRAND.ink};padding-bottom:14px;margin-bottom:22px}
  .masthead h1{margin:0;font-size:13px;letter-spacing:.26em;text-transform:uppercase}
  .masthead p{margin:4px 0 0;font-size:10px;letter-spacing:.2em;text-transform:uppercase;color:#5a6b63}
  pre{white-space:pre-wrap;word-break:break-word;margin:0}
  @media print{@page{margin:14mm} .masthead{break-after:avoid}}
</style></head><body>
<header class="masthead">${logoSvg({ size: 46, mono: BRAND.ink })}<div>
<h1>${BRAND.name}</h1><p>${BRAND.tagline} — Investigation Report</p></div></header>
<pre>${esc(md)}</pre>
<script>window.onload=function(){setTimeout(function(){window.print()},250)}</script>
</body></html>`;
}

export interface ImportCheck {
  ok: boolean;
  case?: CasePayload;
  /** Which schema the file declared — 1 for pre-v2 reports, 2 for current. */
  schemaVersion?: 1 | 2;
  /**
   * Rows the file contained that could not be parsed and were discarded
   * (wrong kind, blank value, wrong shape).
   *
   * The integrity hash covers the CANONICAL payload, so rows that don't survive
   * sanitisation are not part of what was attested — appending junk to a report
   * therefore still verifies. That is the correct answer about the *case*, but
   * it would be silent about the *file*, so the count is reported separately.
   * A non-zero value on an otherwise-verified report means someone edited the
   * file even though nothing an analyst would act on changed.
   */
  dropped?: number;
  expectedHash?: string;
  actualHash?: string;
  error?: string;
  /** A hash was present and did NOT match — the payload changed after export. */
  tampered?: boolean;
  /**
   * A hash was present AND matched. A report carrying no integrity block is
   * `verified: false` with `tampered: false`: we cannot vouch for it either way,
   * and callers must not claim it was verified.
   */
  verified?: boolean;
}

const IMPORT_KINDS = new Set<EntityKind>(["phone", "email", "username", "ip", "domain"]);

/** How many rows a raw array held that the matching sanitizer did not keep. */
function droppedCount(raw: unknown, kept: number): number {
  return Array.isArray(raw) ? Math.max(0, raw.length - kept) : 0;
}

// An imported file is untrusted input: it can carry nulls, wrong types, or a
// non-array `entities`. Coerce to the shape payloadOf() expects (mirroring the
// server's importCase validation) instead of letting a malformed field throw.
// Anything dropped here changes the payload, so the hash check below fails and
// the caller is warned — a silently-repaired file is still reported as tampered.
function sanitizeEntities(raw: unknown, fallbackAt: number): CaseEntity[] {
  if (!Array.isArray(raw)) return [];
  const out: CaseEntity[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const e = item as Partial<CaseEntity>;
    if (!IMPORT_KINDS.has(e.kind as EntityKind) || typeof e.value !== "string") continue;
    out.push({
      kind: e.kind as EntityKind,
      value: e.value,
      addedAt: typeof e.addedAt === "number" && Number.isFinite(e.addedAt) ? e.addedAt : fallbackAt,
      note: typeof e.note === "string" ? e.note : undefined,
    });
  }
  return out;
}

/** Keep only well-formed edges from an untrusted file (mirrors the server). */
function sanitizeEdges(raw: unknown, fallbackAt: number): CaseEdge[] {
  if (!Array.isArray(raw)) return [];
  const ref = (r: unknown): { kind: EntityKind; value: string } | null => {
    if (!r || typeof r !== "object") return null;
    const o = r as { kind?: unknown; value?: unknown };
    if (!IMPORT_KINDS.has(o.kind as EntityKind) || typeof o.value !== "string" || !o.value) return null;
    return { kind: o.kind as EntityKind, value: o.value };
  };
  const out: CaseEdge[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const e = item as { from?: unknown; to?: unknown; reason?: unknown; addedAt?: unknown };
    const from = ref(e.from);
    const to = ref(e.to);
    if (!from || !to) continue;
    out.push({
      from, to,
      reason: typeof e.reason === "string" ? e.reason : "derived",
      addedAt: finiteOr(e.addedAt, fallbackAt),
    });
  }
  return out;
}

/** Same for snapshots; non-scalar facts are dropped rather than carried. */
function sanitizeSnapshots(raw: unknown, fallbackAt: number): CaseSnapshot[] {
  if (!Array.isArray(raw)) return [];
  const out: CaseSnapshot[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const s = item as { kind?: unknown; value?: unknown; takenAt?: unknown; facts?: unknown; fromCache?: unknown };
    if (!IMPORT_KINDS.has(s.kind as EntityKind) || typeof s.value !== "string" || !s.value) continue;
    const facts: Record<string, number | string> = {};
    if (s.facts && typeof s.facts === "object" && !Array.isArray(s.facts)) {
      for (const [k, v] of Object.entries(s.facts as Record<string, unknown>)) {
        if (typeof v === "number" && Number.isFinite(v)) facts[k] = v;
        else if (typeof v === "string") facts[k] = v;
      }
    }
    out.push({
      kind: s.kind as EntityKind,
      value: s.value,
      takenAt: finiteOr(s.takenAt, fallbackAt),
      facts,
      ...(s.fromCache === true ? { fromCache: true as const } : {}),
    });
  }
  return out;
}

const finiteOr = (v: unknown, fallback: number): number =>
  typeof v === "number" && Number.isFinite(v) ? v : fallback;
const stringOr = (v: unknown, fallback: string): string => (typeof v === "string" ? v : fallback);

/** Parse + integrity-check a previously exported JSON report (no network). */
export async function verifyCaseImport(text: string): Promise<ImportCheck> {
  let parsed: unknown;
  try { parsed = JSON.parse(text); }
  catch { return { ok: false, error: "Not valid JSON" }; }

  const env = parsed as Partial<CaseReportEnvelope> & { schema?: string };
  const schemaVersion: 1 | 2 | null =
    env?.schema === REPORT_SCHEMA ? 2 : env?.schema === REPORT_SCHEMA_V1 ? 1 : null;
  if (!env || schemaVersion === null || !env.case || typeof env.case !== "object") {
    return { ok: false, error: "Not a HEAVEN-GeoIntel case report" };
  }
  const now = Date.now();
  const restored: InvestigationCase = {
    id: "",
    createdAt: finiteOr(env.case.createdAt, now),
    updatedAt: finiteOr(env.case.updatedAt, now),
    name: stringOr(env.case.name, ""),
    entities: sanitizeEntities(env.case.entities, now),
    notes: stringOr(env.case.notes, ""),
    edges: sanitizeEdges(env.case.edges, now),
    snapshots: sanitizeSnapshots(env.case.snapshots, now),
  };
  const payload = payloadOf(restored);
  const dropped =
    droppedCount(env.case.entities, restored.entities.length) +
    droppedCount(env.case.edges, restored.edges!.length) +
    droppedCount(env.case.snapshots, restored.snapshots!.length);
  // Hash against the shape the file was WRITTEN with. Re-hashing a v1 report as
  // v2 would add two empty arrays to the canonical form and report every old
  // export as tampered.
  const actualHash = await sha256Hex(
    canonical(schemaVersion === 1 ? payloadOfV1(restored) : payload),
  );
  const expectedHash = typeof env.integrity?.hash === "string" ? env.integrity.hash : undefined;
  const tampered = expectedHash !== undefined && expectedHash !== actualHash;
  const verified = expectedHash !== undefined && expectedHash === actualHash;
  return { ok: true, case: payload, schemaVersion, dropped, expectedHash, actualHash, tampered, verified };
}
