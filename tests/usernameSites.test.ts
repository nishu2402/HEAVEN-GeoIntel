import { describe, it, expect } from "vitest";
import { USERNAME_SITES, isPlausibleUsername, emailToUsernameCandidate } from "@/lib/data/usernameSites";

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
      "Instagram", "TikTok", "X / Twitter", "Telegram", "Threads",
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
    for (const name of ["Codeberg", "Docker Hub", "npm", "CodePen"]) {
      const site = USERNAME_SITES.find((s) => s.name === name);
      expect(site?.check, name).toBe("status");
    }
  });

  it("keyless-API providers are handled as rich profiles, not in the sweep catalog", () => {
    // GitHub / GitLab / Hacker News / Reddit each have a structured public API,
    // so the route verifies them via analysis/usernameProfiles (real name, karma,
    // repos, join date) instead of a bare probe. They must NOT appear here.
    for (const name of ["GitHub", "GitLab", "Hacker News", "Reddit"]) {
      expect(USERNAME_SITES.find((s) => s.name === name), name).toBeUndefined();
    }
  });

  it("validates plausible usernames and rejects junk", () => {
    expect(isPlausibleUsername("torvalds")).toBe(true);
    expect(isPlausibleUsername("a.b-c_d")).toBe(true);
    expect(isPlausibleUsername("x")).toBe(false);          // too short
    expect(isPlausibleUsername("has space")).toBe(false);  // illegal char
    expect(isPlausibleUsername("a".repeat(41))).toBe(false); // too long
  });

  it("derives a username candidate from an email local-part (email→username pivot)", () => {
    expect(emailToUsernameCandidate("jdoe@example.com")).toBe("jdoe");
    expect(emailToUsernameCandidate("John.Doe@example.com")).toBe("John.Doe"); // case preserved
    expect(emailToUsernameCandidate("john.doe+newsletter@gmail.com")).toBe("john.doe"); // +tag stripped
    expect(emailToUsernameCandidate("a@example.com")).toBeNull();       // local-part too short
    expect(emailToUsernameCandidate("+tag@example.com")).toBeNull();    // empty local-part
    expect(emailToUsernameCandidate("has space@example.com")).toBeNull(); // illegal char
    expect(emailToUsernameCandidate("barehandle")).toBe("barehandle");  // no @ → treat whole as local
  });
});
