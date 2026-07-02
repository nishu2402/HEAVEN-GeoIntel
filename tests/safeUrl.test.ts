import { describe, it, expect } from "vitest";
import { safeExternalUrl } from "@/lib/utils";

// safeExternalUrl guards every remote-supplied href/src we render. A regression
// here would re-open a click-to-XSS via a target-controlled profile URL (e.g. a
// Gravatar linked-account URL), so the dangerous-protocol cases are the point.

describe("safeExternalUrl", () => {
  it("passes through normal http(s) URLs", () => {
    expect(safeExternalUrl("https://github.com/torvalds")).toBe("https://github.com/torvalds");
    expect(safeExternalUrl("http://example.com/path?q=1")).toBe("http://example.com/path?q=1");
  });

  it("rejects javascript: URLs (the core XSS case)", () => {
    expect(safeExternalUrl("javascript:alert(1)")).toBeUndefined();
    expect(safeExternalUrl("JavaScript:alert(document.cookie)")).toBeUndefined();
  });

  it("rejects control-char / whitespace obfuscation of javascript:", () => {
    expect(safeExternalUrl("  javascript:alert(1)")).toBeUndefined();
    expect(safeExternalUrl("java\tscript:alert(1)")).toBeUndefined();
    expect(safeExternalUrl("java\nscript:alert(1)")).toBeUndefined();
  });

  it("rejects other dangerous / non-http protocols", () => {
    expect(safeExternalUrl("data:text/html,<script>alert(1)</script>")).toBeUndefined();
    expect(safeExternalUrl("vbscript:msgbox(1)")).toBeUndefined();
    expect(safeExternalUrl("file:///etc/passwd")).toBeUndefined();
    expect(safeExternalUrl("mailto:x@y.com")).toBeUndefined();
  });

  it("rejects relative / protocol-relative / unparseable inputs", () => {
    expect(safeExternalUrl("/relative/path")).toBeUndefined();
    expect(safeExternalUrl("//evil.com")).toBeUndefined();
    expect(safeExternalUrl("not a url")).toBeUndefined();
  });

  it("treats empty / nullish input as no link", () => {
    expect(safeExternalUrl(null)).toBeUndefined();
    expect(safeExternalUrl(undefined)).toBeUndefined();
    expect(safeExternalUrl("")).toBeUndefined();
  });
});
