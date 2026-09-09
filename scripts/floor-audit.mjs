#!/usr/bin/env node
/**
 * Declared-floor advisory check.
 *
 *   npm run audit:floors
 *   npm run audit:floors -- --json
 *
 * ── Why this exists, next to audit-gate.mjs ─────────────────────────────────
 *
 * `npm audit` resolves the LOCKFILE. That is the right input for "what does
 * the artifact we ship contain", which is what audit-gate.mjs asks. It is the
 * wrong input for a different question: "what could a fresh install of this
 * manifest produce?"
 *
 * Those two answers came apart twice.
 *
 *   • postcss, before 3.0.0. The floor was `^8`; the lowest version satisfying
 *     it (8.0.x) carried seven advisories. The lock held a patched 8.5.x, so
 *     `npm audit` was clean and stayed clean.
 *   • next, on 2026-09-09. The floor was `^16.2.12`, which permits 16.2.12
 *     through 16.3.2 — every one of them inside the affected range of
 *     GHSA-2xp9-vwfh-vxw4 and GHSA-p293-qw3h-jr36, two unauthenticated-RCE
 *     advisories fixed in 16.3.3. The lock held 16.3.4, so again `npm audit`
 *     reported zero. An external SCA scan reading package.json reported two
 *     criticals, and it was right about the manifest.
 *
 * A caret range is meant to be permissive, so "floor must equal the lock" is
 * the wrong rule — 14 of this repo's 30 ranges sit below their locked version
 * perfectly safely. The only thing that matters is whether the LOWEST version
 * the range admits carries an advisory.
 *
 * ── Why this is not wired into the release gate ─────────────────────────────
 *
 * audit-gate.mjs is deliberately built so that it cannot itself break a
 * release. This check needs a second network source (OSV) that the release
 * path does not otherwise depend on, and its input — an advisory database —
 * changes without anyone touching this repo, which is the exact property that
 * docblock argues should keep something OUT of a tag-time gate. So it is run
 * on demand and reports; it is not a step between a tag and a release.
 *
 * Unreachable is reported as unreachable, never as clean.
 */

import { readFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const run = promisify(execFile);

// ── Policy ──────────────────────────────────────────────────────────────────

/**
 * One declared range, resolved. `min` is null when nothing published satisfies
 * the range, which is an unanswered question rather than a clean result.
 *
 * @typedef {{ name: string, range: string, prod: boolean, min: string | null, vulns: string[] }} FloorRow
 */

/**
 * The whole policy, as a pure function of the resolved rows.
 *
 * Split out from the IO so tests can drive it with fixtures, matching
 * audit-gate.mjs: the interesting state (a production floor admitting a known
 * advisory) is one a healthy tree never reproduces, so a check that could only
 * be exercised against a live registry would have its blocking path untested
 * until the day it fired.
 *
 * The production/dev split is the same reachability argument audit-gate.mjs
 * makes. A dev-only floor cannot reach anyone running the tool, so it is
 * reported and does not block.
 *
 * @param {FloorRow[]} rows
 * @returns {{ blocking: FloorRow[], reported: FloorRow[], unresolved: FloorRow[], checked: number }}
 */
export function classifyFloors(rows) {
  const hits = rows.filter((r) => r.vulns.length > 0);
  return {
    blocking: hits.filter((r) => r.prod),
    reported: hits.filter((r) => !r.prod),
    unresolved: rows.filter((r) => r.min === null),
    checked: rows.filter((r) => r.min !== null).length,
  };
}

// ── Resolution ──────────────────────────────────────────────────────────────

/** The lowest published version the declared range admits. */
async function lowestSatisfying(name, range) {
  try {
    const { stdout } = await run("npm", ["view", `${name}@${range}`, "version", "--json"], {
      cwd: ROOT, maxBuffer: 8 * 1024 * 1024,
    });
    const parsed = JSON.parse(stdout);
    // npm lists matches ascending; a range matching exactly one version yields
    // a bare string rather than an array.
    const list = Array.isArray(parsed) ? parsed : [parsed];
    return list[0] ?? null;
  } catch {
    return null;
  }
}

async function advisoriesFor(queries) {
  const res = await fetch("https://api.osv.dev/v1/querybatch", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ queries }),
  });
  if (!res.ok) throw new Error(`OSV responded ${res.status}`);
  const { results } = await res.json();
  return results ?? [];
}

// ── CLI ─────────────────────────────────────────────────────────────────────

async function main() {
  const asJson = process.argv.slice(2).includes("--json");
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  const prod = pkg.dependencies ?? {};
  const declared = Object.entries({ ...prod, ...(pkg.devDependencies ?? {}) });

  const rows = await Promise.all(
    declared.map(async ([name, range]) => ({
      name, range, prod: name in prod, min: await lowestSatisfying(name, range), vulns: [],
    })),
  );

  const resolved = rows.filter((r) => r.min !== null);
  let results;
  try {
    results = await advisoriesFor(
      resolved.map((r) => ({ package: { name: r.name, ecosystem: "npm" }, version: r.min })),
    );
  } catch (err) {
    // An advisory source that could not be reached has told us nothing. Saying
    // "0 findings" here would be inventing a clean result.
    console.error(`Could not reach the advisory database: ${err.message}`);
    console.error("No conclusion drawn — re-run when it is reachable.");
    process.exit(2);
  }
  resolved.forEach((r, i) => { r.vulns = (results[i]?.vulns ?? []).map((v) => v.id); });

  const verdict = classifyFloors(rows);

  if (asJson) {
    console.log(JSON.stringify(verdict, null, 2));
  } else {
    console.log("\nDeclared-floor advisory check\n");
    for (const r of [...verdict.blocking, ...verdict.reported]) {
      const tree = r.prod ? "ships" : "dev-only";
      console.log(`  ${r.prod ? "✘" : "!"} ${r.name} ${r.range} admits ${r.min} (${tree})`);
      console.log(`      ${r.vulns.join(", ")}`);
    }
    for (const r of verdict.unresolved) {
      console.log(`  ? ${r.name} ${r.range} — no published version resolved`);
    }
    if (!verdict.blocking.length && !verdict.reported.length) {
      console.log(`  ✔ ${verdict.checked} declared ranges; none admits a known-vulnerable version`);
    }
    console.log(
      verdict.blocking.length
        ? `\n${verdict.blocking.length} production floor(s) admit a known-vulnerable install. Raise the floor above the fixed-in version.\n`
        : "\nNothing that ships can be installed vulnerable from this manifest.\n",
    );
  }

  process.exit(verdict.blocking.length ? 1 : 0);
}

// Importable for tests without running the CLI.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
