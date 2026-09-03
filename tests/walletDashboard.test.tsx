// @vitest-environment jsdom
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { installMemoryLocalStorage } from "./testUtils";
import WalletResultsDashboard from "@/components/wallet/WalletResultsDashboard";
import type { WalletLookupResponse } from "@/lib/types";

beforeAll(() => { installMemoryLocalStorage(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
beforeEach(() => localStorage.clear());

const btc: WalletLookupResponse = {
  input: "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa",
  chain: "btc",
  facts: { chain: "btc", address: "1A1z", balance: "47.43251519 BTC", balanceRaw: "4743251519 sats", txCount: 65639, totalReceived: "57.43251519 BTC", totalSent: "10 BTC" },
  pivots: [{ label: "mempool.space", url: "https://mempool.space/address/x", note: "UTXO graph" }],
  sourceHealth: [{ source: "mempool.space", ok: true, ms: 120, fetchedAt: 0 }],
};

describe("<WalletResultsDashboard>", () => {
  it("renders a Bitcoin balance, activity, totals and explorer pivots", () => {
    render(<WalletResultsDashboard data={btc} />);
    expect(screen.getByText("Bitcoin")).toBeTruthy();
    expect(screen.getByText("47.43251519 BTC")).toBeTruthy();
    expect(screen.getByText("65,639")).toBeTruthy(); // tx count localised
    expect(screen.getByText("57.43251519 BTC")).toBeTruthy(); // total received
    expect(screen.getByText("mempool.space")).toBeTruthy();
    expect(screen.getByText(/mempool.space · 120ms/)).toBeTruthy();
  });

  it("renders an Ethereum balance with no BTC-only totals and a null tx count", () => {
    render(<WalletResultsDashboard data={{
      input: "0xabc", chain: "eth",
      facts: { chain: "eth", address: "0xabc", balance: "6.71215 ETH", balanceRaw: "6712150161831460931 wei", txCount: null, totalReceived: null, totalSent: null },
      pivots: [{ label: "Etherscan", url: "https://etherscan.io/address/0xabc", note: "txns" }],
      sourceHealth: [{ source: "ethereum-rpc", ok: true, ms: 90, fetchedAt: 0 }],
    }} />);
    expect(screen.getByText("Ethereum")).toBeTruthy();
    expect(screen.getByText("6.71215 ETH")).toBeTruthy();
    expect(screen.queryByText("Total received")).toBeNull(); // ETH has no totals
    expect(screen.queryByText("Transactions")).toBeNull();   // txCount null → row hidden
  });

  it("renders a forward-verified ENS name as a green badge", () => {
    render(<WalletResultsDashboard data={{
      input: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045", chain: "eth",
      facts: { chain: "eth", address: "0xd8dA", balance: "6.71 ETH", balanceRaw: "1 wei", txCount: null, totalReceived: null, totalSent: null },
      pivots: [], ens: { name: "vitalik.eth", address: "0xd8da", verified: true },
    }} />);
    expect(screen.getByText(/ENS · vitalik.eth · forward-verified/)).toBeTruthy();
  });

  it("warns when a reverse ENS record does not forward-verify", () => {
    render(<WalletResultsDashboard data={{
      input: "0xabc", chain: "eth",
      facts: { chain: "eth", address: "0xabc", balance: "0 ETH", balanceRaw: "0 wei", txCount: null, totalReceived: null, totalSent: null },
      pivots: [], ens: { name: "spoof.eth", address: "0xabc", verified: false },
    }} />);
    expect(screen.getByText(/reverse record spoof.eth does not forward-verify/)).toBeTruthy();
  });

  it("shows an honest error and an unknown chain when the lookup found nothing", () => {
    render(<WalletResultsDashboard data={{
      input: "1A1z", chain: null, facts: null,
      error: "The explorer was unreachable, or this address has never been seen on-chain.",
      pivots: [{ label: "Blockchair", url: "https://blockchair.com/x", note: "analytics" }],
      sourceHealth: [{ source: "mempool.space", ok: false, ms: 5, fetchedAt: 0, error: "unreachable" }],
    }} />);
    expect(screen.getByText("Unknown")).toBeTruthy();
    expect(screen.getByText(/never been seen on-chain/)).toBeTruthy();
    expect(screen.getByText(/mempool.space · 5ms · unreachable/)).toBeTruthy();
  });

  it("falls back to a generic message when facts are null with no error string", () => {
    render(<WalletResultsDashboard data={{ input: "0xabc", chain: "eth", facts: null, pivots: [] }} />);
    expect(screen.getByText("No on-chain data.")).toBeTruthy();
  });
});
