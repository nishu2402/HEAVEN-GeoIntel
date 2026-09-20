import { describe, it, expect, beforeEach } from "vitest";
import {
  authFailureDelayMs, clearAuthFailures, resetAuthThrottle, delay,
} from "@/lib/server/authThrottle";

// What this is defending: AUTH_PASSWORD is the gate an operator sets before
// putting the console on a LAN or a tunnel, and it had no cost per guess at
// all. Measured against the built server: 300 wrong passwords in 2.2 seconds,
// every one answered 401 at full speed, with no 429 anywhere — the per-route
// limiter runs inside the handlers and the proxy refuses long before them.

beforeEach(resetAuthThrottle);

describe("authFailureDelayMs", () => {
  it("does not punish ordinary mistyping", () => {
    // Three free failures: nobody who fumbles their own password waits.
    expect(authFailureDelayMs(1000)).toBe(0);
    expect(authFailureDelayMs(1001)).toBe(0);
    expect(authFailureDelayMs(1002)).toBe(0);
  });

  it("doubles the wait once guessing starts, and stops at the ceiling", () => {
    for (let i = 0; i < 3; i++) authFailureDelayMs(1000 + i);
    const waits = Array.from({ length: 14 }, (_, i) => authFailureDelayMs(2000 + i));
    expect(waits.slice(0, 5)).toEqual([1, 2, 4, 8, 16]);
    // Capped, so a flood of guesses cannot pin open an unbounded number of
    // sockets: past here each wrong guess costs a second and no more.
    expect(waits.at(-1)).toBe(1000);
    expect(Math.max(...waits)).toBe(1000);
  });

  it("clears the debt on a correct password", () => {
    for (let i = 0; i < 8; i++) authFailureDelayMs(1000 + i);
    expect(authFailureDelayMs(1100)).toBeGreaterThan(0);
    clearAuthFailures();
    expect(authFailureDelayMs(1200)).toBe(0);
  });

  it("forgets a quiet spell, so yesterday's attack is not today's delay", () => {
    for (let i = 0; i < 8; i++) authFailureDelayMs(1000 + i);
    expect(authFailureDelayMs(1100)).toBeGreaterThan(0);
    // Sixteen minutes later the window has lapsed.
    expect(authFailureDelayMs(1100 + 16 * 60_000)).toBe(0);
  });
});

describe("delay", () => {
  it("resolves immediately when there is nothing to wait for", async () => {
    const started = Date.now();
    await delay(0);
    expect(Date.now() - started).toBeLessThan(50);
  });

  it("actually waits when there is", async () => {
    const started = Date.now();
    await delay(20);
    expect(Date.now() - started).toBeGreaterThanOrEqual(15);
  });
});
