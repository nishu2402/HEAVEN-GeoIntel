#!/usr/bin/env node
// ── XposedOrNot breach-catalog snapshot refresh ──────────────────────────────
//
// Pulls XposedOrNot's PUBLIC breach catalog (/v1/breaches) and vendors a
// trimmed copy into src/lib/data/xonCatalog.snapshot.json. Run it with
// `npm run breaches:refresh` (which refreshes both catalogs).
//
// Why a SECOND catalog next to the HIBP one:
//   • Enrichment describes a breach a free per-account source returned by name
//     only. The more catalogs describe a name, the fewer bare rows the analyst
//     sees. Measured 2026-09-05, XposedOrNot's catalog carried 43 breaches the
//     HIBP snapshot did not — regional ones (Flipkart, BDV, CouponMom) and
//     combo/stealer lists (AntiPublic, 14 billion records) that HIBP omits.
//   • Both endpoints are keyless catalog endpoints. Neither can answer "is THIS
//     address breached" (XON's per-account lookup is a separate call the routes
//     already make); this file only DESCRIBES a breach, so it never asserts
//     presence — the same boundary the HIBP snapshot keeps.
//
// It is written in the SAME shape as breachCatalog.snapshot.json so the catalog
// module can merge the two raw arrays with one index build: on a key collision
// the richer description (more data classes) wins, so HIBP and XON reinforce
// each other rather than one clobbering the other.
//
// Like the HIBP refresh, this is deliberately NOT a unit test: it needs the live
// internet and writes into the source tree. A maintainer runs it before a
// release and commits the diff.

import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "..", "src", "lib", "data", "xonCatalog.snapshot.json");
const ENDPOINT = "https://api.xposedornot.com/v1/breaches";
const UA = "HEAVEN-GeoIntel catalog refresh (+https://github.com)";

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
  const list = Array.isArray(raw?.exposedBreaches) ? raw.exposedBreaches : null;
  if (!list || list.length === 0) {
    process.stderr.write("FAILED: catalog was empty or not in the expected shape\n");
    process.exit(1);
  }

  const breaches = list
    .map((b) => {
      const entry = {
        name: b.breachID ?? "",
        title: b.breachID ?? "",
        domain: b.domain || null,
        // XON dates are ISO timestamps ("2013-10-04T00:00:00+00:00"); keep the
        // calendar day, which is all the aggregator's date logic uses.
        date: typeof b.breachedDate === "string" ? b.breachedDate.slice(0, 10) : null,
        pwnCount: typeof b.exposedRecords === "number" ? b.exposedRecords : null,
        // exposedData carries a trailing "" on many rows; the catalog builder's
        // canonicalizer drops empties, but trim them here too for a clean file.
        dataClasses: Array.isArray(b.exposedData)
          ? b.exposedData.filter((c) => typeof c === "string" && c.trim())
          : [],
      };
      if (b.verified === true) entry.verified = true;
      return entry;
    })
    .filter((b) => b.name)
    .sort((a, z) => a.name.localeCompare(z.name)); // stable order → clean diffs

  // Version by the newest addedDate so an unchanged catalog re-serializes byte
  // for byte (no spurious diff), matching the HIBP refresh's ModifiedDate trick.
  const version = list
    .map((b) => b.addedDate)
    .filter((d) => typeof d === "string")
    .sort()
    .pop() ?? null;

  const snapshot = {
    source: "XposedOrNot: public breach catalog (/v1/breaches)",
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
