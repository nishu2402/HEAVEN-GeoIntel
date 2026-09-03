// ── Operational-security disclosure — pure per-mode footprint model ──────────
//
// Every lookup leaves a footprint: it tells one or more third parties what you
// are investigating, and a few kinds of lookup touch the target directly. An
// analyst should be able to see that footprint before they run a query, not
// guess at it. This module states it plainly, per mode, deriving the third-party
// list from the same source manifest the lookups actually use so it can't drift.
//
// The one hard line: only the domain HTTP/TLS probe connects to the target. Every
// other mode consults third-party databases about the identifier and never
// contacts the subject, and image mode never leaves the browser at all.

import type { Mode } from "../client/modes";
import { sourcesForMode } from "../sources/manifest";

interface OpsecMeta {
  /** Display label. */
  label: string;
  /** Does any part of this lookup connect to the target/subject directly? */
  contactsTarget: boolean;
  /** What specifically touches the target, when it does. */
  targetNote: string | null;
  /** Fully in-browser — nothing leaves the machine, no upstream is called. */
  clientSide: boolean;
  note: string;
}

const META: Partial<Record<Mode, OpsecMeta>> = {
  phone: {
    label: "Phone", contactsTarget: false, targetNote: null, clientSide: false,
    note: "The number is never dialed or texted: only breach and OSINT databases are queried.",
  },
  email: {
    label: "Email", contactsTarget: false, targetNote: null, clientSide: false,
    note: "No mail is sent to the address. Keyed SMTP/MX validators, if you configure them, do connect to the mail server.",
  },
  username: {
    label: "Username", contactsTarget: false, targetNote: null, clientSide: false,
    note: "Public profile URLs are requested server-side, so the platforms log the tool's server IP, not your browser's.",
  },
  ip: {
    label: "IP", contactsTarget: false, targetNote: null, clientSide: false,
    note: "The address is not pinged or port-scanned: only passive databases are consulted.",
  },
  domain: {
    label: "Domain", contactsTarget: true,
    targetNote: "The HTTP/TLS posture probe connects directly to the domain, so the target's own logs record a request from the tool's server IP.",
    clientSide: false,
    note: "DNS, RDAP, certificate transparency and Wayback are third-party; only the live HTTP/TLS probe touches the target.",
  },
  wallet: {
    label: "Wallet", contactsTarget: false, targetNote: null, clientSide: false,
    note: "Public-ledger reads and on-chain ENS resolution only: the address owner is never contacted.",
  },
  hash: {
    label: "Hash", contactsTarget: false, targetNote: null, clientSide: false,
    note: "Only a hash-reputation database is queried; no file is ever uploaded.",
  },
  image: {
    label: "Image / EXIF", contactsTarget: false, targetNote: null, clientSide: true,
    note: "EXIF and GPS are parsed entirely in your browser: the image never leaves your machine.",
  },
};

export interface OpsecProfile {
  mode: Mode;
  label: string;
  contactsTarget: boolean;
  targetNote: string | null;
  clientSide: boolean;
  /** The always-on (keyless) third parties this mode discloses your query to. */
  thirdParties: string[];
  note: string;
}

/** The opsec footprint of one mode, or null for a mode with no footprint model. */
export function opsecProfile(mode: Mode): OpsecProfile | null {
  const m = META[mode];
  if (!m) return null;
  return {
    mode,
    label: m.label,
    contactsTarget: m.contactsTarget,
    targetNote: m.targetNote,
    clientSide: m.clientSide,
    thirdParties: sourcesForMode(mode).filter((s) => s.tier === "free").map((s) => s.name),
    note: m.note,
  };
}

/** Every mode that has a footprint model, in a stable disclosure order. */
export function lookupOpsecProfiles(): OpsecProfile[] {
  const order: Mode[] = ["phone", "email", "username", "ip", "domain", "wallet", "hash", "image"];
  return order.map(opsecProfile).filter((p): p is OpsecProfile => p !== null);
}

/** Instance-wide opsec facts, independent of which mode you are in. */
export const GLOBAL_OPSEC_NOTES: string[] = [
  "Lookups run server-side, so upstreams see this instance's IP: not your browser's. Run the tool from a VPN or VPS if attribution matters.",
  "No subject is notified of a lookup. The one exception is the domain HTTP/TLS probe, which connects to the target's server directly.",
  "Configure no API keys to stay fully keyless. Phone analysis and the bundled datasets work with no network at all.",
  "Investigate only identifiers you are authorized to. This tool returns public metadata for research and authorized testing: not surveillance.",
];
