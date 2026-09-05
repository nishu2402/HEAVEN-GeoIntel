// ── Optional API-key store (file-backed, owner-only) ─────────────────────────
// Lets the operator add provider keys from the web UI instead of editing
// .env.local. Stored in ./.data/keys.json (mode 0600, git-ignored). Keys are
// NEVER returned to the browser — the UI only ever sees a configured/source flag.
//
// SECURITY MODEL: this is a single-user, self-host convenience. Values are stored
// in PLAINTEXT (same trust level as .env.local). If you expose the app on a
// network, set AUTH_PASSWORD so the key endpoints aren't world-reachable.

import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { clearAllCaches } from "./cache";
import { dataDir } from "./dataDir";

const keysFile = () => path.join(dataDir(), "keys.json");

// Allow-list — only these names may be stored or read, so the endpoint can never
// be used to inject arbitrary environment-like values.
export const KEY_NAMES = [
  "NUMVERIFY_API_KEY",
  "IPQS_API_KEY",
  "ABSTRACT_API_KEY",
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "HUNTER_API_KEY",
  "EMAILREP_API_KEY",
  "FULLCONTACT_API_KEY",
  "RAPIDAPI_KEY",
  "HIBP_API_KEY",
] as const;
export type KeyName = (typeof KEY_NAMES)[number];
const ALLOWED = new Set<string>(KEY_NAMES);

export type KeySource = "ui" | "env" | null;

// Single-process in-memory cache; writes update it so reads stay consistent.
let cache: Record<string, string> | null = null;

// Serialise every mutation so a read-modify-write is atomic (no lost updates
// when two writes race) and a failed write never poisons the queue for later
// writers. The retained tail is always resolved, so the queue self-heals.
let chain: Promise<unknown> = Promise.resolve();
function serialize<T>(op: () => Promise<T>): Promise<T> {
  const run = chain.then(op, op);
  chain = run.then(() => {}, () => {});
  return run;
}

async function load(): Promise<Record<string, string>> {
  if (cache) return cache;
  try {
    const raw = await fs.readFile(keysFile(), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    /* v8 ignore next -- keys.json is always written by us as an object; the {}
       fallback only guards a hand-corrupted non-object file. */
    cache = parsed && typeof parsed === "object" ? (parsed as Record<string, string>) : {};
  } catch {
    cache = {};
  }
  return cache;
}

/** Resolve a key for server use: a value added in the UI wins, then the env var. */
export async function resolveKey(name: KeyName): Promise<string | undefined> {
  const stored = (await load())[name];
  return (stored && stored.trim()) || process.env[name] || undefined;
}

/** Where each known key is configured — "ui", "env", or null. Never the value. */
export async function configuredMap(): Promise<Record<KeyName, KeySource>> {
  const stored = await load();
  const out = {} as Record<KeyName, KeySource>;
  for (const k of KEY_NAMES) {
    out[k] = stored[k] && stored[k].trim() ? "ui" : process.env[k] ? "env" : null;
  }
  return out;
}

// Atomic write: stage to a temp file, then rename over the target so a reader
// never sees a half-written file and a mid-write crash keeps the old one.
async function writeAtomic(next: Record<string, string>): Promise<void> {
  const file = keysFile();
  await fs.mkdir(dataDir(), { recursive: true });
  const tmp = `${file}.${randomUUID()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(next, null, 2), { encoding: "utf8", mode: 0o600 });
  try {
    await fs.rename(tmp, file);
  } catch (err) {
    /* v8 ignore next -- best-effort tmp cleanup; the no-op catch is defensive */
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
  /* v8 ignore next -- chmod is best-effort hardening; ignoring failure is intentional */
  await fs.chmod(file, 0o600).catch(() => {});
}

// Any change to the key set invalidates every cached lookup: a result produced
// without a key is not the answer the user gets once that key exists. Without
// this, adding a key in the UI silently kept serving the old thin result until
// the 24 h TTL expired, and the key looked broken.
function keysChanged(): void {
  clearAllCaches();
}

export async function setKey(name: string, value: string): Promise<boolean> {
  if (!ALLOWED.has(name)) return false;
  const v = value.trim().slice(0, 512);
  if (!v) return false;
  await serialize(async () => {
    const next = { ...(await load()), [name]: v };
    cache = next;
    await writeAtomic(next);
  });
  keysChanged();
  return true;
}

export async function clearKey(name: string): Promise<boolean> {
  if (!ALLOWED.has(name)) return false;
  await serialize(async () => {
    const all = { ...(await load()) };
    if (!(name in all)) return;
    delete all[name];
    cache = all;
    await writeAtomic(all);
  });
  keysChanged();
  return true;
}

export async function clearAllKeys(): Promise<void> {
  await serialize(async () => {
    cache = {};
    await writeAtomic({});
  });
  keysChanged();
}
