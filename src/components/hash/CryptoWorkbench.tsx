"use client";

import { useState } from "react";
import { KeyRound, Copy, Check, ArrowUpDown, X, ShieldAlert, Play, Loader2, Wand2 } from "lucide-react";
import { copyText } from "@/lib/utils";
import {
  CRYPTO_CATEGORIES, algosInCategory, runCrypto,
  type OpCategory, type RunResult,
} from "@/lib/analysis/cryptoLab";

/**
 * A local crypto bench for Hash mode: take any text — a token, a paragraph — and
 * hash it, encode it, or encrypt/decrypt it with a passphrase. Every operation
 * runs in this tab over Web Crypto (plus a pure MD5); nothing is uploaded, so it
 * works offline and the plaintext never leaves the browser.
 */

// What the run button and direction toggle say, per category. Digests and HMACs
// are one-way, so they only ever "compute".
const DIR: Record<OpCategory, { fwd: string; rev: string }> = {
  digest: { fwd: "Compute", rev: "Compute" },
  hmac: { fwd: "Compute", rev: "Compute" },
  encode: { fwd: "Encode", rev: "Decode" },
  cipher: { fwd: "Encrypt", rev: "Decrypt" },
  encrypt: { fwd: "Encrypt", rev: "Decrypt" },
};

export default function CryptoWorkbench() {
  const [category, setCategory] = useState<OpCategory>("digest");
  const [algoId, setAlgoId] = useState("md5");
  const [decrypt, setDecrypt] = useState(false);
  const [text, setText] = useState("");
  const [key, setKey] = useState("");
  const [result, setResult] = useState<RunResult | null>(null);
  const [running, setRunning] = useState(false);
  const [copied, setCopied] = useState(false);

  const algos = algosInCategory(category);
  // algoId is kept in sync with category by the pickers below, so the match
  // always exists; the non-null assertion carries no runtime branch.
  const algo = algos.find((a) => a.id === algoId)!;
  const labels = DIR[category];

  const pickCategory = (c: OpCategory) => {
    setCategory(c);
    setAlgoId(algosInCategory(c)[0].id);
    setDecrypt(false);
    setResult(null);
  };
  const pickAlgo = (id: string) => {
    setAlgoId(id);
    setResult(null);
  };

  const run = async () => {
    setRunning(true);
    const r = await runCrypto({ algo: algo.id, text, key, decrypt });
    setResult(r);
    setRunning(false);
  };

  const output = result && result.ok ? result.output : "";
  const note = result && result.ok ? result.note : undefined;

  const copyOut = () => {
    try { void copyText(output); } catch { /* ignore */ }
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };
  const swap = () => { setText(output); setResult(null); };
  const clearAll = () => { setText(""); setKey(""); setResult(null); };

  return (
    <div className="terminal-card p-4 space-y-3">
      <div className="text-[12px] uppercase tracking-widest text-[var(--hv-ink-dim)] flex items-center gap-1.5">
        <Wand2 className="w-3.5 h-3.5" /> CRYPTO WORKBENCH: hash, encode &amp; encrypt any text — offline, in your browser
      </div>

      {/* Category */}
      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Operation category">
        {CRYPTO_CATEGORIES.map((c) => (
          <button
            key={c.id}
            type="button"
            role="tab"
            aria-selected={category === c.id}
            onClick={() => pickCategory(c.id)}
            title={c.blurb}
            className={`text-[11px] font-mono uppercase tracking-widest px-2.5 py-1 rounded-md border transition-colors ${
              category === c.id
                ? "border-[var(--hv-cyan)] text-[var(--hv-cyan)] bg-[var(--hv-cyan)]/10"
                : "border-[var(--hv-glass-border)] text-[var(--hv-ink-dim)] hover:text-[var(--hv-ink)] hover:border-[var(--hv-glass-hi)]"
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>

      {/* Algorithm */}
      <div className="flex flex-wrap gap-1.5" role="listbox" aria-label="Algorithm">
        {algos.map((a) => (
          <button
            key={a.id}
            type="button"
            role="option"
            aria-selected={a.id === algo.id}
            onClick={() => pickAlgo(a.id)}
            className={`text-[11px] font-mono px-2.5 py-1 rounded-md border transition-colors ${
              a.id === algo.id
                ? "border-[var(--hv-green)] text-[var(--hv-green)] bg-[var(--hv-green)]/10"
                : "border-[var(--hv-glass-border)] text-[var(--hv-ink-dim)] hover:text-[var(--hv-ink)] hover:border-[var(--hv-glass-hi)]"
            }`}
          >
            {a.label}
          </button>
        ))}
      </div>

      <p className="text-[11px] font-mono text-[var(--hv-ink-dim)] leading-snug">{algo.blurb}</p>

      {/* Direction — only for reversible algorithms */}
      {algo.reversible && (
        <div className="inline-flex rounded-md border border-[var(--hv-glass-border)] overflow-hidden text-[11px] font-mono uppercase tracking-widest">
          <button
            type="button"
            aria-pressed={!decrypt}
            onClick={() => { setDecrypt(false); setResult(null); }}
            className={`px-3 py-1 ${!decrypt ? "bg-[var(--hv-green)]/15 text-[var(--hv-green)]" : "text-[var(--hv-ink-dim)] hover:text-[var(--hv-ink)]"}`}
          >
            {labels.fwd}
          </button>
          <button
            type="button"
            aria-pressed={decrypt}
            onClick={() => { setDecrypt(true); setResult(null); }}
            className={`px-3 py-1 border-l border-[var(--hv-glass-border)] ${decrypt ? "bg-[var(--hv-cyan)]/15 text-[var(--hv-cyan)]" : "text-[var(--hv-ink-dim)] hover:text-[var(--hv-ink)]"}`}
          >
            {labels.rev}
          </button>
        </div>
      )}

      {/* Text input */}
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={decrypt ? "Paste the encoded / encrypted text to reverse…" : "Type or paste any text — a word or a whole paragraph…"}
        rows={4}
        aria-label="Input text"
        className="w-full text-[12px] font-mono bg-[var(--hv-glass)] border border-[var(--hv-glass-border)] rounded p-2 text-[var(--hv-ink)] focus:outline-none focus:border-[var(--hv-cyan)]"
      />

      {/* Key / passphrase, only when the algorithm needs one */}
      {algo.key !== "none" && (
        <label className="flex items-center gap-2 rounded border border-[var(--hv-glass-border)] bg-[var(--hv-glass)] px-2">
          <KeyRound className="w-3.5 h-3.5 text-[var(--hv-amber)] shrink-0" />
          <input
            type="text"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder={algo.keyLabel}
            aria-label={algo.keyLabel}
            autoComplete="off"
            spellCheck={false}
            className="w-full text-[12px] font-mono bg-transparent py-1.5 text-[var(--hv-ink)] focus:outline-none"
          />
        </label>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={run}
          disabled={running}
          className="inline-flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-widest px-3 py-1.5 rounded border border-[var(--hv-green)]/40 text-[var(--hv-green)] hover:bg-[var(--hv-green)]/10 disabled:opacity-50"
        >
          {running ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
          {decrypt ? labels.rev : labels.fwd}
        </button>
        {(text || key || result) && (
          <button
            type="button"
            onClick={clearAll}
            className="text-[11px] font-mono uppercase tracking-widest px-3 py-1.5 rounded border border-[var(--hv-glass-border)] text-[var(--hv-ink-dim)] hover:text-[var(--hv-ink)]"
          >
            Clear
          </button>
        )}
      </div>

      {/* Result */}
      {result && !result.ok && (
        <div className="text-[12px] font-mono text-[#ff4d6d] flex items-center gap-2 rounded-md border border-[#ff4d6d]/40 bg-[#ff4d6d]/5 p-2.5">
          <ShieldAlert className="w-3.5 h-3.5 shrink-0" /> {result.error}
        </div>
      )}

      {result && result.ok && (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] uppercase tracking-widest text-[var(--hv-ink-dim)] font-mono">Output</span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={copyOut}
                className="inline-flex items-center gap-1 text-[11px] font-mono px-2 py-1 rounded border border-[var(--hv-glass-border)] text-[var(--hv-ink-dim)] hover:text-[var(--hv-cyan)] hover:border-[var(--hv-glass-hi)]"
              >
                {copied ? <><Check className="w-3 h-3" /> Copied</> : <><Copy className="w-3 h-3" /> Copy</>}
              </button>
              <button
                type="button"
                onClick={swap}
                title="Move the output back into the input"
                className="inline-flex items-center gap-1 text-[11px] font-mono px-2 py-1 rounded border border-[var(--hv-glass-border)] text-[var(--hv-ink-dim)] hover:text-[var(--hv-cyan)] hover:border-[var(--hv-glass-hi)]"
              >
                <ArrowUpDown className="w-3 h-3" /> Use as input
              </button>
            </div>
          </div>
          <textarea
            readOnly
            value={output}
            aria-label="Output"
            rows={3}
            onFocus={(e) => e.currentTarget.select()}
            className="w-full text-[12px] font-mono bg-[var(--hv-glass)] border border-[var(--hv-green)]/30 rounded p-2 text-[var(--hv-green)] break-all focus:outline-none"
          />
          {note && (
            <p className="text-[11px] font-mono text-[var(--hv-ink-dim)] leading-snug">{note}</p>
          )}
        </div>
      )}

      <p className="text-[10px] font-mono text-[var(--hv-ink-dim)] leading-snug flex items-start gap-1.5 pt-1 border-t border-[var(--hv-glass-border)]">
        <X className="w-3 h-3 mt-0.5 shrink-0" />
        Encoding (Base64, hex, ROT13, …) hides nothing. For real secrecy use AES-256-GCM with a strong passphrase. Nothing here is sent anywhere.
      </p>
    </div>
  );
}
