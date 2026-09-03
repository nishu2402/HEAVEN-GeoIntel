"use client";

import { useState, useCallback } from "react";
import { Search, CheckCircle2, XCircle, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  onLookup: (email: string) => void;
  onClear?: () => void;
  loading: boolean;
}

const EMAIL_RE = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/;

type ValidationState = "empty" | "valid" | "invalid";

export default function EmailInput({ onLookup, onClear, loading }: Props) {
  const [value, setValue] = useState("");

  const trimmed = value.trim();
  let validation: ValidationState = "empty";
  if (trimmed) {
    validation = EMAIL_RE.test(trimmed) ? "valid" : "invalid";
  }

  const handleSubmit = useCallback(() => {
    if (validation === "valid") onLookup(trimmed);
  }, [validation, trimmed, onLookup]);

  const handleClear = useCallback(() => {
    setValue("");
    onClear?.();
  }, [onClear]);

  return (
    <div className="w-full space-y-3">
      {/* Email input row */}
      <div className="relative">
        <input
          type="email"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
          placeholder="target@domain.com"
          className="w-full h-12 pl-4 pr-10 terminal-input text-base rounded-none font-mono"
          spellCheck={false}
          autoComplete="email"
          autoFocus
        />
        <div className="absolute right-3 top-1/2 -translate-y-1/2">
          {validation === "valid" && <CheckCircle2 className="w-4 h-4 text-[#00ff41]" />}
          {validation === "invalid" && trimmed && <XCircle className="w-4 h-4 text-[#ff3e3e]" />}
        </div>
      </div>

      {/* Execute + Clear — full width on mobile */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={validation !== "valid" || loading}
          className={cn(
            "flex-1 h-12 px-4 border text-sm font-mono font-bold tracking-widest transition-all flex items-center justify-center gap-2",
            validation === "valid" && !loading
              ? "border-[#00ff41] text-[#00ff41] hover:bg-[#00ff41] hover:text-[#0a0a0a] hover:shadow-[0_0_20px_rgba(0,255,65,0.4)] cursor-pointer"
              : "border-[#00ff41]/20 text-[#00ff41]/54 cursor-not-allowed"
          )}
        >
          <Search className="w-4 h-4" />
          {loading ? "SCANNING..." : "EXECUTE LOOKUP"}
        </button>

        {(value || onClear) && (
          <button
            type="button"
            onClick={handleClear}
            title="Clear"
            className="h-12 px-4 border border-[#00ff41]/25 text-[#00ff41]/54 hover:text-[#ff3e3e] hover:border-[#ff3e3e]/50 transition-all font-mono"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Status line */}
      <div className="text-sm font-mono">
        {validation === "valid" && (
          <span className="text-[#00ff41]">
            ✓ Valid: will scan: <span className="glow-green">{trimmed}</span>
          </span>
        )}
        {validation === "invalid" && trimmed && (
          <span className="text-[#ff3e3e]">
            ✗ Not a valid email address: check format (user@domain.tld)
          </span>
        )}
        {validation === "empty" && (
          <span className="text-[#00ff41]/54">
            _ Enter an email address · breach data, reputation, social profiles, identity
          </span>
        )}
      </div>
    </div>
  );
}
