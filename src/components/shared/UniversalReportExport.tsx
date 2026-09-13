"use client";

import { FileText, FileCode, FileJson, FileType, Printer } from "lucide-react";
import { reportToText, reportToMarkdown, reportToStixBundle, type ReportModel } from "@/lib/analysis/report";
import { reportToHtml } from "@/lib/analysis/reportHtml";
import { reportToPrintHtml } from "@/lib/analysis/reportPrint";

/**
 * Export buttons for any mode's report. Five formats, and PDF and HTML are two
 * different documents rather than one file offered twice: PDF opens the paged
 * A4 report (cover page, numbered sections, ruled tables, ink on white) and
 * hands it to the browser's own PDF engine, while HTML downloads the on-screen
 * dossier (the app's palette, a sticky contents rail, live filtering, per-value
 * copy). Both are built from the same model, so they never disagree.
 *
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

  // The paged document goes to a fresh window and straight into the print
  // dialog. It is fully self-contained (inline styles, inline SVG mark), so it
  // is ready to print the moment it is written.
  const printPdf = () => {
    const win = window.open("", "_blank");
    /* v8 ignore next -- window.open only returns null when a popup blocker intervenes */
    if (!win) return;
    win.document.write(reportToPrintHtml(model));
    win.document.close();
    win.focus();
    win.print();
  };

  const buttons: { label: string; icon: React.ReactNode; color: string; hint: string; run: () => void }[] = [
    { label: "PDF", icon: <Printer className="w-3 h-3" />, color: "#ff4d6d", hint: "Paged A4 document with a cover page: opens the print dialog, choose Save as PDF", run: printPdf },
    { label: "HTML", icon: <FileType className="w-3 h-3" />, color: "#c77dff", hint: "Interactive dossier: one self-contained file with a contents rail, filtering and copy buttons", run: () => download(reportToHtml(model), "text/html", "html") },
    { label: "TXT", icon: <FileText className="w-3 h-3" />, color: "#00ff85", hint: "Plain-text brief for a ticket or an email body", run: () => download(reportToText(model), "text/plain", "txt") },
    { label: "Markdown", icon: <FileCode className="w-3 h-3" />, color: "#00d9ff", hint: "Markdown with tables, for a wiki or a pull request", run: () => download(reportToMarkdown(model), "text/markdown", "md") },
    { label: "STIX 2.1", icon: <FileJson className="w-3 h-3" />, color: "#fbbf24", hint: "STIX 2.1 bundle for machine handoff to another platform", run: () => download(JSON.stringify(reportToStixBundle(model), null, 2), "application/json", "stix.json") },
  ];

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-[11px] uppercase tracking-widest text-[var(--hv-ink-dim)] font-mono">Export</span>
      {buttons.map((b) => (
        <button key={b.label} type="button" onClick={b.run}
          className="inline-flex items-center gap-1.5 text-[11px] font-mono px-2.5 py-1 rounded border transition-colors"
          style={{ borderColor: b.color + "40", color: b.color }}
          title={b.hint}>
          {b.icon} {b.label}
        </button>
      ))}
    </div>
  );
}
