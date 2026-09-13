// ── Extended username breadth (WhatsMyName overlay) — pure link building ──────
//
// Turns a handle into grouped "open to verify" launch links for the sites that
// NOTHING can check automatically: entries WhatsMyName itself marks invalid, and
// entries whose probe needs a POST body or custom headers this tool does not
// send. We never fetch these and never claim a handle exists on one.
//
// Everything else moved: the fast sweep owns its 38 sites, the keyless profile
// APIs own theirs, and the deep sweep auto-classifies the 672 entries that carry
// a full detection contract. Offering those as manual links too would ask the
// analyst to repeat work already done.

import { EXTENDED_USERNAME_SITES, type ExtendedSite } from "../data/extendedUsernameSites";
import { hasContract } from "./wmnDetect";
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

/**
 * A site belongs in the manual panel only when nothing else checks it.
 *
 * The whole catalog used to land here as launch links. Now that 672 of its
 * entries carry a detection contract the deep sweep can classify (see
 * analysis/wmnDetect.ts), listing those as "open to verify" would be asking the
 * analyst to redo work the tool already did. What remains is the genuinely
 * unverifiable residue: entries the upstream marks invalid, and those needing a
 * POST body or custom headers this tool does not send.
 */
function isNew(name: string): boolean {
  return !ALREADY_COVERED.has(name.toLowerCase());
}

function isManualOnly(site: ExtendedSite): boolean {
  return isNew(site.n) && (site.skip === true || !hasContract(site));
}

/** How many sites are left for manual verification, after the sweeps take theirs. */
export function extendedSiteCount(): number {
  return EXTENDED_USERNAME_SITES.filter(isManualOnly).length;
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
    if (!isManualOnly(s)) continue;
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
