import { describe, it, expect } from "vitest";
import {
  keccak256, namehash, reverseNode, toHex, isEnsName,
  encodeResolver, encodeName, encodeAddr, decodeAddress, decodeEnsName, ENS_REGISTRY,
} from "@/lib/analysis/ens";

const enc = (s: string) => new TextEncoder().encode(s);

// Build an ABI-encoded `string` return (offset word, length word, padded data).
function abiString(s: string): string {
  const bytes = enc(s);
  const offset = (32).toString(16).padStart(64, "0");
  const len = bytes.length.toString(16).padStart(64, "0");
  let data = "";
  for (const b of bytes) data += b.toString(16).padStart(2, "0");
  data = data.padEnd(Math.ceil((data.length || 1) / 64) * 64, "0");
  return "0x" + offset + len + data;
}
const addrWord = (addr: string) => "0x" + "0".repeat(24) + addr.replace(/^0x/, "").toLowerCase();

describe("keccak256", () => {
  it("matches Ethereum's keccak-256 test vectors", () => {
    expect(toHex(keccak256(enc("")))).toBe("c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470");
    expect(toHex(keccak256(enc("abc")))).toBe("4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45");
  });
});

describe("namehash / reverseNode", () => {
  it("hashes the root to 32 zero bytes and 'eth' to its known node", () => {
    expect(toHex(namehash(""))).toBe("00".repeat(32));
    expect(toHex(namehash("eth"))).toBe("93cdeb708b7545dc668eb9280176169d1c33cfd8ed6f04690a0bcc88a93fc4ae");
  });
  it("computes the reverse node for an address", () => {
    expect(toHex(reverseNode("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045")))
      .toBe("7aef81fbd30c83431369026d62ee533af8b69f246b63d75b40fe223346e6fa9a");
  });
});

describe("isEnsName", () => {
  it("recognises .eth names case-insensitively and rejects everything else", () => {
    expect(isEnsName("vitalik.eth")).toBe(true);
    expect(isEnsName("SUB.VITALIK.ETH")).toBe(true);
    expect(isEnsName("  nick.eth  ")).toBe(true);
    expect(isEnsName("vitalik.com")).toBe(false);
    expect(isEnsName("vitalik")).toBe(false);
    expect(isEnsName("foo.ethx")).toBe(false);
    expect(isEnsName("bad name.eth")).toBe(false); // space is not a label char
  });
});

describe("call encoders", () => {
  it("prefix each call with the right 4-byte selector and the 32-byte node", () => {
    const node = namehash("vitalik.eth");
    expect(encodeResolver(node).startsWith("0x0178b8bf")).toBe(true);
    expect(encodeName(node).startsWith("0x691f3431")).toBe(true);
    expect(encodeAddr(node).startsWith("0x3b3b57de")).toBe(true);
    expect(encodeResolver(node)).toBe("0x0178b8bf" + toHex(node));
    expect(ENS_REGISTRY).toMatch(/^0x0{11}C2E074eC69A0dFb2997BA6C7d2e1e$/);
  });
});

describe("decodeAddress", () => {
  it("reads the low 20 bytes of a 32-byte word", () => {
    expect(decodeAddress(addrWord("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045")))
      .toBe("0xd8da6bf26964af9d7eed9e03e53415d37aa96045");
  });
  it("returns null for the zero address, short, non-hex and non-string input", () => {
    expect(decodeAddress("0x" + "0".repeat(64))).toBeNull(); // zero address
    expect(decodeAddress("0x1234")).toBeNull();               // too short
    expect(decodeAddress("0x" + "z".repeat(64))).toBeNull();  // not hex
    expect(decodeAddress(42)).toBeNull();                     // not a string
  });
});

describe("decodeEnsName", () => {
  it("decodes an ABI-encoded string", () => {
    expect(decodeEnsName(abiString("vitalik.eth"))).toBe("vitalik.eth");
  });
  it("rejects empty, control-char, truncated and non-string returns", () => {
    expect(decodeEnsName(abiString(""))).toBeNull();       // length 0
    expect(decodeEnsName(abiString("badname"))).toBeNull(); // control char
    expect(decodeEnsName("0x")).toBeNull();                // too short for offset+len
    expect(decodeEnsName(null)).toBeNull();                // not a string
    // Claims length 4 but carries no data bytes → truncated → null.
    expect(decodeEnsName("0x" + "0".repeat(62) + "20" + (4).toString(16).padStart(64, "0"))).toBeNull();
    // Non-numeric length word → NaN → null.
    expect(decodeEnsName("0x" + "0".repeat(62) + "20" + "z".repeat(64) + "00".repeat(8))).toBeNull();
  });
});
