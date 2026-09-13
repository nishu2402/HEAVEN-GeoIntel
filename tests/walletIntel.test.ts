import { describe, it, expect } from "vitest";
import {
  parseBtcActivity, parseTokenBalance, encodeBalanceOf, ERC20_TOKENS,
} from "@/lib/analysis/walletActivity";
import {
  sanctionsFor, sanctionedAddressCount, sanctionedChainCounts,
  SANCTIONS_SOURCE, SANCTIONS_FETCHED_AT,
} from "@/lib/data/sanctionedAddresses";

// Wallet mode could read a balance and say nothing about whether the address is
// sanctioned, which is the first question in any funds investigation.

describe("parseBtcActivity", () => {
  const tx = (time: number, from: string, to: string) => ({
    status: { confirmed: true, block_time: time },
    vin: [{ prevout: { scriptpubkey_address: from } }],
    vout: [{ scriptpubkey_address: to }],
  });

  it("summarises the sampled page, labelling it as a sample", () => {
    const out = parseBtcActivity("me", [
      tx(1_700_000_000, "alice", "me"),
      tx(1_600_000_000, "me", "bob"),
    ], 500);
    expect(out).toEqual({
      lastActivity: "2023-11-14",
      oldestSampled: "2020-09-13",
      sampled: 2,
      counterparties: 2,
      capped: true,       // 500 transactions exist, 2 were sampled
    });
  });

  it("does not count the subject as its own counterparty", () => {
    const out = parseBtcActivity("ME", [tx(1_700_000_000, "me", "me")], 1);
    expect(out!.counterparties).toBe(0);
    expect(out!.capped).toBe(false);
  });

  it("survives unconfirmed and address-less outputs", () => {
    const out = parseBtcActivity("me", [
      { status: {}, vin: [{}], vout: [{}] },
      { vout: [{ scriptpubkey_address: "bob" }] },
    ], null);
    expect(out).toEqual({
      lastActivity: null, oldestSampled: null, sampled: 2, counterparties: 1, capped: false,
    });
  });

  it("returns null when the explorer did not send a list", () => {
    expect(parseBtcActivity("me", { error: "nope" }, 1)).toBeNull();
    expect(parseBtcActivity("me", null, 1)).toBeNull();
  });
});

describe("ERC-20 reads", () => {
  it("encodes balanceOf for a checksummed address", () => {
    expect(encodeBalanceOf("0xD8dA6BF26964aF9D7eEd9e03E53415D37aA96045"))
      .toBe("0x70a08231000000000000000000000000d8da6bf26964af9d7eed9e03e53415d37aa96045");
  });

  it("decodes a non-zero balance and drops everything else", () => {
    const usdt = ERC20_TOKENS[0];
    expect(parseTokenBalance(usdt, "0x00000000000000000000000000000000000000000000000000000000114b3adb")).toEqual({
      symbol: "USDT",
      contract: usdt.contract,
      amount: "290.142939",
      raw: "290142939",
    });
    // Zero is not a holding, and a malformed answer is not a zero.
    expect(parseTokenBalance(usdt, "0x0")).toBeNull();
    expect(parseTokenBalance(usdt, "not hex")).toBeNull();
    expect(parseTokenBalance(usdt, null)).toBeNull();
  });

  it("checks a fixed list of major assets, each with a contract and decimals", () => {
    expect(ERC20_TOKENS.length).toBeGreaterThan(5);
    for (const t of ERC20_TOKENS) {
      expect(t.contract).toMatch(/^0x[0-9a-f]{40}$/);
      expect(t.decimals).toBeGreaterThan(0);
    }
  });
});

describe("OFAC sanctioned addresses", () => {
  it("holds a vendored snapshot across many chains", () => {
    expect(sanctionedAddressCount()).toBeGreaterThan(900);
    const chains = sanctionedChainCounts();
    expect(chains.XBT).toBeGreaterThan(100);
    expect(chains.ETH).toBeGreaterThan(50);
    expect(Object.keys(chains).length).toBeGreaterThan(10);
    expect(SANCTIONS_SOURCE).toMatch(/OFAC/);
    expect(SANCTIONS_FETCHED_AT).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("matches a listed address and names the designated entity", () => {
    // A real listing from the snapshot, looked up the way the route does —
    // including with the case flipped, since an EIP-55 variant of an address is
    // the same address.
    const sample = sanctionsFor("123WBUDmSJv4GctdVEz6Qq6z8nXSKrJ4KX");
    expect(sample).toHaveLength(1);
    expect(sample[0].entity).toBe("HYDRA MARKET");
    expect(sample[0].ticker).toBe("XBT");
    expect(sample[0].programs).toContain("CYBER2");
    expect(sanctionsFor("123wbudmsjv4gctdvez6qq6z8nxskrj4kx")).toHaveLength(1);
  });

  it("returns nothing for an address that is not on the list", () => {
    expect(sanctionsFor("bc1qnotarealaddressatall")).toEqual([]);
    expect(sanctionsFor("   ")).toEqual([]);
  });
});
