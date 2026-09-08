// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import UniversalReportExport from "@/components/shared/UniversalReportExport";
import type { ReportModel } from "@/lib/analysis/report";

const model: ReportModel = {
  kind: "domain", subject: "acme.test", generatedAt: "2026-09-02T00:00:00.000Z",
  headline: { label: "HTTP", value: "grade B" },
  sections: [{ heading: "DNS", rows: [{ label: "A", value: "1.2.3.4" }] }],
  sources: [{ source: "dns", ok: true, ms: 10 }],
  pivots: [{ label: "crt.sh", url: "https://crt.sh" }],
  observables: [{ type: "domain-name", value: "acme.test" }],
};

let anchors: HTMLAnchorElement[];
const realCreate = document.createElement.bind(document);

beforeEach(() => {
  cleanup();
  anchors = [];
  URL.createObjectURL = vi.fn(() => "blob:x");
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
    const el = realCreate(tag);
    if (tag === "a") { (el as HTMLAnchorElement).click = vi.fn(); anchors.push(el as HTMLAnchorElement); }
    return el;
  });
});
afterEach(() => vi.restoreAllMocks());

describe("UniversalReportExport", () => {
  it("offers five export formats including PDF", () => {
    render(<UniversalReportExport model={model} />);
    for (const label of ["PDF", "TXT", "Markdown", "HTML", "STIX 2.1"]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
  });

  it("downloads each file format with the right extension and a sanitised filename", () => {
    render(<UniversalReportExport model={model} />);
    const expectExt = [["TXT", ".txt"], ["Markdown", ".md"], ["HTML", ".html"], ["STIX 2.1", ".stix.json"]] as const;
    for (const [label, ext] of expectExt) {
      fireEvent.click(screen.getByText(label));
      const a = anchors[anchors.length - 1];
      expect(a.download.startsWith("geointel_domain_acme.test_")).toBe(true);
      expect(a.download.endsWith(ext)).toBe(true);
    }
    // PDF opens a print window instead of a blob download, so only the four file
    // formats create object URLs.
    expect(URL.createObjectURL).toHaveBeenCalledTimes(4);
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(4);
  });

  it("PDF opens a print-ready report window and invokes the browser print dialog", () => {
    const write = vi.fn(), close = vi.fn(), focus = vi.fn(), print = vi.fn();
    const fakeWin = { document: { write, close }, focus, print } as unknown as Window;
    const open = vi.spyOn(window, "open").mockReturnValue(fakeWin);
    render(<UniversalReportExport model={model} />);
    fireEvent.click(screen.getByText("PDF"));
    expect(open).toHaveBeenCalled();
    expect(write).toHaveBeenCalledWith(expect.stringContaining("<!DOCTYPE html>"));
    expect(close).toHaveBeenCalled();
    expect(print).toHaveBeenCalled();
  });

  it("sanitises unusual characters in the subject for the filename", () => {
    render(<UniversalReportExport model={{ ...model, kind: "username", subject: "weird name/@!" }} />);
    fireEvent.click(screen.getByText("TXT"));
    expect(anchors[anchors.length - 1].download.startsWith("geointel_username_weird_name_")).toBe(true);
  });
});
