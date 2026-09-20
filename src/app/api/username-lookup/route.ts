import { NextRequest, NextResponse } from "next/server";
import { guardRateLimit } from "@/lib/server/rateLimit";
import { timedValue, markAll } from "@/lib/server/sourceHealth";
import { audit } from "@/lib/server/auditLog";
import { activeUsernameSites, isPlausibleUsername } from "@/lib/data/usernameSites";
import { ensureDatasets } from "@/lib/server/datasets";
import { fetchJson } from "@/lib/server/fetchSafe";
import { fetchLeakCheck } from "@/lib/server/leakCheck";
import { hudsonRockFor } from "@/lib/server/hudsonRock";
import { aggregateBreaches } from "@/lib/analysis/breachAggregate";
import { assessCredentialExposure, stealerCredentialSummary } from "@/lib/analysis/credentialExposure";
import { breachCatalog } from "@/lib/data/breachCatalog";
import { parseBody, usernameBody } from "@/lib/server/validation";
import {
  normalizeGithub, normalizeGitlab, normalizeHackerNews, normalizeReddit,
  normalizeBluesky, normalizeMastodon, normalizeCodeberg, normalizeChessCom,
  normalizeLichess, deriveIdentity,
} from "@/lib/analysis/usernameProfiles";
import { hashAvatars } from "@/lib/server/avatarHash";
import { followRedirects, readPrefix } from "@/lib/server/httpProbe";
import { correlateAvatars } from "@/lib/analysis/phash";
import { selfLinkProofs, avatarProofs } from "@/lib/analysis/identityLinks";
import { resolveIdentity } from "@/lib/analysis/identityResolve";
import { mapLimit, hostKey } from "@/lib/server/concurrency";
import { fanoutConcurrency } from "@/lib/server/config";
import type { UsernameLookupResponse, UsernameHit, UsernameHitStatus, SocialProfile } from "@/lib/types";

// ── Rich profile providers — keyless public JSON APIs ────────────────────────
// Five sites expose a structured, no-key endpoint, so we upgrade them from a
// bare found/notfound probe to a real profile card (name / karma / repos / join
// date). All parsing is done by pure normalisers in analysis/usernameProfiles —
// here we only fetch. A non-2xx / blocked / malformed response yields `null`
// (no profile), never a false claim.

async function fetchGithub(username: string): Promise<SocialProfile | null> {
  const r = await fetchJson<unknown>(`https://api.github.com/users/${encodeURIComponent(username)}`, {
    source: "GitHub API", timeoutMs: 6000,
    init: { headers: { "User-Agent": UA, Accept: "application/vnd.github+json" } },
  });
  return r.ok ? normalizeGithub(r.data) : null;
}

async function fetchGitlab(username: string): Promise<SocialProfile | null> {
  const r = await fetchJson<unknown>(`https://gitlab.com/api/v4/users?username=${encodeURIComponent(username)}`, {
    source: "GitLab API", timeoutMs: 6000,
    init: { headers: { "User-Agent": UA, Accept: "application/json" } },
  });
  return r.ok ? normalizeGitlab(r.data) : null;
}

async function fetchHackerNews(username: string): Promise<SocialProfile | null> {
  // Official Firebase read API: 200 with `null` body for a missing user.
  const r = await fetchJson<unknown>(`https://hacker-news.firebaseio.com/v0/user/${encodeURIComponent(username)}.json`, {
    source: "Hacker News API", timeoutMs: 6000,
    init: { headers: { "User-Agent": UA, Accept: "application/json" } },
  });
  return r.ok ? normalizeHackerNews(r.data) : null;
}

async function fetchReddit(username: string): Promise<SocialProfile | null> {
  const r = await fetchJson<unknown>(`https://www.reddit.com/user/${encodeURIComponent(username)}/about.json`, {
    source: "Reddit API", timeoutMs: 6000,
    init: { headers: { "User-Agent": UA, Accept: "application/json" } },
  });
  return r.ok ? normalizeReddit(r.data) : null;
}

async function fetchBluesky(username: string): Promise<SocialProfile | null> {
  // The AT Protocol appview: 200 with the profile, 400 "Profile not found".
  // `{u}.bsky.social` is the default domain every account is issued.
  const handle = `${username}.bsky.social`;
  const r = await fetchJson<unknown>(
    `https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(handle)}`,
    { source: "Bluesky API", timeoutMs: 6000, init: { headers: { "User-Agent": UA, Accept: "application/json" } } },
  );
  return r.ok ? normalizeBluesky(r.data) : null;
}

async function fetchMastodon(username: string): Promise<SocialProfile | null> {
  // mastodon.social only — see normalizeMastodon on why one instance is the
  // honest scope for a fediverse handle.
  const r = await fetchJson<unknown>(
    `https://mastodon.social/api/v1/accounts/lookup?acct=${encodeURIComponent(username)}`,
    { source: "Mastodon API", timeoutMs: 6000, init: { headers: { "User-Agent": UA, Accept: "application/json" } } },
  );
  return r.ok ? normalizeMastodon(r.data) : null;
}

async function fetchCodeberg(username: string): Promise<SocialProfile | null> {
  const r = await fetchJson<unknown>(`https://codeberg.org/api/v1/users/${encodeURIComponent(username)}`, {
    source: "Codeberg API", timeoutMs: 6000,
    init: { headers: { "User-Agent": UA, Accept: "application/json" } },
  });
  return r.ok ? normalizeCodeberg(r.data) : null;
}

async function fetchChessCom(username: string): Promise<SocialProfile | null> {
  const r = await fetchJson<unknown>(`https://api.chess.com/pub/player/${encodeURIComponent(username.toLowerCase())}`, {
    source: "Chess.com API", timeoutMs: 6000,
    init: { headers: { "User-Agent": UA, Accept: "application/json" } },
  });
  return r.ok ? normalizeChessCom(r.data) : null;
}

async function fetchLichess(username: string): Promise<SocialProfile | null> {
  const r = await fetchJson<unknown>(`https://lichess.org/api/user/${encodeURIComponent(username)}`, {
    source: "Lichess API", timeoutMs: 6000,
    init: { headers: { "User-Agent": UA, Accept: "application/json" } },
  });
  return r.ok ? normalizeLichess(r.data) : null;
}

// ── Username OSINT — free, no API key ────────────────────────────────────────
// Checks a username against the sweep catalog in parallel (server-side, so no
// CORS), alongside 9 rich API providers. Classifies each as found / notfound /
// unknown using either HTTP status or a "user not found" body marker.
// Conservative: ambiguous → unknown; unverifiable-server-side → manual.

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

async function checkSite(
  site: ReturnType<typeof activeUsernameSites>[number],
  username: string
): Promise<UsernameHit> {
  const url = site.url.replace("{u}", encodeURIComponent(username));
  const profile = (site.profile ?? site.url).replace("{u}", username);
  const base: UsernameHit = { site: site.name, category: site.category, url: profile, status: "unknown" };

  // "manual" sites can't be verified by a server-side probe — either a JS SPA /
  // bot-wall that returns HTTP 200 for everyone, or an anti-bot challenge that
  // 403s our keyless fetch. Don't fetch — never claim found/notfound, just hand
  // the analyst a link. Also skips those dead requests. See usernameSites.ts.
  if (site.check === "manual") {
    return { ...base, status: "manual" };
  }

  // A handle the site cannot hold is not registered there, whatever the probe
  // would say. An overlay's JSON cannot carry a RegExp, so only bundled
  // entries set one.
  if (site.pattern instanceof RegExp && !site.pattern.test(username)) {
    return { ...base, status: "notfound" };
  }

  try {
    // Redirects are followed by hand with every hop vetted, as in the deep
    // sweep: the probe must never be steered at an internal address.
    const walked = await followRedirects(url, {
      timeoutMs: 6500,
      headers: { "User-Agent": UA, "Accept": "text/html,application/xhtml+xml" },
    });
    if (!walked) return base; // refused, unreachable or looping → unknown
    const { res } = walked;

    const httpStatus = res.status;

    if (site.check === "status") {
      let status: UsernameHitStatus = "unknown";
      if (httpStatus === 200) status = "found";
      else if (httpStatus === 404 || httpStatus === 410) status = "notfound";
      return { ...base, status, httpStatus };
    }

    // body check
    if (httpStatus !== 200) {
      return { ...base, status: httpStatus === 404 ? "notfound" : "unknown", httpStatus };
    }
    const text = await readPrefix(res, 60000);
    /* v8 ignore next -- a "body" site without an absence marker is rejected by
       the overlay loader and none is bundled, so the false arm is unreachable. */
    const absent = site.absence ? text.includes(site.absence) : false;
    return { ...base, status: absent ? "notfound" : "found", httpStatus };
  } catch {
    return base; // timeout / network → unknown
  }
}

function buildPivots(username: string): UsernameLookupResponse["pivots"] {
  const u = encodeURIComponent(username);
  return [
    { label: "WhatsMyName (web)", url: `https://whatsmyname.app/?q=${u}` },
    { label: "Sherlock (GitHub)", url: `https://github.com/sherlock-project/sherlock` },
    { label: "Google sweep",      url: `https://www.google.com/search?q=${u}` },
    { label: "Google: profiles",  url: `https://www.google.com/search?q=${u}+profile+OR+account+OR+bio` },
    { label: "Have I Been Pwned",  url: `https://haveibeenpwned.com/` },
    { label: "IntelligenceX",     url: `https://intelx.io/?s=${u}` },
  ];
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const rl = guardRateLimit(req);
  if (rl.limited) return rl.limited;
  const rlHeaders = rl.headers;
  const client = rl.client;

  const parsed = await parseBody(req, usernameBody);
  if (!parsed.ok) return NextResponse.json(parsed.problem, { status: parsed.status ?? 400, headers: rlHeaders });
  const body = parsed.data;

  const username = body.username.trim().replace(/^@/, "");
  if (!username) return NextResponse.json({ error: "Missing username" }, { status: 400, headers: rlHeaders });
  if (!isPlausibleUsername(username)) {
    return NextResponse.json({ error: "Username must be 2-40 chars: letters, digits, . _ -" }, { status: 400, headers: rlHeaders });
  }
  void audit("username", username, client, 200);

  // Rich, API-verified profiles run in parallel with the site sweep. Order here
  // is the display order (developer forges first, then forum, then social).
  const richJob = timedValue(
    "usernameProfiles",
    Promise.all([
      fetchGithub(username), fetchGitlab(username), fetchCodeberg(username),
      fetchHackerNews(username), fetchReddit(username),
      fetchBluesky(username), fetchMastodon(username),
      fetchChessCom(username), fetchLichess(username),
    ]),
    () => true
  );

  // Breach exposure for the handle itself — keyless, and it starts alongside the
  // sweep rather than after it so it costs no extra wall time.
  const leakJob = timedValue("leakCheck", fetchLeakCheck(username, "username"), (r) => r.ok);
  // Infostealer exposure for the handle — Cavalier's search-by-username accepts
  // a bare handle, so a username can be tied to malware infections keylessly.
  const hrJob = timedValue("hudsonRock", hudsonRockFor(username, "identifier"), (r) => r.ok);

  // Pick up any operator-supplied catalog overlay before sweeping.
  await ensureDatasets();
  const sites = activeUsernameSites();

  const sweepStarted = Date.now();
  // Bounded fan-out. This was `Promise.allSettled` over every site at once,
  // which opens one socket per site and reads to the far end as a scan. The cap
  // is FANOUT_CONCURRENCY, and same-host rows are serialised so a site with
  // three catalog entries is not hit three times in the same instant.
  const settled = await mapLimit(
    sites,
    fanoutConcurrency(),
    async (s) => {
      try {
        return { status: "fulfilled" as const, value: await checkSite(s, username) };
      /* v8 ignore start -- checkSite catches everything, so a rejection is not
         reachable; the wrapper keeps one bad site from failing the sweep. */
      } catch {
        return { status: "rejected" as const, value: null };
      }
      /* v8 ignore stop */
    },
    (s) => hostKey(s.url),
  );
  /* v8 ignore start -- checkSite catches everything, so a rejected promise is not
     reachable; the fallback exists so one bad site can never fail the sweep. */
  const hits: UsernameHit[] = settled.map((r, i) =>
    r.status === "fulfilled"
      ? r.value
      : { site: sites[i].name, category: sites[i].category, url: sites[i].url.replace("{u}", username), status: "unknown" as const }
  );
  /* v8 ignore stop */

  // Sort: confirmed first, then the "open to verify" buckets, then notfound.
  const order: Record<UsernameHitStatus, number> = { found: 0, unknown: 1, manual: 2, notfound: 3 };
  hits.sort((a, b) => order[a.status] - order[b.status] || a.site.localeCompare(b.site));

  const sweepMs = Date.now() - sweepStarted;
  const [rich, leak, hr] = await Promise.all([richJob, leakJob, hrJob]);
  const profiles = rich.value.filter((p): p is SocialProfile => p !== null);
  const identity = deriveIdentity(profiles);

  // ── Linkage, established server-side ──────────────────────────────────────
  // The avatar comparison used to run on a canvas in the browser, which needs
  // CORS; measured live, only one of three avatar hosts sent the header, so the
  // panel silently never rendered. Hashing here also means the result can feed
  // identity resolution, which is what turns "these accounts share a handle"
  // into "these accounts are provably the same person".
  const avatarJob = timedValue(
    "avatarHash",
    hashAvatars(identity.avatars.map((a) => ({ url: a.url, source: a.source })), fanoutConcurrency()),
    (r) => r.hashed.length > 0 || r.skipped.length === 0,
    (r) => `no avatar could be hashed (${r.skipped.length} skipped)`,
  );
  const avatars = await avatarJob;
  const avatarClusters = correlateAvatars(avatars.value.hashed);
  const identityProofs = [...selfLinkProofs(profiles), ...avatarProofs(avatarClusters)];
  const resolvedIdentity = resolveIdentity(identity, identityProofs);

  // Catalog-enriched union for the handle. Username has one keyless breach index
  // (LeakCheck), but the offline HIBP catalog still fills its bare breach names
  // with data classes and record counts — the same unified view as the other
  // modes, just narrower until more username breach sources are wired.
  // COMB is email-only, so a handle's credential evidence comes from the breach
  // password count plus Hudson Rock's infostealer captures — Cavalier's
  // search-by-username matches the handle exactly, so those masked passwords are
  // real exposure evidence for this identifier, not a fuzzy hit.
  const breachAggregate = aggregateBreaches({ leakCheck: leak.value }, breachCatalog());
  const credentialExposure = assessCredentialExposure(
    null,
    breachAggregate.withPassword,
    stealerCredentialSummary(hr.value.data),
  );

  // Health is judged on the AUTO-CHECKED sites only. `manual` sites are never
  // fetched, so counting them would make the sweep look healthy even when every
  // real probe had failed.
  const probed = hits.filter((h) => h.status !== "manual");
  const sourceHealth = markAll([
    {
      source: "usernameSweep",
      ok: probed.some((h) => h.status !== "unknown"),
      ms: sweepMs,
      fetchedAt: Date.now(),
    },
    rich.provenance,
    leak.provenance,
    hr.provenance,
    avatars.provenance,
  ]);

  // `checked` counts only sites we could actually auto-verify — manual sites are
  // excluded from the denominator so the presence percentage isn't diluted by
  // sites we never claimed to check. They're reported separately as `manual`.
  const manual = hits.filter((h) => h.status === "manual").length;
  const response: UsernameLookupResponse = {
    username,
    checked: hits.length - manual,
    found: hits.filter((h) => h.status === "found").length,
    manual,
    hits,
    profiles,
    identity,
    resolvedIdentity,
    identityProofs,
    avatarClusters,
    avatarSkipped: avatars.value.skipped,
    pivots: buildPivots(username),
    leakCheck: leak.value,
    hudsonRock: hr.value,
    breachAggregate,
    credentialExposure,
    sourceHealth,
  };

  return NextResponse.json(response, { headers: rlHeaders });
}
