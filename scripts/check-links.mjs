#!/usr/bin/env node
// ── Outbound link health check ───────────────────────────────────────────────
//
// Probes every external URL the app hands an analyst and reports the ones that
// no longer resolve. Run it with `npm run links:check`.
//
// Link rot cannot be detected without sending a request, so nothing in the
// repo can catch it. An audit of v2.1.0 found seven pivot targets that had
// quietly died — www.peekyou.com stopped resolving in DNS entirely,
// hashkiller.io was returning a Cloudflare 522, and NumLookup, BeenVerified,
// Spokeo, IPQS and EmailRep had all moved or retired the per-identifier path
// the tool was building. The test suite saw none of it: to a type checker and
// a unit test, a stale URL template is just a well-formed string.
//
// It is deliberately NOT a unit test. It needs the live internet, third parties
// rate-limit, and a transient 503 must never fail somebody's build. It is a
// maintenance tool: run it before a release, act on what it says.
//
// ── What this script CANNOT settle ──
// It sends scripted requests, and a scripted request is not what an analyst
// makes. The two verdicts disagree in both directions, so never re-tier a link
// on this output alone:
//   • Radaris and freecarrierlookup.com answer this script with 403 while
//     loading normally in a real browser. Reported here as WALLED/BLOCKED, they
//     are in fact `free`.
//   • ZabaSearch answered a scripted request perfectly well, and a browser
//     showed it inventing an owner ("Kincannon Lindsay Sales", age 44) for
//     415-555-2671 — a number Radaris correctly reports as having no record.
//     A 200 here says a page was served, never that the page is truthful.
// Open the URL in a browser before changing an access tier. This script tells
// you WHERE to look; it does not tell you what you will find.
//
// ── Reading the output ──
// A DEAD, DOWN, UNREACHABLE or RATELIMIT verdict is confirmed with a second
// probe before it is reported: those are the transient-prone ones (a throttled
// DNS lookup, a datacenter 5xx, a reset), and the kinder of the two looks wins.
// Only a link that fails BOTH times is reported below.
//
//   DEAD      the host will not resolve at all (DNS NXDOMAIN). Fix it.
//   NO-RECORD every probe 404'd: either the path is wrong or the probe
//             identifiers have no record. Check one identifier you know exists.
//   WALLED    a bot-check interstitial that a real browser clears ("Just a
//             moment...", "Confirm you're human"). Expected on a `captcha`-tier
//             link; on one tagged `free`, the tier is wrong.
//   BLOCKED   a hard refusal with no challenge offered ("Sorry, you have been
//             blocked" — Cloudflare's 1020 shape). A real browser is turned away
//             too, so this is NOT the same as WALLED and the link belongs in the
//             `blocked` tier. Verified in a browser against TruePeopleSearch,
//             FastPeopleSearch, USPhoneBook and PeekYou, all of which refused a
//             genuine Chrome session on a residential line outside the US. That
//             vantage is part of the verdict, not background detail: see the
//             Vantage line this script prints, and BLOCK_VANTAGE in
//             src/lib/osint/accessTier.ts.
//   RATELIMIT the source is throttling this run, not broken. Re-run later.
//   OK        reached a real page.
//
// A 404 is not automatically DEAD: several of these sites answer "no records for
// that identifier" with a 404 (800notes does), and a username site 404s for any
// handle that simply has no account there. So a uniform 404 is reported as
// NO-RECORD — ambiguous, needing a human to check one handle that does exist —
// rather than DEAD. The first run of this script called about.me, Dribbble and
// Wattpad dead on that evidence; all three turned out to have correct URLs and
// simply no account for the probe handles. Reporting those as broken would have
// sent someone to fix three links that were fine.

import { readFileSync, readdirSync } from "node:fs";
import { join, extname } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const TIMEOUT_MS = 20000;
const CONCURRENCY = 6;
const RETRY_DELAY_MS = 1500;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Severity rank, lower is worse. Sorts the report and, on a retry, decides which
// of two verdicts to keep (the kinder one — a link that recovers was not broken).
const SEVERITY = { DEAD: 0, DOWN: 1, UNREACHABLE: 2, "NO-RECORD": 3, BLOCKED: 4, WALLED: 5, RATELIMIT: 6, OK: 7 };

// Verdicts that are commonly transient rather than real rot: a DNS lookup
// throttled under load (this run makes ~1600 of them), a datacenter 5xx, a
// momentary reset or rate-limit. Every one of these gets a second, confirming
// probe before the report believes it — the single biggest source of false
// DEAD/DOWN issues is a CI datacenter IP being throttled on the first look, and
// a genuinely dead host stays dead on the retry.
const RETRY_STATES = new Set(["DEAD", "DOWN", "UNREACHABLE", "RATELIMIT"]);

// Substituted into every URL template. Two identifiers per kind: one that the
// site is very likely to hold a record for, one arbitrary — a template is only
// reported DEAD when neither resolves.
const SUBSTITUTIONS = {
  "${enc}": ["%2B18002662278", "%2B14155552671"],
  "${encNat}": ["800-266-2278", "(415) 555-2671"],
  "${digits}": ["18002662278", "14155552671"],
  "${noPlus}": ["18002662278", "14155552671"],
  "${ccLc}": ["us", "us"],
  "${e164}": ["+18002662278", "+14155552671"],
  "${encDomain}": ["github.com", "example.com"],
  // Two username placeholders exist in the tree: usernameSites.ts uses {u},
  // extendedUsernameSites.ts uses {account} (filled at runtime with the
  // URL-encoded handle). Both must be substituted, or the ~700 extended-site
  // templates get probed with a literal "{account}" in the host/path — which
  // NXDOMAINs or 404s wholesale and floods the report with false DEAD/NO-RECORD.
  "{u}": ["torvalds", "jack"],
  "{account}": ["torvalds", "jack"],
};

/** Pull every literal URL out of a source file, template holes and all. */
function urlsIn(source) {
  // Matches http(s) URLs inside a backtick template or a plain quoted string,
  // stopping at the quote/backtick that closes it.
  const found = new Set();
  for (const m of source.matchAll(/https?:\/\/[^\s`"'<>)]+/g)) {
    const url = m[0].replace(/[.,;]+$/, "");
    // Skip badge/CI/doc URLs — they are not analyst-facing pivots.
    if (/shields\.io|capsule-render|readme-typing-svg|w3\.org|schema\.org/.test(url)) continue;
    found.add(url);
  }
  return [...found];
}

function expand(template) {
  const variants = [[], []];
  for (const i of [0, 1]) {
    let url = template;
    for (const [hole, values] of Object.entries(SUBSTITUTIONS)) {
      url = url.split(hole).join(values[i]);
    }
    variants[i] = url;
  }
  // A template with a hole we do not know how to fill is unusable — say so
  // rather than probing a URL with a literal "${…}", "{u}" or "{account}" in it.
  if (variants.some((u) => /\$\{|\{u\}|\{account\}/.test(u))) return null;
  return [...new Set(variants)];
}

async function probe(url) {
  const started = Date.now();
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { "User-Agent": BROWSER_UA, Accept: "text/html,application/xhtml+xml,*/*;q=0.8" },
    });
    let body = "";
    try { body = (await res.text()).slice(0, 3000); } catch { /* body is optional */ }
    return { status: res.status, ms: Date.now() - started, body };
  } catch (err) {
    return { status: 0, ms: Date.now() - started, code: String(err?.cause?.code ?? err?.name ?? "error") };
  }
}

function verdict(results) {
  // A host that does not resolve is dead regardless of identifier.
  if (results.some((r) => r.code === "ENOTFOUND")) return "DEAD";
  if (results.every((r) => r.status === 0)) return "UNREACHABLE";
  if (results.some((r) => r.status === 429)) return "RATELIMIT";
  // Cloudflare / WAF interstitial: the page exists, a browser gets through.
  // Order matters: a 1020 block is served WITH a 403, so testing for the block
  // text first keeps it from being filed as an ordinary challenge.
  const blocked = results.every((r) => /Sorry, you have been blocked|unable to access/i.test(r.body ?? ""));
  if (blocked) return "BLOCKED";
  const walled = results.every(
    (r) => r.status === 403 || /Just a moment|Attention Required|Security Check|Confirm you.re human/i.test(r.body ?? ""),
  );
  if (walled) return "WALLED";
  if (results.some((r) => r.status >= 200 && r.status < 400)) return "OK";
  if (results.every((r) => r.status >= 500)) return "DOWN";
  // Every probe 404'd. That means either the path is wrong or neither probe
  // identifier has a record — indistinguishable from here, so say so.
  if (results.every((r) => r.status === 404)) return "NO-RECORD";
  return "OK";
}

/**
 * Where this run is standing.
 *
 * Every verdict below is a conversation between one address and a hundred
 * sites, and BLOCKED is as much a fact about the address as about the site. Two
 * runs from different countries disagree, and without this line the reports
 * they print are indistinguishable — so the report says where it stood, and a
 * future disagreement becomes evidence instead of a mystery.
 *
 * Only the network's class and country are read, never the address. ip-api is
 * asked for exactly those fields, and it learns the address from the connection
 * regardless, so this discloses nothing the run has not already disclosed to
 * every site it is about to probe. Best-effort by design: an unknown vantage is
 * worth printing, and is never worth failing a maintenance run over.
 */
async function vantage() {
  try {
    const res = await fetch("http://ip-api.com/json/?fields=status,countryCode,mobile,proxy,hosting", {
      signal: AbortSignal.timeout(4000),
    });
    const d = await res.json();
    if (d?.status !== "success") return "unknown";
    const kind = d.hosting ? "datacenter" : d.proxy ? "proxy/VPN" : d.mobile ? "mobile" : "residential";
    return `${kind} · ${d.countryCode}`;
  } catch {
    return "unknown";
  }
}

function collectSources() {
  const roots = ["src/components", "src/lib/data", "src/lib/sources"];
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
      const rel = join(dir, entry.name);
      if (entry.isDirectory()) walk(rel);
      else if ([".ts", ".tsx"].includes(extname(entry.name))) files.push(rel);
    }
  };
  roots.forEach(walk);
  return files;
}

async function main() {
  const targets = new Map(); // expanded url -> template origin
  for (const file of collectSources()) {
    for (const template of urlsIn(readFileSync(join(ROOT, file), "utf8"))) {
      const expanded = expand(template);
      if (!expanded) continue;
      if (!targets.has(template)) targets.set(template, { file, expanded });
    }
  }

  console.log(`Probing ${targets.size} outbound link templates…`);
  console.log(
    `Vantage: ${await vantage()} · ${new Date().toISOString().slice(0, 10)}` +
    `. BLOCKED and WALLED are relative to this; a run from elsewhere may differ.\n`,
  );
  const entries = [...targets.entries()];
  const report = [];
  let cursor = 0;

  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (cursor < entries.length) {
        const [template, { file, expanded }] = entries[cursor++];
        let results = await Promise.all(expanded.map(probe));
        let state = verdict(results);
        // Confirm a transient-looking verdict with a second look; believe the
        // kinder result so a link that recovers is not filed as broken.
        if (RETRY_STATES.has(state)) {
          await sleep(RETRY_DELAY_MS);
          const retry = await Promise.all(expanded.map(probe));
          const retryState = verdict(retry);
          if (SEVERITY[retryState] > SEVERITY[state]) { results = retry; state = retryState; }
        }
        report.push({ template, file, state, results });
      }
    }),
  );

  report.sort((a, b) => SEVERITY[a.state] - SEVERITY[b.state] || a.template.localeCompare(b.template));

  for (const row of report) {
    if (row.state === "OK") continue;
    const codes = row.results.map((r) => r.code ?? r.status).join("/");
    console.log(`${row.state.padEnd(11)} ${codes.padEnd(12)} ${row.template}`);
    console.log(`${" ".repeat(24)}${row.file}`);
  }

  const counts = report.reduce((acc, r) => ({ ...acc, [r.state]: (acc[r.state] ?? 0) + 1 }), {});
  console.log(`\n${Object.entries(counts).map(([k, v]) => `${k}: ${v}`).join("  ·  ")}`);

  // Only a retry-confirmed DNS death (DEAD) is unambiguous enough to fail on.
  // DOWN is deliberately NOT a failure: measured against a browser, a scripted
  // 5xx here is usually a live site answering "no account for this handle" with
  // a 500 instead of a 404 (chatovka.net and soup.io both serve 200 at the root
  // while 5xx-ing the probe handle), or a datacenter IP being refused — the same
  // ambiguity as NO-RECORD and WALLED, which already do not fail. It is still
  // printed above and saved in the artifact for a human to review; it just does
  // not gate. That keeps the weekly run from filing an issue over links that are
  // not actually broken, while a genuinely vanished domain (DEAD) still does.
  const dead = report.filter((r) => r.state === "DEAD").length;
  const down = report.filter((r) => r.state === "DOWN" || r.state === "UNREACHABLE").length;
  if (down > 0) {
    console.log(`\n${down} link(s) returned 5xx / did not connect from this vantage — review, do not assume dead.`);
  }
  if (dead > 0) {
    console.log(`\n${dead} link(s) no longer resolve (DNS) and need fixing.`);
    process.exitCode = 1;
  }
}

main();
