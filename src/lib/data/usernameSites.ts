import { overlayList, overlayRemovals } from "./overlay";

// ── Username enumeration catalog (offline definition, checked at request time) ──
// Each entry defines how to test whether a username is registered on a site.
//   - check "status": claimed if the profile URL returns HTTP 200, free if 404.
//   - check "body":   claimed if HTTP 200 AND the response body does NOT contain
//                     `absence` (a string only present on "user not found" pages).
// Server-side fetch (no CORS limits). High-signal, scrape-tolerant sites only.

// "status" — exists if the profile URL returns 200, free if 404.
// "body"   — exists if 200 AND the response body lacks an `absence` marker.
// "manual" — existence CANNOT be determined server-side, for either reason:
//            (a) a JS-rendered SPA / bot-wall that returns HTTP 200 for everyone,
//                so a status probe would false-positive on every username, or
//            (b) an anti-bot challenge (Cloudflare / Anubis / Fastly WAF) that
//                blocks our keyless server-side fetch with a 403/interstitial for
//                real AND fake users alike, so a status probe only ever yields
//                "unknown" noise.
//            Either way we NEVER auto-claim found/notfound — we hand the analyst
//            an "open to verify" link. Every classification here was chosen from
//            live probes of a known-real handle vs. a known-nonexistent one.
export type CheckMethod = "status" | "body" | "manual";
export type UsernameCategory =
  | "developer" | "social" | "creative" | "gaming" | "forum" | "professional";

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

// NOTE: GitHub, GitLab, Codeberg, Hacker News, Reddit, Bluesky, Mastodon,
// Chess.com and Lichess are NOT in this sweep catalog — they each expose a
// keyless public JSON API, so the route verifies them as rich "SocialProfile"
// providers (real name / karma / repos / join date) instead of a bare
// found/notfound probe. See analysis/usernameProfiles.ts.
//
// Chess.com, Lichess and Mastodon were plain status rows until their APIs were
// measured against 4 known-real and 4 known-absent handles each (4/4 and 0/4).
// A row that answers "exists" is worth less than one that answers with a join
// date, a location and — for Chess.com — the account's own Twitch URL, so they
// were promoted rather than left as a second opinion on themselves.
// Bluesky moved here from `manual`: bsky.app is client-rendered, so a status
// probe returns 200 for everyone and a title-marker body probe was measured
// misclassifying real accounts — but the AT Protocol appview answers exactly.
export const USERNAME_SITES: UsernameSite[] = [
  // ── Developer ──
  { name: "Replit",        category: "developer",    url: "https://replit.com/@{u}",                check: "manual" },
  { name: "Docker Hub",    category: "developer",    url: "https://hub.docker.com/u/{u}",           check: "status" },
  { name: "PyPI",          category: "developer",    url: "https://pypi.org/user/{u}/",             check: "manual" },
  // NOTE: Stack Overflow has no clean username→profile URL (profiles are keyed by
  // numeric id). Its /users/filter?search= page returns HTTP 200 for ANY query,
  // which a status-check would misreport as "found" for every username.
  // npm (npmjs.com) and CodePen sit behind an anti-bot
  // challenge that 403s our keyless server-side fetch for real AND fake users
  // alike — a status probe there only ever yields "unknown", so they are `manual`
  // (open-to-verify links) rather than a wall of unverified rows.
  { name: "npm",           category: "developer",    url: "https://www.npmjs.com/~{u}",             check: "manual" },
  { name: "CodePen",       category: "developer",    url: "https://codepen.io/{u}",                 check: "manual" },
  { name: "Kaggle",        category: "developer",    url: "https://www.kaggle.com/{u}",             check: "manual" },

  // ── Social ──
  { name: "Instagram",     category: "social",       url: "https://www.instagram.com/{u}/",         check: "manual" },
  // twitter.com still answers a server-side GET with a clean 200/404 split.
  // Measured over 8 known-real and 6 known-absent handles: zero false positives
  // and zero false negatives, which is what promotion out of `manual` requires.
  { name: "X / Twitter",   category: "social",       url: "https://twitter.com/{u}",                check: "status" },
  { name: "TikTok",        category: "social",       url: "https://www.tiktok.com/@{u}",            check: "manual" },
  { name: "Telegram",      category: "social",       url: "https://t.me/{u}",                       check: "manual" },
  { name: "Threads",       category: "social",       url: "https://www.threads.net/@{u}",           check: "manual" },
  { name: "VK",            category: "social",       url: "https://vk.com/{u}",                     check: "status" },
  { name: "Pinterest",     category: "social",       url: "https://www.pinterest.com/{u}/",         check: "manual" },
  { name: "Tumblr",        category: "social",       url: "https://{u}.tumblr.com",                 check: "status" },

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
  // medium.com/@{u} is Cloudflare-walled to server fetches, but the public RSS
  // feed is not and returns a clean 200 (exists) / 404 (free) — so we probe the
  // feed and show the analyst the pretty profile URL.
  { name: "Medium",        category: "creative",     url: "https://medium.com/feed/@{u}", profile: "https://medium.com/@{u}", check: "status" },
  { name: "Patreon",       category: "creative",     url: "https://www.patreon.com/{u}",            check: "status" },

  // ── Gaming ──
  { name: "Steam",         category: "gaming",       url: "https://steamcommunity.com/id/{u}",      check: "body", absence: "The specified profile could not be found." },
  { name: "Xbox Gamertag", category: "gaming",       url: "https://account.xbox.com/en-us/profile?gamertag={u}", check: "manual" },
  { name: "Roblox",        category: "gaming",       url: "https://www.roblox.com/user.aspx?username={u}", check: "status" },
  { name: "itch.io",       category: "gaming",       url: "https://{u}.itch.io",                    check: "status" },

  // ── Professional / forum ──
  { name: "Keybase",       category: "professional", url: "https://keybase.io/{u}",                 check: "status" },
  { name: "About.me",      category: "professional", url: "https://about.me/{u}",                   check: "status" },
  { name: "Gravatar",      category: "professional", url: "https://gravatar.com/{u}",               check: "status" },
  { name: "Linktree",      category: "professional", url: "https://linktr.ee/{u}",                  check: "status" },
  { name: "Buy Me a Coffee", category: "professional", url: "https://www.buymeacoffee.com/{u}",     check: "status" },
  // Product Hunt (Cloudflare) and Last.fm (Fastly WAF, intermittent HTTP 600)
  // both block our keyless server fetch → manual, not an "unverified" wall.
  { name: "Product Hunt",  category: "professional", url: "https://www.producthunt.com/@{u}",       check: "manual" },
  { name: "Wattpad",       category: "forum",        url: "https://www.wattpad.com/user/{u}",       check: "status" },
  { name: "Last.fm",       category: "creative",     url: "https://www.last.fm/user/{u}",           check: "manual" },
  { name: "Trello",        category: "professional", url: "https://api.trello.com/1/members/{u}", profile: "https://trello.com/{u}",                 check: "status" },
  // NOTE: GitHub Sponsors was removed — github.com/sponsors/{u} 302-redirects to
  // the plain github.com/{u} profile for ANY existing GitHub user, so it fired on
  // every GitHub account as a misleading "found" that just duplicates the rich
  // GitHub profile card (see analysis/usernameProfiles.ts).
];

/**
 * The catalog actually swept, bundled entries plus any runtime overlay.
 *
 * Adding a site used to mean editing this file and redeploying. An overlay in
 * `.data/datasets/usernameSites.json` can now append sites (or remove a
 * bundled one by name) on a running instance. Overlay entries are validated by
 * the loader, so a malformed entry is skipped rather than breaking the sweep.
 */
export function activeUsernameSites(): UsernameSite[] {
  const removed = new Set(overlayRemovals("usernameSites"));
  const extra = overlayList<UsernameSite>("usernameSites");
  const bundled = USERNAME_SITES.filter((s) => !removed.has(s.name));
  // An overlay entry with the same name as a bundled one replaces it.
  const overridden = new Set(extra.map((s) => s.name));
  return [...bundled.filter((s) => !overridden.has(s.name)), ...extra];
}

export const USERNAME_CATEGORY_META: Record<UsernameCategory, { label: string; color: string }> = {
  developer:    { label: "DEVELOPER",     color: "#22d3ee" },
  social:       { label: "SOCIAL",        color: "#e879f9" },
  creative:     { label: "CREATIVE / MEDIA", color: "#a3e635" },
  gaming:       { label: "GAMING",        color: "#fb923c" },
  forum:        { label: "FORUM",         color: "#facc15" },
  professional: { label: "PROFESSIONAL",  color: "#38bdf8" },
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
