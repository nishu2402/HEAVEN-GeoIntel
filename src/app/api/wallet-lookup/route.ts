import { NextRequest, NextResponse } from "next/server";
import { guardRateLimit } from "@/lib/server/rateLimit";
import { audit } from "@/lib/server/auditLog";
import { parseBody, walletBody } from "@/lib/server/validation";
import { fetchBudgeted } from "@/lib/server/upstreamBudget";
import { markAll } from "@/lib/server/sourceHealth";
import { detectChain, parseBtc, parseEth, walletPivots } from "@/lib/analysis/wallet";
import {
  isEnsName, reverseNode, namehash, ENS_REGISTRY,
  encodeResolver, encodeName, encodeAddr, decodeAddress, decodeEnsName,
} from "@/lib/analysis/ens";
import type { WalletLookupResponse, SourceProvenance, WalletFacts, EnsIdentity } from "@/lib/types";

// ── Crypto wallet OSINT — free, no API key ───────────────────────────────────
// Fixed upstreams, no SSRF surface:
//   • Bitcoin  → mempool.space   (address balance + tx count, keyless)
//   • Ethereum → a public JSON-RPC (eth_getBalance + eth_getTransactionCount)
// The read is factual ledger data, so there is no false-positive surface; a
// blackout returns an honest error rather than an empty card.

const MEMPOOL = "https://mempool.space/api/address";
const ETH_RPC = "https://ethereum-rpc.publicnode.com";

async function ethRpc(method: string, params: unknown[]): Promise<{ result?: unknown; ms: number; ok: boolean; error?: string; fetchedAt: number }> {
  const res = await fetchBudgeted<{ result?: unknown }>(ETH_RPC, {
    source: "ethereum-rpc", timeoutMs: 8000, allowNon2xx: true,
    init: { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) },
  });
  return { result: res.data?.result, ms: res.ms, ok: res.status === 200, error: res.error, fetchedAt: res.fetchedAt };
}

async function resolveBtc(address: string): Promise<{ facts: WalletFacts | null; provenance: SourceProvenance }> {
  const res = await fetchBudgeted<unknown>(`${MEMPOOL}/${encodeURIComponent(address)}`, {
    source: "mempool.space", timeoutMs: 8000, allowNon2xx: true,
  });
  const facts = res.status === 200 ? parseBtc(address, res.data) : null;
  return {
    facts,
    provenance: { source: "mempool.space", ok: facts !== null, ms: res.ms, fetchedAt: res.fetchedAt, error: facts !== null ? undefined : (res.error ?? "unreachable or unknown address") },
  };
}

// ── ENS resolution over the same public RPC (eth_call, keyless) ──────────────
// A reverse record is attacker-settable, so a name is only an identity once it
// forward-resolves back to the address. `verified:false` means a reverse record
// exists but fails that check — surfaced as a possible spoof, never as identity.

async function ethCall(to: string, data: string): Promise<string | null> {
  const r = await ethRpc("eth_call", [{ to, data }, "latest"]);
  return r.ok && typeof r.result === "string" ? r.result : null;
}

async function resolverFor(node: Uint8Array): Promise<string | null> {
  return decodeAddress(await ethCall(ENS_REGISTRY, encodeResolver(node)));
}

/** Forward-resolve an ENS name to its address (null when it has no address record). */
async function addressFromEns(name: string): Promise<string | null> {
  const node = namehash(name);
  const resolver = await resolverFor(node);
  if (!resolver) return null;
  return decodeAddress(await ethCall(resolver, encodeAddr(node)));
}

/** Reverse-resolve an ETH address to a forward-verified ENS name (or null). */
async function ensFromAddress(address: string): Promise<EnsIdentity | null> {
  const node = reverseNode(address);
  const resolver = await resolverFor(node);
  if (!resolver) return null;
  const name = decodeEnsName(await ethCall(resolver, encodeName(node)));
  if (!name) return null;
  const forward = await addressFromEns(name);
  const verified = forward !== null && forward.toLowerCase() === address.toLowerCase();
  return { name, address, verified };
}

async function resolveEth(address: string): Promise<{ facts: WalletFacts | null; provenance: SourceProvenance }> {
  const [bal, nonce] = await Promise.all([
    ethRpc("eth_getBalance", [address, "latest"]),
    ethRpc("eth_getTransactionCount", [address, "latest"]),
  ]);
  const facts = bal.ok ? parseEth(address, bal.result, nonce.ok ? nonce.result : undefined) : null;
  return {
    facts,
    provenance: { source: "ethereum-rpc", ok: facts !== null, ms: Math.max(bal.ms, nonce.ms), fetchedAt: bal.fetchedAt, error: facts !== null ? undefined : "Ethereum RPC unreachable" },
  };
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const rl = guardRateLimit(req);
  if (rl.limited) return rl.limited;
  const rlHeaders = rl.headers;
  const client = rl.client;

  const body = await parseBody(req, walletBody);
  if (!body) return NextResponse.json({ error: "Invalid request body" }, { status: 400 });

  const raw = body.address.trim();

  // An ENS name (vitalik.eth) is forward-resolved to its address first; the rest
  // of the lookup then runs against that address exactly as a typed 0x… would.
  let address = raw;
  let ens: EnsIdentity | null = null;
  if (isEnsName(raw)) {
    const name = raw.toLowerCase();
    const resolved = await addressFromEns(name);
    if (!resolved) {
      void audit("wallet", raw, client, 400);
      return NextResponse.json({ error: "That ENS name does not resolve to an address" }, { status: 400 });
    }
    address = resolved;
    ens = { name, address, verified: true };
  }

  const chain = detectChain(address);
  if (!chain) {
    return NextResponse.json({ error: "Not a recognised BTC or ETH address" }, { status: 400 });
  }
  void audit("wallet", address, client, 200);

  const { facts, provenance } = chain === "btc" ? await resolveBtc(address) : await resolveEth(address);
  const sourceHealth = markAll([provenance]);

  // For a typed ETH address, enrich with its reverse-resolved, forward-verified
  // ENS name. (An ENS-name input already carries its forward-resolved identity.)
  if (chain === "eth" && !ens) ens = await ensFromAddress(address);

  const response: WalletLookupResponse = {
    input: raw,
    chain,
    facts,
    pivots: walletPivots(chain, address),
    ens,
    sourceHealth,
    error: facts ? undefined : "The explorer was unreachable, or this address has never been seen on-chain.",
  };
  return NextResponse.json(response, { headers: rlHeaders });
}
