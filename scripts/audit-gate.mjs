#!/usr/bin/env node
/**
 * Dependency-advisory gate.
 *
 *   npm run audit            # human-readable
 *   npm run audit -- --json  # machine-readable (release:verify uses this)
 *   node scripts/audit-gate.mjs --github   # CI: step summary + job outputs
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * The release workflow's first draft ran `npm audit --audit-level=low`. That
 * is the right instinct — a release page claiming "0 vulnerabilities" should be
 * checked rather than typed — but it has a failure mode that only shows up
 * once releases are automated: the gate runs AFTER the tag is pushed, and its
 * input is the npm advisory database, which changes without anyone touching
 * this repo. A `low` advisory published against an eslint transitive at 03:00
 * turns a tag push into a failed release, and the only way out is to fix a dev
 * dependency, amend, force-move the tag and push again — under pressure, for
 * something that cannot reach a single user of the tool.
 *
 * Loosening the threshold to `high` would trade that for a worse problem: a
 * moderate advisory in a package that actually ships would pass silently.
 *
 * The useful distinction is not severity, it is *reachability*:
 *
 *   • Production tree (`npm audit --omit=dev`, ~90 packages) — this is what
 *     `.next/standalone` traces into the downloadable bundle. Code here runs on
 *     the user's machine while it serves requests. ANY severity blocks.
 *
 *   • Dev-only (the other ~550) — eslint, vitest, playwright, the build chain.
 *     Never bundled, never served, reachable only by someone who already has
 *     the repo checked out and runs the tooling. Reported on the release page,
 *     but does not block... except at `critical`, where the realistic exploit
 *     is build-time code execution, which IS a supply-chain path into a
 *     release artifact.
 *
 * So: everything is still surfaced, nothing is silently dropped, and the only
 * advisories that can stop a release are the ones that could reach a user.
 *
 * ── The allowlist ───────────────────────────────────────────────────────────
 *
 * `npm audit` has no native ignore. Without one, a production advisory with no
 * published fix blocks EVERY release, indefinitely, and the only escape is
 * editing the workflow — an untracked, unreviewed decision made in a hurry.
 * `.github/audit-allowlist.json` makes that decision explicit, reviewable in a
 * diff, and time-boxed: each entry carries a reason and an `expires` date,
 * after which it stops suppressing anything. A suppression that nobody
 * revisits is how a known hole ships.
 *
 * Plain Node, no dependencies: this has to run before `npm ci` finishes on a
 * cold runner, and it must not itself be something that can break the gate.
 */

import { readFileSync } from "node:fs";
import { appendFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ALLOWLIST = ".github/audit-allowlist.json";

const args = new Set(process.argv.slice(2));
const asJson = args.has("--json");
const forGithub = args.has("--github");

/** low < moderate < high < critical. `info` is advisory-only by definition. */
const RANK = { info: 0, low: 1, moderate: 2, high: 3, critical: 4 };

// ── Running npm audit ───────────────────────────────────────────────────────

/**
 * `npm audit --json`, tolerating its non-zero exit (it exits 1 whenever it
 * finds anything — the report is still on stdout).
 *
 * Retried, because the one input this gate cannot control is the registry. A
 * transient 5xx from registry.npmjs.org is not a security finding, and failing
 * a release over one is exactly the noise this file exists to remove. Three
 * attempts, then a hard failure that names the cause — an audit that could not
 * run is never treated as an audit that passed.
 */
function audit(omitDev) {
  const flags = ["audit", "--json", ...(omitDev ? ["--omit=dev"] : [])];
  let lastError = "";

  for (let attempt = 1; attempt <= 3; attempt++) {
    let stdout;
    try {
      stdout = execFileSync("npm", flags, {
        cwd: ROOT,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        maxBuffer: 32 * 1024 * 1024,
      });
    } catch (err) {
      stdout = err.stdout ?? "";
      lastError = (err.stderr ?? "").trim() || String(err.message ?? err);
    }

    try {
      const report = JSON.parse(stdout);
      // npm reports registry failures inside a successfully-parsed envelope too.
      if (report.error) {
        lastError = report.error.summary ?? JSON.stringify(report.error);
      } else {
        return report;
      }
    } catch {
      lastError ||= "npm audit produced no parseable JSON";
    }

    // Synchronous backoff. This script is a gate, not a server: making the
    // whole file async to sleep twice would cost more than it buys, and
    // Atomics.wait is allowed on Node's main thread.
    if (attempt < 3) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, attempt * 2000);
  }

  throw new Error(`npm audit could not be run after 3 attempts: ${lastError}`);
}

/**
 * One entry per (package, advisory) pair.
 *
 * npm groups by package and nests the real advisories under `via`, where an
 * entry is either an object (the advisory itself) or a string (this package is
 * only vulnerable *because* of another one). Only the objects carry an id, and
 * only ids can be allowlisted or linked, so the strings are dropped: the
 * package they point at is already in the list on its own.
 */
export function flatten(report) {
  const out = [];
  for (const [name, node] of Object.entries(report.vulnerabilities ?? {})) {
    for (const via of node.via ?? []) {
      if (typeof via !== "object") continue;
      const ghsa = /(GHSA-[0-9a-z-]+)/i.exec(via.url ?? "")?.[1] ?? null;
      out.push({
        package: name,
        severity: via.severity ?? node.severity ?? "low",
        id: ghsa ?? (via.source != null ? String(via.source) : via.title ?? name),
        ghsa,
        source: via.source ?? null,
        title: via.title ?? "(no title)",
        url: via.url ?? null,
        range: via.range ?? node.range ?? "",
        direct: node.isDirect === true,
        fixAvailable: node.fixAvailable !== false,
      });
    }
  }
  // Stable order so two runs of the same tree produce byte-identical output.
  return out.sort((a, b) => RANK[b.severity] - RANK[a.severity] || a.package.localeCompare(b.package) || a.id.localeCompare(b.id));
}

// ── The allowlist ───────────────────────────────────────────────────────────

export function loadAllowlist(today) {
  let raw;
  try {
    raw = readFileSync(join(ROOT, ALLOWLIST), "utf8");
  } catch {
    return []; // absent is the normal, healthy state
  }

  const parsed = JSON.parse(raw);
  const entries = Array.isArray(parsed) ? parsed : (parsed.allow ?? []);

  return entries.map((e) => ({
    ...e,
    // An expiry that has passed stops suppressing. That is the whole point of
    // the field: a suppression nobody renewed is a decision nobody re-made.
    expired: !e.expires || e.expires < today,
  }));
}

/** Does this allowlist entry cover this advisory? */
export function covers(entry, adv) {
  if (entry.package && entry.package !== adv.package) return false;
  const wanted = String(entry.advisory ?? "");
  return wanted === adv.id || wanted === adv.ghsa || wanted === String(adv.source);
}

// ── Policy ──────────────────────────────────────────────────────────────────

/**
 * The whole policy, as a pure function of two audit reports.
 *
 * Split out from the CLI so `tests/releaseGate.test.ts` can drive it with
 * fixtures. The interesting states — a production advisory, an expired
 * suppression, a critical dev dependency — are exactly the ones a healthy tree
 * never reproduces, so a gate that could only be exercised by running `npm
 * audit` against this repo would be a gate whose blocking paths were never
 * tested until the day they fired.
 */
export function classifyReports(prodReport, allReport, allowlist) {
  const prod = flatten(prodReport);
  const all = flatten(allReport);

  const shippedKeys = new Set(prod.map((a) => `${a.package}@${a.id}`));

  const blocking = [];
  const reported = [];
  const suppressed = [];

  for (const adv of all) {
    const shipped = shippedKeys.has(`${adv.package}@${adv.id}`);
    const entry = allowlist.find((e) => covers(e, adv));

    const item = { ...adv, shipped };

    if (entry && !entry.expired) {
      suppressed.push({ ...item, reason: entry.reason, expires: entry.expires });
      continue;
    }
    if (entry?.expired) item.note = `allowlist entry expired ${entry.expires}`;

    // Ships to users, or executes during a build that produces what ships.
    if (shipped || adv.severity === "critical") blocking.push(item);
    else reported.push(item);
  }

  const staleAllowlist = allowlist.filter((e) => !all.some((adv) => covers(e, adv)));

  return { blocking, reported, suppressed, staleAllowlist, counts: { prod: prod.length, total: all.length } };
}

/** Shields.io needs `_` for a space and `--` for a literal hyphen. */
export function badge({ blocking, reported }) {
  const clean = blocking.length === 0 && reported.length === 0;
  return {
    message: clean ? "0" : `0_bundled,_${reported.length}_dev--only`,
    color: clean ? "00C853" : "FFA000",
  };
}

function classify() {
  const today = new Date().toISOString().slice(0, 10);
  return classifyReports(audit(true), audit(false), loadAllowlist(today));
}

// ── Output ──────────────────────────────────────────────────────────────────

const line = (a) =>
  `${a.severity.padEnd(8)} ${a.package}${a.range ? `@${a.range}` : ""} — ${a.title}` +
  `${a.url ? `\n           ${a.url}` : ""}` +
  `${a.fixAvailable ? "" : "\n           no fix published upstream"}` +
  `${a.note ? `\n           ${a.note}` : ""}`;

function main() {
  const result = classify();
  const { blocking, reported, suppressed, staleAllowlist } = result;

  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log("\nDependency advisories\n");
    if (blocking.length) {
      console.log(`  ✘ ${blocking.length} blocking (reaches the published artifact):\n`);
      for (const a of blocking) console.log(`    ${line(a)}\n`);
    } else {
      console.log("  ✔ nothing that reaches the published artifact\n");
    }
    if (reported.length) {
      console.log(`  ! ${reported.length} dev-only, reported but not blocking:\n`);
      for (const a of reported) console.log(`    ${line(a)}\n`);
    }
    for (const a of suppressed) {
      console.log(`  – suppressed until ${a.expires}: ${a.package} ${a.id}\n           ${a.reason}\n`);
    }
    for (const e of staleAllowlist) {
      console.log(`  – stale allowlist entry (matches nothing): ${e.package ?? "?"} ${e.advisory ?? "?"} — remove it from ${ALLOWLIST}\n`);
    }
  }

  if (forGithub && process.env.GITHUB_OUTPUT) {
    const clean = blocking.length === 0 && reported.length === 0;
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      [
        `blocking=${blocking.length}`,
        `reported=${reported.length}`,
        `suppressed=${suppressed.length}`,
        // Rendered straight into the release page's shields.io badge, so the
        // number there is measured rather than typed. Shields reads `_` as a
        // space and `--` as a literal hyphen; kept ASCII so the badge URL needs
        // no percent-encoding on its way through the workflow.
        `badge_message=${clean ? "0" : `0_bundled,_${reported.length}_dev--only`}`,
        `badge_color=${clean ? "00C853" : "FFA000"}`,
      ].join("\n") + "\n",
    );
  }

  if (forGithub && process.env.GITHUB_STEP_SUMMARY) {
    const rows = [...blocking, ...reported]
      .map((a) => `| ${a.shipped ? "**ships**" : "dev-only"} | ${a.severity} | \`${a.package}\` | ${a.url ? `[${a.title}](${a.url})` : a.title} |`)
      .join("\n");
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `## Dependency advisories\n\n` +
        (rows
          ? `| Reach | Severity | Package | Advisory |\n|---|---|---|---|\n${rows}\n`
          : `No advisories in ${result.counts.total === 0 ? "any" : "the"} dependency tree.\n`) +
        (suppressed.length ? `\n${suppressed.length} allowlisted (see \`${ALLOWLIST}\`).\n` : "") +
        "\n",
    );
  }

  if (blocking.length) {
    if (!asJson) {
      console.log(
        `${blocking.length} advisory/advisories reach the published artifact — this release is blocked.\n` +
          `Fix them (\`npm audit fix\`), or, if upstream has no fix, add a reasoned time-boxed entry to ${ALLOWLIST}.\n`,
      );
    }
    process.exit(1);
  }

  if (!asJson) {
    console.log(
      reported.length
        ? `Clear to release: ${reported.length} dev-only advisory/advisories, none of which ship.\n`
        : "Clear to release: 0 advisories.\n",
    );
  }
}

// Importable for tests, executable for the gate. `main()` shells out to npm
// twice, so importing the policy must not trigger it.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
