import { describe, it, expect } from "vitest";
import { USERNAME_SITES, isPlausibleUsername } from "@/lib/usernameSites";

describe("usernameSites catalog", () => {
  it("every site has a {u} placeholder and a valid check method", () => {
    for (const s of USERNAME_SITES) {
      expect(s.url, s.name).toContain("{u}");
      expect(["status", "body", "manual"], s.name).toContain(s.check);
    }
  });

  it("body-checks carry an absence marker; status/manual do not need one", () => {
    for (const s of USERNAME_SITES) {
      if (s.check === "body") expect(s.absence, `${s.name} needs an absence marker`).toBeTruthy();
    }
  });

  it("bot-walled SPAs that answer 200 for everyone are 'manual' (never auto-claimed)", () => {
    // These were empirically verified to return HTTP 200 for both real and
    // nonexistent usernames — a status check would be a guaranteed false positive.
    const mustBeManual = [
      "Instagram", "TikTok", "X / Twitter", "Reddit", "Telegram", "Threads",
      "Bluesky", "Pinterest", "Spotify", "PyPI", "Replit", "Kaggle",
      "Trello", "Twitch", "Xbox Gamertag",
    ];
    for (const name of mustBeManual) {
      const site = USERNAME_SITES.find((s) => s.name === name);
      expect(site, `${name} should exist in the catalog`).toBeTruthy();
      expect(site!.check, `${name} must be manual (cannot be verified server-side)`).toBe("manual");
    }
  });

  it("reliable 404-based forges stay auto-checked (status)", () => {
    for (const name of ["GitHub", "GitLab", "Codeberg", "Docker Hub"]) {
      const site = USERNAME_SITES.find((s) => s.name === name);
      expect(site?.check, name).toBe("status");
    }
  });

  it("validates plausible usernames and rejects junk", () => {
    expect(isPlausibleUsername("torvalds")).toBe(true);
    expect(isPlausibleUsername("a.b-c_d")).toBe(true);
    expect(isPlausibleUsername("x")).toBe(false);          // too short
    expect(isPlausibleUsername("has space")).toBe(false);  // illegal char
    expect(isPlausibleUsername("a".repeat(41))).toBe(false); // too long
  });
});
