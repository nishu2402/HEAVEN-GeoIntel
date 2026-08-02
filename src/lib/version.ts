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

/** Full semver, as published. Matches `version` in package.json. */
export const APP_VERSION = "2.0.1";

/** `major.minor` — what the UI shows and what upstreams see. */
export const APP_VERSION_SHORT = APP_VERSION.split(".").slice(0, 2).join(".");

/**
 * Outbound User-Agent for every third-party call.
 *
 * Deliberately identifies the tool: several of the free sources this app leans
 * on (Hudson Rock, LeakCheck, Certspotter, crt.sh, RDAP) are run as a public
 * good, and an operator who needs to throttle or contact a noisy client can
 * only do that if the client says what it is. The patch level is left off so a
 * bugfix release does not look like a new client to their logs.
 */
export const USER_AGENT = `HEAVEN-GeoIntel/${APP_VERSION_SHORT}`;
