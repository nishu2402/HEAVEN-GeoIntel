// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { cn, copyText } from "@/lib/utils";

// cn = clsx + tailwind-merge; copyText has a secure-context (navigator.clipboard)
// path and a legacy execCommand fallback for plain-HTTP/LAN origins.

describe("cn", () => {
  it("joins truthy classes and lets tailwind-merge win the last conflict", () => {
    expect(cn("a", false, "b", null, undefined)).toBe("a b");
    expect(cn("px-2", "px-4")).toBe("px-4");
  });
});

describe("copyText", () => {
  afterEach(() => vi.restoreAllMocks());

  it("uses the clipboard API in a secure context", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    Object.defineProperty(window, "isSecureContext", { value: true, configurable: true });
    expect(await copyText("hello")).toBe(true);
    expect(writeText).toHaveBeenCalledWith("hello");
  });

  it("falls back to a hidden textarea + execCommand off a secure context", async () => {
    Object.defineProperty(window, "isSecureContext", { value: false, configurable: true });
    const exec = vi.fn(() => true);
    (document as unknown as { execCommand: typeof exec }).execCommand = exec;
    expect(await copyText("via-textarea")).toBe(true);
    expect(exec).toHaveBeenCalledWith("copy");
  });

  it("returns false when both paths fail (never throws)", async () => {
    Object.defineProperty(window, "isSecureContext", { value: false, configurable: true });
    (document as unknown as { execCommand: () => never }).execCommand = () => { throw new Error("denied"); };
    expect(await copyText("nope")).toBe(false);
  });
});
