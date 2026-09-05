// ── Crypto workbench — hash, encode and encrypt arbitrary text, in the browser ─
//
// The Hash mode used to answer exactly one question: "is this file digest known
// software?". This module adds the other half an analyst reaches for constantly:
// take a piece of text (a word, a token, a whole paragraph) and hash it, encode
// it, or encrypt/decrypt it with a passphrase. Everything here runs on the bytes
// in front of it — no network, no upload — so it works offline and the plaintext
// never leaves the tab.
//
// Three honest categories, kept separate on purpose:
//   • DIGEST / HMAC — one-way. A hash cannot be "decrypted"; the workbench never
//     pretends otherwise. MD5 and SHA-1 are offered because analysts still meet
//     them in the wild (IOCs, legacy systems), clearly labelled as weak.
//   • ENCODE — reversible transforms with NO secret (Base64, hex, URL, binary,
//     Morse, ROT13, Atbash). These hide nothing; they only change representation.
//   • CIPHER / ENCRYPT — reversible WITH a key. Caesar/Vigenère/XOR are classical
//     and breakable (teaching + CTF use); AES-256-GCM with a PBKDF2 passphrase is
//     the real one: authenticated, so a wrong key or a tampered token fails loudly
//     rather than returning garbage.
//
// The modern primitives use the platform Web Crypto (crypto.subtle), which exists
// in every current browser and in Node, so the same code path is what the tests
// exercise. MD5 is implemented here because Web Crypto deliberately omits it.

// ── Byte primitives ─────────────────────────────────────────────────────────

// Web Crypto's BufferSource wants an ArrayBuffer-backed view, not the wider
// SharedArrayBuffer-inclusive default that a bare `Uint8Array` now means under
// TypeScript 5.7+. Everything we hand to crypto.subtle is typed as this.
type Bytes = Uint8Array<ArrayBuffer>;

const encoder = new TextEncoder();
// A non-fatal decoder: invalid UTF-8 becomes U+FFFD rather than throwing, so a
// wrong XOR key or a corrupt token yields visible mojibake instead of a crash.
const decoder = new TextDecoder();

export function utf8Encode(text: string): Bytes {
  return encoder.encode(text) as Bytes;
}

export function utf8Decode(bytes: Uint8Array): string {
  return decoder.decode(bytes);
}

export function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

export function hexToBytes(input: string): Bytes {
  const clean = input.replace(/\s+/g, "").toLowerCase();
  if (clean.length % 2 !== 0) throw new Error("Hex needs an even number of digits.");
  if (!/^[0-9a-f]*$/.test(clean)) throw new Error("That is not valid hexadecimal.");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export function bytesToBase64(bytes: Uint8Array, url = false): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const has1 = i + 1 < bytes.length;
    const has2 = i + 2 < bytes.length;
    const b1 = has1 ? bytes[i + 1] : 0;
    const b2 = has2 ? bytes[i + 2] : 0;
    const triple = (b0 << 16) | (b1 << 8) | b2;
    out += B64[(triple >> 18) & 63];
    out += B64[(triple >> 12) & 63];
    out += has1 ? B64[(triple >> 6) & 63] : "=";
    out += has2 ? B64[triple & 63] : "=";
  }
  // URL-safe: swap the two alphabet chars and drop padding.
  return url ? out.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") : out;
}

export function base64ToBytes(input: string): Bytes {
  // Accept standard and URL-safe alike, with or without padding and whitespace.
  const clean = input.replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, "");
  const out: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const ch of clean) {
    const val = B64.indexOf(ch);
    if (val < 0) throw new Error("That is not valid Base64.");
    buffer = (buffer << 6) | val;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buffer >> bits) & 0xff);
    }
  }
  return Uint8Array.from(out);
}

// ── MD5 (pure) ───────────────────────────────────────────────────────────────
// Web Crypto has no MD5, but analysts still see it everywhere, so it lives here.
// Verified byte-for-byte against Node's crypto in the test suite.

const MD5_S = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];
// K[i] = floor(abs(sin(i+1)) * 2^32) — computed, not transcribed, so there is no
// 64-entry constant table to mistype.
const MD5_K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296));

function md5Words(input: Uint8Array): number[] {
  const len = input.length;
  const bitLen = len * 8;
  const nWords = (((len + 8) >>> 6) + 1) * 16;
  const words = new Array<number>(nWords).fill(0);
  for (let i = 0; i < len; i++) words[i >>> 2] |= input[i] << ((i % 4) * 8);
  words[len >>> 2] |= 0x80 << ((len % 4) * 8);
  words[nWords - 2] = bitLen >>> 0;
  words[nWords - 1] = Math.floor(bitLen / 4294967296) >>> 0;
  return words;
}

function rotl32(x: number, c: number): number {
  return (x << c) | (x >>> (32 - c));
}

function leWordHex(w: number): string {
  let s = "";
  for (let i = 0; i < 4; i++) s += ((w >>> (i * 8)) & 0xff).toString(16).padStart(2, "0");
  return s;
}

export function md5Hex(input: Uint8Array): string {
  const words = md5Words(input);
  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;
  for (let off = 0; off < words.length; off += 16) {
    let A = a0;
    let B = b0;
    let C = c0;
    let D = d0;
    for (let i = 0; i < 64; i++) {
      let f: number;
      let g: number;
      if (i < 16) {
        f = (B & C) | (~B & D);
        g = i;
      } else if (i < 32) {
        f = (D & B) | (~D & C);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        f = B ^ C ^ D;
        g = (3 * i + 5) % 16;
      } else {
        f = C ^ (B | ~D);
        g = (7 * i) % 16;
      }
      f = (f + A + MD5_K[i] + (words[off + g] | 0)) | 0;
      A = D;
      D = C;
      C = B;
      B = (B + rotl32(f, MD5_S[i])) | 0;
    }
    a0 = (a0 + A) | 0;
    b0 = (b0 + B) | 0;
    c0 = (c0 + C) | 0;
    d0 = (d0 + D) | 0;
  }
  return leWordHex(a0) + leWordHex(b0) + leWordHex(c0) + leWordHex(d0);
}

// ── Web Crypto helpers ───────────────────────────────────────────────────────

type SubtleHash = "SHA-1" | "SHA-256" | "SHA-384" | "SHA-512";

async function subtleDigest(name: SubtleHash, bytes: Bytes): Promise<string> {
  const buf = await crypto.subtle.digest(name, bytes);
  return bytesToHex(new Uint8Array(buf));
}

async function hmacHex(hash: "SHA-256" | "SHA-512", key: string, text: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey("raw", utf8Encode(key), { name: "HMAC", hash }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, utf8Encode(text));
  return bytesToHex(new Uint8Array(sig));
}

// AES-256-GCM with a PBKDF2-SHA256 passphrase. A fresh 16-byte salt and 12-byte
// IV each time, packed salt||iv||ciphertext and Base64'd. Iterations are fixed,
// so the token is self-describing enough to decrypt with only the passphrase.
const PBKDF2_ITERS = 210000;

async function deriveAesKey(passphrase: string, salt: Bytes, usage: "encrypt" | "decrypt"): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", utf8Encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERS, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    [usage],
  );
}

async function aesGcmEncrypt(passphrase: string, text: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveAesKey(passphrase, salt, "encrypt");
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, utf8Encode(text));
  const packed = new Uint8Array(16 + 12 + ct.byteLength);
  packed.set(salt, 0);
  packed.set(iv, 16);
  packed.set(new Uint8Array(ct), 28);
  return bytesToBase64(packed);
}

async function aesGcmDecrypt(passphrase: string, token: string): Promise<string> {
  const packed = base64ToBytes(token);
  // 16 salt + 12 IV + at least the 16-byte GCM tag.
  if (packed.length < 44) throw new Error("This does not look like an AES token from this tool.");
  const salt = packed.slice(0, 16);
  const iv = packed.slice(16, 28);
  const ct = packed.slice(28);
  const key = await deriveAesKey(passphrase, salt, "decrypt");
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  return utf8Decode(new Uint8Array(pt));
}

// ── Classical, character-level transforms ────────────────────────────────────

function shiftLetter(code: number, base: number, shift: number): string {
  return String.fromCharCode(((code - base + shift) % 26 + 26) % 26 + base);
}

// Apply a per-letter shift, leaving every non-letter untouched. `shiftFor` is
// asked for the shift to use at each letter position (Caesar ignores position,
// Vigenère advances its key), and returns the shift plus whether to advance.
function mapLetters(text: string, shiftFor: (index: number) => number): string {
  let out = "";
  let index = 0;
  for (const ch of text) {
    const c = ch.charCodeAt(0);
    if (c >= 65 && c <= 90) {
      out += shiftLetter(c, 65, shiftFor(index));
      index++;
    } else if (c >= 97 && c <= 122) {
      out += shiftLetter(c, 97, shiftFor(index));
      index++;
    } else {
      out += ch;
    }
  }
  return out;
}

function caesar(text: string, key: string, dir: 1 | -1): string {
  const n = Number(key.trim());
  if (!Number.isInteger(n)) throw new Error("The Caesar shift must be a whole number.");
  const shift = (((n * dir) % 26) + 26) % 26;
  return mapLetters(text, () => shift);
}

function vigenere(text: string, key: string, dir: 1 | -1): string {
  const letters = key.toLowerCase().replace(/[^a-z]/g, "");
  if (!letters) throw new Error("The Vigenère key must contain letters.");
  return mapLetters(text, (i) => {
    const k = letters.charCodeAt(i % letters.length) - 97;
    return dir === 1 ? k : 26 - k;
  });
}

function xorForward(text: string, key: string): string {
  const kb = utf8Encode(key);
  const tb = utf8Encode(text);
  const out = new Uint8Array(tb.length);
  for (let i = 0; i < tb.length; i++) out[i] = tb[i] ^ kb[i % kb.length];
  return bytesToHex(out);
}

function xorInverse(hexInput: string, key: string): string {
  const kb = utf8Encode(key);
  const data = hexToBytes(hexInput);
  const out = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) out[i] = data[i] ^ kb[i % kb.length];
  return utf8Decode(out);
}

function rot13(text: string): string {
  return mapLetters(text, () => 13);
}

function atbash(text: string): string {
  let out = "";
  for (const ch of text) {
    const c = ch.charCodeAt(0);
    if (c >= 65 && c <= 90) out += String.fromCharCode(90 - (c - 65));
    else if (c >= 97 && c <= 122) out += String.fromCharCode(122 - (c - 97));
    else out += ch;
  }
  return out;
}

function toBinary(text: string): string {
  return [...utf8Encode(text)].map((b) => b.toString(2).padStart(8, "0")).join(" ");
}

function fromBinary(input: string): string {
  const groups = input.trim().split(/\s+/).filter(Boolean);
  const out = new Uint8Array(groups.length);
  for (let i = 0; i < groups.length; i++) {
    if (!/^[01]{8}$/.test(groups[i])) throw new Error("Each binary group must be 8 bits.");
    out[i] = parseInt(groups[i], 2);
  }
  return utf8Decode(out);
}

// Standard ITU Morse for letters, digits and common punctuation.
const MORSE: Record<string, string> = {
  A: ".-", B: "-...", C: "-.-.", D: "-..", E: ".", F: "..-.", G: "--.", H: "....",
  I: "..", J: ".---", K: "-.-", L: ".-..", M: "--", N: "-.", O: "---", P: ".--.",
  Q: "--.-", R: ".-.", S: "...", T: "-", U: "..-", V: "...-", W: ".--", X: "-..-",
  Y: "-.--", Z: "--..",
  "0": "-----", "1": ".----", "2": "..---", "3": "...--", "4": "....-",
  "5": ".....", "6": "-....", "7": "--...", "8": "---..", "9": "----.",
  ".": ".-.-.-", ",": "--..--", "?": "..--..", "'": ".----.", "!": "-.-.--",
  "/": "-..-.", "(": "-.--.", ")": "-.--.-", "&": ".-...", ":": "---...",
  ";": "-.-.-.", "=": "-...-", "+": ".-.-.", "-": "-....-", "_": "..--.-",
  '"': ".-..-.", $: "...-..-", "@": ".--.-.",
};
const MORSE_REVERSE: Record<string, string> = Object.fromEntries(
  Object.entries(MORSE).map(([k, v]) => [v, k]),
);

function toMorse(text: string): string {
  // Words separated by " / ", letters by a single space. Anything with no Morse
  // code (an emoji, say) is dropped rather than faked.
  return text
    .toUpperCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => [...word].map((ch) => MORSE[ch] ?? "").filter(Boolean).join(" "))
    .join(" / ");
}

function fromMorse(input: string): string {
  return input
    .trim()
    .split(/\s*\/\s*/)
    .map((word) =>
      word
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .map((code) => {
          const ch = MORSE_REVERSE[code];
          if (!ch) throw new Error(`Not Morse: "${code}"`);
          return ch;
        })
        .join(""),
    )
    .filter(Boolean)
    .join(" ");
}

// ── Registry ─────────────────────────────────────────────────────────────────

export type OpCategory = "digest" | "hmac" | "encode" | "cipher" | "encrypt";
export type KeyNeed = "none" | "required";

export interface AlgoMeta {
  id: string;
  label: string;
  category: OpCategory;
  /** Supports a reverse (decode / decrypt) direction. */
  reversible: boolean;
  key: KeyNeed;
  /** Placeholder / label for the key field, when one is needed. */
  keyLabel: string;
  /** One-line description shown in the UI. */
  blurb: string;
}

interface Impl {
  meta: Omit<AlgoMeta, "reversible">;
  forward: (text: string, key: string) => string | Promise<string>;
  inverse?: (text: string, key: string) => string | Promise<string>;
  /** Extra line shown under a successful result (e.g. cipher strength). */
  note?: string;
}

const IMPLS: Impl[] = [
  // DIGEST — one-way
  { meta: { id: "md5", label: "MD5", category: "digest", key: "none", keyLabel: "", blurb: "128-bit legacy digest. Broken for security, still common in IOCs." },
    forward: (t) => md5Hex(utf8Encode(t)) },
  { meta: { id: "sha1", label: "SHA-1", category: "digest", key: "none", keyLabel: "", blurb: "160-bit digest. Collision-broken; avoid for new work." },
    forward: (t) => subtleDigest("SHA-1", utf8Encode(t)) },
  { meta: { id: "sha256", label: "SHA-256", category: "digest", key: "none", keyLabel: "", blurb: "The everyday secure digest. 256-bit output." },
    forward: (t) => subtleDigest("SHA-256", utf8Encode(t)) },
  { meta: { id: "sha384", label: "SHA-384", category: "digest", key: "none", keyLabel: "", blurb: "Truncated SHA-512, 384-bit output." },
    forward: (t) => subtleDigest("SHA-384", utf8Encode(t)) },
  { meta: { id: "sha512", label: "SHA-512", category: "digest", key: "none", keyLabel: "", blurb: "512-bit digest, strong margin." },
    forward: (t) => subtleDigest("SHA-512", utf8Encode(t)) },

  // HMAC — keyed, one-way
  { meta: { id: "hmac-sha256", label: "HMAC-SHA256", category: "hmac", key: "required", keyLabel: "Secret key", blurb: "Keyed authentication tag over the text." },
    forward: (t, k) => hmacHex("SHA-256", k, t) },
  { meta: { id: "hmac-sha512", label: "HMAC-SHA512", category: "hmac", key: "required", keyLabel: "Secret key", blurb: "Keyed authentication tag, 512-bit." },
    forward: (t, k) => hmacHex("SHA-512", k, t) },

  // ENCODE — reversible, no secret
  { meta: { id: "base64", label: "Base64", category: "encode", key: "none", keyLabel: "", blurb: "Standard Base64. Encoding, not encryption." },
    forward: (t) => bytesToBase64(utf8Encode(t)), inverse: (t) => utf8Decode(base64ToBytes(t)) },
  { meta: { id: "base64url", label: "Base64 URL", category: "encode", key: "none", keyLabel: "", blurb: "URL-safe Base64 (-_, no padding)." },
    forward: (t) => bytesToBase64(utf8Encode(t), true), inverse: (t) => utf8Decode(base64ToBytes(t)) },
  { meta: { id: "hex", label: "Hex", category: "encode", key: "none", keyLabel: "", blurb: "Hexadecimal of the UTF-8 bytes." },
    forward: (t) => bytesToHex(utf8Encode(t)), inverse: (t) => utf8Decode(hexToBytes(t)) },
  { meta: { id: "url", label: "URL encode", category: "encode", key: "none", keyLabel: "", blurb: "Percent-encoding for query strings." },
    forward: (t) => encodeURIComponent(t), inverse: (t) => decodeURIComponent(t) },
  { meta: { id: "binary", label: "Binary", category: "encode", key: "none", keyLabel: "", blurb: "8-bit binary of each byte, space-separated." },
    forward: (t) => toBinary(t), inverse: (t) => fromBinary(t) },
  { meta: { id: "morse", label: "Morse", category: "encode", key: "none", keyLabel: "", blurb: "ITU Morse. Letters, digits, punctuation." },
    forward: (t) => toMorse(t), inverse: (t) => fromMorse(t) },
  { meta: { id: "rot13", label: "ROT13", category: "encode", key: "none", keyLabel: "", blurb: "Rotate letters by 13. Its own inverse." },
    forward: (t) => rot13(t), inverse: (t) => rot13(t) },
  { meta: { id: "atbash", label: "Atbash", category: "encode", key: "none", keyLabel: "", blurb: "Mirror the alphabet (A↔Z). Its own inverse." },
    forward: (t) => atbash(t), inverse: (t) => atbash(t) },

  // CIPHER — reversible, keyed, classical (breakable)
  { meta: { id: "caesar", label: "Caesar shift", category: "cipher", key: "required", keyLabel: "Shift (a whole number)", blurb: "Shift every letter by N. Trivially broken." },
    forward: (t, k) => caesar(t, k, 1), inverse: (t, k) => caesar(t, k, -1), note: "Classical cipher — for teaching and puzzles, not real secrecy." },
  { meta: { id: "vigenere", label: "Vigenère", category: "cipher", key: "required", keyLabel: "Keyword (letters)", blurb: "Keyword-driven letter shifts. Classical." },
    forward: (t, k) => vigenere(t, k, 1), inverse: (t, k) => vigenere(t, k, -1), note: "Classical cipher — for teaching and puzzles, not real secrecy." },
  { meta: { id: "xor", label: "XOR", category: "cipher", key: "required", keyLabel: "Key", blurb: "Repeating-key XOR. Output is hex. Classical." },
    forward: (t, k) => xorForward(t, k), inverse: (t, k) => xorInverse(t, k), note: "Repeating-key XOR is weak; use AES-GCM for real secrecy." },

  // ENCRYPT — reversible, keyed, real
  { meta: { id: "aes-gcm", label: "AES-256-GCM", category: "encrypt", key: "required", keyLabel: "Passphrase", blurb: "Authenticated AES with a PBKDF2 passphrase." },
    forward: (t, k) => aesGcmEncrypt(k, t), inverse: (t, k) => aesGcmDecrypt(k, t),
    note: "AES-256-GCM · PBKDF2-SHA256 (210k) · authenticated. A wrong passphrase fails; it never returns garbage." },
];

const IMPL_BY_ID = new Map(IMPLS.map((impl) => [impl.meta.id, impl]));

export const CRYPTO_ALGOS: AlgoMeta[] = IMPLS.map((impl) => ({ ...impl.meta, reversible: !!impl.inverse }));

export interface CategoryMeta {
  id: OpCategory;
  label: string;
  blurb: string;
}

// Order and copy for the category selector.
export const CRYPTO_CATEGORIES: CategoryMeta[] = [
  { id: "digest", label: "Hash / digest", blurb: "One-way fingerprint of the text. Cannot be reversed." },
  { id: "hmac", label: "HMAC", blurb: "Keyed one-way authentication tag." },
  { id: "encode", label: "Encode / decode", blurb: "Reversible representation change. No secret, no security." },
  { id: "cipher", label: "Classical cipher", blurb: "Reversible with a key, but breakable. Teaching and puzzles." },
  { id: "encrypt", label: "Encrypt / decrypt", blurb: "Real, authenticated encryption with a passphrase." },
];

export function algosInCategory(category: OpCategory): AlgoMeta[] {
  return CRYPTO_ALGOS.filter((a) => a.category === category);
}

export interface RunInput {
  algo: string;
  text: string;
  key: string;
  /** Reverse direction (decode / decrypt). Ignored by one-way algorithms. */
  decrypt: boolean;
}

export type RunResult =
  | { ok: true; output: string; note?: string }
  | { ok: false; error: string };

/** Normalise a caught throw to a message. Exported so both arms are testable. */
export function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Operation failed.";
}

/**
 * Run one workbench operation. Never throws: every failure (unknown algorithm,
 * missing key, malformed input, wrong passphrase) comes back as a typed error so
 * the UI can show it inline. The plaintext and key stay in this process.
 */
export async function runCrypto(input: RunInput): Promise<RunResult> {
  const impl = IMPL_BY_ID.get(input.algo);
  if (!impl) return { ok: false, error: "Unknown algorithm." };

  const decrypt = input.decrypt;
  if (decrypt && !impl.inverse) {
    return { ok: false, error: "This is a one-way operation; there is nothing to reverse." };
  }
  if (impl.meta.key === "required" && !input.key.trim()) {
    return { ok: false, error: `A ${impl.meta.keyLabel.toLowerCase()} is required.` };
  }

  try {
    const run = decrypt ? impl.inverse! : impl.forward;
    const output = await run(input.text, input.key);
    return impl.note ? { ok: true, output, note: impl.note } : { ok: true, output };
  } catch (err) {
    return { ok: false, error: errMessage(err) };
  }
}
