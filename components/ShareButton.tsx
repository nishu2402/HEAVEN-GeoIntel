"use client";

import { useState } from "react";
import { Share2, Check } from "lucide-react";
import { copyText } from "@/lib/utils";

interface Props {
  e164: string;
}

export default function ShareButton({ e164 }: Props) {
  const [copied, setCopied] = useState(false);

  const handleShare = () => {
    const url = `${window.location.origin}?q=${encodeURIComponent(e164)}`;
    void copyText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      onClick={handleShare}
      className="flex items-center gap-1.5 text-xs border border-[#00ff41]/30 px-3 py-1.5 text-[#00ff41]/70 hover:text-[#00ff41] hover:border-[#00ff41]/60 transition-colors font-mono"
      title="Copy shareable URL"
    >
      {copied ? (
        <>
          <Check className="w-3 h-3 text-[#00ff41]" /> URL COPIED
        </>
      ) : (
        <>
          <Share2 className="w-3 h-3" /> SHARE LINK
        </>
      )}
    </button>
  );
}
