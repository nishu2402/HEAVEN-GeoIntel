import { describe, it, expect } from "vitest";
import { buildCaseHtml, buildCasePrintHtml } from "@/lib/analysis/caseDoc";
import { buildCaseDoc } from "@/lib/analysis/caseReport";
import type { InvestigationCase } from "@/lib/types";

// The case export was a Markdown string in a <pre> tag, printed. It is now two
// documents from one model, and these tests keep them apart and keep them
// honest about what a case file does and does not claim.

const full: InvestigationCase = {
  id: "c1",
  name: "Operation Kestrel",
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_900_000,
  notes: "Lead came from the abuse mailbox.\nSecond line.",
  entities: [
    { kind: "email", value: "billing@kestrel.example", addedAt: 1_700_000_000_100, note: "sender" },
    { kind: "domain", value: "kestrel.example", addedAt: 1_700_000_000_200 },
  ],
  edges: [
    { from: { kind: "email", value: "billing@kestrel.example" }, to: { kind: "domain", value: "kestrel.example" }, reason: "Email domain", addedAt: 1_700_000_000_300 },
  ],
  snapshots: [
    { kind: "domain", value: "kestrel.example", takenAt: 1_700_000_000_400, facts: { subdomains: 3 } },
    { kind: "domain", value: "kestrel.example", takenAt: 1_700_000_000_500, facts: { subdomains: 9 } },
    { kind: "email", value: "billing@kestrel.example", takenAt: 1_700_000_000_600, facts: { breaches: 1 } },
  ],
};

// Nothing but a name: no identifiers, links, snapshots or notes.
const empty: InvestigationCase = {
  id: "c2", name: "Empty case", createdAt: 1, updatedAt: 2, entities: [],
  notes: undefined as unknown as string,
};

// Re-run with nothing moving, which is a finding of its own and must not read
// as "never re-run".
const quiet: InvestigationCase = {
  ...full,
  snapshots: [
    { kind: "ip", value: "8.8.8.8", takenAt: 1, facts: { openPorts: 2 } },
    { kind: "ip", value: "8.8.8.8", takenAt: 2, facts: { openPorts: 2 } },
  ],
};

describe("the two case documents are genuinely different documents", () => {
  it("share the model and nothing else", async () => {
    const screen = await buildCaseHtml(full);
    const print = await buildCasePrintHtml(full);
    expect(screen).not.toBe(print);
    expect(print).toContain("@page { size: A4;");
    expect(print).toContain(`<section class="cover">`);
    expect(print).toContain("Prepared by");          // signature strip
    expect(screen).not.toContain("@page { size: A4;");
    expect(screen).not.toContain("Prepared by");
    expect(screen).toContain("--p0:#05060d");        // the app's palette
    expect(print).toContain("#0b1020");              // ink for paper
    expect(print).toContain('<linearGradient id="cp-frame"'); // coloured mark on paper
    // Same case, same document id, on both.
    const d = await buildCaseDoc(full);
    expect(screen).toContain(d.documentId);
    expect(print).toContain(d.documentId);
  });

  it("both carry the integrity hash and say what it covers", async () => {
    const d = await buildCaseDoc(full);
    for (const html of [await buildCaseHtml(full), await buildCasePrintHtml(full)]) {
      expect(html).toContain(d.integrity.hash);
      expect(html).toContain("Re-import this file into HEAVEN-GeoIntel");
    }
  });
});

describe("buildCaseHtml", () => {
  it("renders the profile, identifiers, links, history and notes", async () => {
    const html = await buildCaseHtml(full);
    expect(html).toMatch(/^<!DOCTYPE html>/);
    expect(html).toContain("<h1>Investigation Dossier</h1>");
    expect(html).toContain("Operation Kestrel");
    expect(html).toContain("<dt>Derived links</dt><dd>1</dd>");
    expect(html).toContain("kestrel.example");
    expect(html).toContain("Email domain");
    expect(html).toContain("<td>subdomains</td><td>3</td><td>9</td>");
    expect(html).toContain("Lead came from the abuse mailbox.");
    // Identifier chips carry the panel's colours.
    expect(html).toContain("#22d3ee");  // email
    expect(html).toContain("#7dd3fc");  // domain
  });

  it("states each empty section in words rather than leaving a blank", async () => {
    const html = await buildCaseHtml(empty);
    expect(html).toContain("No identifiers have been added to this case yet.");
    expect(html).toContain("No identifiers recorded.");
    expect(html).toContain("No derived links recorded.");
    expect(html).toContain("No lookups have been snapshotted for this case.");
    expect(html).toContain("<p class=\"empty\">None.</p>");
  });

  it("separates a baseline from a re-run where nothing moved", async () => {
    expect(await buildCaseHtml(quiet)).toContain("Nothing changed across 2 snapshots.");
    expect(await buildCaseHtml({ ...full, snapshots: [{ kind: "ip", value: "8.8.8.8", takenAt: 1, facts: {} }] }))
      .toContain("Baseline only: re-run this identifier to see what changes.");
    // One snapshot is "snapshot", not "snapshots".
    expect(await buildCaseHtml({ ...full, snapshots: [{ kind: "ip", value: "8.8.8.8", takenAt: 1, facts: {} }] }))
      .toContain("1 snapshot ·");
  });

  it("escapes the case name, notes and identifier values", async () => {
    const html = await buildCaseHtml({
      ...empty, name: `A&B <script>alert(1)</script>`, notes: "<img src=x>",
      entities: [{ kind: "ip", value: `"><b>`, addedAt: 1 }],
    });
    expect(html).toContain("A&amp;B &lt;script&gt;");
    expect(html).toContain("&lt;img src=x&gt;");
    expect(html).toContain("&quot;&gt;&lt;b&gt;");
    expect(html).not.toContain("<script>alert(1)</script>");
  });

  it("stays self-contained: no external stylesheet, script or font", async () => {
    const html = await buildCaseHtml(full);
    expect(html).not.toMatch(/<link[^>]+href="http/);
    expect(html).not.toMatch(/<script[^>]+src=/);
    expect(html).not.toContain("@import");
  });
});

describe("buildCasePrintHtml", () => {
  it("renders a cover sheet, contents and every numbered section", async () => {
    const html = await buildCasePrintHtml(full);
    expect(html).toMatch(/^<!DOCTYPE html>/);
    expect(html).toContain(`<p class="kicker">Investigation dossier</p>`);
    expect(html).toContain("<h1>Operation Kestrel</h1>");
    expect(html).toContain("2 identifiers &middot; 1 derived links &middot; 3 snapshots");
    for (const heading of [
      "Case profile", "Identifiers", "Derived links", "Change history",
      "Analyst notes", "Methodology and limitations", "Integrity and chain of custody",
    ]) {
      expect(html).toContain(heading);
    }
    // Per-kind counts appear in the profile table.
    expect(html).toContain("<th>domain identifiers</th><td>1</td>");
    expect(html).toContain("<td>subdomains</td><td>3</td><td>9</td>");
  });

  it("states each empty section in words rather than leaving a blank", async () => {
    const html = await buildCasePrintHtml(empty);
    expect(html).toContain("No identifiers recorded.");
    expect(html).toContain("No derived links recorded.");
    expect(html).toContain("No lookups have been snapshotted for this case.");
    expect(html).toContain("<p class=\"empty\">None.</p>");
  });

  it("separates a baseline from a re-run where nothing moved", async () => {
    expect(await buildCasePrintHtml(quiet)).toContain("Nothing changed across 2 snapshots.");
    expect(await buildCasePrintHtml({ ...full, snapshots: [{ kind: "ip", value: "8.8.8.8", takenAt: 1, facts: {} }] }))
      .toContain("Baseline only: re-run this identifier to see what changes.");
  });

  it("escapes the case name and identifier values", async () => {
    const html = await buildCasePrintHtml({
      ...empty, name: `A&B <script>`,
      entities: [{ kind: "ip", value: "<b>", addedAt: 1, note: "<i>" }],
    });
    expect(html).toContain("A&amp;B &lt;script&gt;");
    expect(html).toContain("&lt;b&gt;");
    expect(html).toContain("&lt;i&gt;");
    expect(html).not.toContain("<script>A");
  });
});
