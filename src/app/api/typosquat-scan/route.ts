import { NextRequest, NextResponse } from "next/server";
import { guardRateLimit } from "@/lib/server/rateLimit";
import { audit } from "@/lib/server/auditLog";
import { parseBody, typosquatBody } from "@/lib/server/validation";
import { toAsciiHost } from "@/lib/analysis/idn";
import { generateTyposquats } from "@/lib/analysis/typosquat";
import { mapLimit } from "@/lib/server/concurrency";
import { fanoutConcurrency } from "@/lib/server/config";
import { DOH_URL, dohFailure } from "@/lib/server/doh";
import { withUserAgent } from "@/lib/server/fetchSafe";
import { fetchWhois } from "@/lib/server/rdap";
import { markAll } from "@/lib/server/sourceHealth";
import type { TyposquatFinding, TyposquatScanResponse } from "@/lib/types";

// ── Typosquat resolution ─────────────────────────────────────────────────────
//
// The generator produces the look-alike names an attacker would register; this
// asks DNS which of them exist. Before it, the panel printed 180 candidates as
// links and left the analyst to open each one by hand, which is not a finding —
// it is homework. The finding is "six of these resolve, two accept mail, and
// this one was registered four days ago".
//
// Every query is DNS-over-HTTPS to a fixed resolver, which is effectively
// unmetered, so a bounded fanout is safe; RDAP is slower and quota'd, so only
// the first WHOIS_LIMIT resolving candidates get a registration date.
//
// This never claims a squat is malicious. It reports which names exist, which
// have mail, and how old they are, which is exactly the evidence an analyst
// needs to decide.

/** Candidates resolved per request. 180 is what a 9-character label generates. */
const DEFAULT_LIMIT = 200;
/** Resolving candidates that also get an RDAP registration date. */
const WHOIS_LIMIT = 12;
const DOH_TIMEOUT_MS = 5000;

interface DohAnswer {
  name: string;
  type: number;
  TTL: number;
  data: string;
}

/**
 * One DoH query, returning the answer values of the requested type, or null
 * when the resolver did not answer. Null matters: "no answer" must never be
 * rendered as "this name does not exist".
 */
async function resolve(name: string, type: "A" | "MX"): Promise<string[] | null> {
  try {
    const res = await fetch(`${DOH_URL}?name=${encodeURIComponent(name)}&type=${type}`, withUserAgent({
      headers: { Accept: "application/dns-json" },
      signal: AbortSignal.timeout(DOH_TIMEOUT_MS),
      next: { revalidate: 0 },
    }));
    if (!res.ok) return null;
    const json = (await res.json()) as { Status?: number; Answer?: DohAnswer[] };
    if (dohFailure(json.Status)) return null;
    const wanted = type === "A" ? 1 : 15;
    return (json.Answer ?? [])
      .filter((a) => a.type === wanted)
      .map((a) => (type === "MX" ? a.data.split(" ").slice(1).join(" ").replace(/\.$/, "") : a.data));
  } catch {
    return null;
  }
}

/** Whole days between an ISO date and now, or null when the date is unusable. */
export function ageInDays(iso: string | null, now = Date.now()): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  return Math.floor((now - ms) / 86_400_000);
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const rl = guardRateLimit(req);
  if (rl.limited) return rl.limited;
  const rlHeaders = rl.headers;
  const client = rl.client;

  const parsed = await parseBody(req, typosquatBody);
  if (!parsed.ok) return NextResponse.json(parsed.problem, { status: 400, headers: rlHeaders });

  const ascii = toAsciiHost(parsed.data.domain);
  if (!ascii) {
    return NextResponse.json({ error: "Not a valid domain name", field: "domain" }, { status: 400, headers: rlHeaders });
  }
  const domain = ascii.replace(/^www\./, "");
  const limit = parsed.data.limit ?? DEFAULT_LIMIT;
  void audit("typosquat", domain, client, 200);

  const candidates = generateTyposquats(domain).slice(0, limit);
  const started = Date.now();

  const findings = await mapLimit(candidates, fanoutConcurrency(), async (c): Promise<TyposquatFinding> => {
    const [a, mx] = await Promise.all([resolve(c.domain, "A"), resolve(c.domain, "MX")]);
    return {
      domain: c.domain,
      display: c.display,
      technique: c.technique,
      addresses: a ?? [],
      mx: mx ?? [],
      // "Resolves" is a statement about DNS, not about registration: a
      // registered-but-parked name with no records is not counted, and neither
      // is a name whose query timed out.
      resolves: (a?.length ?? 0) > 0 || (mx?.length ?? 0) > 0,
      answered: a !== null && mx !== null,
      whois: null,
      ageDays: null,
    };
  });

  // One retry pass over the queries that got no answer. A 180-name burst at
  // this concurrency draws some throttling from the resolver — 34 of 180 came
  // back unanswered in a live run — and an unanswered candidate is a hole in the
  // scan, not a result.
  const retry = findings.filter((f) => !f.answered);
  await mapLimit(retry, fanoutConcurrency(), async (f) => {
    const [a, mx] = await Promise.all([resolve(f.domain, "A"), resolve(f.domain, "MX")]);
    if (a === null || mx === null) return;
    f.addresses = a;
    f.mx = mx;
    f.resolves = a.length > 0 || mx.length > 0;
    f.answered = true;
  });

  // Registration dates for the newest-looking leads. A look-alike registered
  // days ago is a live campaign; one registered in 2009 is usually a brand
  // holding its own defensive names.
  const resolving = findings.filter((f) => f.resolves).slice(0, WHOIS_LIMIT);
  await mapLimit(resolving, fanoutConcurrency(), async (f) => {
    const whois = await fetchWhois(f.domain);
    if (!whois) return;
    f.whois = { registrar: whois.registrar, createdDate: whois.createdDate };
    f.ageDays = ageInDays(whois.createdDate);
  });

  const ms = Date.now() - started;
  const response: TyposquatScanResponse = {
    domain,
    generated: generateTyposquats(domain).length,
    checked: findings.length,
    resolving: findings.filter((f) => f.resolves).length,
    withMail: findings.filter((f) => f.mx.length > 0).length,
    unanswered: findings.filter((f) => !f.answered).length,
    findings: findings.filter((f) => f.resolves),
    sourceHealth: markAll([
      { source: "dns", ok: findings.some((f) => f.answered), ms, fetchedAt: Date.now() },
    ]),
  };

  return NextResponse.json(response, { headers: rlHeaders });
}
