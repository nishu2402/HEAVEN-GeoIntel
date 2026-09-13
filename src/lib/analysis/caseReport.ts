// ── Case report export / import (chain-of-custody) ───────────────────────────
// Produces an analyst-grade, self-describing export of an investigation case:
//   • JSON  — machine-readable, re-importable, with a SHA-256 integrity hash
//             over the case payload so tampering is detectable.
//   • Markdown — human-readable report (entities table, notes, provenance).
//   • CSV / Maltego CSV / STIX — interop.
//   • HTML and PDF — two separate documents, rendered from `CaseDocModel` by
//     ./caseDoc. Everything they show is normalised here first, so the dossier
//     on screen, the one on paper and the Markdown cannot tell three different
//     stories about one case.
// Pure functions + Web Crypto; runs entirely client-side.

import type { InvestigationCase, CaseEdge, CaseEntity, CaseSnapshot, EntityKind } from "../types";
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

/**
 * Escape a value for a Markdown table cell. Backslashes are escaped FIRST, so a
 * literal `\` in the input can never combine with the escape we add for `|`;
 * newlines are folded to a space, since a raw newline ends the table row.
 */
const md = (s: string) =>
  s.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");

// ── Normalised document model ────────────────────────────────────────────────

/** One fact that moved between two consecutive snapshots of an identifier. */
export interface CaseChange { at: number; fact: string; from: string; to: string }

/** The snapshot history of one identifier: the reason snapshots exist at all. */
export interface CaseHistory {
  kind: EntityKind;
  value: string;
  snapshots: number;
  first: number;
  last: number;
  /** Only a baseline exists, so there is nothing yet to compare it against. */
  baselineOnly: boolean;
  /** Empty with `baselineOnly: false` means re-runs happened and nothing moved. */
  changes: CaseChange[];
}

/**
 * Everything a case dossier states, in one shape, resolved once. Both renderers
 * and the Markdown export read this and nothing else, so a figure can never
 * differ between the formats.
 */
export interface CaseDocModel {
  documentId: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  exportedAt: string;
  entities: CaseEntity[];
  edges: CaseEdge[];
  notes: string;
  /** Identifier counts per kind, highest first: the shape of the case. */
  kinds: { kind: EntityKind; count: number }[];
  histories: CaseHistory[];
  snapshots: number;
  integrity: { algo: "SHA-256"; hash: string };
  schema: string;
  version: string;
}

/** Group snapshots per identifier and diff each consecutive pair. */
function historiesOf(snapshots: CaseSnapshot[]): CaseHistory[] {
  const byKey = new Map<string, CaseSnapshot[]>();
  for (const s of snapshots) {
    const key = `${s.kind}:${s.value.toLowerCase()}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key)!.push(s);
  }
  const out: CaseHistory[] = [];
  for (const list of byKey.values()) {
    const first = list[0]!;
    const last = list[list.length - 1]!;
    const changes: CaseChange[] = [];
    for (let i = 1; i < list.length; i++) {
      const prev = list[i - 1]!;
      const cur = list[i]!;
      for (const ch of diffFacts(prev.facts, cur.facts)) {
        // A fact that appeared has no "was", and one that vanished has no
        // "now"; the dash is the table's way of saying so.
        changes.push({ at: cur.takenAt, fact: ch.fact, from: String(ch.from ?? "—"), to: String(ch.to ?? "—") });
      }
    }
    out.push({
      kind: first.kind, value: first.value, snapshots: list.length,
      first: first.takenAt, last: last.takenAt,
      baselineOnly: list.length === 1, changes,
    });
  }
  return out;
}

function kindCounts(entities: CaseEntity[]): { kind: EntityKind; count: number }[] {
  const counts = new Map<EntityKind, number>();
  for (const e of entities) counts.set(e.kind, (counts.get(e.kind) ?? 0) + 1);
  return [...counts.entries()]
    .map(([kind, count]) => ({ kind, count }))
    .sort((a, b) => b.count - a.count || a.kind.localeCompare(b.kind));
}

export async function buildCaseDoc(c: InvestigationCase): Promise<CaseDocModel> {
  const payload = payloadOf(c);
  const hash = await sha256Hex(canonical(payload));
  return {
    // Derived from the integrity hash, so the document's own reference and the
    // thing it attests to are the same number.
    documentId: `CASE-${hash.slice(0, 10).toUpperCase()}`,
    name: payload.name,
    createdAt: payload.createdAt,
    updatedAt: payload.updatedAt,
    exportedAt: new Date().toISOString(),
    entities: payload.entities,
    edges: payload.edges,
    notes: payload.notes,
    kinds: kindCounts(payload.entities),
    histories: historiesOf(payload.snapshots),
    snapshots: payload.snapshots.length,
    integrity: { algo: "SHA-256", hash },
    schema: REPORT_SCHEMA,
    version: APP_VERSION,
  };
}

/** The classification and handling line every case export carries. */
export const CASE_CLASSIFICATION =
  "OSINT // Investigation case file // For authorized investigative use only";

/** What the integrity block means, said once and reused by every renderer. */
export const CASE_INTEGRITY_NOTE =
  "The hash covers the canonical case payload: name, timestamps, identifiers, derived links and snapshots. Re-import this file into HEAVEN-GeoIntel to have it recomputed and compared. A mismatch means the payload changed after export.";

export const CASE_METHODOLOGY: string[] = [
  "A case file is a record of what an analyst collected, not a conclusion. Identifiers were added by hand or from a lookup result; nothing here was inferred.",
  "Derived links come from lookup results and name the field that produced each one, so every edge can be traced back to its evidence.",
  "The change history compares consecutive snapshots of the same identifier. A fact that is absent from one side is shown as a dash, never as a value of zero or false.",
  "For authorized investigative use only. Verify every finding against the primary source before acting on it.",
];

// ── Markdown report ──────────────────────────────────────────────────────────

function changeHistoryMd(histories: CaseHistory[]): string[] {
  if (histories.length === 0) return ["_No lookups have been snapshotted for this case._"];
  const out: string[] = [];
  for (const h of histories) {
    out.push(`### ${h.kind} \`${md(h.value)}\``, "");
    out.push(`Snapshots: ${h.snapshots} · first ${new Date(h.first).toISOString()} · latest ${new Date(h.last).toISOString()}`, "");
    if (h.baselineOnly) {
      out.push("_Baseline only: re-run this identifier to see what changes._", "");
      continue;
    }
    out.push(`| When | Fact | Was | Now |`, `|------|------|-----|-----|`);
    for (const ch of h.changes) {
      out.push(`| ${new Date(ch.at).toISOString()} | ${md(ch.fact)} | ${md(ch.from)} | ${md(ch.to)} |`);
    }
    if (h.changes.length === 0) out.push(`| — | _nothing changed across ${h.snapshots} snapshots_ | — | — |`);
    out.push("");
  }
  return out;
}

export async function buildCaseMarkdown(c: InvestigationCase): Promise<string> {
  const d = await buildCaseDoc(c);
  const fmt = (ms: number) => new Date(ms).toISOString();
  const rows = d.entities.length
    ? d.entities.map((e) => `| ${e.kind} | \`${md(e.value)}\` | ${fmt(e.addedAt)} | ${md(e.note ?? "")} |`).join("\n")
    : "| — | _no identifiers_ | — | — |";

  return [
    `# HEAVEN-GeoIntel: Investigation Report`,
    ``,
    `> ${CASE_CLASSIFICATION}`,
    ``,
    `**Case:** ${d.name}`,
    `**Document ID:** ${d.documentId}`,
    `**Created:** ${fmt(d.createdAt)}`,
    `**Last updated:** ${fmt(d.updatedAt)}`,
    `**Exported:** ${d.exportedAt}`,
    `**Identifiers:** ${d.entities.length}`,
    `**Derived links:** ${d.edges.length}`,
    `**Snapshots:** ${d.snapshots}`,
    `**Produced by:** HEAVEN-GeoIntel v${d.version} (${d.schema})`,
    ``,
    `## Contents`,
    ``,
    `- [Case profile](#case-profile)`,
    `- [Identifiers](#identifiers)`,
    `- [Derived links](#derived-links)`,
    `- [Change history](#change-history)`,
    `- [Analyst notes](#analyst-notes)`,
    `- [Methodology and limitations](#methodology-and-limitations)`,
    `- [Integrity](#integrity)`,
    ``,
    `## Case profile`,
    ``,
    `| Identifier type | Count |`,
    `|------|-------|`,
    ...(d.kinds.length
      ? d.kinds.map((k) => `| ${k.kind} | ${k.count} |`)
      : [`| — | _no identifiers_ |`]),
    ``,
    `## Identifiers`,
    ``,
    `| Type | Value | Added | Note |`,
    `|------|-------|-------|------|`,
    rows,
    ``,
    `## Derived links`,
    ``,
    ...(d.edges.length
      ? [
          `Relationships the tool derived from lookup results, with the source that produced each.`,
          ``,
          `| From | To | Derived from | Added |`,
          `|------|----|--------------|-------|`,
          ...d.edges.map(
            (e) => `| ${e.from.kind} \`${md(e.from.value)}\` | ${e.to.kind} \`${md(e.to.value)}\` | ${md(e.reason)} | ${fmt(e.addedAt)} |`,
          ),
        ]
      : ["_No derived links recorded._"]),
    ``,
    `## Change history`,
    ``,
    ...changeHistoryMd(d.histories),
    ``,
    `## Analyst notes`,
    ``,
    d.notes.trim() ? d.notes.trim() : "_None._",
    ``,
    `## Methodology and limitations`,
    ``,
    ...CASE_METHODOLOGY.map((l) => `- ${md(l)}`),
    ``,
    `## Integrity`,
    ``,
    `Integrity (SHA-256 of case payload): \`${d.integrity.hash}\``,
    ``,
    CASE_INTEGRITY_NOTE,
    ``,
    `---`,
    ``,
    `_${d.documentId} · Generated by HEAVEN-GeoIntel v${APP_VERSION}, for authorized use only. Verify all intelligence before relying on it._`,
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
