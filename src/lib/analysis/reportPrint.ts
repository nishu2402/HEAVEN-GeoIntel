// ── Print document: the paged A4 report behind the PDF button ────────────────
//
// This is NOT the HTML export with a print stylesheet bolted on. The two
// documents were one file until it became clear that neither audience was being
// served: a screen dossier wants to be dark, scrollable and interactive, and a
// paper document wants a cover page, a numbered body, ruled tables and ink that
// survives a monochrome laser printer. They now share the model, the outline and
// the copy (see ./report) and nothing else.
//
// The browser's own print engine paginates it and writes the PDF. That is a
// deliberate choice over bundling a PDF writer: the engine already does
// widow control, vector type and vector logos, and it needs no dependency.

import {
  CLASSIFICATION, HEAD, LEGEND, METHODOLOGY, bandInk, controlRows, esc,
  observableStixId, reportOutline, reportStats, reportMeta, reportTitle, slug,
  sourceState, statsRows,
  type ReportModel, type ReportRow, type ReportSection,
} from "./report";
import { BRAND, logoSvg } from "../brand/logo";

const kv = (rows: ReportRow[]) =>
  `<table class="kv">${rows.map((r) => `<tr><th>${esc(r.label)}</th><td>${esc(r.value)}</td></tr>`).join("")}</table>`;

const bullets = (items: string[]) =>
  `<ul class="ev">${items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>`;

/** An evidence section: rows, a list, or both, under one numbered heading. */
function sectionBody(s: ReportSection): string {
  const parts: string[] = [];
  if (s.rows?.length) parts.push(kv(s.rows));
  if (s.list?.length) parts.push(bullets(s.list));
  return parts.join("\n");
}

/** 0 to 100 with quarter ticks, so a score reads as a position, not a number. */
function meter(score: number, accent: string): string {
  return `<div class="meter" role="img" aria-label="Risk score ${score} of 100">
  <div class="meter-track"><div class="meter-fill" style="width:${score}%;background:${accent}"></div></div>
  <div class="meter-ticks"><span>0</span><span>25</span><span>50</span><span>75</span><span>100</span></div>
</div>`;
}

export function reportToPrintHtml(m: ReportModel): string {
  const meta = reportMeta(m);
  const st = reportStats(m);
  const a = m.assessment;
  const accent = bandInk(a?.band);
  const outline = reportOutline(m);

  // The body walks the shared outline in order and takes its number from the
  // index it is standing on, so the Contents page cannot list a section the
  // body does not print, or number it differently.
  let n = 0;
  const num = () => String(n + 1).padStart(2, "0");
  const h2 = (title: string) => {
    const head = `<h2 id="${slug(title)}"><span class="sn">${num()}</span>${esc(title)}</h2>`;
    n++;
    return head;
  };

  const body: string[] = [];

  body.push(`<section class="blk">`, h2(HEAD.summary));
  if (m.headline) {
    body.push(`<p class="verdict"><span>${esc(m.headline.label)}</span><strong>${esc(m.headline.value)}</strong></p>`);
  }
  if (m.summary?.length) body.push(kv(m.summary));
  body.push(`</section>`);

  if (a) {
    body.push(`<section class="blk">`, h2(HEAD.risk));
    body.push(
      `<p class="score"><strong style="color:${accent}">${a.score}/100</strong> <span class="band">${esc(a.band)}</span> <span class="conf">confidence ${esc(a.confidence)}</span></p>`,
      meter(a.score, accent),
      `<p class="rationale">${esc(a.rationale)}</p>`,
    );
    if (a.factors.length) {
      body.push(
        `<h3>Contributing factors</h3>`,
        `<table class="factors"><thead><tr><th>Factor</th><th class="sh">Share</th><th>Evidence</th></tr></thead><tbody>`,
        ...a.factors.map((f) => {
          const share = Math.round(f.share * 100);
          return `<tr><td>${esc(f.label)}</td><td class="sh"><span class="fbar"><span style="width:${share}%;background:${accent}"></span></span>${share}%</td><td>${esc(f.evidence)}</td></tr>`;
        }),
        `</tbody></table>`,
      );
    }
    if (a.anomalies.length) {
      body.push(
        `<h3>Flagged patterns</h3>`,
        `<table class="factors"><thead><tr><th>Pattern</th><th>Severity</th><th>Detail</th></tr></thead><tbody>`,
        ...a.anomalies.map((an) => `<tr><td>${esc(an.title)}</td><td>${esc(an.severity)}</td><td>${esc(an.detail)}</td></tr>`),
        `</tbody></table>`,
      );
    }
    body.push(`</section>`);
  }

  for (const s of m.sections) {
    body.push(`<section class="blk">`, h2(s.heading), sectionBody(s), `</section>`);
  }

  if (m.sources.length) {
    body.push(
      `<section class="blk">`, h2(HEAD.sources),
      `<table class="grid"><thead><tr><th>Source</th><th>Result</th><th class="r">Latency</th><th>Reported</th></tr></thead><tbody>`,
      ...m.sources.map((s) => {
        const state = sourceState(s);
        return `<tr><td>${esc(s.source)}</td><td class="st st-${state.replace(/ /g, "-")}">${esc(state)}</td><td class="r">${s.ms != null ? `${s.ms} ms` : ""}</td><td>${esc(s.error ?? "")}</td></tr>`;
      }),
      `</tbody></table>`,
      `<p class="note">Not configured means the source was never called because no API key is set for it. Not applicable means it needs no key, but this lookup gave it nothing to ask about. Neither is a failure, and neither is a negative finding.</p>`,
      `</section>`,
    );
  }

  if (m.pivots.length) {
    body.push(
      `<section class="blk">`, h2(HEAD.pivots),
      `<table class="grid"><thead><tr><th>Resource</th><th>Address</th></tr></thead><tbody>`,
      // The URL is printed in full: on paper a link that only shows its label
      // is a dead end.
      ...m.pivots.map((p) => `<tr><td>${esc(p.label)}</td><td class="url">${esc(p.url)}</td></tr>`),
      `</tbody></table></section>`,
    );
  }

  if (a?.narrative.length) {
    body.push(
      `<section class="blk">`, h2(HEAD.narrative),
      `<p class="note">Computed locally from the evidence above. No language model wrote any part of it.</p>`,
      bullets(a.narrative), `</section>`,
    );
  }

  body.push(
    `<section class="blk">`, h2(HEAD.method),
    `<ol class="method">${METHODOLOGY.map((l) => `<li>${esc(l)}</li>`).join("")}</ol>`,
    `<h3>How to read the numbers</h3>`, kv(LEGEND), `</section>`,
  );

  if (m.observables.length) {
    body.push(
      `<section class="blk">`, h2(HEAD.observables),
      `<table class="grid"><thead><tr><th>Type</th><th>Value</th><th>STIX identifier</th></tr></thead><tbody>`,
      ...m.observables.map((o) => `<tr><td>${esc(o.type)}</td><td class="url">${esc(o.value)}</td><td class="url">${esc(observableStixId(o))}</td></tr>`),
      `</tbody></table>`,
      `<p class="note">These identifiers match the STIX 2.1 bundle exported from the same result, so a document and its machine handoff can be cited against each other.</p>`,
      `</section>`,
    );
  }

  body.push(`<section class="blk">`, h2(HEAD.stats), kv(statsRows(m)), `</section>`);

  const stamp = a
    ? `<div class="stamp" style="border-color:${accent}">
    <span class="stamp-k">Risk</span>
    <strong style="color:${accent}">${a.score}<small>/100</small></strong>
    <span class="stamp-b">${esc(a.band)}</span>
    <span class="stamp-c">confidence ${esc(a.confidence)}</span>
  </div>`
    : "";

  const cover = `<section class="cover">
  <header class="mast">
    ${logoSvg({ size: 44, mono: BRAND.ink, idPrefix: "pr", title: BRAND.name })}
    <div class="mast-t"><strong>${esc(BRAND.name)}</strong><span>${esc(BRAND.tagline)}</span></div>
    <div class="mast-c">${esc(CLASSIFICATION)}</div>
  </header>
  <div class="title-block">
    <p class="kicker">Intelligence report</p>
    <h1>${esc(reportTitle(m))}</h1>
    <p class="subject">${esc(m.subject)}</p>
    <div class="rule" style="background:${accent}"></div>
    ${stamp}
  </div>
  <h2 class="ctl-h">Document control</h2>
  ${kv(controlRows(m))}
  <p class="notice">This document was assembled from ${st.sources} open-source ${st.sources === 1 ? "source" : "sources"}, of which ${st.sourcesAnswered} answered. Every field it contains was returned by one of them. Fields no source returned are omitted rather than padded, so a gap means the data was not collected, not that it does not exist. Read section ${String(outline.indexOf(HEAD.method) + 1).padStart(2, "0")} before quoting any figure here.</p>
  <p class="cover-foot">${esc(meta.documentId)} &middot; ${esc(meta.generatedAt)}</p>
</section>`;

  const toc = `<section class="toc-page">
  <h2 class="toc-h">Contents</h2>
  <ol class="toc">${outline.map((t, i) => `<li><span class="tn">${String(i + 1).padStart(2, "0")}</span><a href="#${slug(t)}">${esc(t)}</a></li>`).join("")}</ol>
  <p class="note">Printed from ${esc(BRAND.name)} v${esc(meta.version)}. Page numbers are applied by the printer, not by this document.</p>
</section>`;

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(meta.documentId)} ${esc(reportTitle(m))}: ${esc(m.subject)}</title>
<style>
  :root {
    --ink: ${BRAND.ink}; --muted: #56617a; --rule: #ccd4e0; --soft: #f4f6fa;
    --accent: ${accent};
    --sans: ui-sans-serif, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif;
    --serif: Georgia, "Iowan Old Style", "Times New Roman", serif;
    --mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 0; color: var(--ink); background: #fff;
    font: 10.5pt/1.55 var(--serif);
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .sheet { max-width: 190mm; margin: 0 auto; padding: 14mm 12mm 20mm; }

  /* Cover ─────────────────────────────────────────────────────────────── */
  .cover { break-after: page; }
  .mast { display: flex; align-items: center; gap: 12px; padding-bottom: 10px; border-bottom: 2px solid var(--ink); }
  .mast-t { display: flex; flex-direction: column; line-height: 1.2; }
  .mast-t strong { font: 700 11pt/1.2 var(--sans); letter-spacing: .12em; text-transform: uppercase; }
  .mast-t span { font: 7.5pt/1.3 var(--sans); letter-spacing: .18em; text-transform: uppercase; color: var(--muted); }
  .mast-c { margin-left: auto; max-width: 62mm; text-align: right; font: 7pt/1.4 var(--sans); letter-spacing: .06em; text-transform: uppercase; color: var(--muted); }
  .title-block { position: relative; padding: 26mm 0 10mm; }
  .kicker { margin: 0; font: 8pt/1 var(--sans); letter-spacing: .3em; text-transform: uppercase; color: var(--muted); }
  h1 { margin: 6px 0 4px; font: 700 26pt/1.12 var(--sans); letter-spacing: -0.01em; max-width: 130mm; }
  .subject { margin: 4px 0 14px; font: 13pt/1.3 var(--mono); word-break: break-all; max-width: 130mm; }
  .rule { height: 4px; width: 52mm; border-radius: 2px; }
  .stamp { position: absolute; top: 22mm; right: 0; width: 42mm; padding: 10px 12px; border: 2px solid var(--ink); border-radius: 4px; text-align: center; }
  .stamp-k { display: block; font: 7pt/1 var(--sans); letter-spacing: .24em; text-transform: uppercase; color: var(--muted); }
  .stamp strong { display: block; margin: 4px 0 2px; font: 700 24pt/1 var(--sans); }
  .stamp strong small { font-size: 11pt; color: var(--muted); }
  .stamp-b { display: block; font: 700 9pt/1.3 var(--sans); letter-spacing: .16em; text-transform: uppercase; }
  .stamp-c { display: block; font: 7.5pt/1.4 var(--sans); color: var(--muted); }
  .ctl-h { margin-top: 6mm; }
  .notice { margin: 6mm 0 0; padding: 10px 14px; background: var(--soft); border-left: 3px solid var(--accent); font-size: 9.5pt; }
  .cover-foot { margin-top: 8mm; font: 8pt/1.4 var(--mono); color: var(--muted); }

  /* Contents ──────────────────────────────────────────────────────────── */
  .toc-page { break-after: page; }
  .toc { list-style: none; margin: 0; padding: 0; columns: 2; column-gap: 12mm; }
  .toc li { display: flex; gap: 8px; break-inside: avoid; padding: 3px 0; border-bottom: 1px dotted var(--rule); }
  .tn { font: 8.5pt/1.7 var(--mono); color: var(--muted); }
  .toc a { color: var(--ink); text-decoration: none; font-size: 9.5pt; }

  /* Body ──────────────────────────────────────────────────────────────── */
  .blk { break-inside: auto; margin: 0 0 7mm; }
  h2 { display: flex; align-items: baseline; gap: 10px; margin: 8mm 0 3mm; padding-bottom: 4px;
       border-bottom: 1.5px solid var(--ink); font: 700 10pt/1.3 var(--sans); letter-spacing: .16em; text-transform: uppercase; break-after: avoid; }
  .sn { font: 700 10pt/1 var(--mono); color: var(--accent); }
  h3 { margin: 5mm 0 2mm; font: 700 8.5pt/1.3 var(--sans); letter-spacing: .14em; text-transform: uppercase; color: var(--muted); break-after: avoid; }
  p { margin: 0 0 3mm; }
  .verdict { display: flex; align-items: baseline; gap: 10px; margin-bottom: 4mm; }
  .verdict span { font: 8pt/1 var(--sans); letter-spacing: .2em; text-transform: uppercase; color: var(--muted); }
  .verdict strong { font: 700 15pt/1.2 var(--sans); }
  .score { margin-bottom: 2mm; }
  .score strong { font: 700 15pt/1 var(--sans); }
  .band { font: 700 9pt/1 var(--sans); letter-spacing: .16em; text-transform: uppercase; }
  .conf { font-size: 9pt; color: var(--muted); }
  .meter { margin: 0 0 3mm; break-inside: avoid; }
  .meter-track { height: 7px; background: #e6eaf2; border: 1px solid var(--rule); border-radius: 4px; overflow: hidden; }
  .meter-fill { height: 100%; }
  .meter-ticks { display: flex; justify-content: space-between; font: 7pt/1.6 var(--mono); color: var(--muted); }
  .rationale { font-size: 10pt; }

  table { width: 100%; border-collapse: collapse; break-inside: avoid; margin: 0 0 3mm; }
  .kv th { width: 46mm; text-align: left; vertical-align: top; padding: 3.5px 10px 3.5px 0;
           font: 700 8pt/1.5 var(--sans); letter-spacing: .06em; text-transform: uppercase; color: var(--muted);
           border-bottom: 1px solid var(--rule); }
  .kv td { padding: 3.5px 0; vertical-align: top; font: 9.5pt/1.45 var(--mono); word-break: break-word; border-bottom: 1px solid var(--rule); }
  .grid thead th, .factors thead th { text-align: left; padding: 4px 8px 4px 0; border-bottom: 1.5px solid var(--ink);
           font: 700 7.5pt/1.5 var(--sans); letter-spacing: .12em; text-transform: uppercase; }
  .grid td, .factors td { padding: 4px 8px 4px 0; vertical-align: top; border-bottom: 1px solid var(--rule); font-size: 9.5pt; }
  .grid td { font-family: var(--mono); font-size: 9pt; }
  .grid .r, .factors .sh { text-align: left; white-space: nowrap; }
  .grid .url { word-break: break-all; }
  .st { font-family: var(--sans); font-size: 8.5pt; text-transform: uppercase; letter-spacing: .08em; }
  .st-answered { color: #0a7a33; }
  .st-failed { color: #b00020; }
  .st-not-configured, .st-not-applicable { color: var(--muted); }
  .fbar { display: inline-block; width: 18mm; height: 6px; margin-right: 6px; background: #e6eaf2; border-radius: 3px; overflow: hidden; vertical-align: middle; }
  .fbar span { display: block; height: 100%; }
  ul.ev, ol.method { margin: 0 0 3mm; padding-left: 5mm; }
  ul.ev li { margin: 1.5px 0; font: 9.5pt/1.45 var(--mono); word-break: break-word; }
  ol.method li { margin: 1.5mm 0; }
  .note { font: 8.5pt/1.45 var(--sans); color: var(--muted); }

  footer { margin-top: 8mm; padding-top: 3mm; border-top: 1.5px solid var(--ink);
           display: flex; justify-content: space-between; gap: 10mm; font: 7.5pt/1.5 var(--sans); color: var(--muted); }

  /* The hint is for the window this document opens in; paper never sees it. */
  .hint { position: sticky; top: 0; z-index: 2; margin: 0; padding: 8px 14px; background: var(--ink); color: #fff;
          font: 8.5pt/1.4 var(--sans); letter-spacing: .04em; text-align: center; }

  @page { size: A4; margin: 16mm 14mm 14mm; }
  @media print {
    .hint { display: none; }
    .sheet { max-width: none; padding: 0; }
    a { color: var(--ink); text-decoration: none; }
  }
</style></head><body>
<p class="hint">Print dialog not open? Press Ctrl+P (Cmd+P on a Mac) and choose "Save as PDF". This page is the paged document; the HTML export is a different, on-screen one.</p>
<div class="sheet">
${cover}
${toc}
${body.join("\n")}
<footer>
  <span>${esc(meta.documentId)} &middot; ${esc(reportTitle(m))} &middot; ${esc(m.subject)}</span>
  <span>${esc(BRAND.name)} v${esc(meta.version)} &middot; authorized use only</span>
</footer>
</div>
</body></html>`;
}
