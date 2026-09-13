// ── Wallet activity and token holdings (pure parsing) ────────────────────────
//
// A balance and a transaction count are a snapshot of a wallet, not its
// behaviour. What an investigation actually asks is: is it still moving, how
// long has it been moving, how many counterparties has it dealt with, and what
// else is in it besides the native coin. All four are answerable keylessly.
//
// The honesty constraint here is the SAMPLE. mempool.space returns the most
// recent page of transactions, not the whole history, so "first seen" cannot be
// derived from it — only "oldest in this page". Every field below says which it
// is, and `capped` marks when the wallet has more history than we looked at.
// Calling a sampled minimum "first activity" would be a fabricated fact.

import { formatUnits, hexToBigInt } from "./wallet";

export interface WalletActivity {
  /** Most recent transaction time seen, ISO date. */
  lastActivity: string | null;
  /** Oldest transaction IN THE SAMPLE, ISO date. A floor, not a first-seen. */
  oldestSampled: string | null;
  /** Transactions examined. */
  sampled: number;
  /** Distinct counterparty addresses in the sample, excluding the subject. */
  counterparties: number;
  /** True when the address has more transactions than were sampled. */
  capped: boolean;
}

interface MempoolTx {
  status?: { confirmed?: boolean; block_time?: number };
  vin?: { prevout?: { scriptpubkey_address?: string } }[];
  vout?: { scriptpubkey_address?: string }[];
}

/** Epoch seconds → ISO date, or null. */
function isoDay(seconds: number | undefined): string | null {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) return null;
  return new Date(seconds * 1000).toISOString().slice(0, 10);
}

/**
 * Summarise a page of mempool.space transactions for one address.
 *
 * Returns null for a non-array payload, so a provider error is never rendered
 * as "no activity".
 */
export function parseBtcActivity(address: string, json: unknown, txCount: number | null): WalletActivity | null {
  if (!Array.isArray(json)) return null;
  const txs = json as MempoolTx[];
  const self = address.toLowerCase();
  const times: number[] = [];
  const others = new Set<string>();

  for (const tx of txs) {
    const t = tx.status?.block_time;
    if (typeof t === "number" && t > 0) times.push(t);
    for (const vin of tx.vin ?? []) {
      const a = vin.prevout?.scriptpubkey_address;
      if (a && a.toLowerCase() !== self) others.add(a);
    }
    for (const vout of tx.vout ?? []) {
      const a = vout.scriptpubkey_address;
      if (a && a.toLowerCase() !== self) others.add(a);
    }
  }

  return {
    lastActivity: times.length > 0 ? isoDay(Math.max(...times)) : null,
    oldestSampled: times.length > 0 ? isoDay(Math.min(...times)) : null,
    sampled: txs.length,
    counterparties: others.size,
    capped: typeof txCount === "number" ? txCount > txs.length : false,
  };
}

// ── ERC-20 holdings ──────────────────────────────────────────────────────────

export interface TokenSpec {
  symbol: string;
  /** Contract address, lower-cased. */
  contract: string;
  decimals: number;
}

/**
 * Tokens worth checking on a keyless public RPC.
 *
 * Deliberately a fixed, short list. There is no keyless way to enumerate every
 * token an address holds, and pretending otherwise would mean either a paid
 * indexer or a made-up answer. These are the assets that actually carry value in
 * an investigation: the two dominant stablecoins, wrapped BTC and ETH, and the
 * largest-cap ERC-20s. A zero balance is simply not reported.
 */
export const ERC20_TOKENS: TokenSpec[] = [
  { symbol: "USDT", contract: "0xdac17f958d2ee523a2206206994597c13d831ec7", decimals: 6 },
  { symbol: "USDC", contract: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", decimals: 6 },
  { symbol: "DAI", contract: "0x6b175474e89094c44da98b954eedeac495271d0f", decimals: 18 },
  { symbol: "WETH", contract: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2", decimals: 18 },
  { symbol: "WBTC", contract: "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599", decimals: 8 },
  { symbol: "stETH", contract: "0xae7ab96520de3a18e5e111b5eaab095312d7fe84", decimals: 18 },
  { symbol: "LINK", contract: "0x514910771af9ca656af840dff83e8264ecf986ca", decimals: 18 },
  { symbol: "UNI", contract: "0x1f9840a85d5af5bf1d1762f925bdaddc4201f984", decimals: 18 },
  { symbol: "SHIB", contract: "0x95ad61b0a150d79219dcf64e1e6cc01f0b64c4ce", decimals: 18 },
  { symbol: "PEPE", contract: "0x6982508145454ce325ddbe47a25d4ec3d2311933", decimals: 18 },
];

export interface TokenBalance {
  symbol: string;
  contract: string;
  /** Human-readable amount, e.g. "1250.5". */
  amount: string;
  /** Base units as a decimal string, for the report. */
  raw: string;
}

/** ABI-encode `balanceOf(address)` for an 0x-prefixed address. */
export function encodeBalanceOf(address: string): string {
  return `0x70a08231${address.replace(/^0x/, "").toLowerCase().padStart(64, "0")}`;
}

/**
 * Decode one `balanceOf` result into a holding, or null when the balance is zero
 * or the response was not a hex quantity. Zero is not a holding, and a
 * malformed answer is not a zero.
 */
export function parseTokenBalance(token: TokenSpec, result: unknown): TokenBalance | null {
  if (typeof result !== "string") return null;
  const value = hexToBigInt(result);
  if (value === null || value === BigInt(0)) return null;
  return {
    symbol: token.symbol,
    contract: token.contract,
    amount: formatUnits(value, token.decimals, 6),
    raw: value.toString(),
  };
}
