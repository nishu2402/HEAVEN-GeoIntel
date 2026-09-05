// ── Mail-exchange fingerprinting (keyless, corroboration only) ───────────────
//
// Given a domain's MX records, name the service that actually receives its mail
// (Google Workspace, Microsoft 365, Proofpoint, a self-managed server, …). This
// is a keyless corroboration signal for email mode: it describes the DOMAIN's
// mail infrastructure, never that a specific address exists. An MX record is a
// public fact; the provider is read from well-known, unambiguous host suffixes,
// so a match is a real attribution and an unrecognized host is reported as
// "self-managed or unrecognized", never guessed into a brand.
//
// Pure and data-driven so every branch is tested with crafted input rather than
// whatever a live domain publishes today.

import type { MailProviderCategory, MailProviderData } from "../types";

/** One MX record as the resolver hands it back, before normalization. */
export interface MxHost {
  host: string;
  priority: number | null;
}

interface Signature {
  /** Host suffixes (each with a leading dot) that identify this provider. */
  suffixes: string[];
  category: MailProviderCategory;
  label: string;
}

// Ordered most-specific first. Every suffix begins with a dot so it matches a
// mail-exchanger subdomain and never a bare apex, which keeps the match to a
// real signature rather than a loose substring.
const SIGNATURES: Signature[] = [
  { suffixes: [".google.com", ".googlemail.com"], category: "google", label: "Google Workspace" },
  { suffixes: [".protection.outlook.com"], category: "microsoft", label: "Microsoft 365" },
  { suffixes: [".pphosted.com", ".ppe-hosted.com"], category: "proofpoint", label: "Proofpoint" },
  { suffixes: [".mimecast.com", ".mimecast.co.za"], category: "mimecast", label: "Mimecast" },
  { suffixes: [".zoho.com", ".zoho.eu", ".zohomail.com"], category: "zoho", label: "Zoho Mail" },
  { suffixes: [".yandex.net", ".yandex.ru"], category: "yandex", label: "Yandex Mail" },
  { suffixes: [".protonmail.ch", ".proton.me"], category: "proton", label: "Proton Mail" },
  { suffixes: [".messagingengine.com"], category: "fastmail", label: "Fastmail" },
  { suffixes: [".mail.icloud.com", ".icloud.com"], category: "apple", label: "Apple iCloud Mail" },
  { suffixes: [".amazonses.com", ".awsapps.com"], category: "amazon", label: "Amazon SES / WorkMail" },
  { suffixes: [".mx.cloudflare.net"], category: "cloudflare", label: "Cloudflare Email Routing" },
  { suffixes: [".gmx.net", ".gmx.com"], category: "gmx", label: "GMX / 1&1" },
  { suffixes: [".secureserver.net"], category: "godaddy", label: "GoDaddy" },
  { suffixes: [".emailsrvr.com"], category: "rackspace", label: "Rackspace Email" },
  { suffixes: [".qq.com"], category: "tencent", label: "Tencent QQ Mail" },
  { suffixes: [".163.com", ".126.com", ".netease.com"], category: "netease", label: "NetEase Mail" },
];

/**
 * Attribute one MX hostname to a known provider, or null when no signature
 * matches. Case- and trailing-dot-insensitive.
 */
export function classifyMailHost(host: string): { category: MailProviderCategory; label: string } | null {
  const h = host.toLowerCase().replace(/\.$/, "").trim();
  for (const sig of SIGNATURES) {
    if (sig.suffixes.some((s) => h.endsWith(s))) return { category: sig.category, label: sig.label };
  }
  return null;
}

/**
 * Shape a raw MX list into the corroboration record email mode reports:
 * deduplicated hosts primary-first, and the provider read from the first host
 * that carries a known signature. No MX at all is reported honestly — a domain
 * with no published exchanger may still accept mail at its A record, so this
 * states the absence without asserting undeliverability.
 */
export function buildMailProviderData(records: MxHost[]): MailProviderData {
  const seen = new Set<string>();
  // A missing priority sorts last; normalize it here so the comparator is a
  // single numeric path (no per-comparison nullish branch that depends on the
  // sort's internal call order).
  const cleaned: { host: string; priority: number }[] = [];
  for (const r of records) {
    const host = r.host.toLowerCase().replace(/\.$/, "").trim();
    if (!host || seen.has(host)) continue;
    seen.add(host);
    cleaned.push({ host, priority: r.priority ?? Number.MAX_SAFE_INTEGER });
  }
  cleaned.sort((a, b) => a.priority - b.priority || a.host.localeCompare(b.host));

  if (cleaned.length === 0) {
    return { hasMx: false, mxHosts: [], provider: "No published mail exchangers", category: "none" };
  }

  let category: MailProviderCategory = "other";
  let provider = "Self-managed or unrecognized provider";
  for (const { host } of cleaned) {
    const hit = classifyMailHost(host);
    if (hit) {
      category = hit.category;
      provider = hit.label;
      break;
    }
  }
  return { hasMx: true, mxHosts: cleaned.map((c) => c.host), provider, category };
}
