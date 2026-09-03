import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NextRequest } from "next/server";
import { POST } from "@/app/api/wallet-lookup/route";
import { restoreRateLimit, resetServerState, useRateLimit, clientCookie } from "./testUtils";

let dir: string;
beforeAll(() => { dir = mkdtempSync(join(tmpdir(), "hv-wallet-")); process.env.HV_DATA_DIR = dir; process.env.TRUST_PROXY = "1"; });
afterAll(() => { rmSync(dir, { recursive: true, force: true }); delete process.env.HV_DATA_DIR; delete process.env.TRUST_PROXY; });
afterEach(() => { vi.unstubAllGlobals(); restoreRateLimit(); resetServerState(); });

const resp = (status: number, body: unknown, ok = status >= 200 && status < 300) =>
  ({ ok, status, json: async () => body }) as unknown as Response;

let ipCounter = 0;
const post = (payload: unknown) => {
  const req = new Request("http://localhost/api/wallet-lookup", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `203.0.114.${++ipCounter}` },
    body: typeof payload === "string" ? payload : JSON.stringify(payload),
  });
  return POST(req as unknown as NextRequest);
};

describe("POST /api/wallet-lookup", () => {
  it("400 on a malformed body", async () => {
    expect((await post({})).status).toBe(400);
  });

  it("400 on a value that is neither a BTC nor ETH address", async () => {
    const res = await post({ address: "not-a-wallet" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Not a recognised BTC or ETH address");
  });

  it("resolves a Bitcoin address from mempool.space", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL) => {
      if (String(url).includes("mempool.space")) {
        return resp(200, { chain_stats: { funded_txo_sum: 5743251519, spent_txo_sum: 1000000000, tx_count: 65639 } });
      }
      throw new TypeError("unexpected fetch");
    }));
    const j = await (await post({ address: "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa" })).json();
    expect(j.chain).toBe("btc");
    expect(j.facts.balance).toBe("47.43251519 BTC");
    expect(j.facts.txCount).toBe(65639);
    expect(j.pivots.some((p: { label: string }) => p.label === "mempool.space")).toBe(true);
    expect(j.sourceHealth[0]).toMatchObject({ source: "mempool.space", ok: true });
  });

  it("resolves an Ethereum address via two JSON-RPC calls", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_url: string | URL, init?: RequestInit) => {
      const method = JSON.parse(String(init?.body ?? "{}")).method;
      if (method === "eth_getBalance") return resp(200, { jsonrpc: "2.0", id: 1, result: "0x5d2659027b0b8043" });
      if (method === "eth_getTransactionCount") return resp(200, { jsonrpc: "2.0", id: 1, result: "0x1744" });
      throw new TypeError("unexpected method " + method);
    }));
    const j = await (await post({ address: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045" })).json();
    expect(j.chain).toBe("eth");
    expect(j.facts.balance).toBe("6.71215 ETH");
    expect(j.facts.txCount).toBe(5956);
    expect(j.sourceHealth[0]).toMatchObject({ source: "ethereum-rpc", ok: true });
  });

  it("returns an honest error when the explorer is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => resp(0, null, false)));
    const j = await (await post({ address: "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa" })).json();
    expect(j.facts).toBeNull();
    expect(j.error).toBeTruthy();
    expect(j.sourceHealth[0].ok).toBe(false);
    expect(j.pivots.length).toBeGreaterThan(0); // pivots still offered
  });

  it("reports 'unknown address' when mempool answers 200 with no chain_stats", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => resp(200, {}))); // valid HTTP, empty payload
    const j = await (await post({ address: "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa" })).json();
    expect(j.facts).toBeNull();
    expect(j.sourceHealth[0].error).toMatch(/unknown address/);
  });

  it("returns null when the ETH balance call itself fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => resp(500, {}))); // both RPC calls fail
    const j = await (await post({ address: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045" })).json();
    expect(j.chain).toBe("eth");
    expect(j.facts).toBeNull();
    expect(j.sourceHealth[0]).toMatchObject({ source: "ethereum-rpc", ok: false });
  });

  it("keeps a null tx count when the ETH nonce call fails but the balance succeeds", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_url: string | URL, init?: RequestInit) => {
      const method = JSON.parse(String(init?.body ?? "{}")).method;
      if (method === "eth_getBalance") return resp(200, { result: "0x0" });
      return resp(500, {}); // nonce call fails
    }));
    const j = await (await post({ address: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045" })).json();
    expect(j.facts.balance).toBe("0 ETH");
    expect(j.facts.txCount).toBeNull();
  });

  // ── ENS resolution over eth_call (keyless, forward-verified) ───────────────
  const VITALIK = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
  const addrWord = (a: string) => "0x" + "0".repeat(24) + a.replace(/^0x/, "").toLowerCase();
  const zeroWord = "0x" + "0".repeat(64);
  function abiString(s: string): string {
    const bytes = new TextEncoder().encode(s);
    const offset = (32).toString(16).padStart(64, "0");
    const len = bytes.length.toString(16).padStart(64, "0");
    let data = ""; for (const b of bytes) data += b.toString(16).padStart(2, "0");
    data = data.padEnd(Math.ceil((data.length || 1) / 64) * 64, "0");
    return "0x" + offset + len + data;
  }
  // A small mock ENS+ledger world. Each field overrides one eth_call return.
  function world(o: {
    balance?: string; nonce?: string;
    resolver?: string;              // resolver() return (an address word or zeroWord)
    resolverStatus?: number;        // force a non-200 on the resolver() call
    resolverNoResult?: boolean;     // 200 but no `result` field
    name?: string | null;          // name() return (an ENS name, or null → "0x")
    addr?: string | null;          // addr() return (an address, or null → zeroWord)
  }) {
    return vi.fn(async (_url: string | URL, init?: RequestInit) => {
      const { method, params } = JSON.parse(String(init?.body ?? "{}"));
      if (method === "eth_getBalance") return resp(200, { result: o.balance ?? "0x0" });
      if (method === "eth_getTransactionCount") return resp(200, { result: o.nonce ?? "0x0" });
      if (method === "eth_call") {
        const sel = String(params[0].data).slice(2, 10);
        if (sel === "0178b8bf") { // resolver()
          if (o.resolverStatus) return resp(o.resolverStatus, {}, false);
          if (o.resolverNoResult) return resp(200, { jsonrpc: "2.0", id: 1, error: { code: -32000 } });
          return resp(200, { result: o.resolver ?? addrWord("0x5fbb459c49bb06083c33109fa4f14810ec2cf358") });
        }
        if (sel === "691f3431") return resp(200, { result: o.name === null ? "0x" : abiString(o.name ?? "vitalik.eth") }); // name()
        if (sel === "3b3b57de") return resp(200, { result: o.addr === null ? zeroWord : addrWord(o.addr ?? VITALIK) }); // addr()
      }
      throw new TypeError("unexpected " + method);
    });
  }

  it("reverse-resolves an ETH address to a forward-verified ENS name", async () => {
    vi.stubGlobal("fetch", world({ balance: "0x0", name: "vitalik.eth", addr: VITALIK }));
    const j = await (await post({ address: VITALIK })).json();
    expect(j.ens).toMatchObject({ name: "vitalik.eth", verified: true });
  });

  it("flags a reverse record that does NOT forward-verify as unverified (possible spoof)", async () => {
    vi.stubGlobal("fetch", world({ name: "spoof.eth", addr: "0x0000000000000000000000000000000000000bad" }));
    const j = await (await post({ address: VITALIK })).json();
    expect(j.ens).toMatchObject({ name: "spoof.eth", verified: false });
  });

  it("treats a zero forward address as unverified", async () => {
    vi.stubGlobal("fetch", world({ name: "vitalik.eth", addr: null }));
    const j = await (await post({ address: VITALIK })).json();
    expect(j.ens.verified).toBe(false);
  });

  it("returns no ENS when the address has no reverse name record", async () => {
    vi.stubGlobal("fetch", world({ name: null }));
    const j = await (await post({ address: VITALIK })).json();
    expect(j.ens).toBeNull();
  });

  it("returns no ENS when the address has no reverse resolver", async () => {
    vi.stubGlobal("fetch", world({ resolver: zeroWord }));
    const j = await (await post({ address: VITALIK })).json();
    expect(j.ens).toBeNull();
  });

  it("returns no ENS when the resolver eth_call errors out", async () => {
    vi.stubGlobal("fetch", world({ resolverStatus: 500 }));
    const j = await (await post({ address: VITALIK })).json();
    expect(j.ens).toBeNull();
  });

  it("returns no ENS when the resolver eth_call answers 200 with no result", async () => {
    vi.stubGlobal("fetch", world({ resolverNoResult: true }));
    const j = await (await post({ address: VITALIK })).json();
    expect(j.ens).toBeNull();
  });

  it("forward-resolves an ENS name input to an address and reads its balance", async () => {
    vi.stubGlobal("fetch", world({ balance: "0x5d2659027b0b8043", nonce: "0x1744", addr: VITALIK }));
    const j = await (await post({ address: "vitalik.eth" })).json();
    expect(j.input).toBe("vitalik.eth");
    expect(j.chain).toBe("eth");
    expect(j.ens).toMatchObject({ name: "vitalik.eth", address: VITALIK.toLowerCase(), verified: true });
    expect(j.facts.balance).toBe("6.71215 ETH");
  });

  it("400s when an ENS name input does not resolve to an address", async () => {
    vi.stubGlobal("fetch", world({ resolver: zeroWord }));
    const res = await post({ address: "ghost.eth" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/does not resolve/);
  });

  it("rate-limits a client once its budget is spent", async () => {
    useRateLimit(1);
    vi.stubGlobal("fetch", vi.fn(async () => resp(200, { chain_stats: { funded_txo_sum: 0, spent_txo_sum: 0, tx_count: 0 } })));
    const req = () => new Request("http://localhost/api/wallet-lookup", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: clientCookie("wl") },
      body: JSON.stringify({ address: "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa" }),
    });
    expect((await POST(req() as unknown as NextRequest)).status).toBe(200);
    expect((await POST(req() as unknown as NextRequest)).status).toBe(429);
  });
});
