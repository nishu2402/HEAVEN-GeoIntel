import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// `.env.example` is not just documentation — `scripts/start.sh` copies it to
// `.env.local` on a first run, so it is the file most users actually edit. It
// had fallen a whole release behind: every knob added in 2.0 (rate limits,
// cache sizes, timeouts, the case lock, the data directory) was readable from
// the environment and mentioned nowhere a user would look.
//
// This walks the source for env reads and asserts each one is documented, so
// adding a knob without documenting it fails the build.

const root = join(__dirname, "..");
const example = readFileSync(join(root, ".env.example"), "utf8");

/** Env vars that belong to the platform, not to this app's configuration. */
const AMBIENT = new Set([
  "NODE_ENV",     // set by Next/Node, never by a user
  "CI",           // set by the CI runner
  "BROWSER",      // POSIX convention, honoured by scripts/dev-open.mjs
  "NO_OPEN",      // documented in the README's launcher section
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|mjs)$/.test(name)) out.push(full);
  }
  return out;
}

function envNamesRead(): Set<string> {
  const names = new Set<string>();
  const files = [...walk(join(root, "src")), join(root, "next.config.mjs")];
  for (const file of files) {
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) names.add(m[1]);
    // The config layer reads through helpers, so the name is a string literal.
    for (const m of src.matchAll(/(?:intFromEnv|boolFromEnv)\(\s*"([A-Z][A-Z0-9_]*)"/g)) names.add(m[1]);
  }
  for (const a of AMBIENT) names.delete(a);
  return names;
}

describe(".env.example documents the whole configuration surface", () => {
  const names = [...envNamesRead()].sort();

  it("finds the env reads to check (guards the walker itself)", () => {
    // If the scan silently matched nothing, every assertion below would pass
    // vacuously and the guard would be worthless.
    expect(names.length).toBeGreaterThan(10);
    expect(names).toContain("RATE_LIMIT_MAX");
    expect(names).toContain("CASE_PASSWORD");
  });

  it.each(names)("%s is documented", (name) => {
    expect(example).toMatch(new RegExp(`^${name}=`, "m"));
  });

  it("every documented key is one the app actually reads", () => {
    // The reverse direction: a knob renamed in code leaves a dead line here,
    // and a user setting it would get silence rather than an error.
    const documented = [...example.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]);
    expect(documented.length).toBeGreaterThan(10);
    const read = envNamesRead();
    // API keys are read through the key store's own indirection, not a direct
    // `process.env.X`, so allow anything ending in _KEY/_TOKEN/_SID.
    const unread = documented.filter((k) => !read.has(k) && !/_(KEY|TOKEN|SID)$/.test(k));
    expect(unread).toEqual([]);
  });
});
