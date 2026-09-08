"use client";

import { useState } from "react";
import { ArrowUpCircle, ExternalLink, X } from "lucide-react";
import { useUpdateCheck } from "@/lib/update/updateStore";

/**
 * The full-width "a new version is available" bar across the top of the app.
 *
 * It reads the same shared check the header button reads, so the two are always
 * in agreement, and it appears only when that check reports a genuine newer
 * release. Dismiss is remembered per version: closing the bar for v3.1.0 hides
 * it until a still-newer release ships, at which point it returns — the analyst
 * is told about the next update, not nagged about the one they already saw.
 */

const DISMISS_KEY = "hv:update-dismissed:v1";

/** The version the user last dismissed, or null. Never throws on a blocked store. */
function readDismissed(): string | null {
  try {
    return localStorage.getItem(DISMISS_KEY);
  } catch {
    return null;
  }
}

export default function UpdateBanner() {
  const { info } = useUpdateCheck();
  // Lazy init is safe here: the first render shows nothing until `info` arrives
  // (server and first client render both have info === null), so reading storage
  // during render cannot cause a hydration mismatch.
  const [dismissed, setDismissed] = useState<string | null>(readDismissed);

  // Show only a real, tagged, undismissed newer release. `updateAvailable` is
  // already true only for a strictly-newer tag; the `latest` guard keeps a
  // version-less payload (which the endpoint never emits, but a stale cache could
  // in theory hold) from ever rendering a blank "update".
  if (!info || !info.ok || !info.updateAvailable || !info.latest) return null;
  const latest = info.latest; // narrowed to a real version string past the guard
  if (dismissed === latest) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, latest);
    } catch {
      /* unwritable store: the bar still closes for this view */
    }
    setDismissed(latest);
  };

  return (
    <div
      role="status"
      className="relative z-30 flex items-center justify-center gap-2 sm:gap-3 flex-wrap px-10 py-2 text-[12px] font-mono border-b border-[var(--hv-amber)]/40 bg-[var(--hv-amber)]/10"
    >
      <ArrowUpCircle className="w-4 h-4 shrink-0 text-[var(--hv-amber)]" />
      <span className="text-[var(--hv-ink)]">
        A new version <b className="text-[var(--hv-amber)]">{latest}</b> of HEAVEN-GeoIntel is available.
      </span>
      <a
        href={info.url}
        target="_blank"
        rel="noreferrer noopener"
        className="inline-flex items-center gap-1 text-[var(--hv-amber)] underline hover:no-underline"
      >
        <ExternalLink className="w-3.5 h-3.5" /> View release notes
      </a>
      <button
        onClick={dismiss}
        aria-label="Dismiss update notice"
        className="absolute right-2 sm:right-3 top-1/2 -translate-y-1/2 p-1 rounded text-[var(--hv-ink-dim)] hover:text-[var(--hv-ink)] transition-colors"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
