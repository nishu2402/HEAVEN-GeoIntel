/**
 * The numbers the poster and the terminal banner are allowed to print.
 *
 * Shared by `scripts/generate-poster.mjs` (which renders them) and
 * `tests/posterAssets.test.ts` (which re-derives them and fails if the
 * committed artwork no longer matches). Keeping the derivation in ONE place is
 * what makes that test meaningful: if the test computed the numbers its own
 * way, it would be checking two guesses against each other.
 *
 * Every value is read from the real source of truth. Nothing is typed in.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { APP_VERSION } from "../src/lib/version.ts";
import { SOURCES } from "../src/lib/sources/manifest.ts";
import { MODES } from "../src/lib/client/modes.ts";
import { ENDPOINTS } from "../src/lib/api/endpoints.ts";

/** Entries in the bundled username catalog, and how many are auto-verified. */
export function usernameCatalog(root) {
  // Parsed rather than imported: usernameSites.ts pulls in the overlay loader,
  // whose extensionless specifier plain Node ESM will not resolve. Both counts
  // are asserted against the module itself in tests/posterAssets.test.ts, so a
  // refactor that changes the file's shape fails the suite rather than quietly
  // counting zero.
  const src = readFileSync(join(root, "src/lib/data/usernameSites.ts"), "utf8");
  const total = (src.match(/^ {2}\{ name:/gm) ?? []).length;
  const manual = (src.match(/check: "manual"/g) ?? []).length;
  return { total, manual, auto: total - manual };
}

/** The coverage percentage the build gate actually enforces. */
export function coverageThreshold(root) {
  const src = readFileSync(join(root, "vitest.config.ts"), "utf8");
  return Number(src.match(/statements:\s*(\d+)/)[1]);
}

export function posterStats(root) {
  const sites = usernameCatalog(root);
  return {
    version: APP_VERSION,
    identifiers: MODES.filter((m) => m.lookup).length,
    modes: MODES.length,
    sources: SOURCES.length,
    freeSources: SOURCES.filter((s) => s.tier === "free").length,
    usernameSites: sites.total,
    autoVerified: sites.auto,
    apiOperations: ENDPOINTS.length,
    coverage: coverageThreshold(root),
  };
}
