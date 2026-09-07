// ── "Is a newer release available?" ──────────────────────────────────────────
//
// The one place the app looks itself up. It asks the GitHub Releases API for the
// latest published release of this repo and compares its tag to the running
// APP_VERSION. Releases (not raw commits) are the source of truth on purpose:
// they line up with the repo's existing tag discipline — `release:verify`
// already requires a tag at the commit that declares APP_VERSION — and they give
// the user a real page to open.
//
// Two rules make this safe to show in the UI:
//   • It never invents a version. `latest` is a tag GitHub actually returned or
//     null; `updateAvailable` is true only when that tag parses and is strictly
//     newer. A 404 (no release yet), a 403 (unauthenticated rate limit) or an
//     offline box all resolve to "could not check", never a false alarm.
//   • It is cached for an hour, so a busy instance makes at most one GitHub call
//     an hour and cannot burn the 60-request unauthenticated quota.

import { APP_VERSION, REPO_SLUG, RELEASES_URL } from "../version";
import { fetchJson } from "./fetchSafe";
import { isNewerVersion, type UpdateInfo } from "../update/semver";

/** GitHub's "latest published, non-draft, non-prerelease release" for this repo. */
const LATEST_RELEASE_URL = `https://api.github.com/repos/${REPO_SLUG}/releases/latest`;

/** One hour: gentle on the unauthenticated GitHub quota, fresh enough for a release cadence. */
const TTL_MS = 60 * 60 * 1000;

/** Only the release fields we use. GitHub returns far more; we ignore it. */
interface GithubRelease {
  tag_name?: string;
  html_url?: string;
  published_at?: string;
}

let cache: { at: number; info: UpdateInfo } | null = null;

/**
 * Drop the cached check. Test-only seam: the cache is module-level state that
 * would otherwise leak a result from one test into the next.
 */
export function resetUpdateCacheForTests(): void {
  cache = null;
}

async function fetchLatest(): Promise<UpdateInfo> {
  const base: UpdateInfo = {
    current: APP_VERSION,
    latest: null,
    updateAvailable: false,
    url: RELEASES_URL,
    publishedAt: null,
    checkedAt: Date.now(),
    ok: false,
  };

  // fetchJson sets the User-Agent GitHub demands (a UA-less request is answered
  // 403) and never throws — a network error comes back as ok:false.
  const res = await fetchJson<GithubRelease>(LATEST_RELEASE_URL, {
    source: "GitHub Releases",
    init: { headers: { Accept: "application/vnd.github+json" } },
  });

  if (!res.ok || !res.data) {
    // GitHub answers /releases/latest with 404 specifically when the repo has no
    // published release yet, which is an ordinary state (not an error) before the
    // first tagged release. Every other failure keeps its transport reason.
    const reason = res.status === 404 ? "no releases published yet" : (res.error ?? "could not reach GitHub");
    return { ...base, reason };
  }

  const tag = res.data.tag_name?.trim();
  if (!tag) {
    return { ...base, ok: true, reason: "the latest release carries no version tag" };
  }

  return {
    current: APP_VERSION,
    latest: tag,
    updateAvailable: isNewerVersion(tag, APP_VERSION),
    url: res.data.html_url?.trim() || RELEASES_URL,
    publishedAt: res.data.published_at ?? null,
    checkedAt: Date.now(),
    ok: true,
  };
}

/**
 * The latest-release check, cached for an hour.
 *
 * `force` (the "Check for updates" button) bypasses the cache. Only a
 * successful check is cached: a transient failure must not pin "could not
 * check" for an hour, and — just as important — a failure must never be served
 * later as if it were a clean "up to date" answer.
 */
export async function getUpdateInfo(force = false): Promise<UpdateInfo> {
  if (!force && cache && Date.now() - cache.at < TTL_MS) return cache.info;
  const info = await fetchLatest();
  if (info.ok) cache = { at: Date.now(), info };
  return info;
}
