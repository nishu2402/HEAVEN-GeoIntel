// ── Host exposure: open ports, CVEs, scanner reputation (keyless) ────────────
//
// Shodan's InternetDB and GreyNoise's Community endpoint both answer about one
// address without a key. They lived inline in the IP route, which meant domain
// mode resolved an A record and then said nothing about it — the tool knew how
// to ask "what is exposed on this host?" and never asked it about the hosts it
// had just discovered itself. One module now backs both modes.
//
// Neither source gets a second opinion: if InternetDB is down, those fields are
// honestly empty and the source strip says so. `null` here always means "not
// learned", never "none" — a host with no open ports and a host we could not ask
// about must not render the same way.

import { fetchBudgeted } from "./upstreamBudget";
import type { IpLookupData, SourceProvenance } from "../types";

export const SHODAN_SOURCE = "Shodan InternetDB";
export const GREYNOISE_SOURCE = "GreyNoise Community";

interface ShodanIDB {
  ip?: string;
  ports?: number[];
  vulns?: string[];
  hostnames?: string[];
  tags?: string[];
  cpes?: string[];
}

interface GreyNoiseCommunity {
  ip?: string;
  noise?: boolean;
  riot?: boolean;
  classification?: string;
  name?: string;
  last_seen?: string;
  message?: string;
}

/** The exposure half of a host record, with the same nullability rules as IpLookupData. */
export interface HostExposure {
  ports: number[] | null;
  vulns: string[] | null;
  hostnames: string[] | null;
  tags: string[] | null;
  greyNoise: IpLookupData["greyNoise"];
  /** Tag-derived anonymity flags; null when Shodan did not answer. */
  isTor: boolean | null;
  isVpn: boolean | null;
  isProxy: boolean | null;
}

export const EMPTY_EXPOSURE: HostExposure = {
  ports: null, vulns: null, hostnames: null, tags: null, greyNoise: null,
  isTor: null, isVpn: null, isProxy: null,
};

/** True when anything at all was learned — the "partial result is still a result" test. */
export function hasExposure(e: HostExposure): boolean {
  return e.ports !== null || e.vulns !== null || e.hostnames !== null || e.tags !== null || e.greyNoise !== null;
}

/**
 * Ask both sources about one address. Never throws; a source that does not
 * answer contributes nulls and a provenance row saying why.
 *
 * GreyNoise answers 404 for an address it has never observed, which is a real
 * answer ("not seen scanning") rather than a failure — so 404 counts as ok.
 */
export async function fetchHostExposure(
  ip: string,
  timeoutMs = 6000,
): Promise<{ exposure: HostExposure; provenance: SourceProvenance[] }> {
  const enc = encodeURIComponent(ip);
  const [shodan, gn] = await Promise.all([
    fetchBudgeted<ShodanIDB>(`https://internetdb.shodan.io/${enc}`, {
      source: SHODAN_SOURCE, timeoutMs, allowNon2xx: true,
    }),
    fetchBudgeted<GreyNoiseCommunity>(`https://api.greynoise.io/v3/community/${enc}`, {
      source: GREYNOISE_SOURCE, timeoutMs, allowNon2xx: true,
    }),
  ]);

  const shodanOk = shodan.status === 200;
  const gnOk = gn.status === 200 || gn.status === 404;
  const exposure: HostExposure = { ...EMPTY_EXPOSURE };

  if (shodanOk && shodan.data) {
    const s = shodan.data;
    exposure.ports = s.ports?.length ? s.ports : null;
    exposure.vulns = s.vulns?.length ? s.vulns : null;
    exposure.hostnames = s.hostnames?.length ? s.hostnames : null;
    exposure.tags = s.tags?.length ? s.tags : null;
    const tags = (exposure.tags ?? []).map((t) => t.toLowerCase());
    if (tags.includes("tor")) exposure.isTor = true;
    if (tags.includes("vpn")) exposure.isVpn = true;
    if (tags.includes("proxy")) exposure.isProxy = true;
  }

  if (gnOk && gn.data && gn.data.classification) {
    exposure.greyNoise = {
      classification: gn.data.classification,
      noise: Boolean(gn.data.noise),
      riot: Boolean(gn.data.riot),
      name: gn.data.name ?? null,
      lastSeen: gn.data.last_seen ?? null,
    };
  }

  return {
    exposure,
    provenance: [
      { source: shodan.source, ok: shodanOk, ms: shodan.ms, fetchedAt: shodan.fetchedAt, error: shodanOk ? undefined : shodan.error },
      { source: gn.source, ok: gnOk, ms: gn.ms, fetchedAt: gn.fetchedAt, error: gnOk ? undefined : gn.error },
    ],
  };
}
