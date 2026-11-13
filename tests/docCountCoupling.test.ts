// ── Prose counts vs. the thing they count ────────────────────────────────────
//
// "Prose that counts something has to be checked against the thing it counts"
// (osintPivots.test.tsx). That file already pins the phone-pivot matrix and the
// 38-site default username count to their source. Two counts were still quoted
// in hand-written prose and guarded by NOTHING, so the catalog or the vendored
// snapshot could change and the README, a route's own comment and the roadmap
// would keep quoting the old number:
//
//   • the deep username sweep's default/on-request split (sweepSites()), and
//   • the OFAC sanctions snapshot's address and chain totals.
//
// These tests derive each number from the real source and require every document
// that states it to quote the live value. When the catalog or the snapshot is
// next refreshed, the matching prose must be updated in the same change — which
// is exactly what this is here to force.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sweepSites } from "@/app/api/username-sweep/route";
import sanctions from "@/lib/data/sanctionedAddresses.snapshot.json";
import { PROVIDER_NAMES } from "@/lib/analysis/emailAnalysis";
import { buildNumberFormats } from "@/components/phone/NumberPermutations";
import type { LookupResponse } from "@/lib/types";

const read = (p: string): string => readFileSync(join(process.cwd(), p), "utf8");

/** True when `text` quotes `n` as a whole number, with or without a thousands comma. */
function quotesNumber(text: string, n: number): boolean {
  const grouped = n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return new RegExp(`\\b${n}\\b`).test(text) || text.includes(grouped);
}

describe("the deep username sweep's size agrees with every doc that states it", () => {
  const def = sweepSites(false).length; // validated contracts, swept by default
  const onRequest = sweepSites(true).length - def; // the rest, offered on request
  const docs: [string, string][] = [
    ["route comment", read("src/app/api/username-sweep/route.ts")],
    ["README", read("README.md")],
    ["OSINT roadmap", read("docs/OSINT-ROADMAP.md")],
  ];

  it("splits the contract-carrying catalog into two non-trivial halves", () => {
    expect(def).toBeGreaterThan(100);
    expect(onRequest).toBeGreaterThan(100);
  });

  for (const [name, text] of docs) {
    it(`${name} quotes the live default (${def}) and on-request (${onRequest}) counts`, () => {
      expect(quotesNumber(text, def), `${name} must state ${def} default-sweep sites`).toBe(true);
      expect(quotesNumber(text, onRequest), `${name} must state ${onRequest} on-request sites`).toBe(true);
    });
  }
});

describe("the OFAC sanctions snapshot's size agrees with every doc that states it", () => {
  const addresses = (sanctions as { addresses: { t: string }[] }).addresses;
  const count = addresses.length;
  const chains = new Set(addresses.map((a) => a.t)).size;
  const docs: [string, string][] = [
    ["README", read("README.md")],
    ["loader header", read("src/lib/data/sanctionedAddresses.ts")],
  ];

  it("has a sane, non-empty address and chain total", () => {
    expect(count).toBeGreaterThan(500);
    expect(chains).toBeGreaterThan(1);
  });

  for (const [name, text] of docs) {
    it(`${name} quotes the live address (${count}) and chain (${chains}) counts`, () => {
      expect(quotesNumber(text, count), `${name} must state ${count} sanctioned addresses`).toBe(true);
      expect(quotesNumber(text, chains), `${name} must state ${chains} chains`).toBe(true);
    });
  }
});

describe("the phone number-format count agrees with the README", () => {
  // The panel's format list is a local const that dedupes per number at render
  // time (so a canonical number shows fewer), which is why the DEFINED count has
  // to come from buildNumberFormats() rather than from the rendered rows.
  const sample = {
    input: { e164: "+14155551234", countryCallingCode: "+1" },
    aggregated: {
      formatInternational: "+1 415 555 1234",
      formatNational: "(415) 555-1234",
      formatRfc3966: "tel:+1-415-555-1234",
    },
  } as unknown as LookupResponse;
  const defined = buildNumberFormats(sample).length;
  const readme = read("README.md");

  it("the README's format-variant count is the number the panel actually defines", () => {
    const m = /(\d+) format variants/.exec(readme);
    expect(m, "README must state the number-format count as 'N format variants'").not.toBeNull();
    expect(Number(m![1])).toBe(defined);
  });
});

describe("the mail-provider map's size satisfies the README floor", () => {
  // README states a floor, "(40+)", not an exact count. The real failure mode is
  // the prose OVERSTATING it (it once said "50+" with 42 entries): require the
  // map to actually meet whatever floor the README advertises.
  const size = Object.keys(PROVIDER_NAMES).length;
  const readme = read("README.md");

  it("the real map has at least as many entries as the README advertises", () => {
    const m = /Provider name resolution \((\d+)\+\)/.exec(readme);
    expect(m, "README must state the provider-map floor as '(N+)'").not.toBeNull();
    expect(size).toBeGreaterThanOrEqual(Number(m![1]));
  });
});
