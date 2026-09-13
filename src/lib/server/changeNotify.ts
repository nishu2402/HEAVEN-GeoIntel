// ── Optional change webhook ──────────────────────────────────────────────────
//
// The in-app inbox needs no configuration and is where changes are meant to be
// read. This is the other half for people who want a change to reach them
// somewhere else: set `CHANGE_WEBHOOK_URL` and each diff is POSTed there as
// JSON.
//
// Off by default and best-effort by design. A webhook that is slow, down, or
// misconfigured must never delay or fail the snapshot that produced it — the
// change is already recorded in the case file either way.

import { withUserAgent } from "./fetchSafe";
import { hostAllowed } from "./httpProbe";
import type { EntityKind } from "../types";
import type { FactChange } from "../analysis/caseSnapshot";

const TIMEOUT_MS = 5000;

/** The configured webhook, or null when the feature is off. */
export function changeWebhookUrl(): string | null {
  const raw = process.env.CHANGE_WEBHOOK_URL;
  if (!raw || !raw.trim()) return null;
  try {
    const u = new URL(raw.trim());
    // https only, and never pointed inward: this URL is operator-supplied, but
    // an operator who pastes the wrong thing should not turn their own server
    // into a request proxy for its own network.
    if (u.protocol !== "https:" || !hostAllowed(u.hostname)) return null;
    return u.toString();
  } catch {
    return null;
  }
}

export interface ChangePayload {
  caseId: string;
  caseName: string;
  kind: EntityKind;
  value: string;
  takenAt: number;
  changes: FactChange[];
  /** True when either side of the diff came from the result cache. */
  cacheInvolved: boolean;
}

/**
 * Fire the webhook for one diff. Returns whether it was delivered, so a caller
 * can log it; it never throws and never rejects.
 */
export async function notifyChange(payload: ChangePayload): Promise<boolean> {
  const url = changeWebhookUrl();
  if (!url || payload.changes.length === 0) return false;
  try {
    const res = await fetch(url, withUserAgent({
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tool: "HEAVEN-GeoIntel", event: "case.change", ...payload }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    }));
    return res.ok;
  } catch {
    return false;
  }
}
