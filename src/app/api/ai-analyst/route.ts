import { NextRequest, NextResponse } from "next/server";
import { guardRateLimit } from "@/lib/server/rateLimit";
import { audit } from "@/lib/server/auditLog";
import { parseBody, aiAnalystBody } from "@/lib/server/validation";
import { analystStatus, runAnalyst, listModels } from "@/lib/server/aiAnalyst";
import { ALL_PROVIDERS, type CloudProvider } from "@/lib/ai/analyst";

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
//
// GET ?models=<provider> answers the second question: which models that
// provider's key may call. The dropdown used to list names compiled into the
// build, which is how it came to offer Gemini models Google had retired, so the
// only way to run the analyst was to know the right name and type it in.

export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };

/** A provider name from the query string, or null when it names no cloud provider. */
function cloudParam(value: string | null): CloudProvider | null {
  const found = ALL_PROVIDERS.find((p) => p === value);
  return found && found !== "ollama" ? found : null;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const wanted = req.nextUrl.searchParams.get("models");
  if (wanted !== null) {
    const provider = cloudParam(wanted);
    // Ollama is excluded deliberately: its installed models already come back
    // with the readiness probe, from the machine rather than from a key.
    if (!provider) {
      return NextResponse.json(
        { error: "Unknown provider. Expected one of: openai, anthropic, gemini, groq, deepseek, mistral, openrouter." },
        { status: 400, headers: noStore },
      );
    }
    return NextResponse.json(await listModels(provider), { headers: noStore });
  }
  return NextResponse.json(await analystStatus(), { headers: noStore });
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
