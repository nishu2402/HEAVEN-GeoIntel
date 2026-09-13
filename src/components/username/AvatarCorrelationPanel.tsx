"use client";

import { Fingerprint } from "lucide-react";
import type { AvatarCluster } from "@/lib/types";
import { safeExternalUrl } from "@/lib/utils";

interface Props {
  /** Clusters computed server-side by perceptual hash. */
  clusters: AvatarCluster[];
  /** Avatars that produced no hash, with the reason, so absence is explained. */
  skipped?: { url: string; source: string; reason: string }[];
}

/**
 * Flags when the same profile photo is reused across platforms.
 *
 * The comparison itself moved to the server. It used to run on a browser canvas,
 * which requires the image host to send CORS headers — and measured live, only
 * one of three avatar hosts did, so `getImageData` threw for the rest, one
 * surviving hash could never form a cluster, and this panel silently rendered
 * nothing on every lookup that was not pure GitHub. Server-side there is no
 * CORS, so a GitHub-to-Mastodon match (100%, verified on a real account) is now
 * visible.
 */
export default function AvatarCorrelationPanel({ clusters, skipped = [] }: Props) {
  if (clusters.length === 0 && skipped.length === 0) return null;

  return (
    <div className="terminal-card p-4 space-y-2">
      <div className="text-[12px] uppercase tracking-widest text-[var(--hv-magenta)] flex items-center gap-1.5">
        <Fingerprint className="w-3.5 h-3.5" /> AVATAR MATCH: same photo across platforms
      </div>
      {clusters.map((c, i) => (
        <div key={i} className="rounded-md border border-[var(--hv-glass-border)] p-2.5 space-y-1.5">
          <div className="text-xs font-mono text-[var(--hv-ink)]">
            <span className="text-[var(--hv-green)] font-bold">{c.similarity}% match</span>: {c.sources.join(" · ")}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {c.urls.map((u) => {
              const s = safeExternalUrl(u);
              return s ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={u} src={s} alt="" className="w-9 h-9 rounded border border-[var(--hv-glass-border)] object-cover" />
              ) : null;
            })}
          </div>
        </div>
      ))}
      {clusters.length === 0 && (
        <p className="text-[11px] font-mono text-[var(--hv-ink-dim)]">
          No two profile photos matched.
        </p>
      )}
      {skipped.length > 0 && (
        <div className="pt-1.5 border-t border-[var(--hv-glass-border)] space-y-0.5">
          {skipped.map((s) => (
            <div key={s.url} className="text-[10px] font-mono text-[var(--hv-ink-dim)]">
              {s.source}: not compared ({s.reason})
            </div>
          ))}
        </div>
      )}
      <p className="text-[10px] font-mono text-[var(--hv-ink-dim)]">
        Perceptual (dHash) match computed on the server. Platform default avatars are excluded, so two accounts
        that both left the default photo in place never count as a match.
      </p>
    </div>
  );
}
