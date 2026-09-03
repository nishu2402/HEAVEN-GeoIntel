// ── ENS resolution — pure keccak-256, namehash and ABI (de)coding ────────────
//
// Everything needed to reverse-resolve an Ethereum address to its ENS name, and
// to forward-resolve an ENS name to an address, WITHOUT a third-party ENS API or
// any key. The network calls (eth_call against a public RPC) live in the wallet
// route; this module supplies the deterministic pieces: a keccak-256 that matches
// Ethereum's, ENS namehash, the four-byte selectors, and decoders for the two
// return shapes we read (a 32-byte address word and an ABI-encoded string).
//
// Reverse records are attacker-settable — anyone can point `x.addr.reverse` at a
// name they do not own — so a reverse name is only trustworthy once it forward-
// resolves back to the same address. The route does that verification and the UI
// only treats a forward-confirmed name as an identity. That is the zero-false-
// positive rule applied to on-chain data.

// ── keccak-256 (Ethereum's, i.e. 0x01 domain padding, NOT NIST SHA3) ─────────

const MASK64 = (BigInt(1) << BigInt(64)) - BigInt(1);

const RC = [
  "0x0000000000000001", "0x0000000000008082", "0x800000000000808a", "0x8000000080008000",
  "0x000000000000808b", "0x0000000080000001", "0x8000000080008081", "0x8000000000008009",
  "0x000000000000008a", "0x0000000000000088", "0x0000000080008009", "0x000000008000000a",
  "0x000000008000808b", "0x800000000000008b", "0x8000000000008089", "0x8000000000008003",
  "0x8000000000008002", "0x8000000000000080", "0x000000000000800a", "0x800000008000000a",
  "0x8000000080008081", "0x8000000000008080", "0x0000000080000001", "0x8000000080008008",
].map((h) => BigInt(h));

// Rotation offsets r[x][y], flattened as x + 5*y.
const R = [
  0, 1, 62, 28, 27, 36, 44, 6, 55, 20, 3, 10, 43, 25, 39,
  41, 45, 15, 21, 8, 18, 2, 61, 56, 14,
];

function rotl(x: bigint, n: number): bigint {
  if (n === 0) return x & MASK64;
  return ((x << BigInt(n)) | (x >> BigInt(64 - n))) & MASK64;
}

function keccakF(s: bigint[]): void {
  for (let round = 0; round < 24; round++) {
    const C = new Array<bigint>(5);
    for (let x = 0; x < 5; x++) C[x] = s[x] ^ s[x + 5] ^ s[x + 10] ^ s[x + 15] ^ s[x + 20];
    const D = new Array<bigint>(5);
    for (let x = 0; x < 5; x++) D[x] = C[(x + 4) % 5] ^ rotl(C[(x + 1) % 5], 1);
    for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) s[x + 5 * y] ^= D[x];
    const B = new Array<bigint>(25).fill(BigInt(0));
    for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) {
      B[y + 5 * ((2 * x + 3 * y) % 5)] = rotl(s[x + 5 * y], R[x + 5 * y]);
    }
    for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) {
      s[x + 5 * y] = B[x + 5 * y] ^ ((~B[(x + 1) % 5 + 5 * y] & MASK64) & B[(x + 2) % 5 + 5 * y]);
    }
    s[0] ^= RC[round];
  }
}

/** keccak-256 of a byte string, as Ethereum computes it. */
export function keccak256(bytes: Uint8Array): Uint8Array {
  const rate = 136; // 1088-bit rate for keccak-256
  const s = new Array<bigint>(25).fill(BigInt(0));
  const padded = new Uint8Array(Math.ceil((bytes.length + 1) / rate) * rate);
  padded.set(bytes);
  padded[bytes.length] ^= 0x01;                 // keccak domain suffix
  padded[padded.length - 1] ^= 0x80;            // pad10*1 final bit
  for (let off = 0; off < padded.length; off += rate) {
    for (let i = 0; i < rate / 8; i++) {
      let lane = BigInt(0);
      for (let b = 0; b < 8; b++) lane |= BigInt(padded[off + i * 8 + b]) << BigInt(8 * b);
      s[i] ^= lane;
    }
    keccakF(s);
  }
  const out = new Uint8Array(32);
  for (let i = 0; i < 4; i++) {
    let lane = s[i];
    for (let b = 0; b < 8; b++) { out[i * 8 + b] = Number(lane & BigInt(0xff)); lane >>= BigInt(8); }
  }
  return out;
}

// ── hex + encoding helpers ───────────────────────────────────────────────────

const encoder = new TextEncoder();

export function toHex(u8: Uint8Array): string {
  let s = "";
  for (const b of u8) s += b.toString(16).padStart(2, "0");
  return s;
}

function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function selector(sig: string): string {
  return toHex(keccak256(encoder.encode(sig))).slice(0, 8);
}

const SEL_RESOLVER = selector("resolver(bytes32)"); // 0178b8bf
const SEL_NAME = selector("name(bytes32)");         // 691f3431
const SEL_ADDR = selector("addr(bytes32)");         // 3b3b57de

/** The canonical ENS registry address (mainnet). */
export const ENS_REGISTRY = "0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e";

// ── namehash + call encoding ─────────────────────────────────────────────────

/** ENS namehash of a dotted name (empty string → the 32-zero root). */
export function namehash(name: string): Uint8Array {
  let node: Uint8Array = new Uint8Array(32);
  if (name) {
    const labels = name.split(".");
    for (let i = labels.length - 1; i >= 0; i--) {
      const labelHash = keccak256(encoder.encode(labels[i]));
      const buf = new Uint8Array(64);
      buf.set(node);
      buf.set(labelHash, 32);
      node = keccak256(buf);
    }
  }
  return node;
}

/** namehash of `<addr>.addr.reverse`, the node holding an address's reverse record. */
export function reverseNode(address: string): Uint8Array {
  const bare = address.trim().toLowerCase().replace(/^0x/, "");
  return namehash(`${bare}.addr.reverse`);
}

export const encodeResolver = (node: Uint8Array): string => "0x" + SEL_RESOLVER + toHex(node);
export const encodeName = (node: Uint8Array): string => "0x" + SEL_NAME + toHex(node);
export const encodeAddr = (node: Uint8Array): string => "0x" + SEL_ADDR + toHex(node);

// ── return decoders ──────────────────────────────────────────────────────────

/** Decode a 32-byte address word (0x…). Zero address or junk → null. */
export function decodeAddress(ret: unknown): string | null {
  if (typeof ret !== "string") return null;
  const h = ret.replace(/^0x/, "");
  if (h.length < 64) return null;
  const word = h.slice(0, 64);
  if (!/^[0-9a-fA-F]{64}$/.test(word)) return null;
  const addr = word.slice(24); // low 20 bytes
  if (/^0+$/.test(addr)) return null;
  return "0x" + addr.toLowerCase();
}

/** Decode an ABI-encoded string return (offset, length, data). Junk → null. */
export function decodeEnsName(ret: unknown): string | null {
  if (typeof ret !== "string") return null;
  const h = ret.replace(/^0x/, "");
  if (h.length < 128) return null; // need the offset + length words
  const len = parseInt(h.slice(64, 128), 16);
  if (!Number.isFinite(len) || len === 0) return null;
  const dataHex = h.slice(128, 128 + len * 2);
  if (dataHex.length < len * 2) return null;
  const name = new TextDecoder().decode(fromHex(dataHex)).trim();
  // Reject empties and anything with a control character (an anti-spoof guard
  // against a reverse record set to a deceptive, unprintable string).
  if (!name || /[\u0000-\u001f\u007f]/.test(name)) return null;
  return name;
}

export interface EnsIdentity {
  name: string;
  /** The ETH address this name is tied to. */
  address: string;
  /**
   * True when a reverse record was forward-confirmed, or when the name was the
   * input and resolved forward. A false here means a reverse record exists but
   * does NOT resolve back — a possible spoof, surfaced as a warning, never as
   * the address's identity.
   */
  verified: boolean;
}

/** True for a `*.eth` name, so a name typed into the wallet box routes correctly. */
export function isEnsName(s: string): boolean {
  return /^[a-z0-9-]+(\.[a-z0-9-]+)*\.eth$/.test(s.trim().toLowerCase());
}
