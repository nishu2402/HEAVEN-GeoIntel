#!/usr/bin/env node
// ── Refresh the extended username-site overlay from WhatsMyName ───────────────
//
// Regenerates src/lib/data/extendedUsernameSites.ts from the WhatsMyName project
// (wmn-data.json). We vendor ONLY the site name, category and URL template — the
// three fields needed to open a profile in the browser. The detection strings
// (e_string / m_string / e_code …) are deliberately dropped: this overlay never
// auto-verifies a handle, it only offers manual "open to check" launch links, so
// there is no false-positive surface and the community detection heuristics are
// not something we depend on.
//
// Source: WhatsMyName by Micah Hoffman — CC BY-SA 4.0.
//   https://github.com/WebBreacher/WhatsMyName
// The generated data file carries that attribution + licence, as share-alike
// requires.
//
//   node scripts/refresh-username-sites.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const SRC = "https://raw.githubusercontent.com/WebBreacher/WhatsMyName/main/wmn-data.json";
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "lib", "data", "extendedUsernameSites.ts");

const res = await fetch(SRC);
if (!res.ok) { console.error(`fetch failed: HTTP ${res.status}`); process.exit(1); }
const data = await res.json();
const sites = Array.isArray(data.sites) ? data.sites : [];

const rows = sites
  .map((s) => {
    const template = (s.uri_pretty && String(s.uri_pretty)) || String(s.uri_check ?? "");
    return { n: String(s.name ?? "").trim(), c: String(s.cat ?? "misc").trim(), u: template.trim() };
  })
  // Keep only https templates that carry the {account} placeholder — anything
  // else cannot be turned into a safe, correct launch link.
  .filter((r) => r.n && r.u.startsWith("https://") && r.u.includes("{account}"))
  .sort((a, b) => a.c.localeCompare(b.c) || a.n.localeCompare(b.n));

const seen = new Set();
const unique = rows.filter((r) => {
  const k = r.n.toLowerCase();
  if (seen.has(k)) return false;
  seen.add(k);
  return true;
});

const esc = (s) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
const body = unique.map((r) => `  { n: "${esc(r.n)}", c: "${esc(r.c)}", u: "${esc(r.u)}" },`).join("\n");

const file = `// ── Extended username-site overlay (WhatsMyName) — AUTO-GENERATED ─────────────
//
// DO NOT EDIT BY HAND. Regenerate with: node scripts/refresh-username-sites.mjs
//
// Source: WhatsMyName by Micah Hoffman — https://github.com/WebBreacher/WhatsMyName
// Licensed CC BY-SA 4.0 (http://creativecommons.org/licenses/by-sa/4.0/). Only the
// site name, category and URL template are vendored; the detection strings are
// dropped because this overlay offers MANUAL "open to verify" launch links only —
// it never auto-claims a handle, so it has no false-positive surface.
//
// ${unique.length} sites across ${new Set(unique.map((r) => r.c)).size} categories.

export interface ExtendedSite {
  /** Site name. */
  n: string;
  /** Category (WhatsMyName's own taxonomy). */
  c: string;
  /** URL template — {account} is replaced with the (encoded) handle. */
  u: string;
}

export const EXTENDED_USERNAME_SITES: ExtendedSite[] = [
${body}
];
`;

writeFileSync(OUT, file);
console.log(`wrote ${OUT}: ${unique.length} sites, ${new Set(unique.map((r) => r.c)).size} categories`);
