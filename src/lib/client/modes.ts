// Shared lookup-mode registry — single source of truth for the tab switcher,
// command palette, and auto-detection.

import { detectChain } from "../analysis/wallet";
import { detectHashKind } from "../analysis/hash";
import { isEnsName } from "../analysis/ens";

export type Mode = "phone" | "email" | "username" | "ip" | "domain" | "wallet" | "hash" | "image" | "bulk" | "graph" | "cases";

export interface ModeMeta {
  id: Mode;
  label: string;
  glyph: string;       // emoji/symbol used in the tab chips
  /** lookup modes that take a single input + hit an API */
  lookup: boolean;
  placeholder?: string;
}

export const MODES: ModeMeta[] = [
  { id: "phone",    label: "PHONE",    glyph: "📡", lookup: true,  placeholder: "+1 415 555 2671" },
  { id: "email",    label: "EMAIL",    glyph: "✉",  lookup: true,  placeholder: "target@domain.com" },
  { id: "username", label: "USERNAME", glyph: "@",  lookup: true,  placeholder: "handle (no @)" },
  { id: "ip",       label: "IP",       glyph: "⦿",  lookup: true,  placeholder: "8.8.8.8 or IPv6" },
  { id: "domain",   label: "DOMAIN",   glyph: "🌐", lookup: true,  placeholder: "example.com" },
  { id: "wallet",   label: "WALLET",   glyph: "🪙", lookup: true,  placeholder: "0x… or bc1… / 1…" },
  { id: "hash",     label: "HASH",     glyph: "#",  lookup: true,  placeholder: "MD5 / SHA-1 / SHA-256 digest" },
  // Client-only: EXIF/GPS is parsed in the browser and the image is never
  // uploaded, so this takes no single string input and hits no API.
  { id: "image",    label: "IMAGE",    glyph: "📷", lookup: false },
  { id: "bulk",     label: "BULK",     glyph: "≡",  lookup: false },
  { id: "graph",    label: "GRAPH",    glyph: "🕸", lookup: false },
  { id: "cases",    label: "CASES",    glyph: "🗂", lookup: false },
];

export const LOOKUP_MODES = MODES.filter((m) => m.lookup);

// Labels are canonical UPPERCASE for the tab chips. A few are acronyms that must
// stay whole in a proper-case menu: naive title-casing turns "IP" into "Ip".
const ACRONYM_LABELS = new Set(["IP"]);

/**
 * Proper-case label for menus (the command palette's "Switch mode" list).
 * Title-cases an ordinary word ("PHONE" to "Phone") but keeps an acronym intact
 * ("IP", never "Ip"). Add future acronym labels to ACRONYM_LABELS.
 */
export function modeName(m: ModeMeta): string {
  return ACRONYM_LABELS.has(m.label)
    ? m.label
    : m.label.charAt(0) + m.label.slice(1).toLowerCase();
}

/** Narrow an untrusted string (a URL parameter) to a Mode, or null. */
export function toMode(raw: string | null | undefined): Mode | null {
  return MODES.some((m) => m.id === raw) ? (raw as Mode) : null;
}

/**
 * Best-effort guess of which lookup mode a raw string belongs to.
 * Used by the command palette's "smart run".
 */
export function detectMode(raw: string): Mode {
  const s = raw.trim();
  // Order matters. Email (has "@") and IP (dotted-quad or hex:colon) are checked
  // before phone: the permissive phone pattern also matches a dotted IPv4 like
  // "8.8.8.8" ("8" + ".8.8.8"), so IP must win first or IPs misroute to phone.
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return "email";
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(s) || (/:/.test(s) && /^[0-9a-fA-F:]+$/.test(s))) return "ip";
  if (/^\+?\d[\d\s().-]{6,}$/.test(s)) return "phone";
  // A crypto address (0x… ETH, or a BTC legacy/bech32 address) is unambiguous
  // and would otherwise fall through to username, so it is checked before both
  // domain and username. It contains no dot, so it never collides with domain.
  if (detectChain(s)) return "wallet";
  // A `*.eth` ENS name resolves to an Ethereum address, so it belongs to wallet
  // mode. It matches the domain pattern too, so it must be checked before domain.
  if (isEnsName(s)) return "wallet";
  // A bare 32/40/64-char hex digest is an unambiguous file hash. It has no dot
  // and would otherwise fall through to username, so it is checked before both.
  if (detectHashKind(s)) return "hash";
  if (/^(?!-)[a-zA-Z0-9-]{1,63}(\.[a-zA-Z0-9-]{2,})+$/.test(s)) return "domain";
  return "username";
}
