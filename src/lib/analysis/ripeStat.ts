// ── RIPEstat response parsing (pure, no network) ─────────────────────────────
//
// RIPEstat is RIPE NCC's keyless data API over the pooled RIR routing tables. It
// answers the infra questions ip-api cannot: who to report abuse to, which
// announced prefix (netblock) covers the address, and how many prefixes the
// owning ASN announces (a rough size of the operator's footprint).
//
// Parsing lives here, apart from the fetch, so every shape the API can return —
// including the malformed and the empty — is unit-tested directly rather than
// through the route. Each parser takes `unknown` and extracts defensively: a
// surprising payload yields null, never a throw and never a fabricated value.

/** `{ data: { abuse_contacts: ["abuse@..."] } }` → the first contact, or null. */
export function parseAbuse(json: unknown): string | null {
  const arr = (json as { data?: { abuse_contacts?: unknown } } | null | undefined)?.data?.abuse_contacts;
  if (!Array.isArray(arr)) return null;
  const first = arr[0];
  return typeof first === "string" && first.trim() ? first.trim() : null;
}

/** `{ data: { prefix, asns: ["15169"] } }` → the covering prefix + first ASN. */
export function parseNetwork(json: unknown): { prefix: string | null; asn: string | null } {
  const data = (json as { data?: { prefix?: unknown; asns?: unknown } } | null | undefined)?.data;
  const prefix = typeof data?.prefix === "string" && data.prefix.trim() ? data.prefix.trim() : null;
  const asns = data?.asns;
  const asn = Array.isArray(asns) && typeof asns[0] === "string" && asns[0].trim() ? asns[0].trim() : null;
  return { prefix, asn };
}

/** `{ data: { prefixes: [{prefix}, …] } }` → how many prefixes, or null. */
export function parseAnnounced(json: unknown): number | null {
  const arr = (json as { data?: { prefixes?: unknown } } | null | undefined)?.data?.prefixes;
  return Array.isArray(arr) ? arr.length : null;
}
