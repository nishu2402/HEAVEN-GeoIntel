"use client";

import { useState, type ReactNode } from "react";
import { Search, X, Loader2 } from "lucide-react";

interface Props {
  placeholder: string;
  hint?: string;
  icon?: ReactNode;
  loading?: boolean;
  initialValue?: string;
  onLookup: (value: string) => void;
  onClear?: () => void;
  /** Return an error string to block submit, or null when valid. */
  validate?: (value: string) => string | null;
  ariaLabel?: string;
}

export default function SimpleLookupInput({
  placeholder, hint, icon, loading, initialValue = "", onLookup, onClear, validate, ariaLabel,
}: Props) {
  const [value, setValue] = useState(initialValue);
  const [error, setError] = useState<string | null>(null);

  function submit() {
    const v = value.trim();
    if (!v) { setError("Enter a value to look up."); return; }
    const err = validate?.(v) ?? null;
    if (err) { setError(err); return; }
    setError(null);
    onLookup(v);
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          {icon && (
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--hv-ink-dim)] pointer-events-none">
              {icon}
            </span>
          )}
          <input
            type="text"
            value={value}
            onChange={(e) => { setValue(e.target.value); if (error) setError(null); }}
            onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
            placeholder={placeholder}
            aria-label={ariaLabel ?? placeholder}
            spellCheck={false}
            autoCapitalize="none"
            autoCorrect="off"
            className={`terminal-input w-full ${icon ? "pl-9" : "pl-3"} pr-3 py-2.5 font-mono text-sm`}
          />
        </div>
        <div className="flex gap-2">
          <button
            onClick={submit}
            disabled={loading}
            className="btn-neon flex items-center justify-center gap-1.5 px-5 py-2.5 text-xs font-mono font-bold uppercase tracking-widest disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
            {loading ? "SCANNING" : "EXECUTE"}
          </button>
          {onClear && (
            <button
              onClick={() => { setValue(""); setError(null); onClear(); }}
              aria-label="Clear"
              className="px-3 py-2.5 rounded-md border border-[var(--hv-glass-border)] text-[var(--hv-ink-dim)] hover:text-[var(--hv-red)] hover:border-[var(--hv-red)]/50 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
      {error
        ? <div className="text-[12px] font-mono text-[var(--hv-red)]">{error}</div>
        : hint && <div className="text-[12px] font-mono text-[var(--hv-ink-dim)]">{hint}</div>}
    </div>
  );
}
