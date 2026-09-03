// Shared helper for request mocks.
//
// Mocks used to route by `String(url).includes("ip-api.com")`, but a host name
// can appear anywhere in a URL — in a path segment or a query value — so that
// check matches URLs that are NOT actually addressed to the host (exactly what
// CodeQL's js/incomplete-url-substring-sanitization flags). Parsing the URL and
// comparing the real hostname removes the ambiguity.

/** True when `target`'s host is exactly `host` or a subdomain of it. */
export function isHost(target: string | URL, host: string): boolean {
  let hostname: string;
  try {
    hostname = new URL(String(target)).hostname;
  } catch {
    return false;
  }
  return hostname === host || hostname.endsWith("." + host);
}
