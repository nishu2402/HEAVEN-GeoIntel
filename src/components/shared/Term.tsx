import type { ReactNode } from "react";

// Plain-language glossary for the acronyms an OSINT dashboard throws at you.
// Rendered as a native <abbr> with a dotted underline + tooltip, so non-experts
// can hover (or long-press on mobile) any term to learn what it means.
const GLOSSARY: Record<string, string> = {
  "E.164": "International phone format: + country code + national number, no spaces (e.g. +14155552671).",
  NPA: "Numbering Plan Area: the 3-digit US/Canada area code.",
  CNAM: "Caller ID Name: the name registered to show on caller ID for a number.",
  "MCC/MNC": "Mobile Country Code / Mobile Network Code: together they identify the cellular operator.",
  PLMN: "Public Land Mobile Network: a mobile operator's network, identified by MCC + MNC.",
  VoIP: "Voice over IP: an internet phone line, commonly used for burner / cloud numbers.",
  ASN: "Autonomous System Number: identifies the network / ISP that owns a block of IPs.",
  RDAP: "Registration Data Access Protocol: the modern, structured replacement for WHOIS.",
  SPF: "Sender Policy Framework: a DNS record listing who may send email for a domain.",
  DMARC: "Email-authentication policy telling receivers what to do with spoofed mail.",
  DKIM: "DomainKeys Identified Mail: a cryptographic signature proving an email wasn't tampered with.",
  infostealer: "Malware that steals saved passwords, cookies and autofill data from an infected device.",
  prepaid: "A pay-as-you-go SIM with no contract: common in burner / throwaway setups.",
};

export default function Term({ k, children }: { k: string; children?: ReactNode }) {
  const def = GLOSSARY[k];
  if (!def) return <>{children ?? k}</>;
  return (
    <abbr
      title={def}
      aria-label={`${k}: ${def}`}
      className="cursor-help decoration-dotted underline decoration-[var(--hv-ink-dim)] underline-offset-2"
      style={{ textDecorationThickness: "1px" }}
    >
      {children ?? k}
    </abbr>
  );
}
