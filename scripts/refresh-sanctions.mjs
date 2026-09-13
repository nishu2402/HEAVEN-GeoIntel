#!/usr/bin/env node
// ── Refresh the OFAC sanctioned-address snapshot ─────────────────────────────
//
// Wallet mode could read a balance and a transaction count and say nothing about
// whether the address is SANCTIONED — which is the first question in any funds
// investigation, and the one question with a legal consequence attached. OFAC
// publishes the answer for free.
//
// Source: the SDN list's XML export. The CSV is easier to parse and is WRONG for
// this purpose: its `remarks` column is truncated, so entries holding many
// addresses lose most of them. Measured on 2026-09-12, the CSV yielded 505
// addresses and the XML 1,059 for the same list. The XML also structures each
// one as an `<id>` with its own type, instead of leaving them to be regexed out
// of a prose field.
//
//   https://www.treasury.gov/ofac/downloads/sdn.xml
//
// The output is a vendored snapshot, matching how the breach catalogs are
// handled: no network call at lookup time, no key, and an offline answer that
// cannot be rate-limited away.
//
//   node scripts/refresh-sanctions.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const SRC = "https://www.treasury.gov/ofac/downloads/sdn.xml";
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "lib", "data", "sanctionedAddresses.snapshot.json");

const res = await fetch(SRC, { headers: { Accept: "text/xml" } });
if (!res.ok) {
  console.error(`fetch failed: HTTP ${res.status}`);
  process.exit(1);
}
const xml = await res.text();

/** Decode the handful of XML entities the SDN export uses. */
const decode = (s) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();

const entries = xml.match(/<sdnEntry>[\s\S]*?<\/sdnEntry>/g) ?? [];
const rows = [];
const byTicker = {};

for (const entry of entries) {
  const ids = [
    ...entry.matchAll(
      /<idType>Digital Currency Address - ([A-Z0-9]+)<\/idType>\s*<idNumber>([^<]+)<\/idNumber>/g,
    ),
  ];
  if (ids.length === 0) continue;

  const last = decode((entry.match(/<lastName>([^<]*)<\/lastName>/) ?? [])[1] ?? "");
  const first = decode((entry.match(/<firstName>([^<]*)<\/firstName>/) ?? [])[1] ?? "");
  const name = [last, first].filter(Boolean).join(", ");
  const uid = (entry.match(/<uid>(\d+)<\/uid>/) ?? [])[1] ?? "";
  const programs = [...entry.matchAll(/<program>([^<]*)<\/program>/g)].map((m) => decode(m[1]));
  const type = decode((entry.match(/<sdnType>([^<]*)<\/sdnType>/) ?? [])[1] ?? "");

  for (const [, ticker, address] of ids) {
    rows.push({
      t: ticker,
      a: address.trim(),
      n: name,
      u: uid,
      p: programs,
      k: type,
    });
    byTicker[ticker] = (byTicker[ticker] ?? 0) + 1;
  }
}

// One address can be listed by two entities; keep the first and note nothing,
// since the screen only needs to answer "is this listed, and by whom".
const seen = new Set();
const unique = rows.filter((r) => {
  const key = `${r.t}:${r.a.toLowerCase()}`;
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
});

const snapshot = {
  source: "US Treasury OFAC Specially Designated Nationals list (SDN.XML)",
  url: SRC,
  fetchedAt: new Date().toISOString().slice(0, 10),
  addresses: unique.sort((a, b) => a.t.localeCompare(b.t) || a.a.localeCompare(b.a)),
};

writeFileSync(OUT, `${JSON.stringify(snapshot, null, 0)}\n`);
console.log(
  `wrote ${OUT}: ${unique.length} addresses across ${Object.keys(byTicker).length} chains ` +
    `(${Object.entries(byTicker).sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t} ${n}`).join(", ")})`,
);
