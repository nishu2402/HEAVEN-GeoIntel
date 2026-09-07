// ── Version comparison for the update checker ────────────────────────────────
//
// The update checker's one job is to answer "is the published version newer
// than the one running?" without ever guessing. That means a comparison that
// refuses to decide when it cannot parse both sides: an unrecognisable tag must
// yield "no update", never a false alarm. This module is pure — no network, no
// state — so it is trivially testable and shared by the server route and the
// client badge alike.

/** A parsed semantic version. Prerelease/build metadata is intentionally dropped. */
export interface SemVer {
  major: number;
  minor: number;
  patch: number;
}

/**
 * Parse `X.Y.Z` (an optional leading `v`/`V` and any `-prerelease`/`+build`
 * suffix are tolerated), or return null when the three core numbers are not all
 * present. Null is the honest answer for a tag we do not understand, and the
 * caller treats it as "cannot compare" rather than risking a wrong verdict.
 */
export function parseVersion(raw: string): SemVer | null {
  const m = /^\s*v?(\d+)\.(\d+)\.(\d+)/i.exec(raw.trim());
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

/**
 * True only when `latest` is a valid semver strictly greater than `current`.
 *
 * If either side fails to parse the answer is false: the checker would rather
 * miss a real update than announce one that is not there, which is the whole
 * accuracy contract of this tool applied to its own version number.
 */
export function isNewerVersion(latest: string, current: string): boolean {
  const a = parseVersion(latest);
  const b = parseVersion(current);
  if (!a || !b) return false;
  if (a.major !== b.major) return a.major > b.major;
  if (a.minor !== b.minor) return a.minor > b.minor;
  return a.patch > b.patch;
}

/**
 * The result of one update check, as returned by `/api/version` and rendered by
 * the header badge. `latest` is only ever a real tag GitHub returned or null;
 * `updateAvailable` is only ever true when a newer release genuinely exists.
 */
export interface UpdateInfo {
  /** The version of the running build (APP_VERSION). */
  current: string;
  /** The latest published release tag, or null when it could not be determined. */
  latest: string | null;
  /** True only when `latest` parsed and is strictly newer than `current`. */
  updateAvailable: boolean;
  /** A link the user can open: the specific release page, else the releases index. */
  url: string;
  /** ISO timestamp the latest release was published, when known. */
  publishedAt: string | null;
  /** Epoch ms this check was performed. */
  checkedAt: number;
  /** True when GitHub was reached and answered with a usable release. */
  ok: boolean;
  /** Set when ok is false: a short, user-safe reason the check did not land. */
  reason?: string;
}
