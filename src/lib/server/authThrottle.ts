// ── Slowing down password guessing at the Basic auth gate ───────────────────
//
// `AUTH_PASSWORD` is what an operator sets before putting this console on a LAN
// or behind a tunnel, so the gate is precisely where a guess has to cost
// something. Measured against the built server before this existed: 300 wrong
// passwords in 2.2 seconds, every one answered 401 at full speed — and that was
// sequential `curl`, process startup included, so a real client does far better.
//
// The per-route limiter in rateLimit.ts cannot help here. It runs inside the
// route handlers, and the proxy answers 401 long before any handler is reached;
// that is exactly why the 300 attempts above never saw a 429.
//
// A DELAY, rather than a lockout, is the shape this has to take:
//
//   * A lockout keyed on the client would not hold, because an unauthenticated
//     caller chooses their own `hv_rl` cookie and a fresh one buys a fresh
//     bucket. Keying it globally instead would work, and would hand any passer-by
//     the ability to lock the operator out of their own tool — a worse bug than
//     the one being fixed.
//   * A delay cannot lock anyone out. The operator who fat-fingers their
//     password twice waits nothing at all, and the right password is still the
//     right password however long the attacker has been at it.
//
// The delay is capped so that a flood of guesses cannot pin open an unbounded
// number of sockets: past the cap each wrong guess costs a second, which turns
// a brute-force rate of thousands per second into roughly one per second per
// connection, while a sleeping request holds only a timer.

/** Failures that cost nothing, so ordinary mistyping is never punished. */
const FREE_ATTEMPTS = 3;
/** Ceiling on one wrong guess, so a flood costs the attacker more than us. */
const MAX_DELAY_MS = 1000;
/** A quiet spell this long forgets the failures entirely. */
const WINDOW_MS = 15 * 60_000;

let failures = 0;
let last = 0;

/**
 * How long the response to a WRONG password should be held back, in
 * milliseconds. Counting is global on purpose (see the note above); since only
 * failures are counted and a correct password always passes, there is nothing
 * here for an attacker to deny the operator.
 */
export function authFailureDelayMs(now: number = Date.now()): number {
  if (last && now - last > WINDOW_MS) failures = 0;
  last = now;
  failures += 1;
  if (failures <= FREE_ATTEMPTS) return 0;
  // 2^n from the first non-free failure, capped: 1ms, 2, 4, 8 … 1000.
  return Math.min(2 ** (failures - FREE_ATTEMPTS - 1), MAX_DELAY_MS);
}

/** A correct password clears the debt, so the next mistake is free again. */
export function clearAuthFailures(): void {
  failures = 0;
  last = 0;
}

/** Test seam: start from a known state. */
export const resetAuthThrottle = clearAuthFailures;

/** Resolve after `ms`, or immediately when there is nothing to wait for. */
export function delay(ms: number): Promise<void> {
  /* v8 ignore next -- the zero case returns before a timer is ever created. */
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    // A pending punishment must not, by itself, keep the process alive.
    t.unref?.();
  });
}
