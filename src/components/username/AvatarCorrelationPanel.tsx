"use client";

import { useEffect, useState } from "react";
import { Fingerprint } from "lucide-react";
import { correlateAvatars, dHashFromGray, type HashedAvatar, type AvatarCluster } from "@/lib/analysis/phash";
import { safeExternalUrl } from "@/lib/utils";

export interface AvatarInput { url: string; source: string }

/** Resolve an avatar URL to a perceptual hash, or null if it can't be read. */
export type ComputeHash = (url: string) => Promise<bigint | null>;

/* v8 ignore start -- canvas + Image are browser-only; unavailable in jsdom, exercised live */
const defaultCompute: ComputeHash = (url) =>
  new Promise((resolve) => {
    const safe = safeExternalUrl(url);
    if (!safe) return resolve(null);
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onerror = () => resolve(null);
    img.onload = () => {
      try {
        const cols = 9, rows = 8;
        const canvas = document.createElement("canvas");
        canvas.width = cols;
        canvas.height = rows;
        const ctx = canvas.getContext("2d");
        if (!ctx) return resolve(null);
        ctx.drawImage(img, 0, 0, cols, rows);
        const { data } = ctx.getImageData(0, 0, cols, rows);
        const gray: number[] = [];
        for (let i = 0; i < data.length; i += 4) {
          gray.push(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
        }
        resolve(dHashFromGray(gray, cols, rows));
      } catch {
        // Cross-origin taint: the host sent no CORS header, so getImageData throws.
        resolve(null);
      }
    };
    img.src = safe;
  });
/* v8 ignore stop */

interface Props {
  avatars: AvatarInput[];
  /** Injectable for tests; defaults to the in-browser canvas hasher. */
  compute?: ComputeHash;
}

/**
 * Flags when the same profile photo is reused across platforms, using a
 * perceptual (dHash) match computed in the browser. Only a real match is shown,
 * so it self-hides when nothing correlates or fewer than two avatars are
 * readable. Avatars whose host blocks cross-origin canvas reads drop out.
 */
export default function AvatarCorrelationPanel({ avatars, compute = defaultCompute }: Props) {
  const [clusters, setClusters] = useState<AvatarCluster[]>([]);

  useEffect(() => {
    const uniq = [...new Map(avatars.map((a) => [a.url, a])).values()];
    // Fewer than two avatars can never correlate, so hash nothing and reset via
    // the same async path (keeps the reset out of the effect body).
    const work = uniq.length < 2 ? [] : uniq.map(async (a): Promise<HashedAvatar | null> => {
      const hash = await compute(a.url);
      return hash === null ? null : { source: a.source, url: a.url, hash };
    });
    Promise.all(work).then((hashed) => {
      setClusters(correlateAvatars(hashed.filter((h): h is HashedAvatar => h !== null)));
    });
  }, [avatars, compute]);

  if (clusters.length === 0) return null;

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
      <p className="text-[10px] font-mono text-[var(--hv-ink-dim)]">
        Perceptual (dHash) match computed in your browser. Avatars whose host blocks cross-origin reads are skipped.
      </p>
    </div>
  );
}
