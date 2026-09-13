"use client";

import { motion } from "framer-motion";
import { Coins, Wallet, ArrowDownLeft, ArrowUpRight, Activity, ExternalLink, AlertTriangle, CheckCircle2, XCircle, BadgeCheck, ShieldAlert, Gavel, History } from "lucide-react";
import type { WalletLookupResponse } from "@/lib/types";
import CopyLinkButton from "@/components/shared/CopyLinkButton";
import CopyButton from "@/components/shared/CopyButton";
import UniversalReportExport from "@/components/shared/UniversalReportExport";
import { buildWalletReport } from "@/lib/analysis/report";

interface Props { data: WalletLookupResponse }

function Row({ label, value, accent }: { label: React.ReactNode; value: React.ReactNode; accent?: string }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className="flex items-start gap-2 py-1.5 border-b border-[var(--hv-glass-border)] last:border-b-0">
      <span className="text-[12px] uppercase tracking-widest text-[var(--hv-ink-dim)] w-36 shrink-0 pt-0.5">{label}</span>
      <span className="font-mono text-xs flex-1 break-all" style={{ color: accent ?? "var(--hv-ink)" }}>{value}</span>
    </div>
  );
}

export default function WalletResultsDashboard({ data }: Props) {
  const f = data.facts;
  const chainLabel = data.chain === "btc" ? "Bitcoin" : data.chain === "eth" ? "Ethereum" : "Unknown";
  const chainColor = data.chain === "btc" ? "#f7931a" : "#627eea";

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }} className="space-y-4 mt-6">
      <div className="terminal-card p-5 space-y-4">
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Wallet className="w-8 h-8" style={{ color: chainColor }} />
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[11px] font-mono font-bold px-2 py-0.5 rounded border tracking-widest" style={{ color: chainColor, borderColor: chainColor + "70", background: chainColor + "16" }}>{chainLabel}</span>
              </div>
              <div className="flex items-center gap-1.5 mt-1">
                <span className="text-lg sm:text-xl font-bold gradient-text font-mono break-all min-w-0">{data.input}</span>
                <CopyButton text={data.input} ariaLabel="Copy wallet address" className="shrink-0 p-1 rounded text-[var(--hv-ink-dim)] hover:text-[var(--hv-cyan)] hover:bg-[var(--hv-glass-border)]/40 transition-colors" />
              </div>
              {data.ens && (
                data.ens.verified ? (
                  <div className="inline-flex items-center gap-1.5 mt-1.5 text-[12px] font-mono px-2 py-0.5 rounded border" style={{ color: "#00ff85", borderColor: "#00ff8540", background: "#00ff8512" }}>
                    <BadgeCheck className="w-3.5 h-3.5" /> ENS · {data.ens.name} · forward-verified
                  </div>
                ) : (
                  <div className="inline-flex items-center gap-1.5 mt-1.5 text-[12px] font-mono px-2 py-0.5 rounded border" style={{ color: "var(--hv-amber)", borderColor: "var(--hv-amber)", background: "#f59e0b12" }}>
                    <ShieldAlert className="w-3.5 h-3.5" /> reverse record {data.ens.name} does not forward-verify: possible spoof
                  </div>
                )
              )}
            </div>
          </div>
          <CopyLinkButton />
        </div>

        {f ? (
          <>
            <div className="border-t border-[var(--hv-glass-border)] pt-3">
              <div className="flex items-baseline gap-2 flex-wrap">
                <Coins className="w-4 h-4" style={{ color: chainColor }} />
                <span className="text-2xl font-mono font-bold" style={{ color: chainColor }}>{f.balance}</span>
                <span className="text-[11px] font-mono text-[var(--hv-ink-dim)]">current balance</span>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
              <Row label={<span className="inline-flex items-center gap-1"><Activity className="w-3 h-3" /> Transactions</span>} value={f.txCount != null ? f.txCount.toLocaleString() : null} accent="var(--hv-cyan)" />
              <Row label={<span className="inline-flex items-center gap-1"><ArrowDownLeft className="w-3 h-3" /> Total received</span>} value={f.totalReceived} accent="#00ff85" />
              <Row label={<span className="inline-flex items-center gap-1"><ArrowUpRight className="w-3 h-3" /> Total sent</span>} value={f.totalSent} accent="#fb923c" />
              <Row label="Base units" value={f.balanceRaw} />
            </div>
          </>
        ) : (
          <div className="border-t border-[var(--hv-glass-border)] pt-3 text-[13px] font-mono text-[var(--hv-amber)] flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" /> {data.error ?? "No on-chain data."}
          </div>
        )}
      </div>

      {/* Sanctions screening. Shown for every lookup, including one whose chain
          the tool cannot read a balance from — the answer is offline. */}
      {data.sanctions && (
        <div className="terminal-card p-4 space-y-2 border"
          style={{ borderColor: data.sanctions.listed ? "#ff4d6d70" : "var(--hv-glass-border)" }}>
          <div className="text-[12px] uppercase tracking-widest flex items-center gap-1.5"
            style={{ color: data.sanctions.listed ? "#ff4d6d" : "var(--hv-ink-dim)" }}>
            <Gavel className="w-3.5 h-3.5" /> SANCTIONS SCREEN: OFAC SDN
          </div>
          {data.sanctions.listed ? (
            <div className="space-y-1.5">
              {data.sanctions.matches.map((m) => (
                <div key={`${m.uid}-${m.address}`} className="text-xs font-mono text-[var(--hv-ink)]">
                  <span className="text-[#ff4d6d] font-bold">LISTED</span> as {m.entity}
                  <span className="text-[var(--hv-ink-dim)]"> · {m.entityType} · programs {m.programs.join(", ") || "unspecified"} · SDN entry {m.uid} · {m.ticker}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-xs font-mono text-[var(--hv-green)]">
              Not on the SDN list.
            </div>
          )}
          <p className="text-[10px] font-mono text-[var(--hv-ink-dim)]">
            {data.sanctions.listSize.toLocaleString()} designated addresses, snapshot of {data.sanctions.snapshotDate}.
            This is the OFAC SDN list only: no match means not on this list, which is not the same as clean, and an
            address that merely transacted with a listed one is not itself listed.
          </p>
        </div>
      )}

      {/* Recent-history sample (Bitcoin). Every figure is labelled as a sample. */}
      {data.activity && (
        <div className="terminal-card p-4 space-y-2">
          <div className="text-[12px] uppercase tracking-widest text-[var(--hv-ink-dim)] flex items-center gap-1.5">
            <History className="w-3.5 h-3.5" /> RECENT ACTIVITY
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
            <Row label="Last seen" value={data.activity.lastActivity} accent="var(--hv-cyan)" />
            <Row label="Oldest sampled" value={data.activity.oldestSampled} />
            <Row label="Transactions sampled" value={String(data.activity.sampled)} />
            <Row label="Counterparties" value={String(data.activity.counterparties)} accent="#fb923c" />
          </div>
          <p className="text-[10px] font-mono text-[var(--hv-ink-dim)]">
            From the most recent {data.activity.sampled} transactions{data.activity.capped ? " of a longer history" : ""}.
            &quot;Oldest sampled&quot; is the earliest in that page, not the address&apos;s first activity, and the
            counterparty count is a floor.
          </p>
        </div>
      )}

      {/* ERC-20 holdings (Ethereum), zero balances omitted. */}
      {data.tokens && data.tokens.length > 0 && (
        <div className="terminal-card p-4 space-y-2">
          <div className="text-[12px] uppercase tracking-widest text-[var(--hv-ink-dim)] flex items-center gap-1.5">
            <Coins className="w-3.5 h-3.5" /> TOKEN HOLDINGS
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
            {data.tokens.map((t) => (
              <Row key={t.contract} label={t.symbol} value={t.amount} accent="#627eea" />
            ))}
          </div>
          <p className="text-[10px] font-mono text-[var(--hv-ink-dim)]">
            Read directly from each token contract over a public RPC. A fixed list of major assets: no keyless source
            can enumerate every token an address holds, so this is a floor rather than a portfolio.
          </p>
        </div>
      )}

      <div className="terminal-card p-4 space-y-2">
        <div className="text-[12px] uppercase tracking-widest text-[var(--hv-ink-dim)] flex items-center gap-1.5"><Coins className="w-3 h-3" /> DEEPEN: free explorers (no key)</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
          {data.pivots.map((p) => (
            <a key={p.label} href={p.url} target="_blank" rel="noopener noreferrer"
              className="flex items-start gap-2 p-2.5 rounded-md border border-[var(--hv-glass-border)] hover:border-[var(--hv-glass-hi)] transition-all">
              <ExternalLink className="w-3 h-3 mt-0.5 shrink-0 text-[var(--hv-cyan)]" />
              <div className="min-w-0"><div className="text-xs font-bold text-[var(--hv-cyan)]">{p.label}</div><div className="text-[12px] text-[var(--hv-ink-dim)] leading-tight">{p.note}</div></div>
            </a>
          ))}
        </div>
        <p className="text-[11px] font-mono text-[var(--hv-ink-dim)] pt-1 flex items-center gap-1.5">
          <AlertTriangle className="w-3 h-3" /> A balance is not an identity. Attribution needs clustering + off-chain corroboration. ENS names are reverse-resolved and only trusted once they forward-verify.
        </p>
      </div>

      {data.sourceHealth && data.sourceHealth.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-[10px] font-mono text-[var(--hv-ink-dim)] px-1">
          <span className="uppercase tracking-widest">Sources:</span>
          {data.sourceHealth.map((s) => (
            <span key={s.source} title={s.error || "ok"} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border"
              style={{ borderColor: (s.ok ? "#00ff85" : "#ff4d6d") + "40", color: s.ok ? "#00ff85" : "#ff4d6d" }}>
              {s.ok ? <CheckCircle2 className="w-2.5 h-2.5" /> : <XCircle className="w-2.5 h-2.5" />}
              {s.source} · {s.ms}ms{s.ok ? "" : ` · ${s.error}`}
            </span>
          ))}
        </div>
      )}

      <div className="flex justify-end"><UniversalReportExport model={buildWalletReport(data)} /></div>
    </motion.div>
  );
}
