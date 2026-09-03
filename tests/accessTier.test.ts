import { describe, it, expect } from "vitest";
import {
  ACCESS_META, ALL_TIERS, BLOCK_CAVEAT, BLOCK_LIMIT, BLOCK_MEASURED, BLOCK_VANTAGE,
  DEFAULT_TIERS, TIER_ORDER, isAppScheme,
} from "@/lib/osint/accessTier";

describe("the blocked tier carries its vantage", () => {
  it("never prescribes a residential IP or a proxy", () => {
    // This is the regression guard for a claim that was in the file and was
    // wrong. The badge used to read "usually needs a residential IP or a
    // proxy", which sounds like ordinary advice and was contradicted by the
    // measurement itself: the four sites refused a residential line. Telling an
    // analyst to buy a proxy to fix a problem no proxy causes is exactly the
    // kind of confident-and-false claim this tool exists not to make.
    const remedy = /residential (ip|proxy)|use a proxy|needs a proxy|via a vpn/i;
    expect(remedy.test(BLOCK_CAVEAT)).toBe(false);
    expect(remedy.test(ACCESS_META.blocked.hint)).toBe(false);
  });

  it("dates the observation, so a stale badge can be spotted", () => {
    // A refusal is perishable. Without the date, a badge measured years ago and
    // a badge measured this morning look identical to the next maintainer.
    expect(BLOCK_VANTAGE.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(BLOCK_MEASURED).toContain(BLOCK_VANTAGE.date);
    expect(BLOCK_MEASURED).toContain(BLOCK_VANTAGE.network);
  });

  it("records the class of network, never the operator or the address", () => {
    // The vantage has to be specific enough to be evidence and no more. An ASN,
    // an ISP name or an address would put the maintainer's home connection in a
    // public repo to buy nothing the class does not already say.
    const v = JSON.stringify(BLOCK_VANTAGE);
    expect(v).not.toMatch(/\b\d{1,3}(\.\d{1,3}){3}\b/);
    expect(v).not.toMatch(/\bAS\d+\b/);
  });

  it("says out loud that the badge is not a property of the site", () => {
    expect(BLOCK_LIMIT).toMatch(/not a property of the site/i);
    expect(BLOCK_CAVEAT).toBe(`${BLOCK_MEASURED} ${BLOCK_LIMIT}`);
  });

  it("hands the filter chip the same sentence the row hovers", () => {
    // Two hand-written copies of a caveat drift, and the one that drifts is
    // always the one nobody is looking at.
    expect(ACCESS_META.blocked.hint).toBe(BLOCK_CAVEAT);
  });

  it("keeps blocked out of the default view but inside the filter", () => {
    expect(DEFAULT_TIERS).not.toContain("blocked");
    expect(ALL_TIERS).toContain("blocked");
    // Last in the order: an analyst scanning top-down reaches what worked first.
    expect(Math.max(...ALL_TIERS.map((t) => TIER_ORDER[t]))).toBe(TIER_ORDER.blocked);
  });
});

describe("isAppScheme", () => {
  it("matches app URIs and leaves web URLs alone", () => {
    expect(isAppScheme("tg://resolve?domain=x")).toBe(true);
    expect(isAppScheme("https://example.com/tg")).toBe(false);
  });
});
