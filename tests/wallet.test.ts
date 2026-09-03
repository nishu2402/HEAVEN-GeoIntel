import { describe, it, expect } from "vitest";
import { detectChain, hexToBigInt, formatUnits, parseBtc, parseEth, walletPivots } from "@/lib/analysis/wallet";

describe("detectChain", () => {
  it("recognises ETH, BTC legacy and bech32 addresses", () => {
    expect(detectChain("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045")).toBe("eth");
    expect(detectChain("1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa")).toBe("btc"); // genesis (P2PKH)
    expect(detectChain("3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy")).toBe("btc"); // P2SH
    expect(detectChain("bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq")).toBe("btc"); // bech32
    expect(detectChain("  0xABCDEF0123456789abcdef0123456789ABCDEF01  ")).toBe("eth"); // trimmed
  });
  it("returns null for non-addresses", () => {
    expect(detectChain("torvalds")).toBeNull();
    expect(detectChain("0x123")).toBeNull();           // too short for ETH
    expect(detectChain("example.com")).toBeNull();
    expect(detectChain("2ABC")).toBeNull();            // BTC legacy must start 1 or 3
  });
});

describe("hexToBigInt", () => {
  it("parses hex quantities and rejects junk", () => {
    expect(hexToBigInt("0x1744")).toBe(BigInt("5956"));
    expect(hexToBigInt("0x0")).toBe(BigInt("0"));
    expect(hexToBigInt("1744")).toBeNull();  // no 0x
    expect(hexToBigInt("0xZZ")).toBeNull();  // not hex
  });
});

describe("formatUnits", () => {
  it("formats and trims fractional digits", () => {
    expect(formatUnits(BigInt("6712000000000000000"), 18, 6)).toBe("6.712");
    expect(formatUnits(BigInt("5743251519"), 8, 8)).toBe("57.43251519");
    expect(formatUnits(BigInt("1000000000000000000"), 18, 6)).toBe("1"); // whole, no fraction
    expect(formatUnits(BigInt("0"), 18, 6)).toBe("0");
    expect(formatUnits(BigInt("-500000000"), 8, 8)).toBe("-5"); // negative (balance can go below zero mid-parse)
    expect(formatUnits(BigInt("123456789012345678"), 18, 6)).toBe("0.123456"); // truncated to 6
  });
});

describe("parseBtc", () => {
  it("computes balance = funded − spent and totals", () => {
    const f = parseBtc("1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa", {
      chain_stats: { funded_txo_sum: 5743251519, spent_txo_sum: 1000000000, tx_count: 65639 },
    });
    expect(f?.chain).toBe("btc");
    expect(f?.balance).toBe("47.43251519 BTC");
    expect(f?.balanceRaw).toBe("4743251519 sats");
    expect(f?.txCount).toBe(65639);
    expect(f?.totalReceived).toBe("57.43251519 BTC");
    expect(f?.totalSent).toBe("10 BTC");
  });
  it("handles a missing tx_count and rejects malformed payloads", () => {
    const f = parseBtc("addr", { chain_stats: { funded_txo_sum: 100000000, spent_txo_sum: 0 } });
    expect(f?.txCount).toBeNull();
    expect(f?.balance).toBe("1 BTC");
    expect(parseBtc("addr", { chain_stats: {} })).toBeNull();
    expect(parseBtc("addr", {})).toBeNull();
    expect(parseBtc("addr", null)).toBeNull();
  });
});

describe("parseEth", () => {
  it("formats wei balance and decodes the nonce as tx count", () => {
    const f = parseEth("0xabc", "0x5d2659027b0b8043", "0x1744");
    expect(f?.chain).toBe("eth");
    expect(f?.balance).toBe("6.71215 ETH");
    expect(f?.balanceRaw).toBe("6712150161831460931 wei");
    expect(f?.txCount).toBe(5956);
    expect(f?.totalReceived).toBeNull();
  });
  it("keeps a null tx count when the nonce is absent, and rejects a bad balance", () => {
    const f = parseEth("0xabc", "0x0", undefined);
    expect(f?.balance).toBe("0 ETH");
    expect(f?.txCount).toBeNull();
    expect(parseEth("0xabc", "not-hex", "0x1")).toBeNull();
    expect(parseEth("0xabc", 42, "0x1")).toBeNull(); // non-string balance
  });
});

describe("walletPivots", () => {
  it("returns chain-appropriate explorer links", () => {
    const btc = walletPivots("btc", "1A1z");
    expect(btc.map((p) => p.label)).toContain("mempool.space");
    const eth = walletPivots("eth", "0xabc");
    expect(eth.map((p) => p.label)).toContain("Etherscan");
    expect(eth.every((p) => p.url.startsWith("https://"))).toBe(true);
  });
});
