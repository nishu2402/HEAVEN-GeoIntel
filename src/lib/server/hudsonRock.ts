// ── Hudson Rock Cavalier — infostealer exposure (free, no API key) ───────────
//
// Cavalier indexes credentials harvested by infostealer malware. Two public
// endpoints, one per identifier shape:
//
//   search-by-username?username=…   accepts a handle OR a phone number
//   search-by-email?email=…         requires an email (the -username endpoint
//                                   rejects one with HTTP 400)
//
// Previously this lived inline in the phone route, so the email route could not
// use it and the source manifest advertised email coverage that did not exist.
// One module now backs both, which is why `hudsonRockFor()` takes the kind.
//
// PRIVACY / ACCURACY: the free tier MASKS the sensitive fields — IPs come back
// as "82.167.***.**", passwords as "I********6", logins as "i****@gmail.com".
// Masked values are real evidence that something was captured, but they are NOT
// usable identifiers. `unmasked()` below is what keeps a masked string from ever
// being offered as a pivot target or written into a case.

import { describeError } from "./fetchSafe";
import { fetchTimeoutMs } from "./config";
import { USER_AGENT } from "../version";
import type { HudsonRockData, HudsonRockStealer, SourceResult } from "../types";

const BASE = "https://cavalier.hudsonrock.com/api/json/v2/osint-tools";

/** Which Cavalier endpoint an identifier belongs to. */
export type HudsonRockKind = "email" | "identifier";

/** Cap on stealer records kept — a heavily-infected identity can return dozens. */
const MAX_STEALERS = 10;
/** Cap on the sample credentials/logins kept per stealer record. */
const MAX_SAMPLES = 5;

interface HudsonRockRaw {
  message?: string;
  stealers?: {
    computer_name?: string;
    operating_system?: string;
    malware_path?: string;
    stealer_family?: string;
    date_compromised?: string;
    ip?: string;
    top_passwords?: string[];
    top_logins?: string[];
  }[];
}

/**
 * True when a value survived the free tier unmasked. Cavalier masks with `*`,
 * so anything containing one is evidence, not an identifier — it must never be
 * offered as a pivot or stored as a case entity.
 */
export function unmasked(v: string | null | undefined): string | null {
  if (!v) return null;
  const s = v.trim();
  return s && !s.includes("*") ? s : null;
}

const KNOWN_FAMILIES = [
  "redline", "raccoon", "vidar", "lumma", "stealc", "amadey",
  "azorult", "meta", "mars", "rhadamanthys", "risepro", "atomic", "acreed",
];

/**
 * Name the malware family, or return null when we genuinely don't know.
 *
 * Two sources, in order: Cavalier's own `stealer_family` field, then a scan of
 * the executable path for a family we recognise.
 *
 * It deliberately does NOT fall back to the bare filename any more. Dropper
 * binaries are usually named with a random token — a live lookup returned
 * `.../45AmJcDpU.exe` — and rendering "45AMJCDPU" in the malware-family badge
 * presents a random string as an identification. An empty badge is the honest
 * answer: the infection is still reported, we just don't claim to know which
 * strain caused it.
 */
export function malwareFamily(
  stealerFamily: string | undefined,
  malwarePath: string | undefined,
): string | null {
  const direct = (stealerFamily ?? "").trim();
  if (direct && direct.toLowerCase() !== "not found") return direct;

  const path = (malwarePath ?? "").trim();
  if (!path || path.toLowerCase() === "not found") return null;

  const lower = path.toLowerCase();
  const hit = KNOWN_FAMILIES.find((fam) => lower.includes(fam));
  return hit ? hit.charAt(0).toUpperCase() + hit.slice(1) : null;
}

function url(identifier: string, kind: HudsonRockKind): string {
  return kind === "email"
    ? `${BASE}/search-by-email?email=${encodeURIComponent(identifier)}`
    : `${BASE}/search-by-username?username=${encodeURIComponent(identifier)}`;
}

/** Query Cavalier for one identifier. Never throws. */
export async function hudsonRockFor(
  identifier: string,
  kind: HudsonRockKind,
): Promise<SourceResult<HudsonRockData>> {
  try {
    const res = await fetch(url(identifier, kind), {
      headers: { Accept: "application/json", "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(fetchTimeoutMs()),
      next: { revalidate: 0 },
    });

    if (res.status === 429) return { ok: false, error: "RATE_LIMITED" };
    if (res.status === 404) return { ok: true, data: { total: 0, stealers: [], message: "No infections found" } };
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };

    const raw = (await res.json()) as HudsonRockRaw;

    // Cavalier returns either a `stealers` array OR a message like "This
    // e-mail/phone is not associated with a computer infected by an
    // info-stealer" — the latter is a clean result, not a failure.
    if (!raw.stealers || raw.stealers.length === 0) {
      return { ok: true, data: { total: 0, stealers: [], message: raw.message ?? "No infections found" } };
    }

    const stealers: HudsonRockStealer[] = raw.stealers.slice(0, MAX_STEALERS).map((s) => ({
      computerName: s.computer_name ?? null,
      operatingSystem: s.operating_system ?? null,
      malwareFamily: malwareFamily(s.stealer_family, s.malware_path),
      dateCompromised: s.date_compromised ?? null,
      ip: s.ip ?? null,
      topPasswords: (s.top_passwords ?? []).slice(0, MAX_SAMPLES),
      topLogins: (s.top_logins ?? []).slice(0, MAX_SAMPLES),
    }));

    return { ok: true, data: { total: raw.stealers.length, stealers, message: raw.message } };
  } catch (err) {
    return { ok: false, error: describeError(err) };
  }
}
