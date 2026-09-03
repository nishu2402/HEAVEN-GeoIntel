// ── RDAP (the structured successor to WHOIS) ─────────────────────────────────
//
// Registration data — registrar, creation/expiry dates, nameservers, status
// codes — for a domain, with no API key.
//
// This lives in its own module for two reasons. It needs a fallback path, which
// is more logic than a route handler should carry inline; and the parsing is
// the fiddly part (RDAP nests the registrar name inside a jCard, itself a
// nested array), so it is worth testing directly against captured registry
// responses rather than only through a live route.
//
// ── Why there is a fallback at all ──
// The tool used to call rdap.org — a broker that redirects you to whichever
// registry is authoritative — and nothing else. rdap.org sits behind Cloudflare
// and answers a request with no User-Agent with HTTP 403. Node's `fetch` sends
// no User-Agent, so WHOIS returned null for EVERY domain, and the UI reported
// "WHOIS unavailable for this TLD via RDAP" — for .com, which has had RDAP
// since 2013. The User-Agent (now a `fetchSafe` default) fixes the immediate
// bug, but a single broker is still a single point of failure for a whole
// intelligence source. So: try the broker, and if it gives us nothing, resolve
// the authoritative registry ourselves from IANA's bootstrap file, exactly as
// the broker would have.

import { fetchJson } from "./fetchSafe";
import type { DomainWhois } from "../types";

const BROKER = "https://rdap.org/domain/";
const IANA_BOOTSTRAP = "https://data.iana.org/rdap/dns.json";
const RDAP_TIMEOUT_MS = 7000;

// ── RDAP response shapes (only the fields we read) ───────────────────────────

interface RdapEvent { eventAction?: string; eventDate?: string }
interface RdapEntity { roles?: string[]; vcardArray?: unknown; handle?: string }
export interface RdapDomain {
  events?: RdapEvent[];
  entities?: RdapEntity[];
  nameservers?: { ldhName?: string }[];
  status?: string[];
}

/**
 * IANA's bootstrap file: `services` pairs a list of TLDs with the base URLs of
 * the registry servers authoritative for them.
 */
interface IanaBootstrap { services?: [string[], string[]][] }

// ── jCard reading ────────────────────────────────────────────────────────────
// RDAP carries contact details as jCard (RFC 7095): an array whose second
// element is a list of properties, each itself `[name, params, type, value]`.
// Nothing here assumes a property is present or well-formed — registries differ
// in how much they publish, and a redacted contact is normal, not an error.

function properties(vcardArray: unknown): unknown[][] {
  if (!Array.isArray(vcardArray)) return [];
  const props = vcardArray[1];
  if (!Array.isArray(props)) return [];
  return props.filter((p): p is unknown[] => Array.isArray(p));
}

function propertyNamed(vcardArray: unknown, name: string): unknown[] | undefined {
  return properties(vcardArray).find((p) => p[0] === name);
}

/** The display name (`fn`) from a jCard, or "" when absent/redacted. */
function fullName(vcardArray: unknown): string {
  const fn = propertyNamed(vcardArray, "fn");
  return fn ? String(fn[3] ?? "").trim() : "";
}

/**
 * The country from a jCard address.
 *
 * Registries publish this two different ways, and both appear in the wild: as a
 * `cc` parameter on the `adr` property (the structured form), or as the last
 * element of the address array (the legacy positional form, index 6 per
 * RFC 6350). We read the parameter first because it is an ISO code rather than
 * a free-text country name.
 */
function addressCountry(vcardArray: unknown): string | null {
  const adr = propertyNamed(vcardArray, "adr");
  if (!adr) return null;

  const params = adr[1];
  if (params && typeof params === "object" && !Array.isArray(params)) {
    const cc = (params as Record<string, unknown>).cc;
    if (typeof cc === "string" && cc.trim()) return cc.trim().toUpperCase();
  }

  const value = adr[3];
  if (Array.isArray(value)) {
    const country = value[6];
    if (typeof country === "string" && country.trim()) return country.trim();
  }
  return null;
}

// ── Parsing ──────────────────────────────────────────────────────────────────

/**
 * Turn a registry RDAP response into the flat record the UI renders.
 *
 * Exported so it can be tested against captured responses from registries that
 * disagree about shape — .com publishes a registrar jCard, several ccTLDs
 * redact every contact and return events only.
 */
export function parseRdapDomain(r: RdapDomain): DomainWhois {
  const eventDate = (action: string) =>
    r.events?.find((e) => e.eventAction === action)?.eventDate ?? null;

  let registrar: string | null = null;
  let registrantOrg: string | null = null;
  let registrantCountry: string | null = null;

  for (const ent of r.entities ?? []) {
    const roles = ent.roles ?? [];
    const name = fullName(ent.vcardArray);
    if (roles.includes("registrar") && !registrar) registrar = name || ent.handle || null;
    if (roles.includes("registrant")) {
      if (!registrantOrg && name) registrantOrg = name;
      // Previously hard-coded to null, so the "Registrant country" row could
      // never populate even when the registry published it.
      if (!registrantCountry) registrantCountry = addressCountry(ent.vcardArray);
    }
  }

  return {
    registrar,
    createdDate: eventDate("registration"),
    updatedDate: eventDate("last changed") ?? eventDate("last update of RDAP database"),
    expiresDate: eventDate("expiration"),
    nameservers: (r.nameservers ?? []).map((n) => (n.ldhName ?? "").toLowerCase()).filter(Boolean),
    statuses: r.status ?? [],
    registrantOrg,
    registrantCountry,
  };
}

// ── Bootstrap ────────────────────────────────────────────────────────────────

/**
 * IANA's bootstrap file is ~70 KB and changes when a TLD is delegated — days
 * apart at the fastest. Holding it for the process lifetime keeps the fallback
 * to one request instead of two, and a cold process just pays it once.
 */
let bootstrapCache: Map<string, string> | null = null;

/** Map every TLD in the bootstrap file to its registry's RDAP base URL. */
export function indexBootstrap(doc: IanaBootstrap): Map<string, string> {
  const index = new Map<string, string>();
  for (const [tlds, urls] of doc.services ?? []) {
    const base = urls?.find((u) => u.startsWith("https://")) ?? urls?.[0];
    if (!base) continue;
    for (const tld of tlds ?? []) index.set(tld.toLowerCase(), base);
  }
  return index;
}

async function registryBaseFor(domain: string): Promise<string | null> {
  if (!bootstrapCache) {
    const res = await fetchJson<IanaBootstrap>(IANA_BOOTSTRAP, {
      source: "IANA RDAP bootstrap",
      timeoutMs: RDAP_TIMEOUT_MS,
      init: { headers: { Accept: "application/json" } },
    });
    if (!res.ok || !res.data) return null;
    bootstrapCache = indexBootstrap(res.data);
  }
  // lastIndexOf returns -1 for a dotless name, so this yields the whole string
  // — which simply misses the index, the same as an unknown TLD.
  const tld = domain.slice(domain.lastIndexOf(".") + 1).toLowerCase();
  return bootstrapCache.get(tld) ?? null;
}

/** Test seam: drop the cached bootstrap so a test can supply its own. */
export function resetBootstrapCache(): void {
  bootstrapCache = null;
}

// ── Lookup ───────────────────────────────────────────────────────────────────

async function rdapAt(url: string, source: string): Promise<RdapDomain | null> {
  const res = await fetchJson<RdapDomain>(url, {
    source,
    timeoutMs: RDAP_TIMEOUT_MS,
    init: { headers: { Accept: "application/rdap+json" } },
  });
  return res.ok && res.data ? res.data : null;
}

/**
 * Registration data for `domain`, or null when no RDAP server will answer.
 *
 * Null genuinely means "nobody would tell us" — several ccTLDs (.de, .fr for
 * some records) really do publish no RDAP, and the caller reports that
 * honestly. It should no longer mean "we forgot to say who we are".
 */
export async function fetchWhois(domain: string): Promise<DomainWhois | null> {
  const viaBroker = await rdapAt(`${BROKER}${encodeURIComponent(domain)}`, "RDAP (rdap.org)");
  if (viaBroker) return parseRdapDomain(viaBroker);

  const base = await registryBaseFor(domain);
  if (!base) return null;

  const url = `${base.replace(/\/$/, "")}/domain/${encodeURIComponent(domain)}`;
  const viaRegistry = await rdapAt(url, "RDAP (registry)");
  return viaRegistry ? parseRdapDomain(viaRegistry) : null;
}
