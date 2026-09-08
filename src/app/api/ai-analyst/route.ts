import { NextRequest, NextResponse } from "next/server";
import { guardRateLimit } from "@/lib/server/rateLimit";
import { audit } from "@/lib/server/auditLog";
import { parseBody, aiAnalystBody } from "@/lib/server/validation";
import { runAnalyst } from "@/lib/server/aiAnalyst";

// ── AI analyst relay ─────────────────────────────────────────────────────────
// The optional, opt-in bridge to a language model. The browser builds a strictly
// grounded prompt from the analysis already on screen and posts it here; this
// forwards it to the chosen provider (local Ollama by default, or a cloud
// provider whose key lives only in the server environment) and returns the raw
// completion for the client to validate. What we audit is the provider name and
// nothing else: never the prompt, which names the subject, and never the key.

export async function POST(req: NextRequest): Promise<NextResponse> {
  const rl = guardRateLimit(req);
  if (rl.limited) return rl.limited;

  const body = await parseBody(req, aiAnalystBody);
  if (!body) return NextResponse.json({ error: "Invalid request body" }, { status: 400 });

  // Audit the provider name only. Never the prompt (it names the subject) and
  // never body.apiKey (the operator's own credential).
  void audit("ai-analyst", body.provider, rl.client, 200);

  const r = await runAnalyst(body.provider, body.model, { system: body.system, user: body.user }, body.apiKey);
  if (!r.ok) {
    return NextResponse.json({ error: r.error }, { status: 502, headers: rl.headers });
  }
  return NextResponse.json({ text: r.text }, { headers: rl.headers });
}
