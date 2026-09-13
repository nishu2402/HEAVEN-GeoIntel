// ── Case dossier: two documents from one model ───────────────────────────────
//
// The case export used to be a Markdown string wrapped in a <pre> tag and
// printed, which is why it read like a memo someone pasted into a browser. It
// is now two purpose-built documents over the same `CaseDocModel`: an on-screen
// dossier in the app's palette, and a paged A4 file with a cover sheet and a
// chain-of-custody block for print and PDF.
//
// Both are self-contained: inline styles, an inline SVG mark, no network calls.
// Every value passes through esc() on its way in.

import {
  CASE_CLASSIFICATION, CASE_INTEGRITY_NOTE, CASE_METHODOLOGY, buildCaseDoc,
  type CaseDocModel, type CaseHistory,
} from "./caseReport";
import { esc } from "./report";
import { BRAND, logoSvg } from "../brand/logo";
import type { InvestigationCase, EntityKind } from "../types";

/** The panel's identifier colours, so a chip means the same thing everywhere. */
const KIND_INK: Record<EntityKind, string> = {
  phone: "#00ff85", email: "#22d3ee", username: "#e879f9", ip: "#fbbf24", domain: "#7dd3fc",
  wallet: "#f7931a", hash: "#a78bfa",
};

const iso = (ms: number) => new Date(ms).toISOString();

/** The ordered outline both case documents follow. */
const OUTLINE = [
  "Case profile",
  "Identifiers",
  "Derived links",
  "Change history",
  "Analyst notes",
  "Methodology and limitations",
  "Integrity and chain of custody",
] as const;

const sid = (i: number) => `s${i + 1}`;

function historyRows(h: CaseHistory, cls: string): string {
  if (h.baselineOnly) {
    return `<p class="${cls}">Baseline only: re-run this identifier to see what changes.</p>`;
  }
  if (h.changes.length === 0) {
    return `<p class="${cls}">Nothing changed across ${h.snapshots} snapshots.</p>`;
  }
  return `<table class="grid"><thead><tr><th>When</th><th>Fact</th><th>Was</th><th>Now</th></tr></thead><tbody>${
    h.changes.map((ch) => `<tr><td>${esc(iso(ch.at))}</td><td>${esc(ch.fact)}</td><td>${esc(ch.from)}</td><td>${esc(ch.to)}</td></tr>`).join("")
  }</tbody></table>`;
}

// ── Screen dossier ───────────────────────────────────────────────────────────

function screenDoc(d: CaseDocModel): string {
  const chip = (kind: EntityKind, value: string) =>
    `<span class="chip" style="color:${KIND_INK[kind]};border-color:${KIND_INK[kind]}55"><em>${esc(kind)}</em>${esc(value)}</span>`;
  // The identifier table already has a Value column, so its Type cell carries
  // the kind alone rather than repeating it either side of the colour.
  const badge = (kind: EntityKind) =>
    `<span class="chip" style="color:${KIND_INK[kind]};border-color:${KIND_INK[kind]}55">${esc(kind)}</span>`;

  const sections: string[] = [];
  const card = (i: number, inner: string) =>
    `<section class="card" id="${sid(i)}" data-sec><h2><span class="sn">${String(i + 1).padStart(2, "0")}</span>${esc(OUTLINE[i]!)}</h2><div class="cb">${inner}</div></section>`;

  sections.push(card(0, `<dl class="facts">
    <div><dt>Identifiers</dt><dd>${d.entities.length}</dd></div>
    <div><dt>Derived links</dt><dd>${d.edges.length}</dd></div>
    <div><dt>Snapshots</dt><dd>${d.snapshots}</dd></div>
    <div><dt>Tracked identifiers</dt><dd>${d.histories.length}</dd></div>
    <div><dt>Opened</dt><dd>${esc(iso(d.createdAt))}</dd></div>
    <div><dt>Last updated</dt><dd>${esc(iso(d.updatedAt))}</dd></div>
  </dl>${d.kinds.length
    ? `<h3>By identifier type</h3><ul class="kinds">${d.kinds.map((k) => `<li style="border-color:${KIND_INK[k.kind]}55"><b style="color:${KIND_INK[k.kind]}">${k.count}</b>${esc(k.kind)}</li>`).join("")}</ul>`
    : `<p class="empty">No identifiers have been added to this case yet.</p>`}`));

  sections.push(card(1, d.entities.length
    ? `<table class="grid"><thead><tr><th>Type</th><th>Value</th><th>Added</th><th>Note</th></tr></thead><tbody>${
      d.entities.map((e) => `<tr><td>${badge(e.kind)}</td><td class="v">${esc(e.value)}</td><td>${esc(iso(e.addedAt))}</td><td>${esc(e.note ?? "")}</td></tr>`).join("")
    }</tbody></table>`
    : `<p class="empty">No identifiers recorded.</p>`));

  sections.push(card(2, d.edges.length
    ? `<p class="note">Relationships the tool derived from lookup results. Each names the field that produced it.</p>
    <table class="grid"><thead><tr><th>From</th><th>To</th><th>Derived from</th><th>Added</th></tr></thead><tbody>${
      d.edges.map((e) => `<tr><td class="v">${chip(e.from.kind, e.from.value)}</td><td class="v">${chip(e.to.kind, e.to.value)}</td><td>${esc(e.reason)}</td><td>${esc(iso(e.addedAt))}</td></tr>`).join("")
    }</tbody></table>`
    : `<p class="empty">No derived links recorded.</p>`));

  sections.push(card(3, d.histories.length
    ? d.histories.map((h) => `<div class="hist">
      <h3>${chip(h.kind, h.value)}</h3>
      <p class="note">${h.snapshots} snapshot${h.snapshots === 1 ? "" : "s"} · first ${esc(iso(h.first))} · latest ${esc(iso(h.last))}</p>
      ${historyRows(h, "empty")}
    </div>`).join("")
    : `<p class="empty">No lookups have been snapshotted for this case.</p>`));

  sections.push(card(4, d.notes.trim()
    ? `<pre class="notes">${esc(d.notes.trim())}</pre>`
    : `<p class="empty">None.</p>`));

  sections.push(card(5, `<ol class="method">${CASE_METHODOLOGY.map((l) => `<li>${esc(l)}</li>`).join("")}</ol>`));

  sections.push(card(6, `<table class="kv"><tbody>
    <tr><th>Algorithm</th><td>${esc(d.integrity.algo)}</td></tr>
    <tr><th>Payload hash</th><td class="hash">${esc(d.integrity.hash)}</td></tr>
    <tr><th>Schema</th><td>${esc(d.schema)}</td></tr>
    <tr><th>Produced by</th><td>${esc(BRAND.name)} v${esc(d.version)}</td></tr>
  </tbody></table><p class="note">${esc(CASE_INTEGRITY_NOTE)}</p>`));

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(d.documentId)} Investigation dossier: ${esc(d.name)}</title>
<style>
  :root {
    --p0:#05060d; --p1:#080a14; --p2:#0b0e1c; --ink:#d6ffe6; --dim:#7fae93;
    --green:#00ff85; --cyan:#22d3ee; --line:rgba(120,255,190,.16); --hi:rgba(34,211,238,.35);
    --grid:rgba(0,255,133,.05);
    --sans: ui-sans-serif,-apple-system,"Segoe UI",Helvetica,Arial,sans-serif;
    --mono: ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,monospace;
  }
  * { box-sizing: border-box; }
  body { margin: 0; color: var(--ink); font: 14px/1.6 var(--sans);
    background: linear-gradient(var(--grid) 1px, transparent 1px) 0 0 / 34px 34px,
                linear-gradient(90deg, var(--grid) 1px, transparent 1px) 0 0 / 34px 34px, var(--p0); }
  .wrap { max-width: 1080px; margin: 0 auto; padding: 26px 22px 60px; }
  header.top { border: 1px solid var(--line); border-radius: 14px; background: var(--p1); padding: 20px 22px; margin-bottom: 18px; }
  .brand { display: flex; align-items: center; gap: 12px; }
  .brand div { display: flex; flex-direction: column; line-height: 1.25; }
  .brand strong { font: 700 13px/1.2 var(--mono); letter-spacing: .18em; text-transform: uppercase; }
  .brand span { font-size: 10px; letter-spacing: .22em; text-transform: uppercase; color: var(--dim); }
  h1 { margin: 20px 0 2px; font: 700 25px/1.25 var(--sans); }
  .case { margin: 0 0 10px; font: 17px/1.4 var(--mono); color: var(--green); word-break: break-word; }
  .cls { margin: 0 0 14px; font: 10px/1.5 var(--mono); letter-spacing: .14em; text-transform: uppercase; color: var(--dim); }
  .ctl { width: 100%; border-collapse: collapse; }
  .ctl th, .ctl td { text-align: left; padding: 4px 12px 4px 0; border-top: 1px solid var(--line); font-size: 12px; vertical-align: top; }
  .ctl th { width: 150px; color: var(--dim); font-size: 10.5px; letter-spacing: .08em; text-transform: uppercase; }
  .ctl td { font-family: var(--mono); word-break: break-word; }
  nav.toc { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 18px; }
  nav.toc a { padding: 5px 11px; border: 1px solid var(--line); border-radius: 999px; color: var(--dim);
              text-decoration: none; font: 11.5px/1.5 var(--sans); }
  nav.toc a:hover { color: var(--cyan); border-color: var(--hi); }
  .card { border: 1px solid var(--line); border-radius: 14px; background: var(--p1); margin: 0 0 16px; overflow: hidden; scroll-margin-top: 16px; }
  .card h2 { display: flex; align-items: center; gap: 11px; margin: 0; padding: 13px 18px; border-bottom: 1px solid var(--line);
             font: 700 11.5px/1.3 var(--sans); letter-spacing: .16em; text-transform: uppercase; }
  .sn { font: 700 11px/1 var(--mono); color: var(--green); }
  .cb { padding: 14px 18px 18px; }
  h3 { margin: 16px 0 8px; font: 700 10.5px/1.3 var(--sans); letter-spacing: .16em; text-transform: uppercase; color: var(--dim); }
  .facts { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px; margin: 0; }
  .facts div { border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; background: var(--p2); }
  .facts dt { font-size: 10px; letter-spacing: .14em; text-transform: uppercase; color: var(--dim); }
  .facts dd { margin: 3px 0 0; font: 15px/1.3 var(--mono); word-break: break-word; }
  .kinds { display: flex; flex-wrap: wrap; gap: 8px; margin: 0; padding: 0; list-style: none; }
  .kinds li { display: flex; align-items: baseline; gap: 7px; padding: 5px 12px; border: 1px solid; border-radius: 999px;
              font: 11.5px/1.5 var(--mono); letter-spacing: .06em; text-transform: uppercase; color: var(--dim); }
  .kinds b { font-size: 14px; }
  table.grid, table.kv { width: 100%; border-collapse: collapse; }
  .grid th { text-align: left; padding: 7px 12px 7px 0; border-bottom: 1px solid var(--hi);
             font-size: 10.5px; letter-spacing: .1em; text-transform: uppercase; color: var(--dim); }
  .grid td { padding: 6px 12px 6px 0; border-bottom: 1px solid var(--line); font: 12.5px/1.5 var(--mono); vertical-align: top; word-break: break-word; }
  .kv th { width: 170px; text-align: left; padding: 6px 14px 6px 0; border-bottom: 1px solid var(--line);
           font-size: 10.5px; letter-spacing: .08em; text-transform: uppercase; color: var(--dim); }
  .kv td { padding: 6px 0; border-bottom: 1px solid var(--line); font: 12.5px/1.5 var(--mono); word-break: break-all; }
  .chip { display: inline-flex; align-items: baseline; gap: 6px; padding: 2px 9px; border: 1px solid; border-radius: 999px; font: 11.5px/1.6 var(--mono); }
  .chip em { font-style: normal; opacity: .6; font-size: 10px; text-transform: uppercase; }
  .hist { padding: 10px 0; border-top: 1px solid var(--line); }
  .hist:first-child { border-top: 0; padding-top: 0; }
  .note, .empty { margin: 8px 0 0; font-size: 12px; color: var(--dim); }
  .notes { margin: 0; padding: 12px 14px; border: 1px solid var(--line); border-radius: 10px; background: var(--p2);
           font: 12.5px/1.65 var(--mono); white-space: pre-wrap; word-break: break-word; }
  ol.method { margin: 0; padding-left: 20px; } ol.method li { margin: 7px 0; font-size: 13px; }
  .foot { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 14px; margin-top: 8px; padding-top: 14px;
          border-top: 1px solid var(--line); font: 11px/1.6 var(--mono); color: var(--dim); }
  @media print {
    body { background: #fff; color: #10151f; }
    .wrap { max-width: none; padding: 0; }
    .card, header.top { border-color: #ccd4e0; background: #fff; break-inside: avoid; }
    nav.toc { display: none; }
  }
</style></head><body>
<div class="wrap">
<header class="top">
  <div class="brand">${logoSvg({ size: 38, idPrefix: "cs", title: BRAND.name })}
    <div><strong>${esc(BRAND.name)}</strong><span>${esc(BRAND.tagline)}</span></div>
  </div>
  <h1>Investigation Dossier</h1>
  <p class="case">${esc(d.name)}</p>
  <p class="cls">${esc(CASE_CLASSIFICATION)}</p>
  <table class="ctl"><tbody>
    <tr><th>Document ID</th><td>${esc(d.documentId)}</td></tr>
    <tr><th>Case opened</th><td>${esc(iso(d.createdAt))}</td></tr>
    <tr><th>Last updated</th><td>${esc(iso(d.updatedAt))}</td></tr>
    <tr><th>Exported</th><td>${esc(d.exportedAt)}</td></tr>
    <tr><th>Contents</th><td>${d.entities.length} identifiers, ${d.edges.length} derived links, ${d.snapshots} snapshots</td></tr>
    <tr><th>Produced by</th><td>${esc(BRAND.name)} v${esc(d.version)} (${esc(d.schema)})</td></tr>
  </tbody></table>
</header>
<nav class="toc">${OUTLINE.map((t, i) => `<a href="#${sid(i)}">${String(i + 1).padStart(2, "0")} ${esc(t)}</a>`).join("")}</nav>
${sections.join("\n")}
<footer class="foot">
  <span>${esc(d.documentId)} &middot; ${esc(d.name)} &middot; ${esc(d.exportedAt)}</span>
  <span>${esc(BRAND.name)} v${esc(d.version)} &middot; authorized use only, verify before acting</span>
</footer>
</div>
</body></html>`;
}

// ── Paged document ───────────────────────────────────────────────────────────

function printDoc(d: CaseDocModel): string {
  const body: string[] = [];
  const h2 = (i: number) => `<h2 id="${sid(i)}"><span class="sn">${String(i + 1).padStart(2, "0")}</span>${esc(OUTLINE[i]!)}</h2>`;

  body.push(`<section class="blk">${h2(0)}
  <table class="kv"><tbody>
    <tr><th>Identifiers</th><td>${d.entities.length}</td></tr>
    <tr><th>Derived links</th><td>${d.edges.length}</td></tr>
    <tr><th>Snapshots</th><td>${d.snapshots}</td></tr>
    <tr><th>Tracked identifiers</th><td>${d.histories.length}</td></tr>
    <tr><th>Case opened</th><td>${esc(iso(d.createdAt))}</td></tr>
    <tr><th>Last updated</th><td>${esc(iso(d.updatedAt))}</td></tr>
    ${d.kinds.map((k) => `<tr><th>${esc(k.kind)} identifiers</th><td>${k.count}</td></tr>`).join("")}
  </tbody></table></section>`);

  body.push(`<section class="blk">${h2(1)}${d.entities.length
    ? `<table class="grid"><thead><tr><th>Type</th><th>Value</th><th>Added</th><th>Note</th></tr></thead><tbody>${
      d.entities.map((e) => `<tr><td>${esc(e.kind)}</td><td class="v">${esc(e.value)}</td><td>${esc(iso(e.addedAt))}</td><td>${esc(e.note ?? "")}</td></tr>`).join("")
    }</tbody></table>`
    : `<p class="empty">No identifiers recorded.</p>`}</section>`);

  body.push(`<section class="blk">${h2(2)}${d.edges.length
    ? `<p class="note">Relationships the tool derived from lookup results. Each names the field that produced it.</p>
    <table class="grid"><thead><tr><th>From</th><th>To</th><th>Derived from</th><th>Added</th></tr></thead><tbody>${
      d.edges.map((e) => `<tr><td class="v">${esc(e.from.kind)} ${esc(e.from.value)}</td><td class="v">${esc(e.to.kind)} ${esc(e.to.value)}</td><td>${esc(e.reason)}</td><td>${esc(iso(e.addedAt))}</td></tr>`).join("")
    }</tbody></table>`
    : `<p class="empty">No derived links recorded.</p>`}</section>`);

  body.push(`<section class="blk">${h2(3)}${d.histories.length
    ? d.histories.map((h) => `<div class="hist"><h3>${esc(h.kind)} ${esc(h.value)}</h3>
      <p class="note">${h.snapshots} snapshot${h.snapshots === 1 ? "" : "s"} &middot; first ${esc(iso(h.first))} &middot; latest ${esc(iso(h.last))}</p>
      ${historyRows(h, "empty")}</div>`).join("")
    : `<p class="empty">No lookups have been snapshotted for this case.</p>`}</section>`);

  body.push(`<section class="blk">${h2(4)}${d.notes.trim()
    ? `<pre class="notes">${esc(d.notes.trim())}</pre>`
    : `<p class="empty">None.</p>`}</section>`);

  body.push(`<section class="blk">${h2(5)}<ol class="method">${CASE_METHODOLOGY.map((l) => `<li>${esc(l)}</li>`).join("")}</ol></section>`);

  body.push(`<section class="blk">${h2(6)}
  <table class="kv"><tbody>
    <tr><th>Algorithm</th><td>${esc(d.integrity.algo)}</td></tr>
    <tr><th>Payload hash</th><td class="hash">${esc(d.integrity.hash)}</td></tr>
    <tr><th>Schema</th><td>${esc(d.schema)}</td></tr>
    <tr><th>Produced by</th><td>${esc(BRAND.name)} v${esc(d.version)}</td></tr>
  </tbody></table>
  <p class="note">${esc(CASE_INTEGRITY_NOTE)}</p>
  <div class="sign">
    <div><span>Prepared by</span><i></i></div>
    <div><span>Reviewed by</span><i></i></div>
    <div><span>Date</span><i></i></div>
  </div></section>`);

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(d.documentId)} Investigation dossier: ${esc(d.name)}</title>
<style>
  :root { --ink:${BRAND.ink}; --muted:#56617a; --rule:#ccd4e0; --soft:#f4f6fa; --accent:#0a7a33;
    --sans: ui-sans-serif,-apple-system,"Segoe UI",Helvetica,Arial,sans-serif;
    --serif: Georgia,"Iowan Old Style","Times New Roman",serif;
    --mono: ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,monospace; }
  * { box-sizing: border-box; }
  body { margin: 0; color: var(--ink); background: #fff; font: 10.5pt/1.55 var(--serif);
         -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .sheet { max-width: 190mm; margin: 0 auto; padding: 14mm 12mm 20mm; }
  .cover { break-after: page; }
  .mast { display: flex; align-items: center; gap: 12px; padding-bottom: 10px; border-bottom: 2px solid var(--ink); }
  .mast-t { display: flex; flex-direction: column; line-height: 1.2; }
  .mast-t strong { font: 700 11pt/1.2 var(--sans); letter-spacing: .12em; text-transform: uppercase; }
  .mast-t span { font: 7.5pt/1.3 var(--sans); letter-spacing: .18em; text-transform: uppercase; color: var(--muted); }
  .mast-c { margin-left: auto; max-width: 62mm; text-align: right; font: 7pt/1.4 var(--sans); letter-spacing: .06em; text-transform: uppercase; color: var(--muted); }
  .title-block { padding: 26mm 0 10mm; }
  .kicker { margin: 0; font: 8pt/1 var(--sans); letter-spacing: .3em; text-transform: uppercase; color: var(--muted); }
  h1 { margin: 6px 0 4px; font: 700 26pt/1.12 var(--sans); max-width: 130mm; }
  .case { margin: 4px 0 14px; font: 13pt/1.3 var(--mono); word-break: break-word; max-width: 130mm; }
  .rule { height: 4px; width: 52mm; border-radius: 2px; background: var(--accent); }
  .notice { margin: 6mm 0 0; padding: 10px 14px; background: var(--soft); border-left: 3px solid var(--accent); font-size: 9.5pt; }
  .cover-foot { margin-top: 8mm; font: 8pt/1.4 var(--mono); color: var(--muted); }
  .toc-page { break-after: page; }
  .toc { list-style: none; margin: 0; padding: 0; }
  .toc li { display: flex; gap: 8px; padding: 3px 0; border-bottom: 1px dotted var(--rule); }
  .tn { font: 8.5pt/1.7 var(--mono); color: var(--muted); }
  .toc a { color: var(--ink); text-decoration: none; font-size: 9.5pt; }
  h2 { display: flex; align-items: baseline; gap: 10px; margin: 8mm 0 3mm; padding-bottom: 4px; border-bottom: 1.5px solid var(--ink);
       font: 700 10pt/1.3 var(--sans); letter-spacing: .16em; text-transform: uppercase; break-after: avoid; }
  .sn { font: 700 10pt/1 var(--mono); color: var(--accent); }
  h3 { margin: 5mm 0 2mm; font: 700 8.5pt/1.3 var(--sans); letter-spacing: .1em; text-transform: uppercase; color: var(--muted); break-after: avoid; }
  p { margin: 0 0 3mm; }
  table { width: 100%; border-collapse: collapse; break-inside: avoid; margin: 0 0 3mm; }
  .kv th { width: 46mm; text-align: left; vertical-align: top; padding: 3.5px 10px 3.5px 0; border-bottom: 1px solid var(--rule);
           font: 700 8pt/1.5 var(--sans); letter-spacing: .06em; text-transform: uppercase; color: var(--muted); }
  .kv td { padding: 3.5px 0; vertical-align: top; font: 9.5pt/1.45 var(--mono); word-break: break-word; border-bottom: 1px solid var(--rule); }
  .hash { word-break: break-all; }
  .grid thead th { text-align: left; padding: 4px 8px 4px 0; border-bottom: 1.5px solid var(--ink);
                   font: 700 7.5pt/1.5 var(--sans); letter-spacing: .12em; text-transform: uppercase; }
  .grid td { padding: 4px 8px 4px 0; vertical-align: top; border-bottom: 1px solid var(--rule); font: 9pt/1.45 var(--mono); word-break: break-word; }
  .hist { break-inside: avoid; }
  .notes { margin: 0 0 3mm; padding: 10px 12px; background: var(--soft); border-left: 3px solid var(--rule);
           font: 9.5pt/1.6 var(--mono); white-space: pre-wrap; word-break: break-word; }
  ol.method { margin: 0 0 3mm; padding-left: 5mm; } ol.method li { margin: 1.5mm 0; }
  .note, .empty { font: 8.5pt/1.45 var(--sans); color: var(--muted); }
  .sign { display: flex; gap: 8mm; margin-top: 8mm; break-inside: avoid; }
  .sign div { flex: 1; }
  .sign span { font: 7.5pt/1.4 var(--sans); letter-spacing: .14em; text-transform: uppercase; color: var(--muted); }
  .sign i { display: block; margin-top: 12mm; border-top: 1px solid var(--ink); }
  footer { margin-top: 8mm; padding-top: 3mm; border-top: 1.5px solid var(--ink); display: flex; justify-content: space-between;
           gap: 10mm; font: 7.5pt/1.5 var(--sans); color: var(--muted); }
  .hint { position: sticky; top: 0; z-index: 2; margin: 0; padding: 8px 14px; background: var(--ink); color: #fff;
          font: 8.5pt/1.4 var(--sans); text-align: center; }
  @page { size: A4; margin: 16mm 14mm 14mm; }
  @media print { .hint { display: none; } .sheet { max-width: none; padding: 0; } a { color: var(--ink); text-decoration: none; } }
</style></head><body>
<p class="hint">Print dialog not open? Press Ctrl+P (Cmd+P on a Mac) and choose "Save as PDF". This page is the paged dossier; the HTML export is a different, on-screen one.</p>
<div class="sheet">
<section class="cover">
  <header class="mast">${logoSvg({ size: 44, mono: BRAND.ink, idPrefix: "cp", title: BRAND.name })}
    <div class="mast-t"><strong>${esc(BRAND.name)}</strong><span>${esc(BRAND.tagline)}</span></div>
    <div class="mast-c">${esc(CASE_CLASSIFICATION)}</div>
  </header>
  <div class="title-block">
    <p class="kicker">Investigation dossier</p>
    <h1>${esc(d.name)}</h1>
    <p class="case">${d.entities.length} identifiers &middot; ${d.edges.length} derived links &middot; ${d.snapshots} snapshots</p>
    <div class="rule"></div>
  </div>
  <h2 class="ctl-h"><span class="sn">00</span>Document control</h2>
  <table class="kv"><tbody>
    <tr><th>Document ID</th><td>${esc(d.documentId)}</td></tr>
    <tr><th>Case</th><td>${esc(d.name)}</td></tr>
    <tr><th>Case opened</th><td>${esc(iso(d.createdAt))}</td></tr>
    <tr><th>Last updated</th><td>${esc(iso(d.updatedAt))}</td></tr>
    <tr><th>Exported (UTC)</th><td>${esc(d.exportedAt)}</td></tr>
    <tr><th>Produced by</th><td>${esc(BRAND.name)} v${esc(d.version)}</td></tr>
    <tr><th>Schema</th><td>${esc(d.schema)}</td></tr>
    <tr><th>Integrity</th><td class="hash">${esc(d.integrity.algo)} ${esc(d.integrity.hash)}</td></tr>
    <tr><th>Handling</th><td>${esc(CASE_CLASSIFICATION)}</td></tr>
  </tbody></table>
  <p class="notice">This dossier records what an analyst collected, not a conclusion. The integrity hash above covers the case payload; re-import the JSON export to have it recomputed and compared.</p>
  <p class="cover-foot">${esc(d.documentId)} &middot; ${esc(d.exportedAt)}</p>
</section>
<section class="toc-page">
  <h2><span class="sn">&nbsp;</span>Contents</h2>
  <ol class="toc">${OUTLINE.map((t, i) => `<li><span class="tn">${String(i + 1).padStart(2, "0")}</span><a href="#${sid(i)}">${esc(t)}</a></li>`).join("")}</ol>
</section>
${body.join("\n")}
<footer>
  <span>${esc(d.documentId)} &middot; ${esc(d.name)}</span>
  <span>${esc(BRAND.name)} v${esc(d.version)} &middot; authorized use only</span>
</footer>
</div>
</body></html>`;
}

/** The on-screen dossier: the app's palette, one self-contained file. */
export async function buildCaseHtml(c: InvestigationCase): Promise<string> {
  return screenDoc(await buildCaseDoc(c));
}

/** The paged A4 dossier: cover sheet, contents, chain of custody, signatures. */
export async function buildCasePrintHtml(c: InvestigationCase): Promise<string> {
  return printDoc(await buildCaseDoc(c));
}
