// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import TyposquatPanel from "@/components/network/TyposquatPanel";
import WalletResultsDashboard from "@/components/wallet/WalletResultsDashboard";
import type { TyposquatScanResponse, WalletLookupResponse } from "@/lib/types";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

// ── TyposquatPanel ───────────────────────────────────────────────────────────
// Generating look-alikes was only half the job: a list of 180 names to open by
// hand is homework, not a finding.

const scan = (over: Partial<TyposquatScanResponse> = {}): TyposquatScanResponse => ({
  domain: "example.com", generated: 180, checked: 180, resolving: 2, withMail: 1, unanswered: 3,
  findings: [
    {
      domain: "exmple.com", technique: "omission", addresses: ["5.6.7.8"], mx: ["mail.evil.test"],
      resolves: true, answered: true, whois: { registrar: "Shady Inc", createdDate: "2026-09-01" }, ageDays: 4,
    },
    {
      domain: "xn--pple-43d.com", display: "аpple.com", technique: "idn-homoglyph", addresses: [], mx: [],
      resolves: true, answered: true, whois: null, ageDays: null,
    },
  ],
  ...over,
});

describe("<TyposquatPanel>", () => {
  it("lists the generated candidates until a scan is run", () => {
    render(<TyposquatPanel domain="example.com" />);
    expect(screen.getByText(/LOOK-ALIKE DOMAINS: \d+ generated/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Resolve every look-alike/ })).toBeTruthy();
  });

  it("self-hides for something that is not a registrable domain", () => {
    const { container } = render(<TyposquatPanel domain="localhost" />);
    expect(container.firstChild).toBeNull();
  });

  it("replaces the list with what actually resolves", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => scan() }) as Response));
    render(<TyposquatPanel domain="example.com" />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Resolve every look-alike/ })); });

    expect(screen.getByText(/2/)).toBeTruthy();
    expect(screen.getByText(/of 180 resolve/)).toBeTruthy();
    expect(screen.getByText(/3 got no DNS answer \(unknown, not absent\)/)).toBeTruthy();
    // A look-alike registered days ago is the finding, and it is flagged.
    expect(screen.getByText(/registered 4d ago/)).toBeTruthy();
    expect(screen.getByText("mail.evil.test")).toBeTruthy();
    // The IDN candidate is shown in the spelling a victim would see, with the
    // punycode name beside it.
    expect(screen.getByText("аpple.com")).toBeTruthy();
    expect(screen.getByText("(xn--pple-43d.com)")).toBeTruthy();
  });

  it("reports a refused scan and a failed request", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 429, json: async () => ({ error: "Rate limited" }) }) as Response));
    render(<TyposquatPanel domain="example.com" />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Resolve every look-alike/ })); });
    expect(screen.getByText("Rate limited")).toBeTruthy();

    cleanup();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }) as Response));
    render(<TyposquatPanel domain="example.com" />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Resolve every look-alike/ })); });
    expect(screen.getByText(/scan failed \(HTTP 500\)/)).toBeTruthy();

    cleanup();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("down"); }));
    render(<TyposquatPanel domain="example.com" />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Resolve every look-alike/ })); });
    expect(screen.getByText(/scan request failed/)).toBeTruthy();
  });

  it("copies every candidate to the clipboard", async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    // copyText only uses the async clipboard in a secure context; jsdom is not
    // one by default, so it falls back to execCommand.
    Object.defineProperty(window, "isSecureContext", { value: true, configurable: true });
    render(<TyposquatPanel domain="example.com" />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Copy every look-alike/ })); });
    expect(writeText).toHaveBeenCalled();
    expect(screen.getByText("Copied")).toBeTruthy();
  });
});

// ── WalletResultsDashboard ───────────────────────────────────────────────────

const wallet = (over: Partial<WalletLookupResponse> = {}): WalletLookupResponse => ({
  input: "1abc", chain: "btc",
  facts: {
    chain: "btc", address: "1abc", balance: "0.5 BTC", balanceRaw: "50000000 sats",
    txCount: 12, totalReceived: "1 BTC", totalSent: "0.5 BTC",
  },
  pivots: [{ label: "mempool.space", url: "https://mempool.space/address/1abc", note: "UTXO graph" }],
  sourceHealth: [{ source: "mempool.space", ok: true, ms: 120, fetchedAt: 1 }],
  ...over,
});

describe("<WalletResultsDashboard>", () => {
  it("puts a sanctions hit in front of the balance", () => {
    render(<WalletResultsDashboard data={wallet({
      sanctions: {
        listed: true,
        matches: [{ ticker: "XBT", address: "1abc", entity: "HYDRA MARKET", uid: "36216", programs: ["CYBER2"], entityType: "Entity" }],
        source: "OFAC SDN", snapshotDate: "2026-09-12", listSize: 1056,
      },
    })} />);
    expect(screen.getByText("SANCTIONS SCREEN: OFAC SDN")).toBeTruthy();
    expect(screen.getByText("LISTED")).toBeTruthy();
    expect(screen.getByText(/HYDRA MARKET/)).toBeTruthy();
    expect(screen.getByText(/CYBER2/)).toBeTruthy();
    expect(screen.getByText(/not the same as clean/)).toBeTruthy();
  });

  it("says plainly when an address is not on the list", () => {
    render(<WalletResultsDashboard data={wallet({
      sanctions: { listed: false, matches: [], source: "OFAC SDN", snapshotDate: "2026-09-12", listSize: 1056 },
    })} />);
    expect(screen.getByText("Not on the SDN list.")).toBeTruthy();
  });

  it("labels the activity figures as the sample they are", () => {
    render(<WalletResultsDashboard data={wallet({
      activity: { lastActivity: "2020-02-18", oldestSampled: "2020-02-12", sampled: 2, counterparties: 107, capped: true },
    })} />);
    expect(screen.getByText("RECENT ACTIVITY")).toBeTruthy();
    expect(screen.getByText("2020-02-18")).toBeTruthy();
    expect(screen.getByText("107")).toBeTruthy();
    expect(screen.getByText(/of a longer history/)).toBeTruthy();
    expect(screen.getByText(/not the address's first activity/)).toBeTruthy();
  });

  it("lists non-zero token holdings and calls them a floor", () => {
    render(<WalletResultsDashboard data={wallet({
      chain: "eth",
      tokens: [{ symbol: "USDT", contract: "0xdac", amount: "290.14", raw: "290140000" }],
    })} />);
    expect(screen.getByText("TOKEN HOLDINGS")).toBeTruthy();
    expect(screen.getByText("290.14")).toBeTruthy();
    expect(screen.getByText(/a floor rather than a portfolio/)).toBeTruthy();
  });

  it("renders an unreadable wallet with its error, and no empty panels", () => {
    render(<WalletResultsDashboard data={wallet({ facts: null, tokens: [], error: "The explorer was unreachable." })} />);
    expect(screen.getByText("The explorer was unreachable.")).toBeTruthy();
    expect(screen.queryByText("TOKEN HOLDINGS")).toBeNull();
    expect(screen.queryByText("RECENT ACTIVITY")).toBeNull();
  });

  it("flags an ENS name that does not forward-verify as a possible spoof", () => {
    render(<WalletResultsDashboard data={wallet({ chain: "eth", ens: { name: "spoof.eth", address: "0x", verified: false } })} />);
    expect(screen.getByText(/possible spoof/)).toBeTruthy();
  });
});
