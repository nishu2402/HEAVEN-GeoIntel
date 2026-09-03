// ── Crypto wallet OSINT — pure address logic + response parsing ──────────────
//
// Detects the chain of a wallet address and turns keyless explorer responses
// (mempool.space for Bitcoin, a public Ethereum JSON-RPC for Ethereum) into
// analyst-facing balances and activity. Everything here is deterministic and
// unit-tested; the network calls live in the route. Values are factual reads
// off the public ledger, so there is no false-positive surface — an address
// either has a balance and a transaction history or it does not.
//
// ENS resolution (the on-chain namehash → resolver → addr/name dance) lives in
// ./ens.ts and is wired into the wallet route: an ETH address is reverse-resolved
// and forward-verified, and an ENS-name input is forward-resolved to an address.

export type WalletChain = "btc" | "eth";

/** Classify an address by chain, or null when it is neither BTC nor ETH. */
export function detectChain(addr: string): WalletChain | null {
  const s = addr.trim();
  if (/^0x[0-9a-fA-F]{40}$/.test(s)) return "eth";
  // Bech32 (native SegWit / Taproot): bc1 + base32 (no 1, b, i, o).
  if (/^bc1[0-9ac-hj-np-z]{11,87}$/.test(s.toLowerCase())) return "btc";
  // Legacy P2PKH (1…) / P2SH (3…): Base58, no 0 O I l.
  if (/^[13][a-km-zA-HJ-NP-Z1-9]{25,39}$/.test(s)) return "btc";
  return null;
}

/** A hex quantity (0x…) → bigint, or null when malformed. */
export function hexToBigInt(hex: string): bigint | null {
  return /^0x[0-9a-fA-F]+$/.test(hex.trim()) ? BigInt(hex.trim()) : null;
}

/**
 * Fixed-point format of a base-unit integer: `value / 10^decimals`, trimmed to
 * at most `show` fractional digits with trailing zeros removed.
 */
export function formatUnits(value: bigint, decimals: number, show: number): string {
  const neg = value < BigInt(0);
  const v = neg ? -value : value;
  const base = BigInt(10) ** BigInt(decimals);
  const whole = v / base;
  const fracFull = (v % base).toString().padStart(decimals, "0");
  const frac = fracFull.slice(0, show).replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole}${frac ? `.${frac}` : ""}`;
}

export interface WalletFacts {
  chain: WalletChain;
  address: string;
  /** Human balance with unit, e.g. "57.43 BTC" / "6.7121 ETH". */
  balance: string;
  /** Base units (satoshis or wei) as a decimal string, for the report. */
  balanceRaw: string;
  /** Total transactions the address has taken part in (BTC) or sent (ETH nonce). */
  txCount: number | null;
  totalReceived: string | null;
  totalSent: string | null;
}

interface MempoolStats { funded_txo_sum?: number; spent_txo_sum?: number; tx_count?: number }
interface MempoolAddress { chain_stats?: MempoolStats; mempool_stats?: MempoolStats }

/** Parse a mempool.space address payload into BTC facts. */
export function parseBtc(address: string, json: unknown): WalletFacts | null {
  const d = json as MempoolAddress | null | undefined;
  const cs = d?.chain_stats;
  if (!cs || typeof cs.funded_txo_sum !== "number" || typeof cs.spent_txo_sum !== "number") return null;
  const funded = BigInt(cs.funded_txo_sum);
  const spent = BigInt(cs.spent_txo_sum);
  const balanceSats = funded - spent;
  return {
    chain: "btc",
    address,
    balance: `${formatUnits(balanceSats, 8, 8)} BTC`,
    balanceRaw: `${balanceSats} sats`,
    txCount: typeof cs.tx_count === "number" ? cs.tx_count : null,
    totalReceived: `${formatUnits(funded, 8, 8)} BTC`,
    totalSent: `${formatUnits(spent, 8, 8)} BTC`,
  };
}

/** Parse eth_getBalance + eth_getTransactionCount hex results into ETH facts. */
export function parseEth(address: string, balanceHex: unknown, nonceHex: unknown): WalletFacts | null {
  const wei = typeof balanceHex === "string" ? hexToBigInt(balanceHex) : null;
  if (wei === null) return null;
  const nonce = typeof nonceHex === "string" ? hexToBigInt(nonceHex) : null;
  return {
    chain: "eth",
    address,
    balance: `${formatUnits(wei, 18, 6)} ETH`,
    balanceRaw: `${wei} wei`,
    txCount: nonce !== null ? Number(nonce) : null,
    totalReceived: null,
    totalSent: null,
  };
}

/** Free explorer pivots for deeper wallet investigation. */
export function walletPivots(chain: WalletChain, address: string): { label: string; url: string; note: string }[] {
  const enc = encodeURIComponent(address);
  if (chain === "btc") {
    return [
      { label: "mempool.space", url: `https://mempool.space/address/${enc}`, note: "Full UTXO + transaction graph" },
      { label: "Blockchair", url: `https://blockchair.com/bitcoin/address/${enc}`, note: "Rich analytics + CSV export" },
      { label: "OXT", url: `https://oxt.me/address/${enc}`, note: "Clustering + flow analysis" },
      { label: "Blockchain.com", url: `https://www.blockchain.com/explorer/addresses/btc/${enc}`, note: "Balance + tx history" },
    ];
  }
  return [
    { label: "Etherscan", url: `https://etherscan.io/address/${enc}`, note: "Transactions, tokens, internal txns" },
    { label: "Blockchair", url: `https://blockchair.com/ethereum/address/${enc}`, note: "Analytics + CSV export" },
    { label: "Arkham", url: `https://intel.arkm.com/explorer/address/${enc}`, note: "Entity attribution" },
    { label: "Breadcrumbs", url: `https://www.breadcrumbs.app/reports/new?address=${enc}`, note: "Fund-flow mapping" },
  ];
}
