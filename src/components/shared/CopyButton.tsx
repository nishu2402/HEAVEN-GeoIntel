"use client";

import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { copyText } from "@/lib/utils";

/**
 * The one "copy this value" control shared by every result dashboard, so the
 * copy affordance looks and behaves the same everywhere. Wraps copyText, which
 * falls back to a hidden-textarea execCommand on insecure LAN / plain-HTTP
 * origins where navigator.clipboard is undefined.
 *
 * Pass `label` for a chip with visible text (COPY E.164, COPY, …); omit it for
 * a compact icon-only button beside a heading. `ariaLabel` names the button for
 * screen readers and fills the hover tooltip (defaults to `Copy <label>`, or
 * "Copy" when there is no label). The COPIED confirmation clears after 1.5s.
 */
export default function CopyButton({
  text,
  label,
  ariaLabel,
  className,
}: {
  text: string;
  label?: string;
  ariaLabel?: string;
  className?: string;
}) {
  const [done, setDone] = useState(false);
  const aria = ariaLabel ?? (label ? `Copy ${label}` : "Copy");
  return (
    <button
      type="button"
      onClick={() => {
        void copyText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
      aria-label={aria}
      title={aria}
      className={
        className ??
        "inline-flex items-center gap-1.5 text-xs border border-[var(--hv-glass-border)] px-3 py-1.5 text-[var(--hv-ink-dim)] hover:text-[var(--hv-cyan)] hover:border-[var(--hv-glass-hi)] transition-colors font-mono"
      }
    >
      {done ? <Check className="w-3 h-3 text-[var(--hv-green)]" /> : <Copy className="w-3 h-3" />}
      {label != null && <span>{done ? "COPIED" : label}</span>}
    </button>
  );
}
