// ── OFAC sanctioned digital-currency addresses (vendored snapshot) ───────────
//
// 1,056 addresses across 20 chains, from the US Treasury's SDN list. Offline by
// design, like the breach catalogs: no key, no network call at lookup time, and
// no rate limit standing between an analyst and a sanctions answer.
//
// Regenerate with `node scripts/refresh-sanctions.mjs` (or `npm run
// sanctions:refresh`), which reads the XML export rather than the CSV — the
// CSV's remarks column is truncated and loses half the addresses.
//
// SCOPE, stated plainly: this is the SDN list only. A negative result means
// "not on this list", never "clean". Other authorities publish their own lists,
// and an address one hop from a listed one is not itself listed.

import snapshot from "./sanctionedAddresses.snapshot.json";

/** One listed address, with the entity OFAC listed it under. */
export interface SanctionedAddress {
  /** Chain ticker as OFAC writes it: XBT for Bitcoin, ETH, TRX, USDT … */
  ticker: string;
  address: string;
  /** The designated entity's name, as listed. */
  entity: string;
  /** OFAC's internal entry id, so a finding can be traced back to the list. */
  uid: string;
  /** Sanctions programs the entity is designated under (NPWMD, CYBER2, …). */
  programs: string[];
  /** "Individual" / "Entity" / "-0-" as the list records it. */
  entityType: string;
}

interface RawRow {
  t: string;
  a: string;
  n: string;
  u: string;
  p: string[];
  k: string;
}

interface RawSnapshot {
  source: string;
  url: string;
  fetchedAt: string;
  addresses: RawRow[];
}

const raw = snapshot as RawSnapshot;

export const SANCTIONS_SOURCE = raw.source;
/** ISO date the snapshot was taken, so the panel can show its age. */
export const SANCTIONS_FETCHED_AT = raw.fetchedAt;

function expand(r: RawRow): SanctionedAddress {
  return { ticker: r.t, address: r.a, entity: r.n, uid: r.u, programs: r.p, entityType: r.k };
}

/**
 * Lower-cased index. Bitcoin's Base58 is case-SENSITIVE and Ethereum's hex is
 * not, so matching case-insensitively is technically looser than Base58
 * requires — but an address that differs from a listed one only in case is not
 * a different address, it is a typo or an EIP-55 checksum variant of the same
 * one. Reporting it is the safe direction for a sanctions screen.
 */
const index = new Map<string, SanctionedAddress[]>();
for (const row of raw.addresses) {
  const key = row.a.toLowerCase();
  const list = index.get(key) ?? [];
  if (list.length === 0) index.set(key, list);
  list.push(expand(row));
}

/** Every listing for an address, or [] when it is not on the SDN list. */
export function sanctionsFor(address: string): SanctionedAddress[] {
  return index.get(address.trim().toLowerCase()) ?? [];
}

/** How many addresses the snapshot holds, for the source manifest and docs. */
export function sanctionedAddressCount(): number {
  return raw.addresses.length;
}

/** Addresses per chain ticker, for the panel's scope note. */
export function sanctionedChainCounts(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of raw.addresses) out[row.t] = (out[row.t] ?? 0) + 1;
  return out;
}
