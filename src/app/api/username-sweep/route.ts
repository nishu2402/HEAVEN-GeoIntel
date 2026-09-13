import { NextRequest, NextResponse } from "next/server";
import { guardRateLimit } from "@/lib/server/rateLimit";
import { audit } from "@/lib/server/auditLog";
import { parseBody, sweepBody } from "@/lib/server/validation";
import { isPlausibleUsername, USERNAME_SITES } from "@/lib/data/usernameSites";
import { EXTENDED_USERNAME_SITES, type ExtendedSite } from "@/lib/data/extendedUsernameSites";
import { classifyWmn, fillTemplate, hasContract } from "@/lib/analysis/wmnDetect";
import { mapLimit, hostKey } from "@/lib/server/concurrency";
import { fanoutConcurrency } from "@/lib/server/config";
import { markAll } from "@/lib/server/sourceHealth";
import { USER_AGENT } from "@/lib/version";
import type { SweepHit, UsernameSweepResponse } from "@/lib/types";

// ── Deep username sweep ──────────────────────────────────────────────────────
//
// The main lookup auto-checks 23 sites and hands 15 more over as manual links.
// This checks the WhatsMyName entries that carry a full detection contract (see
// analysis/wmnDetect.ts) — 242 validated sites by default, 393 more on request —
// which is where the breadth of a real username investigation lives.
//
// Measured on `bagder`, one 60-site page classified 56 of 60 either way: 7
// confirmed accounts, 49 confirmed free, 4 unknown. The fast sweep's own rule
// manages 23 sites in total.
//
// It is PAGED and explicitly started, for two reasons that are the same reason:
// hundreds of probes is tens of seconds of wall time and hundreds of sockets, so
// folding it into the main lookup would make every username lookup slow and
// would fire the whole catalog at people who only wanted the fast answer. The
// analyst presses a button, and the client walks the pages, so progress is
// visible and the sweep can be stopped.
//
// Politeness: the fanout is capped by FANOUT_CONCURRENCY and requests to the
// SAME host are serialised, so the three WordPress.com rows in the catalog are
// three sequential requests rather than three simultaneous ones.

/** Probe sites per page. One page is roughly two to four seconds. */
const DEFAULT_PAGE = 60;
const PROBE_TIMEOUT_MS = 8000;
/** Body bytes read per probe. The markers sit near the top of the document. */
const BODY_LIMIT = 60_000;

/**
 * The sites this endpoint owns: a complete contract, not upstream-invalid, and
 * not already covered by the fast sweep or a keyless profile API (checking a
 * site twice in one investigation would double-report it).
 */
const COVERED = new Set<string>([
  ...USERNAME_SITES.map((s) => s.name.toLowerCase()),
  "github", "gitlab", "codeberg", "hacker news", "reddit", "bluesky",
  "mastodon", "chess.com", "lichess",
]);

/**
 * The sites this endpoint owns, validated ones first.
 *
 * `v` records whether the site behaved exactly as its contract documents when
 * the catalog was last refreshed with `--validate`: a known-real handle
 * classified as found, and a nonexistent one as notfound. Measured on
 * 2026-09-12, 255 of 672 passed. The failures are mostly real rather than
 * artefacts — Instagram and Spotify, probed alone and unhurried, still answer
 * HTTP 200 for a real handle and a nonexistent one alike, with neither marker
 * present, so no honest classification exists from a server-side probe.
 *
 * So the default sweep covers the sites that demonstrably work, and the rest are
 * available on request rather than dropped: a marker can rot, and a site that
 * failed from this machine may answer elsewhere.
 */
export function sweepSites(includeUnvalidated = false): ExtendedSite[] {
  const usable = EXTENDED_USERNAME_SITES.filter(
    (s) => !s.skip && hasContract(s) && !COVERED.has(s.n.toLowerCase()),
  );
  const validated = usable.filter((s) => s.v === true);
  // A catalog regenerated without `--validate` carries no `v` at all. Gating on
  // it then would sweep nothing, so the whole set is used.
  if (validated.length === 0) return usable;
  return includeUnvalidated ? [...validated, ...usable.filter((s) => s.v !== true)] : validated;
}

async function probeSite(site: ExtendedSite, username: string): Promise<SweepHit> {
  const probeUrl = fillTemplate(site.u, username);
  const display = fillTemplate(site.p ?? site.u, username, false);
  const base: SweepHit = {
    site: site.n,
    category: site.c,
    url: display,
    status: "unknown",
    ...(site.pr?.length ? { protection: site.pr } : {}),
  };

  try {
    const res = await fetch(probeUrl, {
      method: "GET",
      headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml,application/json" },
      redirect: "follow",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      next: { revalidate: 0 },
    });
    // Always read the body: `hasContract` only admits sites that carry an
    // `e_string` or `m_string`, so every site reaching here is classified on
    // body text as well as status.
    const body = (await res.text()).slice(0, BODY_LIMIT);
    return { ...base, status: classifyWmn(site, res.status, body), httpStatus: res.status };
  } catch {
    return base; // timeout / network → unknown, never a claim
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const rl = guardRateLimit(req);
  if (rl.limited) return rl.limited;
  const rlHeaders = rl.headers;
  const client = rl.client;

  const parsed = await parseBody(req, sweepBody);
  if (!parsed.ok) return NextResponse.json(parsed.problem, { status: 400, headers: rlHeaders });

  const username = parsed.data.username.trim().replace(/^@/, "");
  if (!isPlausibleUsername(username)) {
    return NextResponse.json(
      { error: "Username must be 2-40 chars: letters, digits, . _ -", field: "username" },
      { status: 400, headers: rlHeaders },
    );
  }

  const all = sweepSites(parsed.data.includeUnvalidated ?? false);
  const unvalidated = sweepSites(true).length - sweepSites(false).length;
  const offset = Math.min(parsed.data.offset ?? 0, all.length);
  const limit = parsed.data.limit ?? DEFAULT_PAGE;
  const page = all.slice(offset, offset + limit);

  void audit("username-sweep", `${username} [${offset}-${offset + page.length}]`, client, 200);

  const started = Date.now();
  const hits = await mapLimit(
    page,
    fanoutConcurrency(),
    (site) => probeSite(site, username),
    (site) => hostKey(site.u),
  );
  const ms = Date.now() - started;

  const nextOffset = offset + page.length < all.length ? offset + page.length : null;
  const response: UsernameSweepResponse = {
    username,
    offset,
    limit: page.length,
    total: all.length,
    unvalidated,
    nextOffset,
    hits,
    found: hits.filter((h) => h.status === "found").length,
    notfound: hits.filter((h) => h.status === "notfound").length,
    unknown: hits.filter((h) => h.status === "unknown").length,
    sourceHealth: markAll([
      {
        source: "usernameDeepSweep",
        // A page where nothing was classified either way means the probes are
        // not working, not that the handle is absent everywhere.
        ok: hits.some((h) => h.status !== "unknown"),
        ms,
        fetchedAt: Date.now(),
        ...(hits.every((h) => h.status === "unknown") ? { error: "no site returned a classifiable answer" } : {}),
      },
    ]),
  };

  return NextResponse.json(response, { headers: rlHeaders });
}
