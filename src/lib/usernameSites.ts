// ── Username enumeration catalog (offline definition, checked at request time) ──
// Each entry defines how to test whether a username is registered on a site.
//   - check "status": claimed if the profile URL returns HTTP 200, free if 404.
//   - check "body":   claimed if HTTP 200 AND the response body does NOT contain
//                     `absence` (a string only present on "user not found" pages).
// Server-side fetch (no CORS limits). High-signal, scrape-tolerant sites only.

export type CheckMethod = "status" | "body";
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

export const USERNAME_SITES: UsernameSite[] = [
  // ── Developer ──
  { name: "GitHub",        category: "developer",    url: "https://github.com/{u}",                 check: "status" },
  { name: "GitLab",        category: "developer",    url: "https://gitlab.com/{u}",                 check: "status" },
  { name: "Replit",        category: "developer",    url: "https://replit.com/@{u}",                check: "status" },
  { name: "Docker Hub",    category: "developer",    url: "https://hub.docker.com/u/{u}",           check: "status" },
  { name: "PyPI",          category: "developer",    url: "https://pypi.org/user/{u}/",             check: "status" },
  { name: "npm",           category: "developer",    url: "https://www.npmjs.com/~{u}",             check: "status" },
  { name: "Hacker News",   category: "forum",        url: "https://news.ycombinator.com/user?id={u}", check: "body", absence: "No such user." },
  // NOTE: Stack Overflow has no clean username→profile URL (profiles are keyed by
  // numeric id). Its /users/filter?search= page returns HTTP 200 for ANY query,
  // which a status-check would misreport as "found" for every username — a false
  // positive. Codeberg (a Gitea forge) returns a real 404 for non-existent users.
  { name: "Codeberg",      category: "developer",    url: "https://codeberg.org/{u}",               check: "status" },
  { name: "CodePen",       category: "developer",    url: "https://codepen.io/{u}",                 check: "status" },
  { name: "Kaggle",        category: "developer",    url: "https://www.kaggle.com/{u}",             check: "status" },

  // ── Social ──
  { name: "Instagram",     category: "social",       url: "https://www.instagram.com/{u}/",         check: "status" },
  { name: "X / Twitter",   category: "social",       url: "https://twitter.com/{u}",                check: "status" },
  { name: "TikTok",        category: "social",       url: "https://www.tiktok.com/@{u}",            check: "status" },
  { name: "Reddit",        category: "forum",        url: "https://www.reddit.com/user/{u}",        check: "body", absence: "Sorry, nobody on Reddit goes by that name." },
  { name: "Telegram",      category: "social",       url: "https://t.me/{u}",                       check: "body", absence: "If you have Telegram, you can contact" },
  { name: "Threads",       category: "social",       url: "https://www.threads.net/@{u}",           check: "status" },
  { name: "Mastodon (.social)", category: "social",  url: "https://mastodon.social/@{u}",           check: "status" },
  { name: "Bluesky",       category: "social",       url: "https://bsky.app/profile/{u}.bsky.social", check: "status" },
  { name: "VK",            category: "social",       url: "https://vk.com/{u}",                     check: "status" },
  { name: "Pinterest",     category: "social",       url: "https://www.pinterest.com/{u}/",         check: "status" },

  // ── Creative / media ──
  { name: "YouTube",       category: "creative",     url: "https://www.youtube.com/@{u}",           check: "status" },
  { name: "Twitch",        category: "gaming",       url: "https://www.twitch.tv/{u}",              check: "status" },
  { name: "SoundCloud",    category: "creative",     url: "https://soundcloud.com/{u}",             check: "status" },
  { name: "Spotify",       category: "creative",     url: "https://open.spotify.com/user/{u}",      check: "status" },
  { name: "Behance",       category: "creative",     url: "https://www.behance.net/{u}",            check: "status" },
  { name: "Dribbble",      category: "creative",     url: "https://dribbble.com/{u}",               check: "status" },
  { name: "DeviantArt",    category: "creative",     url: "https://www.deviantart.com/{u}",         check: "status" },
  { name: "Flickr",        category: "creative",     url: "https://www.flickr.com/people/{u}",      check: "status" },
  { name: "Vimeo",         category: "creative",     url: "https://vimeo.com/{u}",                  check: "status" },
  { name: "Medium",        category: "creative",     url: "https://medium.com/@{u}",                check: "status" },
  { name: "Patreon",       category: "creative",     url: "https://www.patreon.com/{u}",            check: "status" },

  // ── Gaming ──
  { name: "Steam",         category: "gaming",       url: "https://steamcommunity.com/id/{u}",      check: "body", absence: "The specified profile could not be found." },
  { name: "Xbox Gamertag", category: "gaming",       url: "https://account.xbox.com/en-us/profile?gamertag={u}", check: "status" },
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
  { name: "Trello",        category: "professional", url: "https://trello.com/{u}",                 check: "status" },

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
