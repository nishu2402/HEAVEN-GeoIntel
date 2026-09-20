import { vi } from "vitest";

// No test may reach real DNS. The SSRF guard (resolvesPublic in
// src/lib/server/httpProbe.ts) resolves every host before anything connects to
// it, so without this a probe test would pass or fail with the network it ran
// on. By default every name resolves to one public address; a test that needs
// an inward or failed answer overrides `lookup` for that call.
vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(async () => [{ address: "104.20.0.1", family: 4 }]),
}));
