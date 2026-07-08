import { describe, it, expect } from "vitest";
import {
  normalizeGithub, normalizeGitlab, normalizeHackerNews, normalizeReddit, deriveIdentity,
} from "@/lib/analysis/usernameProfiles";
import type { SocialProfile } from "@/lib/types";

// These normalisers are the no-false-positive boundary: a malformed / partial /
// missing payload MUST collapse to null rather than invent a profile. Each block
// covers both the happy path and the "reject junk" path.

describe("normalizeGithub", () => {
  it("maps a full GitHub user payload", () => {
    const p = normalizeGithub({
      login: "torvalds", name: "Linus Torvalds", bio: "creator of linux & git",
      company: "Linux Foundation", location: "Portland, OR", followers: 200000,
      following: 0, public_repos: 8, created_at: "2011-09-03T15:26:22Z",
      avatar_url: "https://avatars.githubusercontent.com/u/1024025", html_url: "https://github.com/torvalds",
    });
    expect(p).not.toBeNull();
    expect(p!.platform).toBe("GitHub");
    expect(p!.handle).toBe("torvalds");
    expect(p!.displayName).toBe("Linus Torvalds");
    expect(p!.joinedYear).toBe("2011");
    expect(p!.location).toBe("Portland, OR");
    expect(p!.extra).toBe("Linux Foundation");
    expect(p!.stats).toEqual([
      { label: "repos", value: "8" },
      { label: "followers", value: "200000" },
      { label: "following", value: "0" },
    ]);
  });

  it("falls back to a constructed URL and zero stats when fields are missing", () => {
    const p = normalizeGithub({ login: "x" });
    expect(p!.url).toBe("https://github.com/x");
    expect(p!.stats.map((s) => s.value)).toEqual(["0", "0", "0"]);
    expect(p!.joinedYear).toBeNull();
    expect(p!.avatarUrl).toBeNull();
  });

  it("rejects a payload with no login (or a non-object)", () => {
    expect(normalizeGithub({ message: "Not Found" })).toBeNull();
    expect(normalizeGithub(null)).toBeNull();
    expect(normalizeGithub("nope")).toBeNull();
    expect(normalizeGithub({ login: "   " })).toBeNull();
  });

  it("ignores a non-finite stat value", () => {
    const p = normalizeGithub({ login: "x", followers: Number.NaN, public_repos: 3 });
    expect(p!.stats[0]).toEqual({ label: "repos", value: "3" });
    expect(p!.stats[1]).toEqual({ label: "followers", value: "0" });
  });

  it("yields a null join year for an unparseable created_at", () => {
    expect(normalizeGithub({ login: "x", created_at: "not-a-real-date" })!.joinedYear).toBeNull();
  });
});

describe("normalizeGitlab", () => {
  it("maps the first element of the users array", () => {
    const p = normalizeGitlab([{ username: "gitlab-user", name: "GL User", web_url: "https://gitlab.com/gitlab-user", avatar_url: "https://secure.gravatar.com/avatar/abc", created_at: "2018-05-01T00:00:00Z" }]);
    expect(p!.platform).toBe("GitLab");
    expect(p!.handle).toBe("gitlab-user");
    expect(p!.displayName).toBe("GL User");
    expect(p!.joinedYear).toBe("2018");
    expect(p!.stats).toEqual([]);
  });

  it("constructs the URL when web_url is absent", () => {
    const p = normalizeGitlab([{ username: "u" }]);
    expect(p!.url).toBe("https://gitlab.com/u");
  });

  it("returns null for an empty array, a non-array, or a nameless entry", () => {
    expect(normalizeGitlab([])).toBeNull();
    expect(normalizeGitlab({ username: "u" })).toBeNull();
    expect(normalizeGitlab([{ name: "no username" }])).toBeNull();
    expect(normalizeGitlab(null)).toBeNull();
  });
});

describe("normalizeHackerNews", () => {
  it("maps a HN user with karma + epoch-seconds join date and strips HTML from about", () => {
    const p = normalizeHackerNews({ id: "pg", karma: 155000, created: 1160418111, about: "Founder of <a href=\"x\">YC</a> &amp; Viaweb" });
    expect(p!.platform).toBe("Hacker News");
    expect(p!.handle).toBe("pg");
    expect(p!.url).toBe("https://news.ycombinator.com/user?id=pg");
    expect(p!.stats).toEqual([{ label: "karma", value: "155000" }]);
    expect(p!.joinedYear).toBe("2006");
    expect(p!.bio).toBe("Founder of YC & Viaweb");
    expect(p!.avatarUrl).toBeNull();
  });

  it("defaults karma to 0 and bio to null; rejects the missing-user null body", () => {
    const p = normalizeHackerNews({ id: "u", created: 0 });
    expect(p!.stats[0].value).toBe("0");
    expect(p!.bio).toBeNull();
    expect(p!.joinedYear).toBeNull();            // created <= 0 → null
    expect(normalizeHackerNews(null)).toBeNull(); // HN returns literal null for a missing user
    expect(normalizeHackerNews({ karma: 5 })).toBeNull();
  });

  it("treats an about that is only markup/whitespace as no bio", () => {
    expect(normalizeHackerNews({ id: "u", about: "<p>  </p>" })!.bio).toBeNull();
  });
});

describe("normalizeReddit", () => {
  it("maps an about.json payload with karma split and subreddit description", () => {
    const p = normalizeReddit({ kind: "t2", data: {
      name: "spez", link_karma: 900, comment_karma: 100, created_utc: 1118030400,
      subreddit: { title: "spez", public_description: "reddit ceo" },
    } });
    expect(p!.platform).toBe("Reddit");
    expect(p!.handle).toBe("spez");
    expect(p!.url).toBe("https://www.reddit.com/user/spez");
    expect(p!.displayName).toBe("spez");
    expect(p!.bio).toBe("reddit ceo");
    expect(p!.joinedYear).toBe("2005");
    expect(p!.avatarUrl).toBeNull();
    expect(p!.extra).toBeNull();
    expect(p!.stats).toEqual([
      { label: "post karma", value: "900" },
      { label: "comment karma", value: "100" },
    ]);
  });

  it("flags a suspended account and tolerates a missing subreddit block", () => {
    const p = normalizeReddit({ data: { name: "banned", is_suspended: true } });
    expect(p!.extra).toBe("account suspended");
    expect(p!.displayName).toBeNull();
    expect(p!.bio).toBeNull();
    expect(p!.stats.map((s) => s.value)).toEqual(["0", "0"]);
  });

  it("rejects a 404 body, a missing data block, or a nameless account", () => {
    expect(normalizeReddit({ message: "Not Found", error: 404 })).toBeNull();
    expect(normalizeReddit({ data: null })).toBeNull();
    expect(normalizeReddit({ data: { id: "t2_x" } })).toBeNull();
    expect(normalizeReddit(null)).toBeNull();
  });
});

describe("deriveIdentity", () => {
  const mk = (over: Partial<SocialProfile>): SocialProfile => ({
    platform: "GitHub", category: "developer", handle: "h", url: "https://x", avatarUrl: null,
    displayName: null, bio: null, stats: [], joinedYear: null, location: null, extra: null, ...over,
  });

  it("collects distinct names / locations / avatars / bios with source attribution", () => {
    const profiles = [
      mk({ platform: "GitHub", displayName: "Linus Torvalds", location: "Portland", avatarUrl: "https://a/1", bio: "linux" }),
      mk({ platform: "GitLab", displayName: "Linus Torvalds", location: "Portland, OR", avatarUrl: "https://a/2", bio: "linux" }),
    ];
    const id = deriveIdentity(profiles);
    expect(id.names).toEqual([{ value: "Linus Torvalds", source: "GitHub" }]);   // case/value dedupe, first wins
    expect(id.locations.map((l) => l.value)).toEqual(["Portland", "Portland, OR"]); // genuinely different → both
    expect(id.avatars).toHaveLength(2);
    expect(id.bios).toEqual([{ value: "linux", source: "GitHub" }]);              // identical bio deduped
  });

  it("dedupes names case-insensitively and skips empty fields", () => {
    const id = deriveIdentity([
      mk({ platform: "Reddit", displayName: "jDoe" }),
      mk({ platform: "GitLab", displayName: "jdoe" }),
      mk({ platform: "GitHub" }),
    ]);
    expect(id.names).toEqual([{ value: "jDoe", source: "Reddit" }]);
    expect(id.locations).toEqual([]);
    expect(id.avatars).toEqual([]);
    expect(id.bios).toEqual([]);
  });

  it("dedupes an identical avatar URL and location shared by two profiles", () => {
    const id = deriveIdentity([
      mk({ platform: "GitHub", avatarUrl: "https://a/same", location: "Berlin" }),
      mk({ platform: "GitLab", avatarUrl: "https://a/same", location: "berlin" }),
    ]);
    expect(id.avatars).toEqual([{ url: "https://a/same", source: "GitHub" }]);
    expect(id.locations).toEqual([{ value: "Berlin", source: "GitHub" }]);
  });

  it("returns empty arrays for no profiles", () => {
    expect(deriveIdentity([])).toEqual({ names: [], locations: [], avatars: [], bios: [] });
  });
});
