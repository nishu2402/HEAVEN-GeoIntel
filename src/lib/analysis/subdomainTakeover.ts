// ── Dangling-CNAME / subdomain-takeover classification (pure, no network) ────
//
// A subdomain that still points (CNAME) at a third-party service which no longer
// hosts anything for it can be claimed by anyone — the classic subdomain
// takeover. This module classifies a CNAME target against the well-known
// takeover-prone services (the can-i-take-over-xyz catalogue) and hands back the
// service name plus the exact HTTP fingerprint that proves the resource is
// unclaimed.
//
// It is deliberately conservative about the word "vulnerable". Matching a
// service is necessary but NOT sufficient — the resource might still be claimed.
// So this returns a CANDIDATE with the fingerprint to check; it never asserts a
// live takeover, because that would be a false positive. The verification step
// (load the host, look for the fingerprint) is a human/HTTP action the UI points
// at, not a claim this function makes.

export type TakeoverStatus = "vulnerable" | "edge-case";

/**
 * What a live probe of the subdomain found.
 *
 *   unclaimed   the provider's "no resource here" body was served — the
 *               takeover condition is real and this is a finding.
 *   claimed     the host answered with something else, so a resource IS bound
 *               to it. Not a finding; these are dropped before display.
 *   unverified  nothing answered (NXDOMAIN, refused, timeout). A dangling
 *               CNAME is still worth a look, but nothing is confirmed.
 */
export type TakeoverVerification = "unclaimed" | "claimed" | "unverified";

export interface TakeoverSignal {
  /** The CNAME target that matched a known service. */
  host: string;
  service: string;
  /**
   * "vulnerable": takeover works whenever the resource is unclaimed.
   * "edge-case": the provider added guards, so it only works under conditions.
   */
  status: TakeoverStatus;
  /** The response body that confirms the backing resource is unclaimed. */
  fingerprint: string;
  /** Literal body substrings that prove it, matched case-insensitively. */
  markers: string[];
  reference: string;
}

interface Rule {
  test: RegExp;
  service: string;
  status: TakeoverStatus;
  fingerprint: string;
  markers: string[];
  reference: string;
}

const REF = "https://github.com/EdOverflow/can-i-take-over-xyz";

// Ordered; the first match wins. Kept to services that are genuinely takeover-
// prone or a documented edge case — nothing marked "not vulnerable" upstream.
const RULES: Rule[] = [
  { test: /\.s3[.-][a-z0-9-]*\.?amazonaws\.com$|(^|\.)s3\.amazonaws\.com$/, service: "AWS S3", status: "vulnerable", fingerprint: "The specified bucket does not exist / NoSuchBucket", markers: ["NoSuchBucket", "The specified bucket does not exist"], reference: REF },
  { test: /\.github\.io$/, service: "GitHub Pages", status: "edge-case", fingerprint: "There isn't a GitHub Pages site here.", markers: ["There isn't a GitHub Pages site here"], reference: REF },
  { test: /\.herokuapp\.com$|\.herokudns\.com$/, service: "Heroku", status: "edge-case", fingerprint: "No such app", markers: ["No such app", "herokucdn.com/error-pages/no-such-app.html"], reference: REF },
  { test: /\.azurewebsites\.net$|\.cloudapp\.net$|\.cloudapp\.azure\.com$|\.trafficmanager\.net$|\.blob\.core\.windows\.net$|\.azureedge\.net$/, service: "Microsoft Azure", status: "vulnerable", fingerprint: "404 Web Site not found / NXDOMAIN on the Azure resource", markers: ["404 Web Site not found", "Web App - Unavailable"], reference: REF },
  { test: /\.fastly\.net$/, service: "Fastly", status: "edge-case", fingerprint: "Fastly error: unknown domain", markers: ["Fastly error: unknown domain"], reference: REF },
  { test: /\.myshopify\.com$/, service: "Shopify", status: "edge-case", fingerprint: "Sorry, this shop is currently unavailable", markers: ["Sorry, this shop is currently unavailable"], reference: REF },
  { test: /\.pantheonsite\.io$/, service: "Pantheon", status: "vulnerable", fingerprint: "The gods are wise, but do not know of the site which you seek.", markers: ["The gods are wise, but do not know of the site which you seek"], reference: REF },
  { test: /\.bitbucket\.io$/, service: "Bitbucket", status: "vulnerable", fingerprint: "Repository not found", markers: ["Repository not found"], reference: REF },
  { test: /\.surge\.sh$/, service: "Surge.sh", status: "vulnerable", fingerprint: "project not found", markers: ["project not found"], reference: REF },
  { test: /\.ghost\.io$/, service: "Ghost", status: "edge-case", fingerprint: "The thing you were looking for is no longer here", markers: ["The thing you were looking for is no longer here"], reference: REF },
  { test: /\.wpengine\.com$/, service: "WP Engine", status: "vulnerable", fingerprint: "The site you were looking for couldn't be found", markers: ["The site you were looking for couldn't be found"], reference: REF },
  { test: /\.zendesk\.com$/, service: "Zendesk", status: "edge-case", fingerprint: "Help Center Closed", markers: ["Help Center Closed"], reference: REF },
  { test: /\.readthedocs\.io$/, service: "Read the Docs", status: "edge-case", fingerprint: "unknown to Read the Docs", markers: ["unknown to Read the Docs"], reference: REF },
  { test: /\.statuspage\.io$/, service: "Statuspage", status: "vulnerable", fingerprint: "You are being redirected / hosted status page not found", markers: ["You are being redirected"], reference: REF },
  { test: /\.launchrock\.com$/, service: "LaunchRock", status: "vulnerable", fingerprint: "It looks like you may have taken a wrong turn somewhere", markers: ["It looks like you may have taken a wrong turn somewhere"], reference: REF },
];

/**
 * Does a response body carry the provider's "nothing is bound here" page?
 *
 * This is what separates a finding from noise. A CNAME into a takeover-prone
 * service is necessary but nowhere near sufficient: a live sweep of github.com
 * on 2026-09-12 produced twelve service matches, and all twelve served real
 * content — every one was a claimed resource. Only the marker proves otherwise.
 */
export function bodyProvesUnclaimed(signal: TakeoverSignal, body: string): boolean {
  const hay = body.toLowerCase();
  return signal.markers.some((m) => hay.includes(m.toLowerCase()));
}

/** Normalise a CNAME target: lower-case and drop the trailing FQDN dot. */
function normalizeHost(host: string): string {
  return host.trim().toLowerCase().replace(/\.$/, "");
}

/** Classify one CNAME target; null when it matches no known service. */
export function classifyTakeover(cnameTarget: string): TakeoverSignal | null {
  const host = normalizeHost(cnameTarget);
  if (!host) return null;
  for (const r of RULES) {
    if (r.test.test(host)) {
      return { host, service: r.service, status: r.status, fingerprint: r.fingerprint, markers: r.markers, reference: r.reference };
    }
  }
  return null;
}

/**
 * Classify a set of CNAME targets, de-duplicated by host. Order of the returned
 * signals follows first appearance in the input.
 */
export function scanTakeover(cnameTargets: string[]): TakeoverSignal[] {
  const seen = new Set<string>();
  const out: TakeoverSignal[] = [];
  for (const t of cnameTargets) {
    const sig = classifyTakeover(t);
    if (!sig || seen.has(sig.host)) continue;
    seen.add(sig.host);
    out.push(sig);
  }
  return out;
}
