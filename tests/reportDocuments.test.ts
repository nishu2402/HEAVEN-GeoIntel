import { describe, it, expect } from "vitest";
import { reportOutline, slug, type ReportModel } from "@/lib/analysis/report";
import { reportToHtml } from "@/lib/analysis/reportHtml";
import { reportToPrintHtml } from "@/lib/analysis/reportPrint";
import { BRAND } from "@/lib/brand/logo";

// The PDF and the HTML export used to be the same file offered twice. These
// tests hold them apart: same model, same outline, same numbers, two documents
// that share no layout, no palette and no stylesheet.

const model: ReportModel = {
  kind: "domain", subject: "acme.test", generatedAt: "2026-09-02T00:00:00.000Z",
  headline: { label: "HTTP headers", value: "grade B" },
  summary: [{ label: "Domain", value: "acme.test" }],
  sections: [
    { heading: "DNS", rows: [{ label: "A", value: "1.2.3.4" }] },
    { heading: "Subdomains (1)", list: ["www.acme.test"] },
    { heading: "Mixed", rows: [{ label: "R", value: "v" }], list: ["entry"] },
  ],
  sources: [
    { source: "dns", ok: true, ms: 30 },
    { source: "whois", ok: false, error: "timeout" },
    { source: "hunter", ok: false, skipped: true },
  ],
  pivots: [{ label: "crt.sh", url: "https://crt.sh?q=acme" }],
  observables: [{ type: "domain-name", value: "acme.test" }],
  assessment: {
    score: 40, band: "elevated", confidence: "medium", rationale: "Elevated by exposed services.",
    factors: [{ label: "Exposed service", share: 1, evidence: "port 22 open" }],
    anomalies: [{ title: "Odd pairing", severity: "warn", detail: "hosting and residential" }],
    narrative: ["acme.test scores 40 out of 100."],
  },
};

// Nothing optional present: no headline, no summary, no assessment, no sources,
// no pivots, no observables. Every "is it there?" branch takes its other leg.
const bare: ReportModel = {
  kind: "hash", subject: "deadbeef", generatedAt: "2026-09-02T00:00:00.000Z",
  sections: [{ heading: "Submitted hash", rows: [{ label: "Value", value: "deadbeef" }] }],
  sources: [], pivots: [], observables: [],
};

// An assessment with nothing under it, and a band no palette knows.
const cleanAi: ReportModel = {
  ...bare,
  assessment: {
    score: 4, band: "unknown-band", confidence: "low", rationale: "No elevated signals.",
    factors: [], anomalies: [], narrative: [],
  },
};

const headingIds = (html: string, pattern: RegExp) =>
  [...html.matchAll(pattern)].map((m) => m[1]);

describe("the two documents are genuinely different documents", () => {
  const screen = reportToHtml(model);
  const print = reportToPrintHtml(model);

  it("share no markup", () => {
    expect(screen).not.toBe(print);
    // The paged document is typeset for paper: A4, a cover, no interaction.
    expect(print).toContain("@page { size: A4;");
    expect(print).toContain(`<section class="cover">`);
    expect(print).toContain("break-after: page");
    expect(print).not.toContain("<script>");
    expect(print).not.toContain(`id="q"`);
    // The screen document is the app's dossier: dark, filterable, collapsible.
    expect(screen).toContain(`data-theme="dark"`);
    expect(screen).toContain(`<input id="q" type="search"`);
    expect(screen).toContain(`class="fold"`);
    expect(screen).toContain("<script>");
    expect(screen).not.toContain("@page { size: A4;");
    expect(screen).not.toContain(`<section class="cover">`);
  });

  it("use the palette each medium can actually show", () => {
    // Neon on paper is unreadable, and ink on the app's page is not the app.
    expect(print).toContain("#0b1020");     // BRAND.ink
    expect(print).toContain("#b26a00");     // elevated, print-legible amber
    // The masthead mark is in colour on paper too, in the darkened hues.
    expect(print).toContain('<linearGradient id="pr-frame"');
    expect(print).toContain(BRAND.greenInk);
    expect(print).toContain(BRAND.cyanInk);
    expect(print).not.toContain("--p0:#05060d");
    expect(screen).toContain("--p0:#05060d");
    expect(screen).toContain("#fbbf24");    // elevated, the app's amber
  });

  it("follow the same outline in the same order", () => {
    const outline = reportOutline(model);
    expect(headingIds(print, /<h2 id="([^"]+)"/g)).toEqual(outline.map(slug));
    expect(headingIds(screen, /<section class="card" id="([^"]+)"/g)).toEqual(outline.map(slug));
    // And both number the sections from that one list.
    expect(print).toContain(`<span class="sn">01</span>Executive summary`);
    expect(screen).toContain(`<span class="sn">01</span><span class="ct">Executive summary</span>`);
  });

  it("carry the same document id and evidence basis", () => {
    const id = /HGI-[0-9A-F]{10}/.exec(print)![0];
    expect(screen).toContain(id);
    expect(print).toContain("3 sources queried, 1 answered, 3 recorded fields");
    expect(screen).toContain("3 sources queried, 1 answered, 3 recorded fields");
  });
});

describe("reportToPrintHtml", () => {
  it("renders a cover, a risk stamp, a meter and ruled evidence tables", () => {
    const html = reportToPrintHtml(model);
    expect(html).toMatch(/^<!DOCTYPE html>/);
    expect(html).toContain(`<p class="kicker">Intelligence report</p>`);
    expect(html).toContain("<h1>Domain Intelligence Report</h1>");
    expect(html).toContain(`<div class="stamp"`);
    expect(html).toContain(`aria-label="Risk score 40 of 100"`);
    expect(html).toContain("<th>A</th><td>1.2.3.4</td>");
    expect(html).toContain("<li>www.acme.test</li>");
    // A section with rows AND a list renders both.
    expect(html).toContain("<th>R</th><td>v</td>");
    expect(html).toContain("<li>entry</li>");
  });

  it("prints source states in words and pivot URLs in full", () => {
    const html = reportToPrintHtml(model);
    expect(html).toContain(`<td class="st st-answered">answered</td>`);
    expect(html).toContain(`<td class="st st-failed">failed</td>`);
    expect(html).toContain(`<td class="st st-not-configured">not configured</td>`);
    // A keyless source with nothing to ask about is its own state, not a
    // missing key: the print note has to explain both.
    const withNoInput = reportToPrintHtml({
      ...model,
      sources: [...model.sources, { source: "GLEIF LEI", ok: false, skipped: true, error: "NO_INPUT" }],
    });
    expect(withNoInput).toContain(`<td class="st st-not-applicable">not applicable</td>`);
    expect(withNoInput).toContain("gave it nothing to ask about");
    expect(html).toContain("<td>timeout</td>");
    expect(html).toContain("<td class=\"r\">30 ms</td>");
    // On paper a link that shows only its label is a dead end.
    expect(html).toContain("https://crt.sh?q=acme");
  });

  it("cross-references the STIX id of every observable", () => {
    expect(reportToPrintHtml(model)).toContain("domain-name--");
  });

  it("escapes every interpolated value", () => {
    const html = reportToPrintHtml({
      ...bare, subject: `a"&<b>`,
      sections: [{ heading: "DNS", rows: [{ label: "A", value: "<b>x</b>" }], list: ["a&b"] }],
    });
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(html).toContain("<li>a&amp;b</li>");
    expect(html).not.toContain("<b>x</b>");
  });

  it("drops every optional block when the model has nothing to put in it", () => {
    const html = reportToPrintHtml(bare);
    expect(html).not.toContain(`<div class="stamp"`);
    expect(html).not.toContain("Risk assessment");
    expect(html).not.toContain("Data sources");
    expect(html).not.toContain("Investigative pivots");
    expect(html).not.toContain("Analyst narrative");
    expect(html).not.toContain("Appendix A");
    // The appendix that is always true of a report survives.
    expect(html).toContain("Appendix B: collection statistics");
    expect(html).toContain("0 open-source sources");
  });

  it("renders an assessment with no factors, patterns or narrative", () => {
    const html = reportToPrintHtml(cleanAi);
    expect(html).toContain("Risk assessment");
    // The legend explains both terms, so match the sub-headings themselves.
    expect(html).not.toContain("<h3>Contributing factors</h3>");
    expect(html).not.toContain("<h3>Flagged patterns</h3>");
    expect(html).not.toContain("Analyst narrative");
    expect(html).toContain("#0a7a33"); // fallback accent for an unknown band
  });

  it("says 'source' rather than 'sources' when exactly one was queried", () => {
    const html = reportToPrintHtml({ ...bare, sources: [{ source: "dns", ok: true }] });
    expect(html).toContain("1 open-source source,");
    expect(html).toContain(`<td class="r"></td>`); // a source that reported no latency
  });
});

describe("reportToHtml", () => {
  it("renders the masthead, rail, gauge and per-value copy buttons", () => {
    const html = reportToHtml(model);
    expect(html).toMatch(/^<!DOCTYPE html>/);
    expect(html).toContain("<h1>Domain Intelligence Report</h1>");
    expect(html).toContain(`<nav class="rail"`);
    expect(html).toContain(`class="gauge"`);
    expect(html).toContain(`<button class="cp" type="button" data-copy="1.2.3.4"`);
    expect(html).toContain(`<span class="pill p-answered">answered</span>`);
    expect(html).toContain(`<span class="pill p-not-configured">not configured</span>`);
    expect(reportToHtml({
      ...model,
      sources: [...model.sources, { source: "GLEIF LEI", ok: false, skipped: true, error: "NO_INPUT" }],
    })).toContain(`<span class="pill p-not-applicable">not applicable</span>`);
    expect(html).toContain(`<span class="sev sev-warn">warn</span>`);
    expect(html).toContain(`href="https://crt.sh?q=acme"`);
    // Rail facts come from the counted statistics.
    expect(html).toContain("<dd>1 of 3 answered</dd>");
    expect(html).toContain("<dd>30 ms</dd>");
  });

  it("links only an http(s) pivot, and shows any other URL as text", () => {
    const html = reportToHtml({
      ...bare,
      pivots: [
        { label: "crt.sh", url: "https://crt.sh?q=acme" },
        { label: "Trap", url: "javascript:alert(document.domain)" },
      ],
    });
    expect(html).toContain(`<a href="https://crt.sh?q=acme"`);
    expect(html).not.toContain(`href="javascript:`);
    expect(html).toContain(`<li>Trap<span class="v">javascript:alert(document.domain)</span></li>`);
  });

  it("escapes values before they reach an attribute or the page", () => {
    const html = reportToHtml({
      ...bare,
      sections: [{ heading: "DNS", rows: [{ label: "A", value: `"><script>x</script>` }], list: ["a&b"] }],
    });
    expect(html).toContain(`data-copy="&quot;&gt;&lt;script&gt;x&lt;/script&gt;"`);
    expect(html).toContain("a&amp;b");
    expect(html).not.toContain("<script>x</script>");
  });

  it("drops every optional block when the model has nothing to put in it", () => {
    const html = reportToHtml(bare);
    expect(html).not.toContain("Risk assessment");
    expect(html).not.toContain("Data sources");
    expect(html).not.toContain("Investigative pivots");
    expect(html).not.toContain("Analyst narrative");
    expect(html).not.toContain("Appendix A");
    expect(html).toContain("Appendix B: collection statistics");
    // With no sources and no list entries, those rail facts are omitted rather
    // than shown as zeroes.
    expect(html).toContain("<dd>0 of 0 answered</dd>");
    expect(html).not.toContain("<dt>List entries</dt>");
    expect(html).not.toContain("<dt>Median latency</dt>");
  });

  it("renders an assessment with no factors, patterns or narrative", () => {
    const html = reportToHtml(cleanAi);
    expect(html).toContain("Risk assessment");
    expect(html).not.toContain("<h3>Contributing factors</h3>");
    expect(html).not.toContain("<h3>Flagged patterns</h3>");
    expect(html).not.toContain("Analyst narrative");
    expect(html).toContain("--accent:#00ff85"); // fallback accent for an unknown band
  });

  it("omits the verdict line and the summary table when neither exists", () => {
    const html = reportToHtml({ ...model, headline: undefined, summary: undefined });
    expect(html).not.toContain(`class="verdict"`);
    expect(html).not.toContain("HTTP headers");
  });

  it("stays self-contained: no external stylesheet, script or font", () => {
    const html = reportToHtml(model);
    expect(html).not.toMatch(/<link[^>]+href="http/);
    expect(html).not.toMatch(/<script[^>]+src=/);
    expect(html).not.toContain("@import");
  });
});
