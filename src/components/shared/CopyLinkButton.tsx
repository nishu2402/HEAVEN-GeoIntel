"use client";

import { useState } from "react";
import { Link2, Check } from "lucide-react";
import { copyText } from "@/lib/utils";

// Copies the current address-bar URL — which every lookup keeps in sync as
// ?mode=…&q=… — so any result (not just phone) can be shared or bookmarked.
export default function CopyLinkButton({ className }: { className?: string }) {
  const [done, setDone] = useState(false);

  const copy = () => {
    try { void copyText(window.location.href); } catch { /* ignore */ }
    setDone(true);
    setTimeout(() => setDone(false), 2000);
  };

  return (
    <button
      onClick={copy}
      title="Copy a shareable link to this result"
      className={
        className ??
        "flex items-center gap-1.5 text-xs border border-[var(--hv-glass-border)] px-3 py-1.5 text-[var(--hv-ink-dim)] hover:text-[var(--hv-cyan)] hover:border-[var(--hv-glass-hi)] transition-colors font-mono"
      }
    >
      {done ? <><Check className="w-3 h-3" /> LINK COPIED</> : <><Link2 className="w-3 h-3" /> COPY LINK</>}
    </button>
  );
}
