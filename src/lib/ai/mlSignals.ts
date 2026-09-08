// ── Text insights → graph entities + grounded summary ────────────────────────
//
// The bridge between the on-device text model (inference.ts) and the rest of the
// app. It does two pure things:
//
//   1. insightsToEntities — map the extracted identifiers onto the five graph
//      entity kinds, so a paste of raw text seeds the session graph / a case the
//      same way a finished lookup does. URL and email entities also contribute
//      their host as a domain, because the host is the pivotable identifier.
//      Wallets and hashes are surfaced in the panel but are not graph kinds, so
//      they are intentionally not mapped here.
//   2. summarizeInsights — a few grounded sentences describing what the model
//      found, never claiming more than the counts and the labelled topic.
//
// Both are deterministic and invent nothing: every entity is one the extractor
// already returned verbatim, and every sentence is gated on a real count.

import type { EntityKind } from "../types";
import type { Mode } from "../client/modes";
import type { ExtractedEntity } from "../analysis/entityExtract";
import type { TextInsights } from "./inference";
import type { MlEntity, MlEntityKind } from "./textAnalysis";

// Which extracted kinds correspond directly to a graph entity kind.
const DIRECT_KIND: Partial<Record<MlEntityKind, EntityKind>> = {
  email: "email",
  domain: "domain",
  ip: "ip",
  phone: "phone",
  username: "username",
};

/** The host of a URL, or null if it will not parse or carries no host. */
function urlHost(raw: string): string | null {
  try {
    const host = new URL(raw).hostname.replace(/^www\./, "").toLowerCase();
    return host || null;
  } catch {
    // A value that will not parse as a URL yields no host. The extractor only
    // emits well-formed http(s) URLs, but this function is exported and general,
    // so a malformed input returns null rather than throwing.
    return null;
  }
}

/** The domain part of an email address, lower-cased. */
function emailHost(value: string): string {
  return value.slice(value.lastIndexOf("@") + 1).toLowerCase();
}

/**
 * Map the model's extracted identifiers onto the graph's five entity kinds,
 * de-duped by kind + lower-cased value. The primary entity of each kind comes
 * first in extractor order; hosts derived from URLs and emails follow.
 */
export function insightsToEntities(insights: TextInsights): ExtractedEntity[] {
  const out: ExtractedEntity[] = [];
  const seen = new Set<string>();
  const push = (kind: EntityKind, value: string): void => {
    const v = value.trim();
    if (!v) return;
    const key = `${kind}:${v.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ kind, value: v });
  };

  for (const e of insights.entities) {
    const direct = DIRECT_KIND[e.kind];
    if (direct) push(direct, e.value);
    if (e.kind === "email") push("domain", emailHost(e.value));
    if (e.kind === "url") {
      const host = urlHost(e.value);
      if (host) push("domain", host);
    }
  }
  return out;
}

// Which lookup mode runs each extracted kind. A URL is handled separately (its
// host is the runnable value), so it is excluded from this direct map.
const RUN_MODE: Record<Exclude<MlEntityKind, "url">, Mode> = {
  email: "email",
  ip: "ip",
  domain: "domain",
  phone: "phone",
  username: "username",
  wallet: "wallet",
  hash: "hash",
};

/**
 * The lookup an extracted entity can be run as: the mode plus the exact value to
 * feed it. A URL runs as a domain lookup on its host; if the URL will not parse
 * the raw value is used so the action is never dropped silently. Every kind maps
 * to a real mode, so a caller can always offer a one-click "run this".
 */
export function runTargetFor(e: MlEntity): { mode: Mode; value: string } {
  if (e.kind === "url") return { mode: "domain", value: urlHost(e.value) ?? e.value };
  return { mode: RUN_MODE[e.kind], value: e.value };
}

/** English pluraliser shared by the summary lines. */
const plural = (n: number, one: string, many = `${one}s`): string => (n === 1 ? one : many);

const CATEGORY_LABEL: Record<TextInsights["classification"]["category"], string> = {
  credentials: "leaked credentials",
  network: "network / infrastructure",
  financial: "financial / crypto",
  threat: "malware or threat activity",
  personal: "personal / contact data",
  neutral: "no strong topic",
};

/**
 * A short, grounded description of what the model found in a block of text.
 * Every line is gated on a real count or a fired label, so the summary can never
 * over-state the evidence. Returns at least one line.
 */
export function summarizeInsights(insights: TextInsights): string[] {
  const lines: string[] = [];
  const n = insights.entities.length;

  if (n === 0) {
    lines.push("No identifiers were extracted from this text.");
  } else {
    const byKind = new Map<string, number>();
    for (const e of insights.entities) byKind.set(e.kind, (byKind.get(e.kind) ?? 0) + 1);
    const parts = [...byKind.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([kind, count]) => `${count} ${plural(count, kind)}`);
    lines.push(`Extracted ${n} ${plural(n, "identifier")}: ${parts.join(", ")}.`);
  }

  const c = insights.classification;
  if (c.category !== "neutral") {
    lines.push(`Topic reads as ${CATEGORY_LABEL[c.category]} (${Math.round(c.confidence * 100)}% of the topic weight).`);
  }

  if (insights.language.language !== "unknown") {
    lines.push(`Language detected: ${insights.language.language}.`);
  }

  lines.push("Extraction is verbatim from the text you provided; nothing here is inferred about any subject.");
  return lines;
}
