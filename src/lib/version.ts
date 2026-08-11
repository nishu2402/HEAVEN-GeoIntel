// ── The app version, in one place ────────────────────────────────────────────
//
// Before this file the version was written out by hand in eight places, and
// they had already drifted: `package.json` and `/api/health` said 1.3.0, the
// OpenAPI spec said 1.4.0, and the outbound User-Agent said 1.3. A version an
// upstream sees, a version a probe reports and a version the analyst reads on
// screen disagreeing with each other is a support problem — a bug report says
// "1.3" and nobody can tell which build that was.
//
// Everything now derives from `APP_VERSION`, and `tests/versionSync.test.ts`
// fails the build if package.json, docker-compose.yml, SECURITY.md,
// scripts/start.sh or the README fall out of step with it. The literal is
// duplicated from package.json on purpose rather than imported: importing JSON
// into the client bundle would ship the whole manifest (including the full
// dependency list) to the browser. The test is what keeps the two honest.
//
// ── One version, shown in full ──
// 2.0.x displayed `major.minor` in the header, the boot sequence, the launcher
// banner, the Docker tag and the User-Agent, on the theory that a patch release
// should not read as a new client. In practice it recreated the exact problem
// this module exists to solve: the app shipped as 2.0.1 with a header reading
// "v2.0", so a screenshot could not tell you which build produced it — and a
// screenshot is how bugs actually get reported. Every surface now carries the
// full semver. `APP_VERSION_BRANCH` survives for the one place that genuinely
// means a *range* rather than a build: the supported-versions table in
// SECURITY.md, where "2.1.x" is the claim being made.

/** Full semver, as published. Matches `version` in package.json. */
export const APP_VERSION = "2.1.0";

/**
 * `major.minor` — the release *branch*, not a build.
 *
 * Only for places that describe a range of releases. Do not use it to label a
 * running build: that is what `APP_VERSION` is for.
 */
export const APP_VERSION_BRANCH = APP_VERSION.split(".").slice(0, 2).join(".");

/**
 * Outbound User-Agent for every third-party call.
 *
 * Deliberately identifies the tool: several of the free sources this app leans
 * on (Hudson Rock, LeakCheck, Certspotter, crt.sh, RDAP) are run as a public
 * good, and an operator who needs to throttle or contact a noisy client can
 * only do that if the client says what it is. It carries the full version for
 * the same reason — an operator correlating a behaviour change to a release
 * needs the patch level, and they bucket by product name, not by exact version.
 */
export const USER_AGENT = `HEAVEN-GeoIntel/${APP_VERSION}`;
