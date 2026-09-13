import { NextRequest, NextResponse } from "next/server";
import { guardRateLimit } from "@/lib/server/rateLimit";
import { audit } from "@/lib/server/auditLog";
import { parseBody, aiAnalystBody } from "@/lib/server/validation";
import { analystStatus, runAnalyst } from "@/lib/server/aiAnalyst";

// ── AI analyst relay ─────────────────────────────────────────────────────────
// The optional, opt-in bridge to a language model. The browser builds a strictly
// grounded prompt from the analysis already on screen and posts it here; this
// forwards it to the chosen provider (a local Ollama server, or a cloud provider
// whose key is saved in the key store or set in the environment) and returns the
// raw completion for the client to validate. What we audit is the provider name
// and nothing else: never the prompt, which names the subject, and never the key.
//
// GET answers the panel's opening question — which provider can actually run
// here — so it selects a working one instead of defaulting to a local server
// that may not be installed. It reports key PRESENCE only, never a key value.

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  return NextResponse.json(await analystStatus(), { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const rl = guardRateLimit(req);
  if (rl.limited) return rl.limited;

  const parsed = await parseBody(req, aiAnalystBody);
  if (!parsed.ok) return NextResponse.json(parsed.problem, { status: 400, headers: rl.headers });
  const body = parsed.data;

  const r = await runAnalyst(body.provider, body.model, { system: body.system, user: body.user }, body.apiKey);

  // Audit the provider name only. Never the prompt (it names the subject) and
  // never body.apiKey (the operator's own credential). Logged after the run and
  // with the status actually returned, the way the lookup routes do it: a log
  // that records 200 for a run that failed is worse than no log.
  void audit("ai-analyst", body.provider, rl.client, r.status);

  if (!r.ok) {
    return NextResponse.json({ error: r.error }, { status: r.status, headers: rl.headers });
  }
  return NextResponse.json({ text: r.text }, { headers: rl.headers });
}
