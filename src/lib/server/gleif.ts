// ── GLEIF Legal Entity Identifier lookup (keyless) ───────────────────────────
//
// Every other source here describes infrastructure: who hosts the name, what it
// resolves to, which certificates exist. None of them answer the first question
// in due-diligence work — is there a real registered company behind this, and
// where is it incorporated? GLEIF publishes the global LEI register as a keyless
// JSON:API, which is the corporate half the tool had none of.
//
// It is queried by a name somebody else already verified: the RDAP registrant
// organisation, or — since post-GDPR RDAP redacts that for most gTLDs — the
// organisation a CA vetted when it issued an OV/EV certificate. paypal.com
// publishes no registrant org, and its certificate says "PayPal, Inc.", which
// resolves to LEI LBQ3CAGQB6M55WHL3G85 and Delaware company number 3014267.
//
// Matching on the domain label instead would be guesswork: the legalName filter
// is a word match, so `wordpress` returns nothing at all while `Automattic`
// returns Automattic Inc. A lookup with nothing to match on is skipped and
// reported as skipped, never as "no company found".

import { fetchBudgeted } from "./upstreamBudget";
import type { SourceProvenance } from "../types";

export const GLEIF_SOURCE = "GLEIF LEI";

export interface LeiRecord {
  /** The 20-character Legal Entity Identifier. */
  lei: string;
  legalName: string;
  /** ISSUED / LAPSED / RETIRED … the registration's own status word. */
  status: string | null;
  /** ISO country of the legal address. */
  country: string | null;
  legalAddress: string | null;
  headquartersAddress: string | null;
  /** Company number in its home register, when published. */
  registeredAs: string | null;
  /** ACTIVE / INACTIVE — whether the entity itself still exists. */
  entityStatus: string | null;
  /**
   * True when the register's legal name matches the query exactly, ignoring
   * case, punctuation and how the legal suffix is spelled. The filter is a WORD
   * match, so a query for "PayPal, Inc." returns 76,760 hits: everything with
   * "Inc" in its name. Without this flag the panel would present the fifth
   * unrelated company as though the tool had identified the registrant.
   */
  exact: boolean;
}

/**
 * The one spelling a legal suffix is compared by, so that a certificate writing
 * "Incorporated" and a register writing "Inc." still match.
 */
const SUFFIX_SPELLING: Record<string, string> = {
  incorporated: "inc",
  corporation: "corp",
  limited: "ltd",
  company: "co",
};

/**
 * Collapse a legal name to a comparable key: lower case, punctuation gone, and
 * the legal suffix spelled one way.
 *
 * The suffix is normalised, never dropped. Dropping it looked like tolerance for
 * formatting and was not: "PayPal, Inc.", "PAYPAL HOLDINGS, INC." and "PAYPAL
 * LIMITED" all collapsed to "paypal", so one lookup of paypal.com flagged three
 * different companies, in two countries, holding three different LEIs, as the
 * exact match that identifies the registrant. A suffix is part of a company's
 * legal identity: Inc is not Ltd, and a holding company is not its subsidiary.
 */
function nameKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(" ")
    .map((word) => SUFFIX_SPELLING[word] ?? word)
    .join(" ");
}

interface GleifAddress {
  addressLines?: string[];
  city?: string;
  region?: string;
  country?: string;
  postalCode?: string;
}

interface GleifRow {
  attributes?: {
    lei?: string;
    entity?: {
      legalName?: { name?: string };
      legalAddress?: GleifAddress;
      headquartersAddress?: GleifAddress;
      registeredAs?: string;
      status?: string;
    };
    registration?: { status?: string };
  };
}

interface GleifBody {
  meta?: { pagination?: { total?: number } };
  data?: GleifRow[];
}

/** One-line address, skipping the parts the register left empty. */
function flatten(a: GleifAddress | undefined): string | null {
  if (!a) return null;
  const parts = [...(a.addressLines ?? []), a.city, a.region, a.postalCode, a.country]
    .map((p) => (typeof p === "string" ? p.trim() : ""))
    .filter((p) => p.length > 0);
  return parts.length > 0 ? parts.join(", ") : null;
}

export interface LeiOutcome {
  /** Exact name matches first, then the register's own relevance order. */
  records: LeiRecord[];
  /**
   * Hits the register reports for the query. Its legalName filter is a WORD
   * match, so this counts names sharing ANY word with the query and is not a
   * count of candidate companies — read it with `LeiRecord.exact`.
   */
  total: number;
  /** The organisation name the query was built from. */
  query: string;
  /** Where that name came from: the WHOIS registrant, or an OV/EV certificate. */
  source: "registrant" | "certificate";
}

/**
 * Look up legal entities by name. Returns null when the source did not answer,
 * and an empty `records` array when it answered and held nothing — those are
 * different findings and the panel says so.
 */
export async function fetchLei(
  organisation: string,
  origin: LeiOutcome["source"],
  pageSize = 5,
  timeoutMs = 7000,
): Promise<{ outcome: LeiOutcome | null; provenance: SourceProvenance }> {
  const name = organisation.trim();
  /* v8 ignore next 6 -- the route only calls this with a non-empty registrant
     org; the guard keeps a future caller from sending an empty filter, which
     GLEIF answers with its entire register. */
  if (!name) {
    return {
      outcome: null,
      provenance: { source: GLEIF_SOURCE, ok: false, ms: 0, fetchedAt: Date.now(), skipped: true, error: "NO_INPUT" },
    };
  }

  // The brackets in JSON:API filter names must be percent-encoded: sent raw,
  // GLEIF answered 200 with an empty body.
  const url =
    `https://api.gleif.org/api/v1/lei-records?filter%5Bentity.legalName%5D=${encodeURIComponent(name)}` +
    `&page%5Bsize%5D=${pageSize}`;

  const res = await fetchBudgeted<GleifBody>(url, {
    source: GLEIF_SOURCE, timeoutMs, allowNon2xx: true,
    init: { headers: { Accept: "application/vnd.api+json" } },
  });

  if (res.status !== 200 || !res.data) {
    return {
      outcome: null,
      provenance: { source: GLEIF_SOURCE, ok: false, ms: res.ms, fetchedAt: res.fetchedAt, error: res.error ?? "no response body" },
    };
  }

  const records: LeiRecord[] = (res.data.data ?? [])
    .map((row) => {
      const a = row.attributes;
      const e = a?.entity;
      const lei = typeof a?.lei === "string" ? a.lei : null;
      const legalName = typeof e?.legalName?.name === "string" ? e.legalName.name : null;
      if (!lei || !legalName) return null;
      return {
        lei,
        legalName,
        exact: nameKey(legalName) === nameKey(name),
        status: a?.registration?.status ?? null,
        country: e?.legalAddress?.country ?? null,
        legalAddress: flatten(e?.legalAddress),
        headquartersAddress: flatten(e?.headquartersAddress),
        registeredAs: e?.registeredAs ?? null,
        entityStatus: e?.status ?? null,
      };
    })
    .filter((r): r is LeiRecord => r !== null);

  const total = res.data.meta?.pagination?.total ?? records.length;
  // Exact matches first: a register that answers with 76,760 word matches is
  // useless unless the one that actually names the registrant is at the top.
  records.sort((a, b) => Number(b.exact) - Number(a.exact));
  return {
    outcome: { records, total, query: name, source: origin },
    provenance: { source: GLEIF_SOURCE, ok: true, ms: res.ms, fetchedAt: res.fetchedAt },
  };
}
