// ── Rich username-profile normalisation ──────────────────────────────────────
// Turns the raw JSON from nine keyless public APIs (GitHub, GitLab, Hacker News,
// Reddit, Bluesky, Mastodon, Codeberg, Chess.com, Lichess) into a single
// normalised `SocialProfile` shape the UI renders
// as a card. These are the sources where "the account exists" can be upgraded to
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

/** 4-digit year from a Unix epoch in SECONDS (HN/Reddit/Chess.com), or null. */
function yearFromEpochSeconds(n: unknown): string | null {
  if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) return null;
  return String(new Date(n * 1000).getUTCFullYear());
}

/** 4-digit year from a Unix epoch in MILLISECONDS (Lichess), or null. */
function yearFromEpochMillis(n: unknown): string | null {
  if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) return null;
  return String(new Date(n).getUTCFullYear());
}

/** Strip HTML tags + decode the handful of entities these APIs emit. */
function stripHtml(s: unknown): string | null {
  if (typeof s !== "string") return null;
  const out = s
    .replace(/<[^>]*>/g, " ")
    .replace(/&(?:#x27|#39|apos);/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&nbsp;/g, " ")
    // `&amp;` LAST: decoding it first would let `&amp;lt;` collapse to `<`,
    // double-unescaping an entity the sender wrote literally. Decoding it after
    // the others means the intermediate `&` it produces is never re-scanned.
    .replace(/&amp;/g, "&")
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

// ── Bluesky — https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile ────
//
// Bluesky was previously a `manual` sweep entry: bsky.app is a client-rendered
// app, so a status probe returns 200 for everyone and a title-marker body probe
// was measured misclassifying real accounts. The AT Protocol appview, though,
// is a keyless public JSON API that answers definitively — 200 with the profile,
// or 400 "Profile not found" — so this moves the platform from an unverifiable
// link straight past found/notfound to a full profile card.
//
// `actor` takes any handle. The sweep passes "{u}.bsky.social" (the default
// domain every account gets); a user on a custom domain resolves too, but we
// cannot derive that from a bare username, so we do not guess at one.

export function normalizeBluesky(raw: unknown): SocialProfile | null {
  if (!isRecord(raw)) return null;
  const handle = clean(raw.handle);
  // A "Profile not found" error body carries no handle, so it collapses to null
  // here even if a caller forwards it.
  if (!handle) return null;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? String(v) : "0");

  // Bluesky lets an issuer vouch for an account; `verifiedStatus: "valid"` is
  // the platform's own confirmation and is worth surfacing to an analyst.
  const verification = isRecord(raw.verification) ? raw.verification : null;
  const verified = verification?.verifiedStatus === "valid";

  return {
    platform: "Bluesky",
    category: "social",
    handle,
    url: `https://bsky.app/profile/${encodeURIComponent(handle)}`,
    avatarUrl: clean(raw.avatar),
    displayName: clean(raw.displayName),
    bio: clean(raw.description),
    stats: [
      { label: "followers", value: num(raw.followersCount) },
      { label: "following", value: num(raw.followsCount) },
      { label: "posts", value: num(raw.postsCount) },
    ],
    joinedYear: yearFromIso(raw.createdAt),
    location: null,
    extra: verified ? "verified by Bluesky" : null,
  };
}


// ── Mastodon — https://mastodon.social/api/v1/accounts/lookup?acct={u} ───────
//
// Only mastodon.social is queried. The fediverse has thousands of instances and
// a handle is only unique WITHIN one, so a hit here means "this handle exists on
// mastodon.social", never "this person is on the fediverse". Reporting it as the
// former is the honest reading and is still the single most useful instance to
// check, being by far the largest.

export function normalizeMastodon(raw: unknown): SocialProfile | null {
  if (!isRecord(raw)) return null;
  const handle = clean(raw.acct) ?? clean(raw.username);
  if (!handle) return null;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? String(v) : "0");
  return {
    platform: "Mastodon",
    category: "social",
    handle,
    url: clean(raw.url) ?? `https://mastodon.social/@${encodeURIComponent(handle)}`,
    avatarUrl: clean(raw.avatar),
    displayName: clean(raw.display_name),
    // `note` is a rendered HTML fragment, not plain text.
    bio: stripHtml(raw.note),
    stats: [
      { label: "followers", value: num(raw.followers_count) },
      { label: "following", value: num(raw.following_count) },
      { label: "posts", value: num(raw.statuses_count) },
    ],
    joinedYear: yearFromIso(raw.created_at),
    location: null,
    extra: raw.bot === true ? "flagged as a bot account" : null,
  };
}

// ── Codeberg — https://codeberg.org/api/v1/users/{u} ─────────────────────────
//
// A Forgejo/Gitea instance, so the response carries a self-declared `website`.
// That field is a genuine cross-platform pivot and is surfaced as `extra`.

export function normalizeCodeberg(raw: unknown): SocialProfile | null {
  if (!isRecord(raw)) return null;
  const login = clean(raw.login);
  if (!login) return null;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? String(v) : "0");
  const website = clean(raw.website);
  const pronouns = clean(raw.pronouns);
  return {
    platform: "Codeberg",
    category: "developer",
    handle: login,
    url: clean(raw.html_url) ?? `https://codeberg.org/${encodeURIComponent(login)}`,
    avatarUrl: clean(raw.avatar_url),
    // Forgejo defaults full_name to the login; echoing it back as a display
    // name would fabricate a "real name" the user never supplied.
    displayName: clean(raw.full_name) === login ? null : clean(raw.full_name),
    bio: stripHtml(raw.description),
    stats: [
      { label: "followers", value: num(raw.followers_count) },
      { label: "following", value: num(raw.following_count) },
    ],
    joinedYear: yearFromIso(raw.created),
    location: clean(raw.location),
    extra: [website && `site: ${website}`, pronouns && `pronouns: ${pronouns}`].filter(Boolean).join(" · ") || null,
  };
}

// ── Chess.com — https://api.chess.com/pub/player/{u} ─────────────────────────
//
// The richest of the four for pivoting: a streamer's `twitch_url` links a chess
// handle to a Twitch channel, which is exactly the kind of cross-platform edge
// Twitch's own keyless-API absence otherwise denies this tool.

export function normalizeChessCom(raw: unknown): SocialProfile | null {
  if (!isRecord(raw)) return null;
  const username = clean(raw.username);
  if (!username) return null;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? String(v) : "0");
  // `country` is an API URL ending in the ISO code, e.g. .../country/US
  const country = clean(raw.country)?.split("/").pop() ?? null;
  const title = clean(raw.title);
  const twitch = clean(raw.twitch_url);
  return {
    platform: "Chess.com",
    category: "gaming",
    handle: username,
    url: clean(raw.url) ?? `https://www.chess.com/member/${encodeURIComponent(username)}`,
    avatarUrl: clean(raw.avatar),
    displayName: clean(raw.name),
    bio: null,
    stats: [{ label: "followers", value: num(raw.followers) }],
    joinedYear: yearFromEpochSeconds(raw.joined),
    location: clean(raw.location) ?? country,
    extra: [title && `${title} title`, twitch && `Twitch: ${twitch}`].filter(Boolean).join(" · ") || null,
  };
}

// ── Lichess — https://lichess.org/api/user/{u} ───────────────────────────────
//
// Timestamps here are epoch MILLISECONDS, unlike Chess.com's seconds. `seenAt`
// is the standout field: a last-active date is something almost no other free
// source in this tool provides.

export function normalizeLichess(raw: unknown): SocialProfile | null {
  if (!isRecord(raw)) return null;
  const username = clean(raw.username) ?? clean(raw.id);
  if (!username) return null;
  const profile = isRecord(raw.profile) ? raw.profile : null;
  const lastSeen = typeof raw.seenAt === "number" && Number.isFinite(raw.seenAt) && raw.seenAt > 0
    ? new Date(raw.seenAt).toISOString().slice(0, 10)
    : null;
  const realName = profile ? [clean(profile.firstName), clean(profile.lastName)].filter(Boolean).join(" ") : "";
  return {
    platform: "Lichess",
    category: "gaming",
    handle: username,
    url: clean(raw.url) ?? `https://lichess.org/@/${encodeURIComponent(username)}`,
    avatarUrl: null,
    displayName: realName || null,
    bio: profile ? clean(profile.bio) : null,
    stats: [],
    joinedYear: yearFromEpochMillis(raw.createdAt),
    location: profile ? (clean(profile.location) ?? clean(profile.country)) : null,
    extra: [
      raw.disabled === true && "account closed",
      raw.tosViolation === true && "flagged for ToS violation",
      lastSeen && `last seen ${lastSeen}`,
    ].filter(Boolean).join(" · ") || null,
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
