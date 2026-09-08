import { describe, it, expect } from "vitest";
import { getServerSnapshot } from "@/lib/update/updateStore";

// The store is exercised end to end through the components (see updateChecker
// and updateBanner suites). The one path those cannot reach from jsdom is the
// server snapshot, which React only calls during SSR: it must hand back the
// neutral initial state so the server HTML carries no banner and no badge, which
// is exactly what the client renders before its first check — the guarantee that
// hydration stays clean.
describe("update store server snapshot", () => {
  it("is the neutral initial state", () => {
    expect(getServerSnapshot()).toEqual({ info: null, loading: false, failed: false });
  });
});
