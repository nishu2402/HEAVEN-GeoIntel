"use client";

import { FileText, FileCode, FileJson, Printer } from "lucide-react";
import {
  reportToText, reportToMarkdown, reportToHtml, reportToStixBundle, type ReportModel,
} from "@/lib/analysis/report";

/**
 * Export buttons for any mode's report — plain text, Markdown, a print-optimised
 * HTML page (the browser's "Save as PDF" finishes the job), and a STIX 2.1
 * bundle for machine handoff. Everything is generated client-side from data the
 * lookup already returned; nothing leaves the browser.
 */
export default function UniversalReportExport({ model }: { model: ReportModel }) {
  const base = `geointel_${model.kind}_${model.subject.replace(/[^a-z0-9.-]+/gi, "_")}`;

  const download = (content: string, mime: string, ext: string) => {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${base}_${Date.now()}.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const buttons: { label: string; icon: React.ReactNode; color: string; run: () => void }[] = [
    { label: "TXT", icon: <FileText className="w-3 h-3" />, color: "#00ff85", run: () => download(reportToText(model), "text/plain", "txt") },
    { label: "Markdown", icon: <FileCode className="w-3 h-3" />, color: "#00d9ff", run: () => download(reportToMarkdown(model), "text/markdown", "md") },
    { label: "HTML / PDF", icon: <Printer className="w-3 h-3" />, color: "#c77dff", run: () => download(reportToHtml(model), "text/html", "html") },
    { label: "STIX 2.1", icon: <FileJson className="w-3 h-3" />, color: "#fbbf24", run: () => download(JSON.stringify(reportToStixBundle(model), null, 2), "application/json", "stix.json") },
  ];

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-[11px] uppercase tracking-widest text-[var(--hv-ink-dim)] font-mono">Export</span>
      {buttons.map((b) => (
        <button key={b.label} type="button" onClick={b.run}
          className="inline-flex items-center gap-1.5 text-[11px] font-mono px-2.5 py-1 rounded border transition-colors"
          style={{ borderColor: b.color + "40", color: b.color }}
          title={`Download ${b.label} report`}>
          {b.icon} {b.label}
        </button>
      ))}
    </div>
  );
}
