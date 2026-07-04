// Shared lookup-mode registry — single source of truth for the tab switcher,
// command palette, and auto-detection.

export type Mode = "phone" | "email" | "username" | "ip" | "domain" | "bulk" | "graph" | "cases";

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
  { id: "bulk",     label: "BULK",     glyph: "≡",  lookup: false },
  { id: "graph",    label: "GRAPH",    glyph: "🕸", lookup: false },
  { id: "cases",    label: "CASES",    glyph: "🗂", lookup: false },
];

export const LOOKUP_MODES = MODES.filter((m) => m.lookup);

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
  if (/^(?!-)[a-zA-Z0-9-]{1,63}(\.[a-zA-Z0-9-]{2,})+$/.test(s)) return "domain";
  return "username";
}
