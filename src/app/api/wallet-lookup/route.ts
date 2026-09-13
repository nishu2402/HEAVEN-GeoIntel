import { NextRequest, NextResponse } from "next/server";
import { guardRateLimit } from "@/lib/server/rateLimit";
import { audit } from "@/lib/server/auditLog";
import { parseBody, walletBody } from "@/lib/server/validation";
import { fetchBudgeted } from "@/lib/server/upstreamBudget";
import { markAll } from "@/lib/server/sourceHealth";
import { detectChain, parseBtc, parseEth, walletPivots } from "@/lib/analysis/wallet";
import {
  parseBtcActivity, parseTokenBalance, encodeBalanceOf, ERC20_TOKENS,
  type WalletActivity, type TokenBalance,
} from "@/lib/analysis/walletActivity";
import { sanctionsFor, SANCTIONS_FETCHED_AT, SANCTIONS_SOURCE, sanctionedAddressCount } from "@/lib/data/sanctionedAddresses";
import { mapLimit } from "@/lib/server/concurrency";
import { fanoutConcurrency } from "@/lib/server/config";
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

/**
 * Recent transaction history for a Bitcoin address.
 *
 * mempool.space returns the most recent page, so this yields a last-seen date,
 * an oldest-in-sample date and a counterparty count — all labelled as the sample
 * they are. It cannot yield a first-seen date without walking the entire chain
 * history of the address, and inventing one from a partial page would be exactly
 * the kind of plausible-looking fabrication this codebase refuses.
 */
async function btcActivity(address: string, txCount: number | null): Promise<WalletActivity | null> {
  const res = await fetchBudgeted<unknown>(`${MEMPOOL}/${encodeURIComponent(address)}/txs`, {
    source: "mempool.space", timeoutMs: 8000, allowNon2xx: true,
  });
  return res.status === 200 ? parseBtcActivity(address, res.data, txCount) : null;
}

/**
 * ERC-20 balances for the fixed token list, read with `balanceOf` over the same
 * public RPC. Zero balances are omitted: a wallet is not "holding 0 SHIB".
 */
async function tokenHoldings(address: string): Promise<TokenBalance[]> {
  const results = await mapLimit(ERC20_TOKENS, fanoutConcurrency(), async (token) => {
    const raw = await ethCall(token.contract, encodeBalanceOf(address));
    return parseTokenBalance(token, raw);
  });
  return results.filter((t): t is TokenBalance => t !== null);
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const rl = guardRateLimit(req);
  if (rl.limited) return rl.limited;
  const rlHeaders = rl.headers;
  const client = rl.client;

  const parsed = await parseBody(req, walletBody);
  if (!parsed.ok) return NextResponse.json(parsed.problem, { status: 400, headers: rlHeaders });
  const body = parsed.data;

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
      return NextResponse.json({ error: "That ENS name does not resolve to an address", field: "address" }, { status: 400, headers: rlHeaders });
    }
    address = resolved;
    ens = { name, address, verified: true };
  }

  // Sanctions screening happens BEFORE chain detection, and is the reason this
  // endpoint answers at all for a chain it cannot read. A Tron or Solana address
  // is not something the tool can fetch a balance for, but "this address is on
  // the OFAC SDN list" is the single most consequential fact about it and is
  // answerable offline. Returning "not a recognised BTC or ETH address" while
  // sitting on that answer would be the tool hiding what it knows.
  const sanctions = sanctionsFor(address);
  const screening = {
    listed: sanctions.length > 0,
    matches: sanctions,
    source: SANCTIONS_SOURCE,
    snapshotDate: SANCTIONS_FETCHED_AT,
    listSize: sanctionedAddressCount(),
  };

  const chain = detectChain(address);
  if (!chain) {
    if (screening.listed) {
      void audit("wallet", address, client, 200);
      return NextResponse.json(
        {
          input: raw,
          chain: null,
          facts: null,
          pivots: [],
          ens: null,
          sanctions: screening,
          sourceHealth: [],
          error: "This address is on the OFAC SDN list. Its chain is not one this tool can read a balance from, so only the sanctions match is reported.",
        } satisfies WalletLookupResponse,
        { headers: rlHeaders },
      );
    }
    return NextResponse.json({ error: "Not a recognised BTC or ETH address", field: "address" }, { status: 400, headers: rlHeaders });
  }
  void audit("wallet", address, client, 200);

  const { facts, provenance } = chain === "btc" ? await resolveBtc(address) : await resolveEth(address);

  // Enrichment runs only once the address is known to exist on-chain: there is
  // nothing to sample for an address no explorer has seen.
  let activity: WalletActivity | null = null;
  let tokens: TokenBalance[] = [];
  if (facts && chain === "btc") activity = await btcActivity(address, facts.txCount);
  if (facts && chain === "eth") tokens = await tokenHoldings(address);

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
    sanctions: screening,
    activity,
    tokens,
    sourceHealth,
    error: facts ? undefined : "The explorer was unreachable, or this address has never been seen on-chain.",
  };
  return NextResponse.json(response, { headers: rlHeaders });
}
