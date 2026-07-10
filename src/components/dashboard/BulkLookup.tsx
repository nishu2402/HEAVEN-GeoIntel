"use client";

import { useState } from "react";
import { Download, ListChecks, AlertTriangle, Loader2 } from "lucide-react";

interface BulkRow {
  input: string;
  ok: boolean;
  error?: string;
  e164?: string;
  country?: string | null;
  countryName?: string;
  type?: string | null;
  carrier?: string | null;
  timezone?: string | null;
  utcOffset?: string | null;
  npaState?: string | null;
  npaRegion?: string | null;
  cached?: boolean;
}

interface BulkResponse {
  count: number;
  rows: BulkRow[];
}

const MAX_BULK = 25;

function toCsv(rows: BulkRow[]): string {
  const headers = [
    "input", "ok", "error", "e164", "country", "countryName",
    "type", "carrier", "timezone", "utcOffset", "npaState", "npaRegion", "cached",
  ];
  const esc = (v: unknown): string => {
    if (v === null || v === undefined) return "";
    let s = String(v);
    // CSV formula-injection guard: a cell starting with = + - @ (or tab/CR) is
    // run as a formula by Excel/Sheets. Phone numbers begin with "+", so prefix
    // a single quote (Excel hides it, value reads as text).
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    if (s.includes(",") || s.includes("\"") || s.includes("\n")) {
      return `"${s.replace(/"/g, "\"\"")}"`;
    }
    return s;
  };
  const body = rows.map((r) =>
    headers.map((h) => esc((r as unknown as Record<string, unknown>)[h])).join(",")
  );
  return [headers.join(","), ...body].join("\n");
}

export default function BulkLookup() {
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState<BulkRow[] | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const numbers = input
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const tooMany = numbers.length > MAX_BULK;

  async function run() {
    setErrorMsg(null);
    setRows(null);

    // Both guards are unreachable from the UI (the RUN button is disabled in
    // exactly these two states); they keep run() safe if it is ever called from
    // somewhere else.
    /* v8 ignore start -- unreachable: RUN is disabled while empty or over the cap */
    if (numbers.length === 0) {
      setErrorMsg("Paste at least one phone number.");
      return;
    }
    if (tooMany) {
      setErrorMsg(`Max ${MAX_BULK} numbers per batch — got ${numbers.length}.`);
      return;
    }
    /* v8 ignore stop */

    setBusy(true);
    try {
      const res = await fetch("/api/bulk-lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ numbers }),
      });
      const json = (await res.json()) as BulkResponse | { error: string };
      if (!res.ok || !("rows" in json)) {
        setErrorMsg("error" in json ? json.error : `HTTP ${res.status}`);
        return;
      }
      setRows(json.rows);
    } catch {
      setErrorMsg("Network error — is the dev server running?");
    } finally {
      setBusy(false);
    }
  }

  function downloadCsv() {
    /* v8 ignore next -- unreachable: the download button only renders once `rows` exists */
    if (!rows) return;
    const blob = new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `geointel-bulk-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const okCount = rows?.filter((r) => r.ok).length ?? 0;
  const errCount = (rows?.length ?? 0) - okCount;

  return (
    <div className="space-y-3">
      <label className="block text-[12px] uppercase tracking-widest text-[#00ff41]/55 font-mono">
        Paste up to {MAX_BULK} phone numbers — one per line, or comma-separated
      </label>
      <textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        rows={6}
        spellCheck={false}
        aria-label="Bulk phone-number input"
        placeholder={"+14155552671\n+447911123456\n+919876543210"}
        className="w-full bg-[#0a0a0a] border border-[#00ff41]/25 focus:border-[#00ff41]/55 focus:outline-none px-3 py-2 font-mono text-sm text-[#00ff41] placeholder:text-[#00ff41]/25 resize-y"
      />

      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={run}
          disabled={busy || numbers.length === 0 || tooMany}
          className="flex items-center gap-1.5 text-xs font-mono font-bold uppercase tracking-widest border border-[#00ff41]/55 text-[#00ff41] px-4 py-2 hover:bg-[#00ff41]/10 disabled:border-[#00ff41]/15 disabled:text-[#00ff41]/35 disabled:cursor-not-allowed transition-colors"
        >
          {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <ListChecks className="w-3 h-3" />}
          {busy ? "ANALYSING…" : `RUN BULK (${numbers.length})`}
        </button>

        {rows && (
          <button
            onClick={downloadCsv}
            className="flex items-center gap-1.5 text-xs font-mono font-bold uppercase tracking-widest border border-[#00d9ff]/55 text-[#00d9ff] px-4 py-2 hover:bg-[#00d9ff]/10 transition-colors"
          >
            <Download className="w-3 h-3" />
            DOWNLOAD CSV ({rows.length})
          </button>
        )}

        {tooMany && (
          <span className="text-[12px] font-mono text-[#ff3e3e] flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" />
            {numbers.length} pasted — max is {MAX_BULK}
          </span>
        )}
      </div>

      {errorMsg && (
        <div className="text-[13px] font-mono text-[#ff3e3e]/85 border border-[#ff3e3e]/30 bg-[#ff3e3e]/[0.05] px-3 py-2">
          {errorMsg}
        </div>
      )}

      {rows && (
        <div className="space-y-2">
          <div className="text-[12px] font-mono text-[#00ff41]/65 flex flex-wrap gap-3">
            <span className="text-[#00ff41]">✓ {okCount} OK</span>
            {errCount > 0 && <span className="text-[#ff3e3e]">✗ {errCount} failed</span>}
            <span className="text-[#00ff41]/45">— bulk mode is offline-only; rerun individual numbers in the PHONE tab for full enrichment.</span>
          </div>

          <div className="border border-[#00ff41]/15 overflow-x-auto">
            <table className="w-full text-[12px] font-mono">
              <thead className="bg-[#00ff41]/5 text-[#00ff41]/70">
                <tr>
                  <th className="text-left px-2 py-1.5 font-normal">#</th>
                  <th className="text-left px-2 py-1.5 font-normal">INPUT</th>
                  <th className="text-left px-2 py-1.5 font-normal">E.164</th>
                  <th className="text-left px-2 py-1.5 font-normal">CC</th>
                  <th className="text-left px-2 py-1.5 font-normal">TYPE</th>
                  <th className="text-left px-2 py-1.5 font-normal">CARRIER</th>
                  <th className="text-left px-2 py-1.5 font-normal">TZ</th>
                  <th className="text-left px-2 py-1.5 font-normal">NPA REGION</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr
                    key={i}
                    className={`border-t border-[#00ff41]/10 ${r.ok ? "" : "bg-[#ff3e3e]/[0.04]"}`}
                  >
                    <td className="px-2 py-1.5 text-[#00ff41]/45">{i + 1}</td>
                    <td className="px-2 py-1.5 text-[#00ff41]/75">{r.input}</td>
                    <td className="px-2 py-1.5 text-[#00d9ff]">{r.e164 ?? "—"}</td>
                    <td className="px-2 py-1.5 text-[#00ff41]/65">{r.country ?? "—"}</td>
                    <td className="px-2 py-1.5 text-[#00ff41]/65">{r.type ?? "—"}</td>
                    <td className="px-2 py-1.5 text-[#00ff41]/65">{r.carrier ?? "—"}</td>
                    <td className="px-2 py-1.5 text-[#00ff41]/65">{r.utcOffset ?? "—"}</td>
                    <td className="px-2 py-1.5 text-[#00ff41]/65">
                      {r.npaRegion ? `${r.npaRegion}${r.npaState ? `, ${r.npaState}` : ""}` : "—"}
                      {r.cached && <span className="ml-1 text-[#ffaa00]/65">[c]</span>}
                      {!r.ok && r.error && <span className="text-[#ff3e3e]/75">{r.error}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
