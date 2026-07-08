// ── Username enumeration catalog (offline definition, checked at request time) ──
// Each entry defines how to test whether a username is registered on a site.
//   - check "status": claimed if the profile URL returns HTTP 200, free if 404.
//   - check "body":   claimed if HTTP 200 AND the response body does NOT contain
//                     `absence` (a string only present on "user not found" pages).
// Server-side fetch (no CORS limits). High-signal, scrape-tolerant sites only.

// "status" — exists if the profile URL returns 200, free if 404.
// "body"   — exists if 200 AND the response body lacks an `absence` marker.
// "manual" — existence CANNOT be determined server-side (JS-rendered SPA or a
//            bot-wall that returns 200 for everyone). NEVER auto-claimed; shown
//            as an "open to verify" link. Empirically verified: these sites
//            return HTTP 200 for both real and nonexistent usernames.
export type CheckMethod = "status" | "body" | "manual";
export type UsernameCategory =
  | "developer" | "social" | "creative" | "gaming" | "forum" | "professional" | "crypto";

export interface UsernameSite {
  name: string;
  category: UsernameCategory;
  /** URL template — {u} is replaced with the username (already encoded). */
  url: string;
  /** Public profile URL shown to the user (same as url unless a prettier form exists). */
  profile?: string;
  check: CheckMethod;
  /** For check==="body": substring that appears ONLY when the user does NOT exist. */
  absence?: string;
}

// NOTE: GitHub, GitLab, Hacker News and Reddit are NOT in this sweep catalog —
// they each expose a keyless public JSON API, so the route verifies them as rich
// "SocialProfile" providers (real name / karma / repos / join date) instead of a
// bare found/notfound probe. See src/lib/analysis/usernameProfiles.ts.
export const USERNAME_SITES: UsernameSite[] = [
  // ── Developer ──
  { name: "Replit",        category: "developer",    url: "https://replit.com/@{u}",                check: "manual" },
  { name: "Docker Hub",    category: "developer",    url: "https://hub.docker.com/u/{u}",           check: "status" },
  { name: "PyPI",          category: "developer",    url: "https://pypi.org/user/{u}/",             check: "manual" },
  { name: "npm",           category: "developer",    url: "https://www.npmjs.com/~{u}",             check: "status" },
  // NOTE: Stack Overflow has no clean username→profile URL (profiles are keyed by
  // numeric id). Its /users/filter?search= page returns HTTP 200 for ANY query,
  // which a status-check would misreport as "found" for every username — a false
  // positive. Codeberg (a Gitea forge) returns a real 404 for non-existent users.
  { name: "Codeberg",      category: "developer",    url: "https://codeberg.org/{u}",               check: "status" },
  { name: "CodePen",       category: "developer",    url: "https://codepen.io/{u}",                 check: "status" },
  { name: "Kaggle",        category: "developer",    url: "https://www.kaggle.com/{u}",             check: "manual" },

  // ── Social ──
  { name: "Instagram",     category: "social",       url: "https://www.instagram.com/{u}/",         check: "manual" },
  { name: "X / Twitter",   category: "social",       url: "https://twitter.com/{u}",                check: "manual" },
  { name: "TikTok",        category: "social",       url: "https://www.tiktok.com/@{u}",            check: "manual" },
  { name: "Telegram",      category: "social",       url: "https://t.me/{u}",                       check: "manual" },
  { name: "Threads",       category: "social",       url: "https://www.threads.net/@{u}",           check: "manual" },
  { name: "Mastodon (.social)", category: "social",  url: "https://mastodon.social/@{u}",           check: "status" },
  { name: "Bluesky",       category: "social",       url: "https://bsky.app/profile/{u}.bsky.social", check: "manual" },
  { name: "VK",            category: "social",       url: "https://vk.com/{u}",                     check: "status" },
  { name: "Pinterest",     category: "social",       url: "https://www.pinterest.com/{u}/",         check: "manual" },

  // ── Creative / media ──
  { name: "YouTube",       category: "creative",     url: "https://www.youtube.com/@{u}",           check: "status" },
  { name: "Twitch",        category: "gaming",       url: "https://www.twitch.tv/{u}",              check: "manual" },
  { name: "SoundCloud",    category: "creative",     url: "https://soundcloud.com/{u}",             check: "status" },
  { name: "Spotify",       category: "creative",     url: "https://open.spotify.com/user/{u}",      check: "manual" },
  { name: "Behance",       category: "creative",     url: "https://www.behance.net/{u}",            check: "status" },
  { name: "Dribbble",      category: "creative",     url: "https://dribbble.com/{u}",               check: "status" },
  { name: "DeviantArt",    category: "creative",     url: "https://www.deviantart.com/{u}",         check: "status" },
  { name: "Flickr",        category: "creative",     url: "https://www.flickr.com/people/{u}",      check: "status" },
  { name: "Vimeo",         category: "creative",     url: "https://vimeo.com/{u}",                  check: "status" },
  { name: "Medium",        category: "creative",     url: "https://medium.com/@{u}",                check: "status" },
  { name: "Patreon",       category: "creative",     url: "https://www.patreon.com/{u}",            check: "status" },

  // ── Gaming ──
  { name: "Steam",         category: "gaming",       url: "https://steamcommunity.com/id/{u}",      check: "body", absence: "The specified profile could not be found." },
  { name: "Xbox Gamertag", category: "gaming",       url: "https://account.xbox.com/en-us/profile?gamertag={u}", check: "manual" },
  { name: "Chess.com",     category: "gaming",       url: "https://www.chess.com/member/{u}",       check: "status" },
  { name: "Roblox",        category: "gaming",       url: "https://www.roblox.com/user.aspx?username={u}", check: "status" },

  // ── Professional / forum ──
  { name: "Keybase",       category: "professional", url: "https://keybase.io/{u}",                 check: "status" },
  { name: "About.me",      category: "professional", url: "https://about.me/{u}",                   check: "status" },
  { name: "Gravatar",      category: "professional", url: "https://gravatar.com/{u}",               check: "status" },
  { name: "Linktree",      category: "professional", url: "https://linktr.ee/{u}",                  check: "status" },
  { name: "Product Hunt",  category: "professional", url: "https://www.producthunt.com/@{u}",       check: "status" },
  { name: "Wattpad",       category: "forum",        url: "https://www.wattpad.com/user/{u}",       check: "status" },
  { name: "Last.fm",       category: "creative",     url: "https://www.last.fm/user/{u}",           check: "status" },
  { name: "Trello",        category: "professional", url: "https://trello.com/{u}",                 check: "manual" },

  // ── Crypto ──
  { name: "GitHub Sponsors", category: "crypto",     url: "https://github.com/sponsors/{u}",        check: "status" },
];

export const USERNAME_CATEGORY_META: Record<UsernameCategory, { label: string; color: string }> = {
  developer:    { label: "DEVELOPER",     color: "#22d3ee" },
  social:       { label: "SOCIAL",        color: "#e879f9" },
  creative:     { label: "CREATIVE / MEDIA", color: "#a3e635" },
  gaming:       { label: "GAMING",        color: "#fb923c" },
  forum:        { label: "FORUM",         color: "#facc15" },
  professional: { label: "PROFESSIONAL",  color: "#38bdf8" },
  crypto:       { label: "CRYPTO",        color: "#f59e0b" },
};

/** Validate a username is plausibly real before we hammer 45 sites with it. */
export function isPlausibleUsername(u: string): boolean {
  return /^[a-zA-Z0-9._-]{2,40}$/.test(u);
}

/**
 * Best-effort username candidate from an email's local-part, for the
 * email → username cross-tool pivot. Strips a `+tag` sub-address and returns the
 * local-part only when it's a plausible handle (so `jdoe@x.com` → "jdoe" but
 * `a@x.com` or a quoted/odd local-part → null). Case is preserved.
 */
export function emailToUsernameCandidate(email: string): string | null {
  const at = email.lastIndexOf("@");
  const local = (at === -1 ? email : email.slice(0, at)).split("+")[0].trim();
  return isPlausibleUsername(local) ? local : null;
}
