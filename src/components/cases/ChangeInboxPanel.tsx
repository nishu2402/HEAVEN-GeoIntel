"use client";

import { Inbox, Check } from "lucide-react";
import type { Inbox as InboxModel } from "@/lib/analysis/changeInbox";

interface Props {
  inbox: InboxModel;
  /** Mark one case's changes as read. */
  onMarkRead?: (caseId: string) => void;
}

const fmt = (ms: number) => new Date(ms).toLocaleString();

/**
 * Everything that moved across every case, newest first.
 *
 * Monitoring used to stop at a manual re-run: the snapshot history knew a
 * breach count had grown and nothing ever said so. This is the read-out, and it
 * needs no delivery channel to be useful — a webhook (CHANGE_WEBHOOK_URL) is
 * the optional half.
 *
 * A first observation is counted as a baseline, never rendered as a change:
 * "first seen" and "changed" are different claims.
 */
export default function ChangeInboxPanel({ inbox, onMarkRead }: Props) {
  if (inbox.changes.length === 0) {
    return (
      <div className="terminal-card p-4 space-y-1">
        <div className="text-[12px] uppercase tracking-widest text-[var(--hv-ink-dim)] flex items-center gap-1.5">
          <Inbox className="w-3.5 h-3.5" /> CHANGES
        </div>
        <p className="text-[11px] font-mono text-[var(--hv-ink-dim)]">
          Nothing has changed yet. {inbox.baselines > 0 ? `${inbox.baselines} identifier${inbox.baselines === 1 ? " has" : "s have"} a first snapshot and nothing to compare against.` : "Re-run a pinned lookup to start comparing."}
        </p>
      </div>
    );
  }

  const cases = [...new Set(inbox.changes.filter((c) => c.unread).map((c) => c.caseId))];

  return (
    <div className="terminal-card p-4 space-y-2">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="text-[12px] uppercase tracking-widest text-[var(--hv-ink-dim)] flex items-center gap-1.5">
          <Inbox className="w-3.5 h-3.5" /> CHANGES: {inbox.unread} unread of {inbox.changes.length}
        </div>
        {onMarkRead && cases.length > 0 && (
          <button type="button" onClick={() => cases.forEach((id) => onMarkRead(id))}
            className="inline-flex items-center gap-1 text-[11px] font-mono px-2 py-1 rounded border border-[var(--hv-glass-border)] text-[var(--hv-green)]">
            <Check className="w-3 h-3" /> Mark all read
          </button>
        )}
      </div>
      <div className="space-y-1 max-h-72 overflow-y-auto">
        {inbox.changes.map((c, i) => (
          <div key={`${c.caseId}-${c.value}-${c.fact}-${i}`}
            className="text-[11px] font-mono flex items-start gap-2 flex-wrap border-b border-[var(--hv-glass-border)] pb-1">
            {c.unread && <span className="text-[var(--hv-green)]">●</span>}
            <span className="text-[var(--hv-ink-dim)]">{fmt(c.at)}</span>
            <span className="text-[var(--hv-cyan)]">{c.caseName}</span>
            <span className="text-[var(--hv-ink)] break-all">{c.kind} {c.value}</span>
            <span className="text-[var(--hv-ink)]">
              {c.fact}: {c.from === null ? "not reported" : String(c.from)} → {c.to === null ? "not reported" : String(c.to)}
            </span>
            {c.cacheInvolved && <span className="text-[#fb923c]">cached side</span>}
          </div>
        ))}
      </div>
      <p className="text-[10px] font-mono text-[var(--hv-ink-dim)]">
        A row marked &quot;cached side&quot; compared against a cached lookup, so the change may be older than its
        timestamp. Set CHANGE_WEBHOOK_URL to have these posted somewhere as they happen.
      </p>
    </div>
  );
}
