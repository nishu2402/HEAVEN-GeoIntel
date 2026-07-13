import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, getClientIp } from "@/lib/server/rateLimit";
import { audit } from "@/lib/server/auditLog";
import { USERNAME_SITES, isPlausibleUsername } from "@/lib/data/usernameSites";
import { fetchJson } from "@/lib/server/fetchSafe";
import { parseBody, usernameBody } from "@/lib/server/validation";
import {
  normalizeGithub, normalizeGitlab, normalizeHackerNews, normalizeReddit, deriveIdentity,
} from "@/lib/analysis/usernameProfiles";
import type { UsernameLookupResponse, UsernameHit, UsernameHitStatus, SocialProfile } from "@/lib/types";

// ── Rich profile providers — keyless public JSON APIs ────────────────────────
// Four sites expose a structured, no-key endpoint, so we upgrade them from a
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

// ── Username OSINT — free, no API key ────────────────────────────────────────
// Checks a username against the sweep catalog in parallel (server-side, so no
// CORS), alongside 4 rich API providers. Classifies each as found / notfound /
// unknown using either HTTP status or a "user not found" body marker.
// Conservative: ambiguous → unknown; unverifiable-server-side → manual.

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

async function checkSite(
  site: (typeof USERNAME_SITES)[number],
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

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { "User-Agent": UA, "Accept": "text/html,application/xhtml+xml" },
      redirect: "follow",
      signal: AbortSignal.timeout(6500),
      next: { revalidate: 0 },
    });

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
    const text = (await res.text()).slice(0, 60000);
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
  const ip = getClientIp(req);
  const { allowed, remaining } = checkRateLimit(ip);
  const rlHeaders = { "X-RateLimit-Limit": "10", "X-RateLimit-Remaining": String(remaining) };
  if (!allowed) {
    return NextResponse.json({ error: "Rate limit exceeded. Max 10/min." }, { status: 429, headers: { ...rlHeaders, "Retry-After": "60" } });
  }

  const body = await parseBody(req, usernameBody);
  if (!body) return NextResponse.json({ error: "Invalid request body" }, { status: 400 });

  const username = body.username.trim().replace(/^@/, "");
  if (!username) return NextResponse.json({ error: "Missing username" }, { status: 400 });
  if (!isPlausibleUsername(username)) {
    return NextResponse.json({ error: "Username must be 2–40 chars: letters, digits, . _ -" }, { status: 400 });
  }
  void audit("username", username, ip, 200);

  // Rich, API-verified profiles run in parallel with the site sweep. Order here
  // is the display order (developer forges first, then forum, then social).
  const richJob = Promise.all([
    fetchGithub(username), fetchGitlab(username), fetchHackerNews(username), fetchReddit(username),
  ]);

  const settled = await Promise.allSettled(USERNAME_SITES.map((s) => checkSite(s, username)));
  const hits: UsernameHit[] = settled.map((r, i) =>
    r.status === "fulfilled"
      ? r.value
      : { site: USERNAME_SITES[i].name, category: USERNAME_SITES[i].category, url: USERNAME_SITES[i].url.replace("{u}", username), status: "unknown" as const }
  );

  // Sort: confirmed first, then the "open to verify" buckets, then notfound.
  const order: Record<UsernameHitStatus, number> = { found: 0, unknown: 1, manual: 2, notfound: 3 };
  hits.sort((a, b) => order[a.status] - order[b.status] || a.site.localeCompare(b.site));

  const profiles = (await richJob).filter((p): p is SocialProfile => p !== null);
  const identity = deriveIdentity(profiles);

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
    pivots: buildPivots(username),
  };

  return NextResponse.json(response, { headers: rlHeaders });
}
