#!/usr/bin/env node
// ── Wikipedia notable-breaches snapshot refresh ──────────────────────────────
//
// Pulls Wikipedia's PUBLIC "List of data breaches" article and vendors a trimmed
// copy into src/lib/data/wikipediaBreaches.snapshot.json. Run it with
// `npm run breaches:refresh` (which refreshes all three catalogs).
//
// Why a THIRD catalog next to HIBP and XposedOrNot, and how it differs:
//   • HIBP and XON are CREDENTIAL catalogs: they describe breaches that a free
//     per-account index (XposedOrNot, LeakCheck) can actually return for a person
//     — consumer sites with leaked email/password sets, each row carrying data
//     classes. Between them they already describe most named credential breaches.
//   • Wikipedia's list is different in KIND: large government and institutional
//     breaches (population registries, health ministries, tax authorities) that
//     never entered a credential corpus, so no keyless per-account source returns
//     them and the credential catalogs do not carry them. It has no per-breach
//     data classes and no domains, so it is deliberately kept as a SEPARATE,
//     lower-tier "notable breaches" set: it never overrides a credential row and
//     only DESCRIBES a breach some source named, filling a record count and year.
//     The catalog module counts it apart from the rich describable set so the
//     "describable breaches" figure stays honest.
//
// Accuracy first (the project's no-false-positives rule): a row is vendored ONLY
// when its Records cell is a clean integer. Anything prose, ranged, "unknown" or
// footnoted is SKIPPED rather than guessed at, so the snapshot never carries a
// wrong count. Ambiguous entity names ("Unknown", "Various") are dropped too.
//
// Like the other refreshes, this is deliberately NOT a unit test: it needs the
// live internet and writes into the source tree. A maintainer runs it before a
// release and commits the diff.

import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "..", "src", "lib", "data", "wikipediaBreaches.snapshot.json");
const ENDPOINT = "https://en.wikipedia.org/w/api.php";
const PAGE = "List of data breaches";
const UA = "HEAVEN-GeoIntel catalog refresh (+https://github.com)";

// Entity names too generic to key safely — they would collide across unrelated
// incidents, so we skip the whole row rather than risk a wrong attribution.
const AMBIGUOUS = new Set(["", "unknown", "various", "n/a", "multiple", "undisclosed"]);

/** Strip refs, templates, wikilinks and HTML from a cell's inner text. */
function stripWiki(s) {
  return s
    .replace(/<ref[^>]*\/>/gi, "")
    .replace(/<ref[\s\S]*?<\/ref>/gi, "")
    .replace(/\{\{[^{}]*\}\}/g, "")
    .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, "$1")
    .replace(/\[[^\s\]]+\s([^\]]*)\]/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/'''?/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Drop a leading wikitable cell-attribute prefix ('data-sort-value="1"| …'). */
function dropCellAttrs(cell) {
  const m = cell.match(/^\s*(?:[\w-]+\s*=\s*(?:"[^"]*"|[^\s|]+)\s*)+\|(?!\|)/);
  return m ? cell.slice(m[0].length) : cell;
}

/** Split one wikitext table row into its cell strings (line and inline cells). */
function rowCells(row) {
  // Inline "||" separators become line separators, then every cell starts "|".
  const norm = row.replace(/\|\|/g, "\n|");
  return norm
    .split(/\n/)
    .filter((line) => line.startsWith("|") && !line.startsWith("|-") && !line.startsWith("|+"))
    .map((line) => stripWiki(dropCellAttrs(line.replace(/^\|/, ""))));
}

/** Header cells, for locating the Year and Records columns by label. */
function headerCells(row) {
  const norm = row.replace(/!!/g, "\n!").replace(/\|\|/g, "\n!");
  return norm
    .split(/\n/)
    .filter((line) => line.startsWith("!"))
    .map((line) => stripWiki(dropCellAttrs(line.replace(/^!/, ""))).toLowerCase());
}

/** A clean integer of >=3 digits, else null. Never guesses at prose/ranges. */
function cleanRecords(cell) {
  const t = cell.replace(/,/g, "").replace(/\+$/, "").trim();
  return /^\d{3,}$/.test(t) ? Number(t) : null;
}

/** A 4-digit year, else null. */
function cleanYear(cell) {
  const m = cell.match(/\b(19|20)\d{2}\b/);
  return m ? m[0] : null;
}

function parseBreaches(wikitext) {
  const out = [];
  const seen = new Set();
  // Every {| … |} wikitable on the page.
  const tables = wikitext.match(/\{\|[\s\S]*?\n\|\}/g) ?? [];
  for (const table of tables) {
    if (!/wikitable/.test(table.slice(0, 80))) continue;
    const rows = table.split(/\n\|-/);
    // Find the header row (has "record" / "year" labels) to locate columns.
    let recordsIdx = -1;
    let yearIdx = -1;
    for (const r of rows) {
      const h = headerCells(r);
      if (h.length === 0) continue;
      const ri = h.findIndex((c) => c.includes("record"));
      const yi = h.findIndex((c) => c.includes("year"));
      if (ri >= 0) { recordsIdx = ri; yearIdx = yi; break; }
    }
    if (recordsIdx < 0) continue;

    for (const r of rows) {
      if (/^\s*\n?!/.test(r) || headerCells(r).length > 0) continue; // skip headers
      const cells = rowCells(r);
      if (cells.length <= recordsIdx) continue;
      const records = cleanRecords(cells[recordsIdx]);
      if (records === null) continue; // no clean count → skip, never guess
      // Entity: the most specific cell before the Year column, else the first.
      const nameCell = (yearIdx > 0 && cells[yearIdx - 1]) || cells[0] || "";
      const name = nameCell.replace(/\s*\(.*?\)\s*$/, "").trim();
      if (AMBIGUOUS.has(name.toLowerCase()) || name.length < 3) continue;
      const year = yearIdx >= 0 ? cleanYear(cells[yearIdx] ?? "") : null;
      const key = name.toLowerCase();
      if (seen.has(key)) continue; // first mention wins, stable diffs
      seen.add(key);
      out.push({ name, title: name, date: year, pwnCount: records });
    }
  }
  return out.sort((a, z) => a.name.localeCompare(z.name));
}

async function main() {
  const url = `${ENDPOINT}?action=parse&page=${encodeURIComponent(PAGE)}&prop=wikitext|revid&format=json&formatversion=2`;
  process.stdout.write(`Fetching ${PAGE} …\n`);
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    process.stderr.write(`FAILED: HTTP ${res.status}\n`);
    process.exit(1);
  }
  const raw = await res.json();
  const wikitext = raw?.parse?.wikitext;
  if (typeof wikitext !== "string" || wikitext.length === 0) {
    process.stderr.write("FAILED: article wikitext was empty or not in the expected shape\n");
    process.exit(1);
  }

  const breaches = parseBreaches(wikitext);
  if (breaches.length === 0) {
    process.stderr.write("FAILED: parsed no clean breach rows (article layout may have changed)\n");
    process.exit(1);
  }

  const snapshot = {
    source: "Wikipedia: List of data breaches (notable government / institutional, record counts only)",
    version: raw?.parse?.revid != null ? String(raw.parse.revid) : null,
    count: breaches.length,
    breaches,
  };

  await writeFile(OUT, JSON.stringify(snapshot, null, 0) + "\n", "utf8");
  process.stdout.write(`Wrote ${breaches.length} notable breaches → ${path.relative(process.cwd(), OUT)}\n`);
  process.stdout.write(`Article revision: ${snapshot.version}\n`);
}

main().catch((err) => {
  process.stderr.write(`FAILED: ${err?.message ?? err}\n`);
  process.exit(1);
});
