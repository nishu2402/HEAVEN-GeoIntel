#!/usr/bin/env node
// ── Headless CLI ─────────────────────────────────────────────────────────────
//
// `geointel` started the web app and nothing else, so every lookup had to go
// through a browser. That rules the tool out of the place a lot of real OSINT
// work happens: a shell, a pipeline, a cron job, a list of targets and `jq`.
//
//   geointel domain example.com --json | jq .subdomains
//   geointel email someone@example.com
//   geointel bulk targets.txt --csv > triage.csv
//
// It does not reimplement anything. It talks to the same HTTP API the UI uses,
// so a CLI answer and a browser answer come from identical code. If a server is
// already running it is reused; otherwise one is started, used, and shut down.
//
//   --server URL   talk to an instance already running somewhere
//   --json         raw response on stdout (the default is a readable summary)
//   --timeout MS   per-request timeout (default 120000)
//   --mode MODE    for `bulk`: force a mode instead of classifying each row
//   --csv          for `bulk`: CSV on stdout instead of a summary

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const PROJECT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");

const MODES = {
  phone: { path: "/api/lookup", field: "number" },
  email: { path: "/api/email-lookup", field: "email" },
  username: { path: "/api/username-lookup", field: "username" },
  ip: { path: "/api/ip-lookup", field: "ip" },
  domain: { path: "/api/domain-lookup", field: "domain" },
  wallet: { path: "/api/wallet-lookup", field: "address" },
  hash: { path: "/api/hash-lookup", field: "hash" },
};

function usage() {
  console.log(`HEAVEN-GeoIntel: headless lookups

  geointel <mode> <target> [--json] [--server URL] [--timeout MS]
  geointel bulk <file|-> [--mode auto|<mode>] [--csv] [--server URL]

  modes: ${Object.keys(MODES).join(", ")}

  --json       print the raw API response (pipe it to jq)
  --csv        bulk only: CSV on stdout
  --mode       bulk only: force one mode instead of classifying each row
  --server     use an instance already running at this URL
  --timeout    per-request timeout in ms (default 120000)

Exit codes: 0 ok · 1 the lookup failed · 2 bad usage`);
}

// ── argument parsing ─────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const flags = { json: false, csv: false, server: null, timeout: 120000, mode: "auto" };
const positional = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--json") flags.json = true;
  else if (a === "--csv") flags.csv = true;
  else if (a === "--server") flags.server = argv[++i];
  else if (a === "--timeout") flags.timeout = Number(argv[++i]) || flags.timeout;
  else if (a === "--mode") flags.mode = argv[++i];
  else if (a === "--help" || a === "-h") { usage(); process.exit(0); }
  else positional.push(a);
}

const [command, target] = positional;
if (!command) { usage(); process.exit(2); }
if (command !== "bulk" && !MODES[command]) {
  console.error(`Unknown mode "${command}". Modes: ${Object.keys(MODES).join(", ")}`);
  process.exit(2);
}
if (!target) { console.error(`Usage: geointel ${command} <target>`); process.exit(2); }
// Checked before anything else, because the alternative is starting a whole
// server and then failing on a path typo. `-` is stdin, which is always there.
if (command === "bulk" && target !== "-" && !existsSync(target)) {
  console.error(`No such file: ${target}`);
  process.exit(2);
}

// ── server discovery / lifecycle ─────────────────────────────────────────────

async function isUp(base) {
  try {
    const res = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

/** An already-running instance, or null. */
async function findRunning() {
  const candidates = [
    flags.server,
    process.env.GEOINTEL_URL,
    process.env.PORT ? `http://127.0.0.1:${process.env.PORT}` : null,
    "http://127.0.0.1:3000",
  ].filter(Boolean);
  for (const base of candidates) {
    const normalised = base.replace(/\/+$/, "");
    if (await isUp(normalised)) return normalised;
  }
  // An explicit --server that is not answering is an error, not a reason to
  // start a second copy of the app behind the user's back.
  if (flags.server) {
    console.error(`No HEAVEN-GeoIntel is answering at ${flags.server}`);
    process.exit(1);
  }
  return null;
}

/** Start a private instance on an ephemeral port; returns { base, stop }. */
async function startServer() {
  const port = 3000 + Math.floor(Math.random() * 900) + 100;
  const built = existsSync(join(PROJECT_DIR, ".next", "BUILD_ID"));
  const args = built
    ? ["node_modules/next/dist/bin/next", "start", "-p", String(port)]
    : ["node_modules/next/dist/bin/next", "dev", "-p", String(port)];
  const child = spawn(process.execPath, args, {
    cwd: PROJECT_DIR,
    stdio: "ignore",
    env: { ...process.env, NO_OPEN: "1" },
  });

  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (await isUp(base)) return { base, stop: () => child.kill() };
    await new Promise((r) => setTimeout(r, 400));
  }
  child.kill();
  console.error("The local server did not come up in time.");
  process.exit(1);
}

async function post(base, path, body) {
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(flags.timeout),
  });
  return { status: res.status, body: await res.json() };
}

// ── rendering ────────────────────────────────────────────────────────────────

/** Flatten a response into "key: value" lines an analyst can read at a glance. */
function summarise(mode, data) {
  const lines = [];
  const add = (k, v) => {
    if (v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0)) return;
    lines.push(`${k.padEnd(18)} ${Array.isArray(v) ? v.slice(0, 8).join(", ") : v}`);
  };
  if (mode === "phone") {
    add("number", data.input?.e164);
    add("valid", data.input?.isValid);
    add("assignable", data.assignability?.assignable);
    add("country", data.analysis?.countryName);
    add("carrier", data.aggregated?.carrier);
    add("line type", data.aggregated?.lineType);
    add("abuse", `${data.threatScore} ${data.threatLabel}`);
    add("exposure", data.exposureScore === undefined ? null : `${data.exposureScore} ${data.exposureLabel}`);
  } else if (mode === "email") {
    add("email", data.email);
    add("provider", data.analysis?.providerName);
    add("disposable", data.analysis?.isDisposable);
    add("breaches", data.breachAggregate?.breaches?.length);
    add("abuse", data.threatScore === undefined ? null : `${data.threatScore} ${data.threatLabel}`);
    add("exposure", data.exposureScore === undefined ? null : `${data.exposureScore} ${data.exposureLabel}`);
  } else if (mode === "username") {
    add("username", data.username);
    add("found", `${data.found} of ${data.checked} checked`);
    add("profiles", data.profiles?.map((p) => p.platform));
    add("identity", data.resolvedIdentity?.name?.value);
    add("confidence", data.resolvedIdentity?.confidence);
  } else if (mode === "ip") {
    add("ip", data.input);
    add("country", data.ip?.country);
    add("asn", data.ip?.asnOrg);
    add("reverse", data.ip?.reverse);
    add("ports", data.ip?.ports);
    add("vulns", data.ip?.vulns);
    add("threat", `${data.threatScore} ${data.threatLabel}`);
  } else if (mode === "domain") {
    add("domain", data.domain);
    add("registrar", data.whois?.registrar);
    add("created", data.whois?.createdDate);
    add("a", data.dns?.a?.map((r) => r.value));
    add("mx", data.dns?.mx?.map((r) => r.value));
    add("spf", data.emailSecurity?.hasSpf);
    add("dmarc", data.emailSecurity?.dmarcPolicy);
    add("subdomains", data.subdomains?.length);
    add("passive dns", data.passiveDns?.total);
    add("http grade", data.http?.security?.grade);
  } else if (mode === "wallet") {
    add("address", data.facts?.address ?? data.input);
    add("chain", data.chain);
    add("balance", data.facts?.balance);
    add("transactions", data.facts?.txCount);
    add("sanctioned", data.sanctions ? (data.sanctions.listed ? "YES (OFAC SDN)" : "no") : null);
    add("last activity", data.activity?.lastActivity);
  } else {
    add("hash", data.input);
    add("kind", data.kind);
    add("known", data.facts?.known);
    add("file", data.facts?.fileName);
    add("product", data.facts?.productName);
  }
  for (const s of data.sourceHealth ?? []) {
    if (!s.ok && !s.skipped) lines.push(`  source ${s.source}: ${s.error ?? "no answer"}`);
  }
  return lines.join("\n");
}

async function runSingle(base) {
  const { path, field } = MODES[command];
  const { status, body } = await post(base, path, { [field]: target });
  if (flags.json) console.log(JSON.stringify(body, null, 2));
  else if (status !== 200 || body.error) console.error(body.error ?? `HTTP ${status}`);
  else console.log(summarise(command, body));
  return status === 200 && !body.error ? 0 : 1;
}

async function runBulk(base) {
  const text = target === "-" ? readFileSync(0, "utf8") : readFileSync(target, "utf8");
  const items = text.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean);
  const started = await post(base, "/api/bulk-lookup", { items, mode: flags.mode });
  if (started.status !== 200) {
    console.error(started.body.error ?? `HTTP ${started.status}`);
    return 1;
  }
  const id = started.body.id;
  // Rows the server could not classify go to stderr, not stdout: a `--csv` or
  // `--json` run is usually redirected to a file, and dropping rows without
  // saying so would leave the caller with a short file and no idea why.
  for (const s of started.body.skipped ?? []) console.error(`skipped  ${s.input}: ${s.reason}`);
  if (started.body.truncated) {
    console.error(`skipped  ${started.body.truncated} further rows: over the per-job row cap`);
  }
  for (;;) {
    const res = await fetch(`${base}/api/bulk-lookup?id=${encodeURIComponent(id)}`, {
      signal: AbortSignal.timeout(flags.timeout),
    });
    const job = await res.json();
    if (job.state !== "running") {
      if (flags.csv) {
        const csv = await fetch(`${base}/api/bulk-lookup?id=${encodeURIComponent(id)}&format=csv`);
        const text = await csv.text();
        // A redirected file should end with a newline, the way every other
        // line-oriented tool writes one.
        process.stdout.write(text.endsWith("\n") ? text : `${text}\n`);
      } else if (flags.json) {
        console.log(JSON.stringify(job, null, 2));
      } else {
        for (const row of job.rows) {
          const detail = row.ok
            ? Object.entries(row.summary).filter(([, v]) => v !== null && v !== "").map(([k, v]) => `${k}=${v}`).join(" ")
            : `FAILED ${row.error ?? row.status}`;
          console.log(`${row.mode.padEnd(9)} ${row.input.padEnd(32)} ${detail}`);
        }
      }
      return job.rows.some((r) => !r.ok) ? 1 : 0;
    }
    if (!flags.csv && !flags.json && process.stderr.isTTY) {
      process.stderr.write(`\r${job.done}/${job.total} done`);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
}

// ── main ─────────────────────────────────────────────────────────────────────

const running = await findRunning();
const server = running ? { base: running, stop: () => {} } : await startServer();
let code = 1;
try {
  code = command === "bulk" ? await runBulk(server.base) : await runSingle(server.base);
} catch (err) {
  console.error(err instanceof Error ? err.message : "the lookup failed");
} finally {
  server.stop();
}
process.exit(code);
