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

const DATA_DIR = path.join(process.cwd(), ".data");
const FILE = path.join(DATA_DIR, "keys.json");

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
] as const;
export type KeyName = (typeof KEY_NAMES)[number];
const ALLOWED = new Set<string>(KEY_NAMES);

export type KeySource = "ui" | "env" | null;

// Single-process in-memory cache; writes update it so reads stay consistent.
let cache: Record<string, string> | null = null;
let writeChain: Promise<void> = Promise.resolve();

async function load(): Promise<Record<string, string>> {
  if (cache) return cache;
  try {
    const raw = await fs.readFile(FILE, "utf8");
    const parsed = JSON.parse(raw) as unknown;
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

async function persist(next: Record<string, string>): Promise<void> {
  cache = next;
  writeChain = writeChain.then(async () => {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(FILE, JSON.stringify(next, null, 2), { encoding: "utf8", mode: 0o600 });
    await fs.chmod(FILE, 0o600).catch(() => {});
  });
  return writeChain;
}

export async function setKey(name: string, value: string): Promise<boolean> {
  if (!ALLOWED.has(name)) return false;
  const v = value.trim().slice(0, 512);
  if (!v) return false;
  await persist({ ...(await load()), [name]: v });
  return true;
}

export async function clearKey(name: string): Promise<boolean> {
  if (!ALLOWED.has(name)) return false;
  const all = { ...(await load()) };
  if (!(name in all)) return true;
  delete all[name];
  await persist(all);
  return true;
}

export async function clearAllKeys(): Promise<void> {
  await persist({});
}
