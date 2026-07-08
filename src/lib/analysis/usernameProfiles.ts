// ── Rich username-profile normalisation ──────────────────────────────────────
// Turns the raw JSON from four keyless public APIs (GitHub, GitLab, Hacker News,
// Reddit) into a single normalised `SocialProfile` shape the UI renders as a
// card. These are the sources where "the account exists" can be upgraded to
// "here is who it is" for FREE — no API key, structured response, so no scraping
// and no false positives. Every function here is PURE: the route does the fetch,
// then hands the raw payload to a normaliser. Unknown / partial shapes collapse
// to `null` rather than inventing data.

import type { SocialProfile, IdentitySignals } from "../types";

// ── small shared helpers ─────────────────────────────────────────────────────

/** 4-digit year from an ISO date string, or null if unparseable/absent. */
function yearFromIso(s: unknown): string | null {
  if (typeof s !== "string" || !s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : String(d.getUTCFullYear());
}

/** 4-digit year from a Unix epoch in SECONDS (HN/Reddit), or null. */
function yearFromEpochSeconds(n: unknown): string | null {
  if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) return null;
  return String(new Date(n * 1000).getUTCFullYear());
}

/** Strip HTML tags + decode the handful of entities these APIs emit. */
function stripHtml(s: unknown): string | null {
  if (typeof s !== "string") return null;
  const out = s
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&(?:#x27|#39|apos);/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return out || null;
}

/** Trim a string to a non-empty value, else null. */
function clean(s: unknown): string | null {
  if (typeof s !== "string") return null;
  const t = s.trim();
  return t || null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

// ── GitHub — https://api.github.com/users/{u} ────────────────────────────────

export function normalizeGithub(raw: unknown): SocialProfile | null {
  if (!isRecord(raw)) return null;
  const login = clean(raw.login);
  if (!login) return null;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? String(v) : "0");
  return {
    platform: "GitHub",
    category: "developer",
    handle: login,
    url: clean(raw.html_url) ?? `https://github.com/${login}`,
    avatarUrl: clean(raw.avatar_url),
    displayName: clean(raw.name),
    bio: clean(raw.bio),
    stats: [
      { label: "repos", value: num(raw.public_repos) },
      { label: "followers", value: num(raw.followers) },
      { label: "following", value: num(raw.following) },
    ],
    joinedYear: yearFromIso(raw.created_at),
    location: clean(raw.location),
    extra: clean(raw.company),
  };
}

// ── GitLab — https://gitlab.com/api/v4/users?username={u} (array) ─────────────

export function normalizeGitlab(raw: unknown): SocialProfile | null {
  const first = Array.isArray(raw) ? raw[0] : undefined;
  if (!isRecord(first)) return null;
  const username = clean(first.username);
  if (!username) return null;
  return {
    platform: "GitLab",
    category: "developer",
    handle: username,
    url: clean(first.web_url) ?? `https://gitlab.com/${username}`,
    // GitLab avatars are usually Gravatar (allowed by our CSP) or gitlab.com.
    avatarUrl: clean(first.avatar_url),
    displayName: clean(first.name),
    bio: clean(first.bio),
    stats: [],
    joinedYear: yearFromIso(first.created_at),
    location: clean(first.location),
    extra: null,
  };
}

// ── Hacker News — https://hacker-news.firebaseio.com/v0/user/{u}.json ────────
// Official read API. Returns `null` for a missing user, or {id, created, karma,
// about}. `about` is HTML. No avatar, no display name — HN has neither.

export function normalizeHackerNews(raw: unknown): SocialProfile | null {
  if (!isRecord(raw)) return null;
  const id = clean(raw.id);
  if (!id) return null;
  const karma = typeof raw.karma === "number" && Number.isFinite(raw.karma) ? String(raw.karma) : "0";
  return {
    platform: "Hacker News",
    category: "forum",
    handle: id,
    url: `https://news.ycombinator.com/user?id=${encodeURIComponent(id)}`,
    avatarUrl: null,
    displayName: null,
    bio: stripHtml(raw.about),
    stats: [{ label: "karma", value: karma }],
    joinedYear: yearFromEpochSeconds(raw.created),
    location: null,
    extra: null,
  };
}

// ── Reddit — https://www.reddit.com/user/{u}/about.json ──────────────────────
// 404 for a missing user; when present, {kind:"t2", data:{...}}. Reddit blocks
// some datacenter IPs (403/429) — those come back as no-profile (handled by the
// route treating a non-200 as null), never a false claim.

export function normalizeReddit(raw: unknown): SocialProfile | null {
  if (!isRecord(raw)) return null;
  const d = raw.data;
  if (!isRecord(d)) return null;
  const name = clean(d.name);
  if (!name) return null;
  const sub = isRecord(d.subreddit) ? d.subreddit : {};
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? String(v) : "0");
  return {
    platform: "Reddit",
    category: "social",
    handle: name,
    url: `https://www.reddit.com/user/${encodeURIComponent(name)}`,
    // Reddit icons live on hosts our CSP doesn't allow → skip to avoid a broken
    // image. The karma + account age are the signal here, not the avatar.
    avatarUrl: null,
    displayName: clean(sub.title),
    bio: clean(sub.public_description),
    stats: [
      { label: "post karma", value: num(d.link_karma) },
      { label: "comment karma", value: num(d.comment_karma) },
    ],
    joinedYear: yearFromEpochSeconds(d.created_utc),
    location: null,
    extra: d.is_suspended === true ? "account suspended" : null,
  };
}

// ── Cross-profile identity synthesis ─────────────────────────────────────────
// Roll the confirmed profiles up into the distinct name / location / avatar /
// bio candidates an analyst actually wants at a glance. Case-insensitive dedupe,
// first-seen wins, each candidate tagged with the platform it came from.

export function deriveIdentity(profiles: SocialProfile[]): IdentitySignals {
  const names: IdentitySignals["names"] = [];
  const locations: IdentitySignals["locations"] = [];
  const avatars: IdentitySignals["avatars"] = [];
  const bios: IdentitySignals["bios"] = [];
  const seenName = new Set<string>();
  const seenLoc = new Set<string>();
  const seenAvatar = new Set<string>();
  const seenBio = new Set<string>();

  for (const p of profiles) {
    if (p.displayName) {
      const k = p.displayName.toLowerCase();
      if (!seenName.has(k)) { seenName.add(k); names.push({ value: p.displayName, source: p.platform }); }
    }
    if (p.location) {
      const k = p.location.toLowerCase();
      if (!seenLoc.has(k)) { seenLoc.add(k); locations.push({ value: p.location, source: p.platform }); }
    }
    if (p.avatarUrl && !seenAvatar.has(p.avatarUrl)) {
      seenAvatar.add(p.avatarUrl); avatars.push({ url: p.avatarUrl, source: p.platform });
    }
    if (p.bio) {
      const k = p.bio.toLowerCase();
      if (!seenBio.has(k)) { seenBio.add(k); bios.push({ value: p.bio, source: p.platform }); }
    }
  }
  return { names, locations, avatars, bios };
}
