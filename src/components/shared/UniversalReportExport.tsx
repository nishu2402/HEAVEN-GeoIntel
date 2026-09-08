"use client";

import { FileText, FileCode, FileJson, FileType, Printer } from "lucide-react";
import {
  reportToText, reportToMarkdown, reportToHtml, reportToStixBundle, type ReportModel,
} from "@/lib/analysis/report";

/**
 * Export buttons for any mode's report — the same professional document in four
 * shapes: plain text, Markdown, a self-contained HTML page, a STIX 2.1 bundle
 * for machine handoff, and a one-click PDF (the print-optimised report is opened
 * and sent straight to the browser's own PDF engine via Print → Save as PDF).
 * Everything is generated client-side from data the lookup already returned;
 * nothing leaves the browser.
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

  // Render the print-optimised report into a fresh window and hand it to the
  // browser's PDF engine. The report HTML is fully self-contained (inline styles,
  // inline SVG logo), so it is ready to print the moment it is written.
  const printPdf = () => {
    const win = window.open("", "_blank");
    /* v8 ignore next -- window.open only returns null when a popup blocker intervenes */
    if (!win) return;
    win.document.write(reportToHtml(model));
    win.document.close();
    win.focus();
    win.print();
  };

  const buttons: { label: string; icon: React.ReactNode; color: string; run: () => void }[] = [
    { label: "PDF", icon: <Printer className="w-3 h-3" />, color: "#ff4d6d", run: printPdf },
    { label: "TXT", icon: <FileText className="w-3 h-3" />, color: "#00ff85", run: () => download(reportToText(model), "text/plain", "txt") },
    { label: "Markdown", icon: <FileCode className="w-3 h-3" />, color: "#00d9ff", run: () => download(reportToMarkdown(model), "text/markdown", "md") },
    { label: "HTML", icon: <FileType className="w-3 h-3" />, color: "#c77dff", run: () => download(reportToHtml(model), "text/html", "html") },
    { label: "STIX 2.1", icon: <FileJson className="w-3 h-3" />, color: "#fbbf24", run: () => download(JSON.stringify(reportToStixBundle(model), null, 2), "application/json", "stix.json") },
  ];

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-[11px] uppercase tracking-widest text-[var(--hv-ink-dim)] font-mono">Export</span>
      {buttons.map((b) => (
        <button key={b.label} type="button" onClick={b.run}
          className="inline-flex items-center gap-1.5 text-[11px] font-mono px-2.5 py-1 rounded border transition-colors"
          style={{ borderColor: b.color + "40", color: b.color }}
          title={b.label === "PDF" ? "Open a print-ready report and Save as PDF" : `Download ${b.label} report`}>
          {b.icon} {b.label}
        </button>
      ))}
    </div>
  );
}
