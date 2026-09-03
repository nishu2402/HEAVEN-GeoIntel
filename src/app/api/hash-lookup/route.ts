import { NextRequest, NextResponse } from "next/server";
import { guardRateLimit } from "@/lib/server/rateLimit";
import { audit } from "@/lib/server/auditLog";
import { parseBody, hashBody } from "@/lib/server/validation";
import { fetchBudgeted } from "@/lib/server/upstreamBudget";
import { markAll } from "@/lib/server/sourceHealth";
import { detectHashKind, buildHashFacts, hashPivots } from "@/lib/analysis/hash";
import type { HashLookupResponse, SourceProvenance, HashFacts, HashKind } from "@/lib/types";

// ── File-hash / IOC OSINT — free, no API key ─────────────────────────────────
// One fixed upstream, no SSRF surface:
//   • CIRCL hashlookup → is this hash KNOWN software (NSRL and friends)?
// A 404 is a valid negative ("not known-good"), not an outage; only a network
// failure or 5xx makes the read null. The keyless source can only ever clear a
// hash as benign — never convict it — so a miss is "unknown", and the malware
// verdict engines are offered as pivots. No false-positive surface.

const HASHLOOKUP = "https://hashlookup.circl.lu/lookup";

async function resolveHash(kind: HashKind, hash: string): Promise<{ facts: HashFacts | null; provenance: SourceProvenance }> {
  const res = await fetchBudgeted<unknown>(`${HASHLOOKUP}/${kind}/${encodeURIComponent(hash)}`, {
    source: "circl-hashlookup", timeoutMs: 8000, allowNon2xx: true,
    init: { headers: { accept: "application/json" } },
  });
  const facts = buildHashFacts(kind, hash, res.status, res.data);
  return {
    facts,
    provenance: {
      source: "circl-hashlookup", ok: facts !== null, ms: res.ms, fetchedAt: res.fetchedAt,
      error: facts !== null ? undefined : (res.error ?? "hashlookup unreachable"),
    },
  };
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const rl = guardRateLimit(req);
  if (rl.limited) return rl.limited;
  const rlHeaders = rl.headers;
  const client = rl.client;

  const body = await parseBody(req, hashBody);
  if (!body) return NextResponse.json({ error: "Invalid request body" }, { status: 400 });

  const hash = body.hash.trim().toLowerCase();
  const kind = detectHashKind(hash);
  if (!kind) {
    return NextResponse.json({ error: "Not a recognised MD5, SHA-1 or SHA-256 hash" }, { status: 400 });
  }
  void audit("hash", hash, client, 200);

  const { facts, provenance } = await resolveHash(kind, hash);
  const response: HashLookupResponse = {
    input: hash,
    kind,
    facts,
    pivots: hashPivots(kind, hash),
    sourceHealth: markAll([provenance]),
    error: facts ? undefined : "CIRCL hashlookup was unreachable.",
  };
  return NextResponse.json(response, { headers: rlHeaders });
}
