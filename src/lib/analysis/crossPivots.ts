// ── Cross-tool pivot derivations ─────────────────────────────────────────────
// Given one lookup's result, pick the identifier worth handing to another lookup:
//   • domain → IP     (a resolved A/AAAA record → run an IP lookup on it)
//   • IP → domain     (the reverse-DNS hostname → run a domain lookup on it)
// Pure and client-safe (no `node:net`), so the result dashboards can call them.
// The receiving API re-validates, so these err toward "offer the pivot"; they
// only suppress the clearly-useless cases (bad shapes, PTR arpa zones).

/** Loose IPv4/IPv6 shape check — the IP-lookup API re-validates strictly. */
function looksLikeIp(v: string): boolean {
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(v)) {
    return v.split(".").every((o) => {
      const n = Number(o);
      return n >= 0 && n <= 255 && String(n) === o; // reject leading-zero / out-of-range
    });
  }
  // IPv6: hex groups + at least one colon, nothing else.
  return v.includes(":") && /^[0-9a-fA-F:]+$/.test(v) && v.length >= 3;
}

/** Every A/AAAA record value that is a valid IP, de-duplicated in order. */
export function ipsFromRecords(records: { value: string }[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of records) {
    const v = (r.value ?? "").trim();
    if (v && looksLikeIp(v) && !seen.has(v)) { seen.add(v); out.push(v); }
  }
  return out;
}

/**
 * First A/AAAA record value that is a valid IP → the target for an IP-lookup
 * pivot from a domain result. Null when the domain has no usable address record.
 */
export function domainToIpPivot(records: { value: string }[]): string | null {
  return ipsFromRecords(records)[0] ?? null;
}

/**
 * A reverse-DNS hostname → the target for a domain-lookup pivot from an IP
 * result. Requires a plausible multi-label hostname and rejects the
 * in-addr.arpa / ip6.arpa PTR zones (not registrable hostnames to investigate).
 */
export function ipToDomainPivot(reverse: string | null | undefined): string | null {
  if (!reverse) return null;
  const h = reverse.trim().replace(/\.$/, "").toLowerCase();
  if (/\.(in-addr|ip6)\.arpa$/.test(h)) return null;
  const HOST = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;
  return HOST.test(h) ? h : null;
}
