import { describe, it, expect } from "vitest";
import { createHash, createHmac, randomBytes } from "node:crypto";
import {
  utf8Encode, utf8Decode, bytesToHex, hexToBytes, bytesToBase64, base64ToBytes,
  md5Hex, errMessage,
  runCrypto, CRYPTO_ALGOS, CRYPTO_CATEGORIES, algosInCategory,
} from "@/lib/analysis/cryptoLab";

// A spread of inputs: empty, ASCII, unicode, emoji, a long paragraph, and
// exact byte lengths around the hash block boundaries (55/56/63/64/65).
const SAMPLES = [
  "",
  "a",
  "abc",
  "The quick brown fox jumps over the lazy dog",
  "café — naïve — Zürich",
  "emoji 😀🔐🌍 mixed with ascii",
  "x".repeat(1000),
  "Lorem ipsum dolor sit amet, consectetur adipiscing elit. ".repeat(20),
];

describe("byte primitives", () => {
  it("hex round-trips and matches Node Buffer", () => {
    for (const s of SAMPLES) {
      const bytes = utf8Encode(s);
      const hex = bytesToHex(bytes);
      expect(hex).toBe(Buffer.from(s, "utf8").toString("hex"));
      expect(utf8Decode(hexToBytes(hex))).toBe(s);
    }
  });

  it("bytesToHex zero-pads bytes below 16", () => {
    expect(bytesToHex(Uint8Array.from([0, 15, 16, 255]))).toBe("000f10ff");
  });

  it("hexToBytes tolerates whitespace and casing", () => {
    expect([...hexToBytes("00 0F\t10 FF")]).toEqual([0, 15, 16, 255]);
  });

  it("hexToBytes rejects odd length and non-hex", () => {
    expect(() => hexToBytes("abc")).toThrow(/even number/);
    expect(() => hexToBytes("zz")).toThrow(/not valid hex/i);
  });

  it("base64 round-trips and matches Node Buffer for every length residue", () => {
    for (const s of SAMPLES) {
      const std = bytesToBase64(utf8Encode(s));
      expect(std).toBe(Buffer.from(s, "utf8").toString("base64"));
      expect(utf8Decode(base64ToBytes(std))).toBe(s);
    }
  });

  it("base64 encodes 1, 2 and 3 byte tails with correct padding", () => {
    expect(bytesToBase64(Uint8Array.from([1]))).toBe("AQ==");
    expect(bytesToBase64(Uint8Array.from([1, 2]))).toBe("AQI=");
    expect(bytesToBase64(Uint8Array.from([1, 2, 3]))).toBe("AQID");
  });

  it("base64url uses -_ and drops padding, and decodes back either way", () => {
    const bytes = Uint8Array.from([251, 255, 191]); // forces + and / in standard
    const url = bytesToBase64(bytes, true);
    expect(url).not.toMatch(/[+/=]/);
    expect([...base64ToBytes(url)]).toEqual([...bytes]);
    // The standard form of the same bytes still decodes.
    expect([...base64ToBytes(bytesToBase64(bytes))]).toEqual([...bytes]);
  });

  it("base64ToBytes handles a single char (no full byte) and rejects junk", () => {
    expect(base64ToBytes("A").length).toBe(0); // 6 bits, no byte emitted
    expect(() => base64ToBytes("****")).toThrow(/not valid Base64/i);
  });
});

describe("MD5 (verified against Node crypto)", () => {
  it("matches a known vector", () => {
    expect(md5Hex(utf8Encode(""))).toBe("d41d8cd98f00b204e9800998ecf8427e");
    expect(md5Hex(utf8Encode("abc"))).toBe("900150983cd24fb0d6963f7d28e17f72");
  });

  it("matches Node for every byte length across the padding boundaries", () => {
    for (let len = 0; len <= 130; len++) {
      const bytes = randomBytes(len);
      const mine = md5Hex(new Uint8Array(bytes));
      const node = createHash("md5").update(bytes).digest("hex");
      expect(mine, `len ${len}`).toBe(node);
    }
  });

  it("matches Node for unicode text samples", () => {
    for (const s of SAMPLES) {
      expect(md5Hex(utf8Encode(s))).toBe(createHash("md5").update(Buffer.from(s, "utf8")).digest("hex"));
    }
  });
});

describe("registry", () => {
  it("groups every algorithm under a known category", () => {
    const cats = new Set(CRYPTO_CATEGORIES.map((c) => c.id));
    for (const a of CRYPTO_ALGOS) expect(cats.has(a.category)).toBe(true);
    // Every category advertises at least one algorithm.
    for (const c of CRYPTO_CATEGORIES) expect(algosInCategory(c.id).length).toBeGreaterThan(0);
  });

  it("marks reversibility correctly", () => {
    expect(CRYPTO_ALGOS.find((a) => a.id === "md5")!.reversible).toBe(false);
    expect(CRYPTO_ALGOS.find((a) => a.id === "aes-gcm")!.reversible).toBe(true);
  });
});

async function fwd(algo: string, text: string, key = ""): Promise<string> {
  const r = await runCrypto({ algo, text, key, decrypt: false });
  if (!r.ok) throw new Error(r.error);
  return r.output;
}
async function inv(algo: string, text: string, key = ""): Promise<string> {
  const r = await runCrypto({ algo, text, key, decrypt: true });
  if (!r.ok) throw new Error(r.error);
  return r.output;
}

describe("digests via runCrypto match Node", () => {
  const pairs: [string, string][] = [
    ["sha1", "sha1"], ["sha256", "sha256"], ["sha384", "sha384"], ["sha512", "sha512"],
  ];
  it("SHA family agrees with Node for all samples", async () => {
    for (const [algo, nodeName] of pairs) {
      for (const s of SAMPLES) {
        expect(await fwd(algo, s)).toBe(createHash(nodeName).update(Buffer.from(s, "utf8")).digest("hex"));
      }
    }
  });

  it("md5 through the dispatcher agrees with Node", async () => {
    expect(await fwd("md5", "hello")).toBe(createHash("md5").update("hello").digest("hex"));
  });
});

describe("HMAC via runCrypto matches Node", () => {
  it("HMAC-SHA256 / SHA512 agree with Node", async () => {
    for (const s of SAMPLES) {
      expect(await fwd("hmac-sha256", s, "s3cret")).toBe(createHmac("sha256", "s3cret").update(Buffer.from(s, "utf8")).digest("hex"));
      expect(await fwd("hmac-sha512", s, "s3cret")).toBe(createHmac("sha512", "s3cret").update(Buffer.from(s, "utf8")).digest("hex"));
    }
  });
});

describe("reversible encoders round-trip", () => {
  const encoders = ["base64", "base64url", "hex", "url", "binary"];
  it("decode(encode(x)) === x for every sample", async () => {
    for (const algo of encoders) {
      for (const s of SAMPLES) {
        expect(await inv(algo, await fwd(algo, s)), `${algo} / ${JSON.stringify(s)}`).toBe(s);
      }
    }
  });

  it("base64 output matches Node", async () => {
    expect(await fwd("base64", "hello world")).toBe(Buffer.from("hello world").toString("base64"));
  });

  it("binary produces 8-bit groups and rejects a malformed group on decode", async () => {
    expect(await fwd("binary", "A")).toBe("01000001");
    const bad = await runCrypto({ algo: "binary", text: "0100000", key: "", decrypt: true });
    expect(bad.ok).toBe(false);
    expect((bad as { error: string }).error).toMatch(/8 bits/);
  });

  it("url decode surfaces a malformed sequence as an error", async () => {
    const r = await runCrypto({ algo: "url", text: "%E0%A4%A", key: "", decrypt: true });
    expect(r.ok).toBe(false);
  });
});

describe("Morse", () => {
  it("encodes and decodes with word breaks", async () => {
    expect(await fwd("morse", "SOS HI")).toBe("... --- ... / .... ..");
    expect(await inv("morse", "... --- ... / .... ..")).toBe("SOS HI");
  });

  it("uppercases on the round trip and drops characters with no code", async () => {
    // The emoji has no Morse code and is dropped; letters survive uppercased.
    expect(await inv("morse", await fwd("morse", "Hello 😀 World"))).toBe("HELLO WORLD");
  });

  it("rejects a token that is not Morse", async () => {
    const r = await runCrypto({ algo: "morse", text: "...---... ..--..--..", key: "", decrypt: true });
    expect(r.ok).toBe(false);
    expect((r as { error: string }).error).toMatch(/Not Morse/);
  });
});

describe("self-inverse letter ciphers", () => {
  it("ROT13 and Atbash are their own inverse and preserve non-letters", async () => {
    const s = "Attack at Dawn! 123";
    expect(await inv("rot13", await fwd("rot13", s))).toBe(s);
    expect(await fwd("rot13", "abc")).toBe("nop");
    expect(await inv("atbash", await fwd("atbash", s))).toBe(s);
    expect(await fwd("atbash", "az AZ")).toBe("za ZA");
  });
});

describe("Caesar & Vigenère", () => {
  it("Caesar shifts and reverses, preserving case and punctuation", async () => {
    expect(await fwd("caesar", "abcXYZ!", "3")).toBe("defABC!");
    expect(await inv("caesar", "defABC!", "3")).toBe("abcXYZ!");
    // Negative and large shifts normalise.
    expect(await inv("caesar", await fwd("caesar", "Hello", "29"), "29")).toBe("Hello");
  });

  it("Caesar rejects a non-numeric shift", async () => {
    const r = await runCrypto({ algo: "caesar", text: "hi", key: "abc", decrypt: false });
    expect(r.ok).toBe(false);
    expect((r as { error: string }).error).toMatch(/whole number/);
  });

  it("Vigenère round-trips and matches a known vector", async () => {
    // Classic ATTACKATDAWN / LEMON -> LXFOPVEFRNHR
    expect(await fwd("vigenere", "ATTACKATDAWN", "LEMON")).toBe("LXFOPVEFRNHR");
    expect(await inv("vigenere", "LXFOPVEFRNHR", "LEMON")).toBe("ATTACKATDAWN");
    const s = "Mixed Case, With Punctuation!";
    expect(await inv("vigenere", await fwd("vigenere", s, "key"), "key")).toBe(s);
  });

  it("Vigenère rejects a key with no letters", async () => {
    const r = await runCrypto({ algo: "vigenere", text: "hi", key: "12345", decrypt: false });
    expect(r.ok).toBe(false);
    expect((r as { error: string }).error).toMatch(/must contain letters/);
  });
});

describe("XOR", () => {
  it("round-trips through hex for unicode and rejects bad hex on decode", async () => {
    for (const s of SAMPLES) {
      expect(await inv("xor", await fwd("xor", s, "k3y"), "k3y")).toBe(s);
    }
    const r = await runCrypto({ algo: "xor", text: "nothex!!", key: "k", decrypt: true });
    expect(r.ok).toBe(false);
  });
});

describe("AES-256-GCM", () => {
  it("encrypts then decrypts a large paragraph with the right passphrase", async () => {
    const secret = "Correct Horse Battery Staple 🔐";
    const plaintext = SAMPLES[7]; // the long paragraph
    const token = await fwd("aes-gcm", plaintext, secret);
    expect(token).not.toContain(plaintext);
    expect(await inv("aes-gcm", token, secret)).toBe(plaintext);
  });

  it("produces a different token each time but both decrypt (random salt/iv)", async () => {
    const t1 = await fwd("aes-gcm", "same text", "pw");
    const t2 = await fwd("aes-gcm", "same text", "pw");
    expect(t1).not.toBe(t2);
    expect(await inv("aes-gcm", t1, "pw")).toBe("same text");
    expect(await inv("aes-gcm", t2, "pw")).toBe("same text");
  });

  it("fails on a wrong passphrase rather than returning garbage", async () => {
    const token = await fwd("aes-gcm", "top secret", "right");
    const r = await runCrypto({ algo: "aes-gcm", text: token, key: "wrong", decrypt: true });
    expect(r.ok).toBe(false);
  });

  it("fails on a tampered token", async () => {
    const token = await fwd("aes-gcm", "top secret", "pw");
    const flipped = token.slice(0, -2) + (token.endsWith("A") ? "B" : "A") + token.slice(-1);
    const r = await runCrypto({ algo: "aes-gcm", text: flipped, key: "pw", decrypt: true });
    expect(r.ok).toBe(false);
  });

  it("rejects a token that is too short to be one of ours", async () => {
    const r = await runCrypto({ algo: "aes-gcm", text: bytesToBase64(Uint8Array.from([1, 2, 3])), key: "pw", decrypt: true });
    expect(r.ok).toBe(false);
    expect((r as { error: string }).error).toMatch(/AES token/);
  });

  it("carries the descriptive note on success", async () => {
    const r = await runCrypto({ algo: "aes-gcm", text: "hi", key: "pw", decrypt: false });
    expect(r.ok && r.note).toMatch(/AES-256-GCM/);
  });
});

describe("dispatcher guards", () => {
  it("errors on an unknown algorithm", async () => {
    const r = await runCrypto({ algo: "nope", text: "x", key: "", decrypt: false });
    expect(r).toEqual({ ok: false, error: "Unknown algorithm." });
  });

  it("refuses to reverse a one-way operation", async () => {
    const r = await runCrypto({ algo: "sha256", text: "x", key: "", decrypt: true });
    expect(r.ok).toBe(false);
    expect((r as { error: string }).error).toMatch(/one-way/);
  });

  it("requires a key when the algorithm needs one", async () => {
    const r = await runCrypto({ algo: "hmac-sha256", text: "x", key: "   ", decrypt: false });
    expect(r.ok).toBe(false);
    expect((r as { error: string }).error).toMatch(/required/);
  });

  it("returns a result with no note for a plain digest", async () => {
    const r = await runCrypto({ algo: "sha256", text: "x", key: "", decrypt: false });
    expect(r.ok).toBe(true);
    expect((r as { note?: string }).note).toBeUndefined();
  });
});

describe("errMessage", () => {
  it("uses an Error's message and falls back for non-Errors", () => {
    expect(errMessage(new Error("boom"))).toBe("boom");
    expect(errMessage("just a string")).toBe("Operation failed.");
  });
});
