// ── WhatsMyName's four-field detection contract (pure) ───────────────────────
//
// The main sweep's own rule is "HTTP 200 means the account exists", which is
// why two thirds of its catalog had to be marked `manual`: a site that serves a
// soft-404 landing page with status 200 would be claimed as a hit for every
// handle on earth. WhatsMyName ships something stricter for 672 sites:
//
//   present  =  status == e_code  AND  body contains e_string
//   absent   =  status == m_code  AND  body contains m_string
//
// Both halves must agree. A page that matches neither is `unknown`, which is the
// honest answer for a Cloudflare interstitial, a redirect to a login wall, or a
// site whose markup has moved on since the catalog entry was written.
//
// This is what makes 672 sites safe to auto-check when the tool previously
// auto-checked 23: not a loosening of the standard, a tightening of it.

export type WmnStatus = "found" | "notfound" | "unknown";

export interface WmnContract {
  /** HTTP status that means the account exists. */
  ec?: number;
  /** Body substring that means the account exists. */
  es?: string;
  /** HTTP status that means the account is free. */
  mc?: number;
  /** Body substring that means the account is free. */
  ms?: string;
}

/** True when the contract is complete enough to classify with at all. */
export function hasContract(site: WmnContract): boolean {
  return (
    typeof site.ec === "number" &&
    typeof site.mc === "number" &&
    ((site.es ?? "") !== "" || (site.ms ?? "") !== "")
  );
}

/** True when this contract needs the response body, not just the status. */
export function needsBody(site: WmnContract): boolean {
  return (site.es ?? "") !== "" || (site.ms ?? "") !== "";
}

/**
 * Classify one probe. `body` may be a prefix of the response — the markers are
 * near the top of the document in practice, and an unbounded read would let one
 * site stall a sweep.
 *
 * An ambiguous result (both halves matching, which happens when a site uses the
 * same status for both and the markers are loose) is `unknown`. Reporting it as
 * found would be a coin flip dressed up as evidence.
 */
export function classifyWmn(site: WmnContract, status: number, body: string): WmnStatus {
  const present = status === site.ec && ((site.es ?? "") === "" || body.includes(site.es as string));
  const absent = status === site.mc && ((site.ms ?? "") === "" || body.includes(site.ms as string));
  if (present && absent) return "unknown";
  if (present) return "found";
  if (absent) return "notfound";
  return "unknown";
}

/** Fill a `{account}` template. The handle is percent-encoded for the probe URL. */
export function fillTemplate(template: string, handle: string, encode = true): string {
  return template.replace(/\{account\}/g, encode ? encodeURIComponent(handle) : handle);
}
