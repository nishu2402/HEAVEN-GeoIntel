// ── Keyless MX lookup for email mode ─────────────────────────────────────────
//
// Resolves a domain's MX records over Cloudflare DNS-over-HTTPS (the same
// keyless `dns` source domain mode uses) and hands them to the mail-provider
// fingerprinter. This is email mode's keyless deliverability-and-infrastructure
// corroboration: it names where the domain's mail lands without a key and
// without asserting a specific address is valid.
//
// Accuracy discipline: only a real answer is returned as ok. A non-2xx or a
// network error is an explicit failure, never an empty MX list that would read
// as "this domain has no mail", so the panel can tell "no exchangers" apart from
// "the resolver did not answer".

import { describeError, withUserAgent } from "./fetchSafe";
import { fetchTimeoutMs } from "./config";
import { buildMailProviderData, type MxHost } from "../analysis/mailProvider";
import type { MailProviderData, SourceResult } from "../types";

const DOH = "https://cloudflare-dns.com/dns-query";

interface DohAnswer { name: string; type: number; TTL: number; data: string; }

/**
 * Parse DoH MX answers into host/priority pairs. MX rdata is
 * "<priority> <host>." (RFC 1035 §3.3.9); a line with no host is dropped and a
 * non-numeric priority becomes null so the fingerprinter can still sort it last.
 */
export function parseMxAnswers(answer: DohAnswer[] | undefined): MxHost[] {
  if (!answer) return [];
  const out: MxHost[] = [];
  for (const a of answer) {
    const [prio, ...rest] = a.data.split(" ");
    const host = rest.join(" ").replace(/\.$/, "").trim();
    if (!host) continue;
    const p = parseInt(prio, 10);
    out.push({ host, priority: Number.isNaN(p) ? null : p });
  }
  return out;
}

export async function fetchEmailMx(domain: string): Promise<SourceResult<MailProviderData>> {
  const d = domain.trim().toLowerCase();
  if (!d) return { ok: false, error: "no domain" };
  try {
    const res = await fetch(`${DOH}?name=${encodeURIComponent(d)}&type=MX`, withUserAgent({
      headers: { Accept: "application/dns-json" },
      signal: AbortSignal.timeout(fetchTimeoutMs()),
      next: { revalidate: 0 },
    }));
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const json = (await res.json()) as { Answer?: DohAnswer[] };
    return { ok: true, data: buildMailProviderData(parseMxAnswers(json.Answer)) };
  } catch (err) {
    return { ok: false, error: describeError(err) };
  }
}
