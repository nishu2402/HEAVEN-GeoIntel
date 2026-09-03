"use client";

import { useState } from "react";
import { ExternalLink, Copy, Check } from "lucide-react";
import { copyText } from "@/lib/utils";
import { ACCESS_META, BLOCK_CAVEAT, BLOCK_LIMIT, isAppScheme, type AccessTier } from "@/lib/osint/accessTier";

export interface PivotRowLink {
  label: string;
  description: string;
  url: string;
  color: string;
  access: AccessTier;
  /** Shows a [US] marker — the site only holds United States records. */
  usOnly?: boolean;
}

/**
 * One row in a pivot matrix.
 *
 * Two shapes, chosen by the URL's scheme rather than by a flag the caller has
 * to remember to set:
 *
 *   • a web URL renders as an anchor that opens in a new tab;
 *   • an application URI (`tg:`, `viber:`, `sms:`) renders as a button that
 *     copies. Handing those to an `<a href>` is what produced the "can't open
 *     this page" error dialog on desktop, and with target="_blank" it also left
 *     a dead tab behind. Copying keeps the URI useful — the analyst pastes it on
 *     the device that actually has the app — and can never fail.
 */
export default function PivotRow({ link }: { link: PivotRowLink }) {
  const [copied, setCopied] = useState(false);
  const meta = ACCESS_META[link.access];

  const body = (
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-xs font-bold truncate" style={{ color: link.color }}>
          {link.label}
        </span>
        <span
          className="text-[10px] font-mono font-bold px-1 tracking-widest"
          style={{ color: meta.color, backgroundColor: meta.bg }}
          title={meta.hint}
        >
          {meta.label}
        </span>
        {link.usOnly && <span className="text-[10px] text-[#00ff41]/75 font-normal">[US]</span>}
      </div>
      <div className="text-[12px] text-[#00ff41]/85 mt-0.5 leading-tight line-clamp-2">
        {copied ? "Copied: paste it on a device with the app" : link.description}
      </div>
      {/*
        A blocked row is only on screen because the analyst went looking for it,
        which is the moment they need to know the badge is an observation rather
        than a verdict. The tooltip carries the evidence; the row carries the
        part they can act on, because nobody hovers a row they already believe.
      */}
      {link.access === "blocked" && (
        <div className="text-[11px] mt-1 leading-tight italic" style={{ color: meta.color }}>
          {BLOCK_LIMIT}
        </div>
      )}
    </div>
  );

  const shell =
    "flex items-start gap-2 p-2.5 border border-[#00ff41]/10 hover:border-[#00ff41]/35 hover:bg-[#00ff41]/[0.04] transition-all";

  if (isAppScheme(link.url)) {
    return (
      <button
        type="button"
        title={`Copy ${link.url}`}
        onClick={() => {
          void copyText(link.url);
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        }}
        className={`${shell} text-left w-full`}
      >
        {copied
          ? <Check className="w-3 h-3 mt-0.5 shrink-0" style={{ color: link.color }} />
          : <Copy className="w-3 h-3 mt-0.5 shrink-0" style={{ color: link.color }} />}
        {body}
      </button>
    );
  }

  return (
    <a href={link.url} target="_blank" rel="noopener noreferrer" className={shell} title={link.access === "blocked" ? BLOCK_CAVEAT : meta.hint}>
      <ExternalLink className="w-3 h-3 mt-0.5 shrink-0" style={{ color: link.color }} />
      {body}
    </a>
  );
}
