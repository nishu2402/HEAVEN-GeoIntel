// ── Extended username breadth (WhatsMyName overlay) — pure link building ──────
//
// Turns a handle into grouped "open to verify" launch links across the vendored
// WhatsMyName catalog. This is deliberately NOT an auto-check: we never fetch
// these sites and never claim a handle exists on one — the analyst opens a link
// and judges for themselves. That is the whole reason it is safe to carry 700+
// community-maintained sites without a false-positive surface.
//
// Sites the main sweep already auto-verifies (and the keyless API providers like
// GitHub/Reddit) are filtered out, so the overlay only adds NEW ground to cover.

import { EXTENDED_USERNAME_SITES } from "../data/extendedUsernameSites";
import { USERNAME_SITES } from "../data/usernameSites";

// Names already covered elsewhere: the server-side sweep catalog, plus the
// keyless public-API providers that return rich profiles (usernameProfiles.ts).
const ALREADY_COVERED = new Set<string>([
  ...USERNAME_SITES.map((s) => s.name.toLowerCase()),
  "github", "gitlab", "codeberg", "hacker news", "reddit", "bluesky",
  "mastodon", "chess.com", "lichess",
]);

export interface ExtendedLink {
  name: string;
  url: string;
}

export interface ExtendedGroup {
  category: string;
  sites: ExtendedLink[];
}

function isNew(name: string): boolean {
  return !ALREADY_COVERED.has(name.toLowerCase());
}

/** How many extra sites the overlay offers, after removing already-covered ones. */
export function extendedSiteCount(): number {
  return EXTENDED_USERNAME_SITES.filter((s) => isNew(s.n)).length;
}

/**
 * Grouped manual-verify launch links for a handle, largest category first and
 * alphabetical within each. Empty for a blank handle.
 */
export function extendedProfileLinks(username: string): ExtendedGroup[] {
  const handle = username.trim();
  if (!handle) return [];
  const enc = encodeURIComponent(handle);
  const groups = new Map<string, ExtendedLink[]>();
  for (const s of EXTENDED_USERNAME_SITES) {
    if (!isNew(s.n)) continue;
    const list = groups.get(s.c) ?? [];
    if (list.length === 0) groups.set(s.c, list);
    list.push({ name: s.n, url: s.u.replace(/\{account\}/g, enc) });
  }
  return [...groups.entries()]
    .map(([category, sites]) => ({
      category,
      sites: sites.sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => b.sites.length - a.sites.length || a.category.localeCompare(b.category));
}
