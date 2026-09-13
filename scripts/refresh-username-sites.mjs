#!/usr/bin/env node
// ── Refresh the WhatsMyName site catalog ─────────────────────────────────────
//
// Regenerates src/lib/data/extendedUsernameSites.ts from WhatsMyName's
// wmn-data.json.
//
// This used to vendor ONLY the name, category and URL, dropping the detection
// strings on the reasoning that a manual "open to verify" link has no
// false-positive surface. True, and it also meant 15 of 38 sites in the main
// sweep were handed to the analyst as homework while 670 more sat unchecked.
//
// The detection contract is now vendored, because it is STRICTER than the rule
// the main sweep applies to itself:
//
//   present  =  HTTP status == e_code  AND  body contains e_string
//   absent   =  HTTP status == m_code  AND  body contains m_string
//   anything else = unknown, and reported as unknown
//
// A bare "HTTP 200 means found" probe cannot tell a real profile from a
// soft-404 landing page. This can, and where it cannot it says so.
//
// Each site also ships `known` accounts, which is what makes the contract
// auditable: `--validate` probes every site with a real handle and a
// nonexistent one and records the result, so a site whose markers have rotted
// is demoted rather than quietly producing noise.
//
// Source: WhatsMyName by Micah Hoffman — CC BY-SA 4.0.
//   https://github.com/WebBreacher/WhatsMyName
// The generated file carries that attribution and licence, as share-alike
// requires.
//
//   node scripts/refresh-username-sites.mjs [--validate] [--only=N]

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const SRC = "https://raw.githubusercontent.com/WebBreacher/WhatsMyName/main/wmn-data.json";
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "lib", "data", "extendedUsernameSites.ts");

const args = process.argv.slice(2);
const VALIDATE = args.includes("--validate");
const ONLY = Number((args.find((a) => a.startsWith("--only=")) ?? "").split("=")[1] || "0");

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
/** A handle no platform can plausibly have issued, for the absence probe. */
const ABSENT_HANDLE = `hvgi${Math.random().toString(36).slice(2, 10)}zzq`;
const CONCURRENCY = 16;
const TIMEOUT_MS = 9000;

const res = await fetch(SRC);
if (!res.ok) { console.error(`fetch failed: HTTP ${res.status}`); process.exit(1); }
const data = await res.json();
const sites = Array.isArray(data.sites) ? data.sites : [];

const str = (v) => (typeof v === "string" ? v : "");
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

const rows = sites
  .map((s) => ({
    n: str(s.name).trim(),
    c: str(s.cat ?? "misc").trim() || "misc",
    u: str(s.uri_check).trim(),
    p: str(s.uri_pretty).trim(),
    ec: num(s.e_code),
    es: str(s.e_string),
    mc: num(s.m_code),
    ms: str(s.m_string),
    k: Array.isArray(s.known) ? s.known.filter((x) => typeof x === "string").slice(0, 2) : [],
    pr: Array.isArray(s.protection) ? s.protection.filter((x) => typeof x === "string") : [],
    // WhatsMyName's own "this entry is known broken" flag, plus the request
    // shapes this tool does not send: a POST body or custom headers.
    skip: s.valid === false || Boolean(s.post_body) || Boolean(s.headers),
  }))
  // An https check URL carrying {account} is the minimum for a safe probe.
  .filter((r) => r.n && r.u.startsWith("https://") && r.u.includes("{account}"))
  .sort((a, b) => a.c.localeCompare(b.c) || a.n.localeCompare(b.n));

const seen = new Set();
const unique = rows.filter((r) => {
  const k = r.n.toLowerCase();
  if (seen.has(k)) return false;
  seen.add(k);
  return true;
});

/** Sites whose contract is complete enough to auto-classify with. */
const autoCapable = (r) => !r.skip && r.ec !== null && r.mc !== null && (r.es !== "" || r.ms !== "");

// ── Optional live validation against the `known` accounts ────────────────────

async function probe(url) {
  try {
    const r = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" },
      redirect: "follow",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = (await r.text()).slice(0, 60000);
    return { status: r.status, body };
  } catch {
    return null;
  }
}

function classify(site, status, body) {
  const present = status === site.ec && (site.es === "" || body.includes(site.es));
  const absent = status === site.mc && (site.ms === "" || body.includes(site.ms));
  if (present && absent) return "unknown";
  if (present) return "found";
  if (absent) return "notfound";
  return "unknown";
}

async function validate(list) {
  const targets = list.filter((r) => autoCapable(r) && r.k.length > 0);
  const work = ONLY > 0 ? targets.slice(0, ONLY) : targets;
  let done = 0;
  let pass = 0;

  const queue = [...work];
  const worker = async () => {
    for (;;) {
      const site = queue.shift();
      if (!site) return;
      const hit = await probe(site.u.replace(/\{account\}/g, encodeURIComponent(site.k[0])));
      const miss = await probe(site.u.replace(/\{account\}/g, ABSENT_HANDLE));
      const hitClass = hit ? classify(site, hit.status, hit.body) : "unreachable";
      const missClass = miss ? classify(site, miss.status, miss.body) : "unreachable";
      site.v = hitClass === "found" && missClass === "notfound";
      if (site.v) pass++;
      done++;
      if (done % 25 === 0) process.stderr.write(`validated ${done}/${work.length} (${pass} pass)\n`);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.error(`validation: ${pass}/${work.length} sites behaved as documented`);
}

if (VALIDATE) await validate(unique);

// ── Emit ─────────────────────────────────────────────────────────────────────

const esc = (s) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "\\r");
const field = (k, v) => (v === "" || v === null || v === undefined ? "" : `${k}: "${esc(String(v))}", `);
const numField = (k, v) => (v === null ? "" : `${k}: ${v}, `);

const body = unique
  .map((r) => {
    const parts = [
      `n: "${esc(r.n)}"`,
      `c: "${esc(r.c)}"`,
      `u: "${esc(r.u)}"`,
      r.p && r.p !== r.u ? `p: "${esc(r.p)}"` : "",
      r.ec === null ? "" : `ec: ${r.ec}`,
      r.es ? `es: "${esc(r.es)}"` : "",
      r.mc === null ? "" : `mc: ${r.mc}`,
      r.ms ? `ms: "${esc(r.ms)}"` : "",
      r.k.length ? `k: [${r.k.map((x) => `"${esc(x)}"`).join(", ")}]` : "",
      r.pr.length ? `pr: [${r.pr.map((x) => `"${esc(x)}"`).join(", ")}]` : "",
      r.skip ? "skip: true" : "",
      r.v === true ? "v: true" : r.v === false ? "v: false" : "",
    ].filter(Boolean);
    return `  { ${parts.join(", ")} },`;
  })
  .join("\n");
void field;
void numField;

const categories = new Set(unique.map((r) => r.c)).size;
const auto = unique.filter(autoCapable).length;
const validated = unique.filter((r) => r.v === true).length;

const file = `// ── WhatsMyName site catalog — AUTO-GENERATED ─────────────────────────────────
//
// DO NOT EDIT BY HAND. Regenerate with: node scripts/refresh-username-sites.mjs
//
// Source: WhatsMyName by Micah Hoffman — https://github.com/WebBreacher/WhatsMyName
// Licensed CC BY-SA 4.0 (http://creativecommons.org/licenses/by-sa/4.0/).
//
// ${unique.length} sites across ${categories} categories; ${auto} carry a complete
// detection contract (e_code + e_string / m_code + m_string) and can therefore be
// auto-classified by the deep sweep. The rest are offered as manual
// "open to verify" links, exactly as the whole catalog used to be.
//
// The contract is STRICTER than a bare status probe: a site is only reported as
// found when the status AND the presence marker both match, and only as notfound
// when the status AND the absence marker both match. Anything else is unknown.
${VALIDATE ? `//\n// ${validated} sites were live-validated against their own \`known\` accounts.\n` : ""}
export interface ExtendedSite {
  /** Site name. */
  n: string;
  /** Category (WhatsMyName's own taxonomy). */
  c: string;
  /** Probe URL template — {account} is replaced with the (encoded) handle. */
  u: string;
  /** Prettier profile URL template shown to the analyst, when it differs. */
  p?: string;
  /** HTTP status that means the account EXISTS. */
  ec?: number;
  /** Body substring that means the account EXISTS. */
  es?: string;
  /** HTTP status that means the account is FREE. */
  mc?: number;
  /** Body substring that means the account is FREE. */
  ms?: string;
  /** Accounts known to exist, used to validate the contract at refresh time. */
  k?: string[];
  /** Anti-bot protection the upstream records (captcha, cloudflare, …). */
  pr?: string[];
  /** True when the entry must never be probed (upstream-invalid, or needs POST). */
  skip?: boolean;
  /** Live validation result from the last \`--validate\` run, when one was done. */
  v?: boolean;
}

export const EXTENDED_USERNAME_SITES: ExtendedSite[] = [
${body}
];
`;

writeFileSync(OUT, file);
console.log(
  `wrote ${OUT}: ${unique.length} sites, ${categories} categories, ${auto} auto-capable` +
    (VALIDATE ? `, ${validated} validated` : ""),
);
