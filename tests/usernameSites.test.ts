import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { USERNAME_SITES, isPlausibleUsername, emailToUsernameCandidate } from "@/lib/data/usernameSites";

const ROOT = join(__dirname, "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

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

  it("sites we cannot verify server-side are 'manual' (never auto-claimed)", () => {
    // Two reasons a site is manual, both verified with live probes of a real vs.
    // a nonexistent handle:
    //   (a) a JS SPA / bot-wall that returns HTTP 200 for EVERYONE — a status
    //       check there would be a guaranteed false positive; and
    //   (b) an anti-bot challenge (Cloudflare/Anubis/Fastly) that 403s our
    //       keyless server fetch for real and fake users alike — a status check
    //       there only ever yields "unknown" noise.
    const mustBeManual = [
      // (a) 200-for-everyone SPAs / bot-walls
      "Instagram", "TikTok", "X / Twitter", "Telegram", "Threads",
      "Bluesky", "Pinterest", "Spotify", "PyPI", "Replit", "Kaggle",
      "Trello", "Twitch", "Xbox Gamertag",
      // (b) anti-bot challenge that blocks our fetch (was falsely "status" before)
      "npm", "Codeberg", "CodePen", "Product Hunt", "Last.fm",
    ];
    for (const name of mustBeManual) {
      const site = USERNAME_SITES.find((s) => s.name === name);
      expect(site, `${name} should exist in the catalog`).toBeTruthy();
      expect(site!.check, `${name} must be manual (cannot be verified server-side)`).toBe("manual");
    }
  });

  it("sites that return a clean 200/404 stay auto-checked (status)", () => {
    // Each verified with a live probe: 200 for a known-real handle, 404 for a
    // known-nonexistent one. Medium is probed via its RSS feed (see profile URL).
    for (const name of [
      "Docker Hub", "Mastodon (.social)", "VK", "YouTube", "SoundCloud",
      "DeviantArt", "Flickr", "Vimeo", "Medium", "Patreon", "Chess.com",
      "Lichess", "Roblox", "itch.io", "Tumblr", "Keybase", "Linktree",
      "Buy Me a Coffee", "Wattpad",
    ]) {
      const site = USERNAME_SITES.find((s) => s.name === name);
      expect(site?.check, name).toBe("status");
    }
  });

  it("Medium is probed via its (unwalled) RSS feed but linked to the pretty profile", () => {
    const medium = USERNAME_SITES.find((s) => s.name === "Medium");
    expect(medium?.url).toBe("https://medium.com/feed/@{u}");
    expect(medium?.profile).toBe("https://medium.com/@{u}");
  });

  it("does not include GitHub Sponsors (302-redirects to the plain GitHub profile → misleading)", () => {
    expect(USERNAME_SITES.find((s) => s.name === "GitHub Sponsors")).toBeUndefined();
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

describe("everything that states the catalog's size agrees with the catalog", () => {
  // This is the claim that has drifted more than any other in the project: the
  // README said 44, then 47, while the array held 43, and the help popover
  // still said 44 after both "corrections". These are the only places the size
  // is written out in prose; each one is checked against the array itself.
  const total = USERNAME_SITES.length;
  const auto = USERNAME_SITES.filter((s) => s.check !== "manual").length;
  const manual = USERNAME_SITES.filter((s) => s.check === "manual").length;

  it("the in-app help popover names the real number of sites", () => {
    expect(read("src/components/shared/HelpPopover.tsx")).toContain(`${total} sites, no false positives`);
  });

  it("the README's badge and API cheat-sheet name the real numbers", () => {
    const readme = read("README.md");
    expect(readme).toContain(`${auto} auto-verified + ${manual} manual`);
    expect(readme).toContain(`Username-${total}`);
    // A stale count is only half the risk; the split has to add up too, or the
    // README can be internally consistent and still wrong.
    expect(auto + manual).toBe(total);
  });
});
