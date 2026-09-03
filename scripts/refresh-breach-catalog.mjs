#!/usr/bin/env node
// ── Breach-catalog snapshot refresh ──────────────────────────────────────────
//
// Pulls Have I Been Pwned's PUBLIC breach catalog and vendors a trimmed copy
// into the repo at src/lib/data/breachCatalog.snapshot.json. Run it with
// `npm run breaches:refresh`.
//
// Why a vendored snapshot instead of a live call:
//   • The catalog endpoint (/api/v3/breaches) is keyless and lists ~1000
//     breaches with data classes, record counts, dates and quality flags. The
//     PER-ACCOUNT endpoint needs a paid key, so this catalog can never answer
//     "is THIS address breached" — the free indexes (XposedOrNot, LeakCheck)
//     do that. What it CAN do is describe a breach the free sources returned by
//     name only, giving each row real data classes and a record count.
//   • Doing that at lookup time would mean a network round-trip per lookup to a
//     rate-limited host for data that changes a few times a week. Vendoring it
//     means enrichment costs nothing, works fully offline, and a rate-limited
//     upstream degrades to "last known" rather than "unavailable" — which is
//     the whole point of the self-hosted-first direction.
//
// It is deliberately NOT a unit test. It needs the live internet and writes a
// file into the source tree; a maintainer runs it before a release and commits
// the diff, the same way `links:check` is run by hand.
//
// The snapshot keeps only the fields enrichment and the domain view use. It
// drops HIBP's prose Description, logo path and URLs — none of which the tool
// renders — so the vendored file stays a few hundred KB, not megabytes.

import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "..", "src", "lib", "data", "breachCatalog.snapshot.json");
const ENDPOINT = "https://haveibeenpwned.com/api/v3/breaches";
const UA = "HEAVEN-GeoIntel catalog refresh (+https://github.com)";

/** Keep the boolean only when true, so the snapshot omits the common false case. */
function flags(b) {
  const out = {};
  if (b.IsVerified) out.verified = true;
  if (b.IsFabricated) out.fabricated = true;
  if (b.IsSpamList) out.spamList = true;
  if (b.IsMalware) out.malware = true;
  if (b.IsStealerLog) out.stealerLog = true;
  if (b.IsRetired) out.retired = true;
  return out;
}

async function main() {
  process.stdout.write(`Fetching ${ENDPOINT} …\n`);
  const res = await fetch(ENDPOINT, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    process.stderr.write(`FAILED: HTTP ${res.status}\n`);
    process.exit(1);
  }
  const raw = await res.json();
  if (!Array.isArray(raw) || raw.length === 0) {
    process.stderr.write("FAILED: catalog was empty or not an array\n");
    process.exit(1);
  }

  const breaches = raw
    .map((b) => ({
      name: b.Name ?? b.Title ?? "",
      title: b.Title ?? b.Name ?? "",
      domain: b.Domain || null,
      date: b.BreachDate || null,
      pwnCount: typeof b.PwnCount === "number" ? b.PwnCount : null,
      dataClasses: Array.isArray(b.DataClasses) ? b.DataClasses : [],
      ...flags(b),
    }))
    .filter((b) => b.name)
    .sort((a, z) => a.name.localeCompare(z.name)); // stable order → clean diffs

  // Version the snapshot by the latest ModifiedDate in the catalog rather than
  // the wall clock, so re-running on an unchanged catalog produces an identical
  // file (no spurious diff).
  const version = raw
    .map((b) => b.ModifiedDate)
    .filter((d) => typeof d === "string")
    .sort()
    .pop() ?? null;

  const snapshot = {
    source: "Have I Been Pwned: public breach catalog (/api/v3/breaches)",
    version,
    count: breaches.length,
    breaches,
  };

  await writeFile(OUT, JSON.stringify(snapshot, null, 0) + "\n", "utf8");
  process.stdout.write(`Wrote ${breaches.length} breaches → ${path.relative(process.cwd(), OUT)}\n`);
  process.stdout.write(`Catalog version: ${version}\n`);
}

main().catch((err) => {
  process.stderr.write(`FAILED: ${err?.message ?? err}\n`);
  process.exit(1);
});
