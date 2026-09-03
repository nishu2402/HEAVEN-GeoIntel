"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import {
  Layers, ShieldAlert, ShieldCheck, ShieldQuestion, KeyRound, BadgeCheck,
  CalendarRange,
} from "lucide-react";
import type { BreachAggregate, AggregatedBreach } from "@/lib/analysis/breachAggregate";

interface Props {
  aggregate: BreachAggregate;
  subject: "email address" | "phone number" | "username";
}

/** How many rows show before the analyst asks for the rest. */
const INITIAL_ROWS = 30;

/** A high-signal class gets a hotter colour so the eye lands on it first. */
const HOT = new Set(["Passwords", "Social security numbers", "Dates of birth"]);

function BreachRow({ b }: { b: AggregatedBreach }) {
  return (
    <div className="border border-[#00ff41]/12 bg-[#00ff41]/[0.02] p-2.5 space-y-1.5">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[13px] font-bold text-[#00d9ff]">{b.name}</span>
        {b.date && (
          <span className="text-[11px] font-mono text-[#00ff41]/55">{b.date}</span>
        )}
        {b.password && (
          <span className="text-[10px] font-mono font-bold tracking-widest px-1 text-[#ff3e3e] bg-[#ff3e3e]/10 flex items-center gap-1">
            <KeyRound className="w-2.5 h-2.5" /> PASSWORD
          </span>
        )}
        {b.verified && (
          <span className="text-[10px] font-mono tracking-widest px-1 text-[#00ff41]/80 flex items-center gap-1">
            <BadgeCheck className="w-2.5 h-2.5" /> VERIFIED
          </span>
        )}
        {b.records !== null && b.records > 0 && (
          <span className="text-[11px] font-mono text-[#00ff41]/45">
            {b.records.toLocaleString()} records
          </span>
        )}
      </div>
      <div className="flex items-center gap-1.5 flex-wrap">
        {b.reportedBy.map((p) => (
          <span
            key={p}
            className="text-[10px] font-mono text-[#bf5fff]/85 px-1 py-0.5 border border-[#bf5fff]/25"
            title="Source that named this breach"
          >
            {p}
          </span>
        ))}
        {b.enriched && (
          <span
            className="text-[10px] font-mono text-[#00d9ff]/70 px-1 py-0.5 border border-[#00d9ff]/25"
            title="Data classes and record count filled from the HIBP public catalog. Presence is asserted by the source(s) above; the catalog only describes the breach."
          >
            catalog
          </span>
        )}
        {b.dataClasses.map((c) => (
          <span
            key={c}
            className={
              HOT.has(c)
                ? "text-[10px] font-mono text-[#ff3e3e]/90 px-1 py-0.5 border border-[#ff3e3e]/30"
                : "text-[10px] font-mono text-[#00ff41]/60 px-1 py-0.5 border border-[#00ff41]/18"
            }
          >
            {c}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * The one-stop breach view: every source's hits folded into a single
 * deduplicated list, so the analyst reads the union instead of comparing
 * panels. The number here is the real exposure; the per-source panels below
 * remain for provenance and for the fields only one source carries.
 */
export default function BreachAggregatePanel({ aggregate: a, subject }: Props) {
  const [showAll, setShowAll] = useState(false);
  const found = a.total > 0;

  if (!found) {
    // Nothing matched. Only call it clean when a source actually answered;
    // otherwise the per-source panels below carry the real reason.
    const answered = a.sourcesAnswered.length > 0;
    return (
      <div
        className="terminal-card p-4 border space-y-2"
        style={{ borderColor: answered ? "#00ff4155" : "#55555555" }}
      >
        <div className="text-[12px] uppercase tracking-widest text-[#00ff41]/65 flex items-center gap-1.5">
          {answered
            ? <ShieldCheck className="w-3 h-3 text-[#00ff41]" />
            : <ShieldQuestion className="w-3 h-3 text-[#888]" />}
          UNIFIED BREACH VIEW: merged across sources
        </div>
        {answered ? (
          <div className="text-[13px] font-mono text-[#00ff41]/70">
            No breach records matched this {subject} across{" "}
            {a.sourcesAnswered.join(", ")}. That is {a.sourcesAnswered.length} index
            {a.sourcesAnswered.length === 1 ? "" : "es"} answering clean, not a source that failed.
          </div>
        ) : (
          <div className="text-[13px] font-mono text-[#aaa]">
            No breach source answered for this {subject}. See the per-source panels below for why.
          </div>
        )}
      </div>
    );
  }

  const rows = showAll ? a.breaches : a.breaches.slice(0, INITIAL_ROWS);
  const hidden = a.total - rows.length;
  const timelineMax = Math.max(1, ...a.timeline.map((t) => t.count));

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="terminal-card p-4 space-y-4"
      style={{ borderColor: "#ff3e3e55" }}
    >
      <div>
        <div className="text-[12px] uppercase tracking-widest text-[#00ff41]/65 mb-1.5 flex items-center gap-1.5">
          <Layers className="w-3 h-3 text-[#ff3e3e]" /> UNIFIED BREACH VIEW: merged across sources
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-2xl font-bold font-mono text-[#ff3e3e] flex items-center gap-1.5">
            <ShieldAlert className="w-5 h-5" /> {a.total.toLocaleString()} BREACH{a.total === 1 ? "" : "ES"}
          </span>
          <span className="text-[12px] font-mono text-[#ff3e3e]/85">
            this {subject} appears in {a.total.toLocaleString()} distinct breach
            {a.total === 1 ? "" : "es"} across {a.sourcesReporting.length} source
            {a.sourcesReporting.length === 1 ? "" : "s"}: {a.sourcesReporting.join(", ")}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap text-[12px] font-mono">
        {a.withPassword > 0 && (
          <span className="px-1.5 py-0.5 border border-[#ff3e3e]/35 bg-[#ff3e3e]/[0.06] text-[#ff3e3e] flex items-center gap-1">
            <KeyRound className="w-3 h-3" /> passwords in {a.withPassword}
          </span>
        )}
        {a.passwordFieldsSeen && a.withPassword === 0 && (
          <span className="px-1.5 py-0.5 border border-[#ffaa00]/35 text-[#ffaa00] flex items-center gap-1">
            <KeyRound className="w-3 h-3" /> password fields seen in this set
          </span>
        )}
        {a.verified > 0 && (
          <span className="px-1.5 py-0.5 border border-[#00ff41]/25 text-[#00ff41]/80 flex items-center gap-1">
            <BadgeCheck className="w-3 h-3" /> {a.verified} verified
          </span>
        )}
        {a.firstBreach && a.lastBreach && (
          <span className="px-1.5 py-0.5 border border-[#00d9ff]/25 text-[#00d9ff]/80 flex items-center gap-1">
            <CalendarRange className="w-3 h-3" /> {a.firstBreach} → {a.lastBreach}
          </span>
        )}
      </div>

      {a.dataClasses.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[11px] uppercase tracking-widest text-[#00ff41]/54">
            Exposed data types across all breaches ({a.dataClasses.length})
          </div>
          <div className="flex flex-wrap gap-1">
            {a.dataClasses.map((c) => (
              <span
                key={c}
                className={
                  HOT.has(c)
                    ? "text-[11px] font-mono text-[#ff3e3e]/90 px-1.5 py-0.5 border border-[#ff3e3e]/35 bg-[#ff3e3e]/[0.06]"
                    : "text-[11px] font-mono text-[#00ff41]/70 px-1.5 py-0.5 border border-[#00ff41]/20"
                }
              >
                {c}
              </span>
            ))}
          </div>
        </div>
      )}

      {a.timeline.length > 1 && (
        <div className="space-y-1.5">
          <div className="text-[11px] uppercase tracking-widest text-[#00ff41]/54">
            Breach timeline ({a.firstBreach} → {a.lastBreach})
          </div>
          <div className="flex items-end gap-1 h-16" role="img" aria-label="breaches per year">
            {a.timeline.map((t) => (
              <div
                key={t.year}
                className="flex flex-col items-center justify-end flex-1 min-w-0"
                title={`${t.count} breach${t.count === 1 ? "" : "es"} dated ${t.year}`}
              >
                <span className="text-[9px] font-mono text-[#ff3e3e]/70">{t.count}</span>
                <div
                  className="w-full bg-[#ff3e3e]/45"
                  style={{ height: `${Math.max(Math.round((t.count / timelineMax) * 100), 6)}%` }}
                />
                <span className="text-[9px] font-mono text-[#00ff41]/50 mt-0.5 truncate">{t.year}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-2 max-h-[560px] overflow-y-auto pr-1">
        {rows.map((b) => <BreachRow key={b.key} b={b} />)}
      </div>

      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="text-[12px] font-mono text-[#00d9ff]/85 hover:text-[#00d9ff] border border-[#00d9ff]/30 px-2 py-1 w-full"
        >
          Show {hidden.toLocaleString()} more breach{hidden === 1 ? "" : "es"}
        </button>
      )}

      <div className="text-[12px] font-mono text-[#00ff41]/54 border-t border-[#00ff41]/10 pt-3">
        One row per breach, deduplicated across every source that answered. A row is
        here because a source named it; the chips show which. Sources disagree on
        coverage, so this union is larger than any single panel below.
        {a.enrichedCount > 0 && (
          <> {a.enrichedCount} {a.enrichedCount === 1 ? "row was" : "rows were"} described from the offline HIBP catalog (the &ldquo;catalog&rdquo; chip), which fills data classes and record counts without asserting presence.</>
        )}
      </div>
    </motion.div>
  );
}
