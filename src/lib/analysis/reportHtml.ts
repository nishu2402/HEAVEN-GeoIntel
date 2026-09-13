// ── Screen dossier: the self-contained HTML export ───────────────────────────
//
// The counterpart to ./reportPrint, and deliberately nothing like it. This one
// is read on a screen, so it wears the app's own palette, keeps a sticky
// contents rail, filters itself as you type, and copies any value with one
// click. It is a single file with no network calls of any kind: the fonts are
// the system stack, the mark is inline SVG, and the script is inline, so it
// works from a thumb drive, an evidence share, or a file:// path years later.
//
// Everything a reader sees comes from the report model through esc(), and no
// value is ever interpolated into the script block.

import {
  CLASSIFICATION, HEAD, LEGEND, METHODOLOGY, bandNeon, controlRows, esc,
  observableStixId, reportOutline, reportStats, reportMeta, reportTitle, slug,
  sourceState, statsRows,
  type ReportModel, type ReportRow, type ReportSection,
} from "./report";
import { BRAND, logoSvg } from "../brand/logo";

/** A value cell plus the button that copies it. */
const valueCell = (v: string) =>
  `<td><span class="v">${esc(v)}</span><button class="cp" type="button" data-copy="${esc(v)}" aria-label="Copy value">copy</button></td>`;

const kv = (rows: ReportRow[]) =>
  `<table class="kv"><tbody>${rows.map((r) => `<tr><th>${esc(r.label)}</th>${valueCell(r.value)}</tr>`).join("")}</tbody></table>`;

const bullets = (items: string[]) =>
  `<ul class="ev">${items.map((i) => `<li><span class="v">${esc(i)}</span><button class="cp" type="button" data-copy="${esc(i)}" aria-label="Copy entry">copy</button></li>`).join("")}</ul>`;

function sectionBody(s: ReportSection): string {
  const parts: string[] = [];
  if (s.rows?.length) parts.push(kv(s.rows));
  if (s.list?.length) parts.push(bullets(s.list));
  return parts.join("\n");
}

/** A ring gauge: the score as a position on a dial, not just a number. */
function gauge(score: number, band: string, accent: string): string {
  const circumference = 2 * Math.PI * 52;
  const filled = (score / 100) * circumference;
  return `<svg class="gauge" viewBox="0 0 120 120" role="img" aria-label="Risk score ${score} of 100, ${esc(band)}">
  <circle class="g-track" cx="60" cy="60" r="52"></circle>
  <circle class="g-fill" cx="60" cy="60" r="52" style="stroke:${accent};stroke-dasharray:${filled.toFixed(1)} ${circumference.toFixed(1)}"></circle>
  <text class="g-val" x="60" y="64" style="fill:${accent}">${score}</text>
  <text class="g-max" x="60" y="80">of 100</text>
</svg>`;
}

/** One collapsible card. `n` is the section's number in the shared outline. */
const card = (n: number, title: string, inner: string) =>
  `<section class="card" id="${slug(title)}" data-sec>
  <h2 class="card-h"><button type="button" class="fold" aria-expanded="true"><span class="sn">${String(n).padStart(2, "0")}</span><span class="ct">${esc(title)}</span><span class="chev" aria-hidden="true"></span></button></h2>
  <div class="card-b">${inner}</div>
</section>`;

export function reportToHtml(m: ReportModel): string {
  const meta = reportMeta(m);
  const st = reportStats(m);
  const a = m.assessment;
  const accent = bandNeon(a?.band);
  const outline = reportOutline(m);
  let n = 0;
  const next = () => ++n;

  const body: string[] = [];

  const summaryInner = [
    m.headline ? `<p class="verdict"><span>${esc(m.headline.label)}</span><strong>${esc(m.headline.value)}</strong></p>` : "",
    m.summary?.length ? kv(m.summary) : "",
  ].join("\n");
  body.push(card(next(), HEAD.summary, summaryInner));

  if (a) {
    const risk: string[] = [
      `<div class="risk-top">`,
      gauge(a.score, a.band, accent),
      `<div class="risk-meta">`,
      `<p class="band" style="color:${accent}">${esc(a.band)}</p>`,
      `<p class="conf">confidence ${esc(a.confidence)}</p>`,
      `<p class="rationale">${esc(a.rationale)}</p>`,
      `</div></div>`,
    ];
    if (a.factors.length) {
      risk.push(`<h3>Contributing factors</h3><div class="factors">`);
      for (const f of a.factors) {
        const share = Math.round(f.share * 100);
        risk.push(`<div class="factor"><div class="f-h"><span>${esc(f.label)}</span><b>${share}%</b></div>`,
          `<div class="f-bar"><i style="width:${share}%;background:${accent}"></i></div>`,
          `<p class="f-ev">${esc(f.evidence)}</p></div>`);
      }
      risk.push(`</div>`);
    }
    if (a.anomalies.length) {
      risk.push(`<h3>Flagged patterns</h3><ul class="anoms">`,
        ...a.anomalies.map((an) => `<li><span class="sev sev-${esc(an.severity)}">${esc(an.severity)}</span><b>${esc(an.title)}</b><span class="v">${esc(an.detail)}</span></li>`),
        `</ul>`);
    }
    body.push(card(next(), HEAD.risk, risk.join("\n")));
  }

  for (const s of m.sections) body.push(card(next(), s.heading, sectionBody(s)));

  if (m.sources.length) {
    const rows = m.sources.map((s) => {
      const state = sourceState(s);
      return `<tr><td>${esc(s.source)}</td><td><span class="pill p-${state.replace(/ /g, "-")}">${esc(state)}</span></td><td class="r">${s.ms != null ? `${s.ms} ms` : ""}</td><td class="v">${esc(s.error ?? "")}</td></tr>`;
    });
    body.push(card(next(), HEAD.sources, [
      `<table class="grid"><thead><tr><th>Source</th><th>Result</th><th class="r">Latency</th><th>Reported</th></tr></thead><tbody>`,
      ...rows, `</tbody></table>`,
      `<p class="note">"Not configured" means the source was never called because no API key is set for it. "Not applicable" means it needs no key, but this lookup gave it nothing to ask about. Neither is a failure, and neither is a negative finding.</p>`,
    ].join("\n")));
  }

  if (m.pivots.length) {
    body.push(card(next(), HEAD.pivots, `<ul class="pivots">${m.pivots
      .map((p) => `<li><a href="${esc(p.url)}" target="_blank" rel="noreferrer noopener">${esc(p.label)}</a><span class="v">${esc(p.url)}</span></li>`)
      .join("")}</ul>`));
  }

  if (a?.narrative.length) {
    body.push(card(next(), HEAD.narrative, [
      `<p class="note">Computed locally from the evidence above. No language model wrote any part of it.</p>`,
      bullets(a.narrative),
    ].join("\n")));
  }

  body.push(card(next(), HEAD.method, [
    `<ol class="method">${METHODOLOGY.map((l) => `<li>${esc(l)}</li>`).join("")}</ol>`,
    `<h3>How to read the numbers</h3>`,
    `<table class="kv legend"><tbody>${LEGEND.map((l) => `<tr><th>${esc(l.label)}</th><td>${esc(l.value)}</td></tr>`).join("")}</tbody></table>`,
  ].join("\n")));

  if (m.observables.length) {
    body.push(card(next(), HEAD.observables, [
      `<table class="grid"><thead><tr><th>Type</th><th>Value</th><th>STIX identifier</th></tr></thead><tbody>`,
      ...m.observables.map((o) => `<tr><td>${esc(o.type)}</td><td class="v">${esc(o.value)}</td><td class="v">${esc(observableStixId(o))}</td></tr>`),
      `</tbody></table>`,
      `<p class="note">These identifiers match the STIX 2.1 bundle exported from the same result.</p>`,
    ].join("\n")));
  }

  body.push(card(next(), HEAD.stats, kv(statsRows(m))));

  const rail = `<nav class="rail" aria-label="Contents">
  <div class="rail-in">
    <label class="search"><span class="sr">Filter the report</span>
      <input id="q" type="search" placeholder="Filter every field…" autocomplete="off">
    </label>
    <p class="hits" id="hits" hidden></p>
    <ol class="toc">${outline.map((t, i) => `<li><a href="#${slug(t)}" data-toc="${slug(t)}"><span class="tn">${String(i + 1).padStart(2, "0")}</span>${esc(t)}</a></li>`).join("")}</ol>
    <dl class="facts">
      <div><dt>Sources</dt><dd>${st.sourcesAnswered} of ${st.sources} answered</dd></div>
      <div><dt>Fields</dt><dd>${st.fields}</dd></div>
      ${st.items > 0 ? `<div><dt>List entries</dt><dd>${st.items}</dd></div>` : ""}
      ${st.medianMs != null ? `<div><dt>Median latency</dt><dd>${st.medianMs} ms</dd></div>` : ""}
    </dl>
  </div>
</nav>`;

  const head = `<header class="top">
  <div class="brand">${logoSvg({ size: 38, idPrefix: "wr", title: BRAND.name })}
    <div><strong>${esc(BRAND.name)}</strong><span>${esc(BRAND.tagline)}</span></div>
  </div>
  <div class="top-r">
    <span class="doc">${esc(meta.documentId)}</span>
    <button type="button" id="theme" class="ghost">Light</button>
  </div>
  <h1>${esc(reportTitle(m))}</h1>
  <p class="subject">${esc(m.subject)}</p>
  <p class="cls">${esc(CLASSIFICATION)}</p>
  <table class="ctl"><tbody>${controlRows(m).map((r) => `<tr><th>${esc(r.label)}</th><td>${esc(r.value)}</td></tr>`).join("")}</tbody></table>
</header>`;

  return `<!DOCTYPE html>
<html lang="en" data-theme="dark"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(meta.documentId)} ${esc(reportTitle(m))}: ${esc(m.subject)}</title>
<style>
  :root {
    --p0:#05060d; --p1:#080a14; --p2:#0b0e1c; --ink:#d6ffe6; --dim:#7fae93;
    --green:#00ff85; --cyan:#22d3ee; --amber:#fbbf24; --red:#ff4d6d;
    --line:rgba(120,255,190,.16); --hi:rgba(34,211,238,.35); --grid:rgba(0,255,133,.05);
    --accent:${accent};
    --sans: ui-sans-serif,-apple-system,"Segoe UI",Helvetica,Arial,sans-serif;
    --mono: ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,monospace;
  }
  [data-theme="light"] {
    --p0:#e9edf6; --p1:#f4f7fc; --p2:#ffffff; --ink:#16233a; --dim:#445c6e;
    --green:#046c3b; --cyan:#0f6378; --amber:#7a5600; --red:#ad0f33;
    --line:#c3ccdb; --hi:#7f93ad; --grid:rgba(40,60,100,.07);
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; color: var(--ink); font: 14px/1.6 var(--sans);
    background:
      linear-gradient(var(--grid) 1px, transparent 1px) 0 0 / 34px 34px,
      linear-gradient(90deg, var(--grid) 1px, transparent 1px) 0 0 / 34px 34px,
      var(--p0);
  }
  .sr { position:absolute; width:1px; height:1px; overflow:hidden; clip:rect(0 0 0 0); }
  .wrap { display: grid; grid-template-columns: 268px minmax(0,1fr); gap: 26px; max-width: 1240px; margin: 0 auto; padding: 26px 22px 60px; }

  /* Masthead ───────────────────────────────────────────────────────────── */
  .top { grid-column: 1 / -1; border: 1px solid var(--line); border-radius: 14px; background: var(--p1); padding: 20px 22px 18px; }
  .brand { display: flex; align-items: center; gap: 12px; }
  .brand div { display: flex; flex-direction: column; line-height: 1.25; }
  .brand strong { font: 700 13px/1.2 var(--mono); letter-spacing: .18em; text-transform: uppercase; }
  .brand span { font-size: 10px; letter-spacing: .22em; text-transform: uppercase; color: var(--dim); }
  .top-r { float: right; display: flex; align-items: center; gap: 10px; margin-top: -34px; }
  .doc { font: 11px/1 var(--mono); letter-spacing: .1em; color: var(--dim); }
  .ghost { background: transparent; color: var(--dim); border: 1px solid var(--line); border-radius: 999px;
           padding: 5px 12px; font: 11px/1 var(--mono); letter-spacing: .12em; text-transform: uppercase; cursor: pointer; }
  .ghost:hover { color: var(--cyan); border-color: var(--hi); }
  .top h1 { margin: 22px 0 2px; font: 700 26px/1.2 var(--sans); letter-spacing: -.01em; }
  .subject { margin: 0 0 10px; font: 17px/1.4 var(--mono); color: var(--accent); word-break: break-all; }
  .cls { margin: 0 0 14px; font: 10px/1.5 var(--mono); letter-spacing: .14em; text-transform: uppercase; color: var(--dim); }
  .ctl { width: 100%; border-collapse: collapse; }
  .ctl th, .ctl td { text-align: left; padding: 4px 12px 4px 0; vertical-align: top; border-top: 1px solid var(--line); font-size: 12px; }
  .ctl th { width: 160px; color: var(--dim); font-weight: 600; letter-spacing: .06em; text-transform: uppercase; font-size: 10.5px; }
  .ctl td { font-family: var(--mono); word-break: break-word; }

  /* Rail ───────────────────────────────────────────────────────────────── */
  .rail-in { position: sticky; top: 18px; }
  .search input { width: 100%; padding: 9px 12px; border-radius: 9px; border: 1px solid var(--line);
                  background: var(--p2); color: var(--ink); font: 12px/1.4 var(--mono); }
  .search input:focus { outline: none; border-color: var(--hi); }
  .hits { margin: 8px 2px 0; font: 11px/1.4 var(--mono); color: var(--amber); }
  .toc { list-style: none; margin: 14px 0 0; padding: 0; }
  .toc a { display: flex; gap: 9px; padding: 5px 9px; border-radius: 7px; border-left: 2px solid transparent;
           color: var(--dim); text-decoration: none; font-size: 12.5px; }
  .toc a:hover { color: var(--ink); background: var(--p1); }
  .toc a.on { color: var(--accent); border-left-color: var(--accent); background: var(--p1); }
  .tn { font: 10px/1.7 var(--mono); opacity: .7; }
  .facts { margin: 16px 0 0; padding: 12px 14px; border: 1px solid var(--line); border-radius: 10px; background: var(--p1); }
  .facts div { display: flex; justify-content: space-between; gap: 10px; padding: 3px 0; }
  .facts dt { font-size: 10.5px; letter-spacing: .1em; text-transform: uppercase; color: var(--dim); }
  .facts dd { margin: 0; font: 12px/1.5 var(--mono); }

  /* Cards ──────────────────────────────────────────────────────────────── */
  .card { border: 1px solid var(--line); border-radius: 14px; background: var(--p1); margin: 0 0 16px; overflow: hidden; scroll-margin-top: 18px; }
  .card-h { margin: 0; }
  .fold { display: flex; align-items: center; gap: 11px; width: 100%; padding: 13px 18px; cursor: pointer;
          background: transparent; border: 0; border-bottom: 1px solid var(--line); color: var(--ink);
          font: 700 11.5px/1.3 var(--sans); letter-spacing: .16em; text-transform: uppercase; text-align: left; }
  .fold:hover { color: var(--accent); }
  .sn { font: 700 11px/1 var(--mono); color: var(--accent); }
  .ct { flex: 1; }
  .chev { width: 8px; height: 8px; border-right: 2px solid currentColor; border-bottom: 2px solid currentColor;
          transform: rotate(45deg); transition: transform .15s ease; opacity: .6; }
  .fold[aria-expanded="false"] .chev { transform: rotate(-45deg); }
  .fold[aria-expanded="false"] { border-bottom-color: transparent; }
  .card-b { padding: 14px 18px 18px; }
  .card[hidden] { display: none; }
  h3 { margin: 18px 0 8px; font: 700 10.5px/1.3 var(--sans); letter-spacing: .16em; text-transform: uppercase; color: var(--dim); }
  .note { margin: 10px 0 0; font-size: 12px; color: var(--dim); }
  .v { font-family: var(--mono); word-break: break-word; }

  table.kv, table.grid { width: 100%; border-collapse: collapse; }
  .kv th { width: 220px; text-align: left; vertical-align: top; padding: 6px 14px 6px 0; border-bottom: 1px solid var(--line);
           font-size: 10.5px; letter-spacing: .08em; text-transform: uppercase; color: var(--dim); font-weight: 600; }
  .kv td { padding: 6px 0; vertical-align: top; border-bottom: 1px solid var(--line); font: 12.5px/1.55 var(--mono); word-break: break-word; }
  .legend td { font-family: var(--sans); font-size: 12.5px; }
  .grid th { text-align: left; padding: 7px 12px 7px 0; border-bottom: 1px solid var(--hi);
             font-size: 10.5px; letter-spacing: .1em; text-transform: uppercase; color: var(--dim); }
  .grid td { padding: 6px 12px 6px 0; border-bottom: 1px solid var(--line); font: 12.5px/1.5 var(--mono); vertical-align: top; word-break: break-word; }
  tr[hidden], li[hidden] { display: none; }

  .cp { margin-left: 8px; padding: 1px 7px; border-radius: 5px; border: 1px solid var(--line); background: transparent;
        color: var(--dim); font: 9.5px/1.5 var(--mono); letter-spacing: .08em; text-transform: uppercase; cursor: pointer;
        opacity: 0; transition: opacity .12s ease; }
  tr:hover .cp, li:hover .cp, .cp:focus { opacity: 1; }
  .cp:hover { color: var(--green); border-color: var(--green); }
  .cp.done { opacity: 1; color: var(--green); border-color: var(--green); }

  ul.ev, ol.method, ul.anoms, ul.pivots { margin: 0; padding: 0; list-style: none; }
  ul.ev li { padding: 5px 0; border-bottom: 1px solid var(--line); font: 12.5px/1.5 var(--mono); }
  ol.method { list-style: decimal; padding-left: 20px; }
  ol.method li { margin: 7px 0; font-size: 13px; }
  ul.pivots li { display: flex; flex-wrap: wrap; align-items: baseline; gap: 10px; padding: 6px 0; border-bottom: 1px solid var(--line); }
  ul.pivots a { color: var(--cyan); font-weight: 600; text-decoration: none; }
  ul.pivots a:hover { text-decoration: underline; }
  ul.pivots .v { font-size: 11.5px; color: var(--dim); }
  ul.anoms li { display: flex; flex-wrap: wrap; align-items: baseline; gap: 10px; padding: 7px 0; border-bottom: 1px solid var(--line); font-size: 12.5px; }

  .verdict { display: flex; flex-wrap: wrap; align-items: baseline; gap: 12px; margin: 0 0 14px; }
  .verdict span { font-size: 10.5px; letter-spacing: .18em; text-transform: uppercase; color: var(--dim); }
  .verdict strong { font: 700 19px/1.2 var(--sans); color: var(--accent); }

  .risk-top { display: flex; flex-wrap: wrap; align-items: center; gap: 22px; }
  .gauge { width: 132px; height: 132px; flex: none; }
  .g-track { fill: none; stroke: var(--line); stroke-width: 9; }
  .g-fill { fill: none; stroke-width: 9; stroke-linecap: round; transform: rotate(-90deg); transform-origin: 60px 60px; }
  .g-val { font: 700 30px var(--sans); text-anchor: middle; }
  .g-max { font: 10px var(--mono); text-anchor: middle; fill: var(--dim); letter-spacing: .1em; }
  .risk-meta { flex: 1 1 240px; }
  .band { margin: 0; font: 700 15px/1.2 var(--sans); letter-spacing: .18em; text-transform: uppercase; }
  .conf { margin: 2px 0 8px; font-size: 11.5px; letter-spacing: .1em; text-transform: uppercase; color: var(--dim); }
  .rationale { margin: 0; font-size: 13.5px; }
  .factor { margin: 12px 0; }
  .f-h { display: flex; justify-content: space-between; gap: 12px; font-size: 12.5px; }
  .f-h b { font-family: var(--mono); color: var(--accent); }
  .f-bar { height: 6px; margin: 5px 0 4px; border-radius: 4px; background: var(--p2); border: 1px solid var(--line); overflow: hidden; }
  .f-bar i { display: block; height: 100%; }
  .f-ev { margin: 0; font: 11.5px/1.5 var(--mono); color: var(--dim); word-break: break-word; }
  .sev, .pill { display: inline-block; padding: 1px 9px; border-radius: 999px; border: 1px solid currentColor;
                font: 10px/1.6 var(--mono); letter-spacing: .1em; text-transform: uppercase; }
  .sev-info { color: var(--cyan); } .sev-warn { color: var(--amber); } .sev-critical { color: var(--red); }
  .p-answered { color: var(--green); } .p-failed { color: var(--red); } .p-not-configured, .p-not-applicable { color: var(--dim); }
  .grid .r { white-space: nowrap; }

  .foot { grid-column: 1 / -1; display: flex; flex-wrap: wrap; justify-content: space-between; gap: 14px;
          margin-top: 8px; padding-top: 14px; border-top: 1px solid var(--line); font: 11px/1.6 var(--mono); color: var(--dim); }
  .top-btn { position: fixed; right: 22px; bottom: 22px; width: 40px; height: 40px; border-radius: 50%;
             border: 1px solid var(--line); background: var(--p2); color: var(--dim); cursor: pointer; font-size: 15px; }
  .top-btn:hover { color: var(--accent); border-color: var(--accent); }

  @media (max-width: 900px) {
    .wrap { grid-template-columns: minmax(0,1fr); }
    .rail-in { position: static; }
    .toc { display: flex; flex-wrap: wrap; gap: 4px; }
    .facts { display: none; }
  }
  /* A stray Ctrl+P on the screen document should still produce something
     readable, but the paged report is the PDF export, not this. */
  @media print {
    body { background: #fff; color: #10151f; }
    .rail, .cp, .top-btn, .ghost { display: none; }
    .wrap { display: block; max-width: none; padding: 0; }
    .card, .top { border-color: #ccd4e0; background: #fff; break-inside: avoid; }
    .fold { color: #10151f; }
    .kv th, .kv td, .grid td, .grid th { border-color: #ccd4e0; }
  }
</style></head><body>
<div class="wrap">
${head}
${rail}
<main>
${body.join("\n")}
</main>
<footer class="foot">
  <span>${esc(meta.documentId)} &middot; ${esc(m.subject)} &middot; ${esc(meta.generatedAt)}</span>
  <span>${esc(BRAND.name)} v${esc(meta.version)} &middot; authorized use only, verify before acting</span>
</footer>
</div>
<button class="top-btn" type="button" id="totop" aria-label="Back to top">&uarr;</button>
<script>
(function () {
  var root = document.documentElement;

  // Fold a section away. The heading stays, so the contents rail keeps working.
  document.querySelectorAll(".fold").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var open = btn.getAttribute("aria-expanded") === "true";
      btn.setAttribute("aria-expanded", open ? "false" : "true");
      var panel = btn.parentElement.nextElementSibling;
      panel.hidden = open;
    });
  });

  // Copy any value. The async Clipboard API is missing on file:// in some
  // browsers and REJECTS in others (an unfocused document, a denied
  // permission), so the textarea path is both the fallback and the rescue.
  function legacyCopy(text) {
    var ta = document.createElement("textarea");
    ta.value = text; ta.setAttribute("readonly", ""); ta.style.position = "absolute"; ta.style.left = "-9999px";
    document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); } catch (e) { /* nothing else to try */ }
    document.body.removeChild(ta);
  }
  function copy(text) {
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).catch(function () { legacyCopy(text); });
      return;
    }
    legacyCopy(text);
  }
  document.addEventListener("click", function (e) {
    var btn = e.target.closest ? e.target.closest(".cp") : null;
    if (!btn) return;
    copy(btn.getAttribute("data-copy") || "");
    var was = btn.textContent;
    btn.textContent = "copied"; btn.classList.add("done");
    setTimeout(function () { btn.textContent = was; btn.classList.remove("done"); }, 1200);
  });

  // Filter every field at once. Rows and list entries that do not match are
  // hidden; a card with nothing left hides too, and the count says how much of
  // the report you are still looking at.
  var q = document.getElementById("q");
  var hits = document.getElementById("hits");
  var cards = Array.prototype.slice.call(document.querySelectorAll("[data-sec]"));
  var lines = Array.prototype.slice.call(document.querySelectorAll(".card-b tr, .card-b li"));
  var total = lines.length;
  q.addEventListener("input", function () {
    var term = q.value.trim().toLowerCase();
    if (!term) {
      lines.forEach(function (l) { l.hidden = false; });
      cards.forEach(function (c) { c.hidden = false; });
      hits.hidden = true;
      return;
    }
    var shown = 0;
    lines.forEach(function (l) {
      var match = (l.textContent || "").toLowerCase().indexOf(term) !== -1;
      l.hidden = !match;
      if (match) shown++;
    });
    cards.forEach(function (c) {
      var any = c.querySelector(".card-b tr:not([hidden]), .card-b li:not([hidden])");
      var heading = (c.querySelector(".ct").textContent || "").toLowerCase().indexOf(term) !== -1;
      c.hidden = !any && !heading;
    });
    hits.hidden = false;
    hits.textContent = shown + " of " + total + " entries match";
  });

  // Highlight the section being read. The visible set is tracked rather than
  // the last entry to fire: callbacks arrive in observer order, not document
  // order, so "whichever said true last" lights up the wrong row on the rail.
  var links = {};
  document.querySelectorAll("[data-toc]").forEach(function (a) { links[a.getAttribute("data-toc")] = a; });
  if ("IntersectionObserver" in window) {
    var visible = {};
    var spy = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) visible[entry.target.id] = true;
        else delete visible[entry.target.id];
      });
      var first = cards.filter(function (c) { return visible[c.id]; })[0];
      Object.keys(links).forEach(function (k) { links[k].classList.remove("on"); });
      if (first && links[first.id]) links[first.id].classList.add("on");
    }, { rootMargin: "-8% 0px -72% 0px" });
    cards.forEach(function (c) { spy.observe(c); });
  }

  // Dark is the default because the app is; the toggle is for paper-white
  // screens and for anyone printing this one instead of the PDF export.
  var themeBtn = document.getElementById("theme");
  themeBtn.addEventListener("click", function () {
    var light = root.getAttribute("data-theme") === "light";
    root.setAttribute("data-theme", light ? "dark" : "light");
    themeBtn.textContent = light ? "Light" : "Dark";
  });

  document.getElementById("totop").addEventListener("click", function () {
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
})();
</script>
</body></html>`;
}
