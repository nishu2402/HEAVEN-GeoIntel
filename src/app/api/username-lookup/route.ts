import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";
import { USERNAME_SITES, isPlausibleUsername } from "@/lib/usernameSites";
import type { UsernameLookupResponse, UsernameHit, UsernameHitStatus } from "@/lib/types";

// ── Username OSINT — free, no API key ────────────────────────────────────────
// Checks a username against ~45 high-signal sites in parallel (server-side, so
// no CORS). Classifies each as found / notfound / unknown using either HTTP
// status or a "user not found" body marker. Conservative: ambiguous → unknown.

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

async function checkSite(
  site: (typeof USERNAME_SITES)[number],
  username: string
): Promise<UsernameHit> {
  const url = site.url.replace("{u}", encodeURIComponent(username));
  const profile = (site.profile ?? site.url).replace("{u}", username);
  const base: UsernameHit = { site: site.name, category: site.category, url: profile, status: "unknown" };

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
    { label: "Google sweep",      url: `https://www.google.com/search?q=%22${u}%22` },
    { label: "Google: profiles",  url: `https://www.google.com/search?q=intitle:%22${u}%22+(profile+OR+account+OR+bio)` },
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

  let body: { username?: string };
  try { body = (await req.json()) as { username?: string }; }
  catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }

  const username = (body.username ?? "").trim().replace(/^@/, "");
  if (!username) return NextResponse.json({ error: "Missing username" }, { status: 400 });
  if (!isPlausibleUsername(username)) {
    return NextResponse.json({ error: "Username must be 2–40 chars: letters, digits, . _ -" }, { status: 400 });
  }

  const settled = await Promise.allSettled(USERNAME_SITES.map((s) => checkSite(s, username)));
  const hits: UsernameHit[] = settled.map((r, i) =>
    r.status === "fulfilled"
      ? r.value
      : { site: USERNAME_SITES[i].name, category: USERNAME_SITES[i].category, url: USERNAME_SITES[i].url.replace("{u}", username), status: "unknown" as const }
  );

  // Sort: found first, then unknown, then notfound; alpha within group.
  const order: Record<UsernameHitStatus, number> = { found: 0, unknown: 1, notfound: 2 };
  hits.sort((a, b) => order[a.status] - order[b.status] || a.site.localeCompare(b.site));

  const response: UsernameLookupResponse = {
    username,
    checked: hits.length,
    found: hits.filter((h) => h.status === "found").length,
    hits,
    pivots: buildPivots(username),
  };

  return NextResponse.json(response, { headers: rlHeaders });
}
