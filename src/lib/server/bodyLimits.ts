// ── How large a request body may be ──────────────────────────────────────────
//
// Two places enforce this and they have to agree:
//
//   `src/proxy.ts`  rejects early on Content-Length. Cheap, and it spares the
//                   runtime from buffering a body it is only going to throw
//                   away — but a client picks whether to send that header at
//                   all, so this is a courtesy, not a gate.
//   `parseBody`     counts the bytes as they arrive. This is the real gate.
//                   Measured against the built server before it existed: a
//                   `Transfer-Encoding: chunked` POST carries no Content-Length,
//                   walked straight past the proxy, and was buffered whole up to
//                   somewhere between 8 and 16 MB — about thirty times the
//                   documented cap, from an unauthenticated caller.
//
// The default is deliberately small; the largest ordinary request is a bulk job
// of 1000 identifiers at 256 characters, which fits with room to spare.
//
// Two routes genuinely need more, and listing them here is what makes them
// work: the proxy's flat cap used to reject EVERY evidence capture over 512 KB
// with a 413, so the locker's documented 4 MB artifact could not be stored at
// all, and a case import carrying a real investigation's snapshots hit the same
// wall. Neither failure was visible in a unit test, because neither the proxy
// nor a duck-typed request runs in one.

/** The ceiling for every route that is not listed below. */
export const DEFAULT_MAX_BODY_BYTES = 512 * 1024;

/**
 * Room for one `MAX_EVIDENCE_BYTES` artifact (4 MB, see evidenceStore.ts) plus
 * the JSON envelope around it, and for a case import of the same order.
 */
export const LARGE_MAX_BODY_BYTES = 4 * 1024 * 1024 + 64 * 1024;

/** The routes that store a document rather than describe a lookup. */
const LARGE_BODY_PATHS = new Set(["/api/evidence", "/api/cases"]);

/** The ceiling that applies to a request for `pathname`. */
export function maxBodyBytes(pathname: string): number {
  return LARGE_BODY_PATHS.has(pathname) ? LARGE_MAX_BODY_BYTES : DEFAULT_MAX_BODY_BYTES;
}
