"use client";

import { useState } from "react";
import {
  ShieldAlert, ShieldCheck, ShieldQuestion, Play, Loader2, Eye, EyeOff, KeyRound,
} from "lucide-react";
import { checkPasswordPwned, type PwnedCheck } from "@/lib/analysis/pwnedPasswords";

/**
 * "Has this password ever leaked?" — a keyless, privacy-preserving check against
 * Have I Been Pwned's Pwned Passwords range API. The password is hashed with
 * SHA-1 in this tab; only the first five hex characters of that hash are sent
 * (relayed through the tool's own server), and the match happens locally. The
 * password and its full hash never leave the browser.
 *
 * This is deliberately a sibling of the Crypto Workbench, not part of it: the
 * workbench is fully offline, and folding a network check into it would muddy
 * that promise. Here the network hop is the point, and the note says so plainly.
 */
export default function PwnedPasswordCheck() {
  const [password, setPassword] = useState("");
  const [reveal, setReveal] = useState(false);
  const [result, setResult] = useState<PwnedCheck | null>(null);
  const [running, setRunning] = useState(false);

  const run = async () => {
    setRunning(true);
    const r = await checkPasswordPwned(password);
    setResult(r);
    setRunning(false);
  };

  return (
    <div className="terminal-card p-4 space-y-3">
      <div className="text-[12px] uppercase tracking-widest text-[var(--hv-ink-dim)] flex items-center gap-1.5">
        <KeyRound className="w-3.5 h-3.5" /> PASSWORD EXPOSURE: has this password ever leaked? — keyless, k-anonymity
      </div>

      <p className="text-[11px] font-mono text-[var(--hv-ink-dim)] leading-snug">
        Checks a password against Have I Been Pwned&rsquo;s breach corpus without revealing it.
        The password is hashed here; only the first five characters of that hash are sent.
      </p>

      <label className="flex items-center gap-2 rounded border border-[var(--hv-glass-border)] bg-[var(--hv-glass)] px-2">
        <KeyRound className="w-3.5 h-3.5 text-[var(--hv-amber)] shrink-0" />
        <input
          type={reveal ? "text" : "password"}
          value={password}
          onChange={(e) => { setPassword(e.target.value); setResult(null); }}
          onKeyDown={(e) => { if (e.key === "Enter") void run(); }}
          placeholder="Type a password to test…"
          aria-label="Password to check"
          autoComplete="off"
          spellCheck={false}
          className="w-full text-[12px] font-mono bg-transparent py-1.5 text-[var(--hv-ink)] focus:outline-none"
        />
        <button
          type="button"
          onClick={() => setReveal((v) => !v)}
          aria-label={reveal ? "Hide password" : "Show password"}
          className="text-[var(--hv-ink-dim)] hover:text-[var(--hv-ink)] shrink-0"
        >
          {reveal ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
        </button>
      </label>

      <button
        type="button"
        onClick={run}
        disabled={running}
        className="inline-flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-widest px-3 py-1.5 rounded border border-[var(--hv-green)]/40 text-[var(--hv-green)] hover:bg-[var(--hv-green)]/10 disabled:opacity-50"
      >
        {running ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
        Check password
      </button>

      {result && !result.ok && (
        <div className="text-[12px] font-mono text-[#ff4d6d] flex items-center gap-2 rounded-md border border-[#ff4d6d]/40 bg-[#ff4d6d]/5 p-2.5">
          <ShieldQuestion className="w-3.5 h-3.5 shrink-0" /> {result.error}
        </div>
      )}

      {result && result.ok && result.count > 0 && (
        <div className="text-[12px] font-mono text-[#ff4d6d] flex items-start gap-2 rounded-md border border-[#ff4d6d]/40 bg-[#ff4d6d]/5 p-2.5">
          <ShieldAlert className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>
            Exposed. This password appears in the Pwned Passwords corpus{" "}
            <strong>{result.count.toLocaleString()}</strong> time{result.count === 1 ? "" : "s"}.
            Treat it as compromised and never use it.
          </span>
        </div>
      )}

      {result && result.ok && result.count === 0 && (
        <div className="text-[12px] font-mono text-[var(--hv-green)] flex items-start gap-2 rounded-md border border-[var(--hv-green)]/30 bg-[var(--hv-green)]/5 p-2.5">
          <ShieldCheck className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>
            Not found in the Pwned Passwords corpus. That is not proof it is strong, only that it
            has not turned up in a known breach.
          </span>
        </div>
      )}

      <p className="text-[10px] font-mono text-[var(--hv-ink-dim)] leading-snug pt-1 border-t border-[var(--hv-glass-border)]">
        k-anonymity: the SHA-1 prefix returns hundreds of candidate hashes and the match is done
        in your browser. The full password never leaves this tab.
      </p>
    </div>
  );
}
