// ── DNS-over-HTTPS answer semantics ──────────────────────────────────────────
//
// Cloudflare's JSON API answers HTTP 200 even when the DNS lookup itself failed.
// The DNS outcome is in `Status`, the RFC 1035 RCODE. Only two of them are
// answers: NOERROR (the records, possibly none) and NXDOMAIN (the name does not
// exist, so it definitively has none). SERVFAIL, REFUSED and the rest mean the
// resolver could not find out. Reading their empty `Answer` as "no records" is
// what let a failed TXT lookup report a real domain as having no SPF.

export const DOH_URL = "https://cloudflare-dns.com/dns-query";

const RCODE_NAMES: Record<number, string> = { 1: "FORMERR", 2: "SERVFAIL", 4: "NOTIMP", 5: "REFUSED" };

/**
 * Why a DoH response is not an answer, or null when it is one. A body with no
 * `Status` is treated as NOERROR, so a resolver that omits the field still works.
 */
export function dohFailure(status: number | undefined): string | null {
  if (status === undefined || status === 0 || status === 3) return null;
  return `DNS ${RCODE_NAMES[status] ?? `rcode ${status}`}`;
}
