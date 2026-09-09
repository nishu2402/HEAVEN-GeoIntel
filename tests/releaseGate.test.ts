import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
// Plain-Node gate script, deliberately not TypeScript: it has to run on a cold
// CI runner before anything is installed.
import { flatten, covers, classifyReports, badge } from "../scripts/audit-gate.mjs";
import { classifyFloors } from "../scripts/floor-audit.mjs";

// ── The release's dependency-advisory policy ─────────────────────────────────
//
// The release workflow's first draft gated on `npm audit --audit-level=low`.
// The instinct was right — the release page claims "0 vulnerabilities", and a claim
// should be measured — but the gate runs AFTER the tag is pushed and its input
// is the advisory database, which changes with no commit to this repo. A `low`
// advisory published overnight against an eslint transitive would fail a
// release for something that cannot reach a single user, and the way out is to
// patch a dev dependency, amend, force-move the tag and push again.
//
// scripts/audit-gate.mjs blocks on *reachability* instead. This suite pins the
// policy, because the states that matter are exactly the ones a healthy tree
// never produces: running the real gate here proves only that today's lockfile
// is clean, never that a production advisory would actually stop a release.

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

type Via = { severity: string; source?: number; title?: string; url?: string; range?: string };

/** Build an `npm audit --json` envelope with the shape npm actually emits. */
function report(pkgs: Record<string, { severity: string; via: (Via | string)[]; fixAvailable?: boolean }>) {
  return {
    vulnerabilities: Object.fromEntries(
      Object.entries(pkgs).map(([name, v]) => [
        name,
        { name, severity: v.severity, via: v.via, range: "*", isDirect: false, fixAvailable: v.fixAvailable ?? true },
      ]),
    ),
  };
}

const advisory = (severity: string, ghsa: string, title = "something bad"): Via => ({
  severity,
  source: 1234,
  title,
  url: `https://github.com/advisories/${ghsa}`,
});

describe("flatten", () => {
  it("keeps one row per advisory and drops npm's string back-references", () => {
    // A `via` string means "vulnerable only because of that other package",
    // which carries no id — nothing to allowlist and nothing to link, and the
    // package it names is already a row of its own.
    const rows = flatten(
      report({
        left: { severity: "high", via: [advisory("high", "GHSA-aaaa-bbbb-cccc")] },
        right: { severity: "high", via: ["left"] },
      }),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ package: "left", ghsa: "GHSA-aaaa-bbbb-cccc", severity: "high" });
  });

  it("orders by severity so the worst thing is the first thing read", () => {
    const rows = flatten(
      report({
        a: { severity: "low", via: [advisory("low", "GHSA-1111-1111-1111")] },
        b: { severity: "critical", via: [advisory("critical", "GHSA-2222-2222-2222")] },
        c: { severity: "moderate", via: [advisory("moderate", "GHSA-3333-3333-3333")] },
      }),
    );
    expect(rows.map((r: { severity: string }) => r.severity)).toEqual(["critical", "moderate", "low"]);
  });

  it("survives an advisory with no url, no source and no title", () => {
    // npm's schema is looser than its docs. A gate that throws on a malformed
    // row fails the release with a stack trace instead of a finding.
    const rows = flatten(report({ odd: { severity: "moderate", via: [{ severity: "moderate" }] } }));
    expect(rows[0]).toMatchObject({ package: "odd", ghsa: null, id: "odd", title: "(no title)" });
  });

  it("reads an empty tree as no findings rather than as a failure", () => {
    expect(flatten({})).toEqual([]);
  });
});

describe("what blocks a release", () => {
  const prodOnly = report({ next: { severity: "low", via: [advisory("low", "GHSA-prod-0000-0001")] } });

  it("a LOW advisory blocks when the package ships in the bundle", () => {
    // The severity is irrelevant here. This code runs on the user's machine
    // while it serves their lookups, so `low` is still a hole in the artifact.
    const { blocking, reported } = classifyReports(prodOnly, prodOnly, []);
    expect(blocking.map((a: { package: string }) => a.package)).toEqual(["next"]);
    expect(reported).toEqual([]);
    expect(blocking[0].shipped).toBe(true);
  });

  it("a HIGH advisory in a dev dependency does not block", () => {
    // The exact case that would have failed a tag push for nothing: eslint is
    // never bundled, never served, and reachable only by someone who already
    // has the repo checked out.
    const all = report({ eslint: { severity: "high", via: [advisory("high", "GHSA-dev-0000-0002")] } });
    const { blocking, reported } = classifyReports({ vulnerabilities: {} }, all, []);
    expect(blocking).toEqual([]);
    expect(reported.map((a: { package: string }) => a.package)).toEqual(["eslint"]);
    expect(reported[0].shipped).toBe(false);
  });

  it("a CRITICAL dev dependency blocks anyway", () => {
    // The realistic exploit at critical is build-time code execution, and the
    // build is what produces the artifact — that is a supply-chain path in.
    const all = report({ vite: { severity: "critical", via: [advisory("critical", "GHSA-dev-0000-0003")] } });
    const { blocking } = classifyReports({ vulnerabilities: {} }, all, []);
    expect(blocking.map((a: { package: string }) => a.package)).toEqual(["vite"]);
  });

  it("nothing is silently dropped: every advisory lands in exactly one bucket", () => {
    const all = report({
      next: { severity: "moderate", via: [advisory("moderate", "GHSA-prod-0000-0004")] },
      eslint: { severity: "high", via: [advisory("high", "GHSA-dev-0000-0005")] },
      vitest: { severity: "low", via: [advisory("low", "GHSA-dev-0000-0006")] },
    });
    const prod = report({ next: { severity: "moderate", via: [advisory("moderate", "GHSA-prod-0000-0004")] } });
    const r = classifyReports(prod, all, []);
    expect(r.blocking.length + r.reported.length + r.suppressed.length).toBe(3);
  });

  it("a clean tree is clear to release", () => {
    const r = classifyReports({ vulnerabilities: {} }, { vulnerabilities: {} }, []);
    expect(r.blocking).toEqual([]);
    expect(r.reported).toEqual([]);
  });
});

describe("the allowlist is an escape hatch that expires", () => {
  const shipped = report({ next: { severity: "high", via: [advisory("high", "GHSA-prod-0000-0007")] } });

  it("an unexpired entry suppresses a blocking advisory and keeps its reason", () => {
    const entry = {
      package: "next",
      advisory: "GHSA-prod-0000-0007",
      reason: "the vulnerable code path is the image optimizer, which this build disables",
      expires: "2099-01-01",
      expired: false,
    };
    const r = classifyReports(shipped, shipped, [entry]);
    expect(r.blocking).toEqual([]);
    expect(r.suppressed[0]).toMatchObject({ package: "next", reason: entry.reason });
  });

  it("an EXPIRED entry blocks again, and says why it stopped working", () => {
    // The point of the field. A suppression nobody renewed is a decision
    // nobody re-made, and inheriting it silently is how a known hole ships.
    const entry = { package: "next", advisory: "GHSA-prod-0000-0007", expires: "2020-01-01", expired: true };
    const r = classifyReports(shipped, shipped, [entry]);
    expect(r.suppressed).toEqual([]);
    expect((r.blocking[0] as { note?: string }).note).toContain("expired 2020-01-01");
  });

  it("an entry matching nothing is called out as stale rather than left to rot", () => {
    const entry = { package: "gone", advisory: "GHSA-0000-0000-0000", expires: "2099-01-01", expired: false };
    const r = classifyReports(shipped, shipped, [entry]);
    expect(r.staleAllowlist).toHaveLength(1);
    expect(r.blocking).toHaveLength(1); // and the real advisory still blocks
  });

  it("an entry cannot suppress a different package that shares an advisory id", () => {
    const entry = { package: "other", advisory: "GHSA-prod-0000-0007", expires: "2099-01-01", expired: false };
    expect(classifyReports(shipped, shipped, [entry]).blocking).toHaveLength(1);
  });

  it("covers() matches on the GHSA, the numeric source id, or neither", () => {
    const adv = { package: "next", id: "GHSA-x", ghsa: "GHSA-x", source: 1234 };
    expect(covers({ package: "next", advisory: "GHSA-x" }, adv)).toBe(true);
    expect(covers({ package: "next", advisory: 1234 }, adv)).toBe(true);
    expect(covers({ package: "next", advisory: "GHSA-y" }, adv)).toBe(false);
  });
});

describe("the vulnerabilities badge on the release page is measured, not typed", () => {
  it("reads 0 and green only when there is genuinely nothing", () => {
    expect(badge({ blocking: [], reported: [] })).toEqual({ message: "0", color: "00C853" });
  });

  it("says what is actually true when dev-only advisories exist", () => {
    // Not "0" — that would be a false claim on a public page — and not red
    // either, because nothing reaches the artifact.
    const b = badge({ blocking: [], reported: [{}, {}] });
    expect(b.message).toBe("0_bundled,_2_dev--only");
    expect(b.color).toBe("FFA000");
  });

  it("stays ASCII, so the badge URL survives the workflow without encoding", () => {
    expect(badge({ blocking: [], reported: [{}] }).message).toMatch(/^[\x20-\x7e]+$/);
  });
});

describe("the checked-in allowlist", () => {
  const raw = JSON.parse(read(".github/audit-allowlist.json"));

  it("is empty: the healthy state, and a diff that says so when it is not", () => {
    expect(raw.allow).toEqual([]);
  });

  it.each(raw.allow as { package?: string; advisory?: string; reason?: string; added?: string; expires?: string }[])(
    "every entry is reasoned and time-boxed (%o)",
    (entry) => {
      expect(entry.package).toBeTruthy();
      expect(entry.advisory).toBeTruthy();
      expect(entry.added).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(entry.expires).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      // A reason short enough to be a shrug is not a reason.
      expect((entry.reason ?? "").length).toBeGreaterThan(40);
      const days = (Date.parse(entry.expires!) - Date.parse(entry.added!)) / 86_400_000;
      expect(days).toBeGreaterThan(0);
      expect(days).toBeLessThanOrEqual(90);
    },
  );
});

describe("both gates run the same policy", () => {
  const workflow = read(".github/workflows/release.yml");

  /**
   * Comments stripped before asserting. Both files *explain* the old
   * `--audit-level` gate and why it was replaced, and that prose is the most
   * useful part of the change — a guard that forbids describing the bug would
   * push the next reader into repeating it.
   */
  const code = (src: string, comment: RegExp) =>
    src
      .split("\n")
      .filter((l) => !comment.test(l.trim()))
      .join("\n");

  it("the release workflow calls the gate instead of npm audit directly", () => {
    expect(workflow).toContain("node scripts/audit-gate.mjs --github");
    // The regression this whole file exists to prevent.
    expect(code(workflow, /^#/)).not.toMatch(/npm audit --audit-level/);
  });

  it("release:verify calls the same script, so local and CI cannot disagree", () => {
    const verify = read("scripts/release-verify.mjs");
    expect(verify).toContain("scripts/audit-gate.mjs");
    expect(code(verify, /^(\/\/|\*|\/\*)/)).not.toMatch(/npm audit --audit-level/);
  });

  it("the release page's badge comes from the gate's output, not a literal", () => {
    expect(workflow).toContain("needs.gate.outputs.badge_message");
    expect(workflow).toMatch(/badge\/Vulnerabilities-%s-%s/);
  });

  it("`npm run audit` is the documented way to run it", () => {
    expect(JSON.parse(read("package.json")).scripts.audit).toBe("node scripts/audit-gate.mjs");
  });
});

// ── The declared-floor check ─────────────────────────────────────────────────
//
// `npm audit` resolves the lockfile, so it answers "what does the artifact
// contain" and cannot answer "what could a fresh install of this manifest
// produce". Those diverged twice: postcss's `^8` floor admitted 8.0.x with
// seven advisories, and `next`'s `^16.2.12` floor admitted 16.2.12–16.3.2,
// every one inside the affected range of two unauthenticated-RCE advisories
// fixed in 16.3.3. Both times the lock held a patched version, so the gate was
// clean and an external scan reading package.json was right to disagree.
//
// Driven with fixtures for the same reason the policy above is: a healthy
// manifest never produces the blocking state, so a test that ran the real
// check would prove only that today's floors are clean.
describe("declared floors, which npm audit cannot see", () => {
  const row = (name: string, prod: boolean, vulns: string[], min: string | null = "1.0.0") =>
    ({ name, range: "^1.0.0", prod, min, vulns });

  it("blocks when something that ships can be installed vulnerable", () => {
    const v = classifyFloors([
      row("next", true, ["GHSA-2xp9-vwfh-vxw4", "GHSA-p293-qw3h-jr36"]),
      row("clsx", true, []),
    ]);
    expect(v.blocking.map((r) => r.name)).toEqual(["next"]);
    expect(v.reported).toEqual([]);
    expect(v.checked).toBe(2);
  });

  // Same reachability argument the advisory policy makes: a dev-only floor
  // cannot reach anyone running the tool.
  it("reports a dev-only floor without blocking", () => {
    const v = classifyFloors([row("vitest", false, ["GHSA-dev"]), row("next", true, [])]);
    expect(v.blocking).toEqual([]);
    expect(v.reported.map((r) => r.name)).toEqual(["vitest"]);
  });

  it("passes a manifest whose floors are all clean", () => {
    const v = classifyFloors([row("next", true, []), row("vitest", false, [])]);
    expect(v.blocking).toEqual([]);
    expect(v.reported).toEqual([]);
    expect(v.checked).toBe(2);
  });

  // A range nothing published satisfies is not a clean range; it is an
  // unanswered question, and it is counted separately from the ones checked.
  it("separates a range it could not resolve from a range it cleared", () => {
    const v = classifyFloors([row("ghost", true, [], null), row("next", true, [])]);
    expect(v.unresolved.map((r) => r.name)).toEqual(["ghost"]);
    expect(v.checked).toBe(1);
    expect(v.blocking).toEqual([]);
  });
});

describe("the checked-in manifest", () => {
  it("declares no floor below a version the project has already had to escape", () => {
    // Pins the two fixes rather than the whole manifest: `npm run audit:floors`
    // checks every range against the live database, but a checked-in assertion
    // is what stops these two specific floors being lowered again by a careless
    // range edit, offline and in the ordinary test run.
    const pkg = JSON.parse(read("package.json"));
    const floor = (r: string) => r.replace(/^[^0-9]*/, "").split(".").map(Number);
    const atLeast = (r: string, min: number[]) => {
      const v = floor(r);
      for (let i = 0; i < min.length; i++) {
        if ((v[i] ?? 0) !== min[i]) return (v[i] ?? 0) > min[i]!;
      }
      return true;
    };
    // next < 16.3.3 is GHSA-2xp9-vwfh-vxw4 / GHSA-p293-qw3h-jr36 (both critical,
    // unauthenticated RCE); postcss < 8.4.31 is CVE-2023-44270 and six others.
    expect(atLeast(pkg.dependencies.next, [16, 3, 3])).toBe(true);
    expect(atLeast(pkg.devDependencies.postcss, [8, 4, 31])).toBe(true);
  });
});
