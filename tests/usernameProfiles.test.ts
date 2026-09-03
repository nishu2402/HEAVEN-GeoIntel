import { describe, it, expect } from "vitest";
import {
  normalizeGithub, normalizeGitlab, normalizeHackerNews, normalizeReddit,
  normalizeBluesky, normalizeMastodon, normalizeCodeberg, normalizeChessCom,
  normalizeLichess, deriveIdentity,
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

describe("normalizeBluesky", () => {
  it("maps an AT Protocol profile payload", () => {
    const p = normalizeBluesky({
      did: "did:plc:oky5czdrnfjpqslsw2a5iclo",
      handle: "jay.bsky.team",
      displayName: "Jay",
      description: "Founder & Chief Innovation Officer @ Bluesky",
      avatar: "https://cdn.bsky.app/img/avatar/plain/did:plc:oky5/x@jpeg",
      createdAt: "2022-11-17T06:31:40.296Z",
      followersCount: 595018, followsCount: 3974, postsCount: 4110,
    });
    expect(p!.platform).toBe("Bluesky");
    expect(p!.handle).toBe("jay.bsky.team");
    expect(p!.displayName).toBe("Jay");
    expect(p!.joinedYear).toBe("2022");
    expect(p!.url).toBe("https://bsky.app/profile/jay.bsky.team");
    expect(p!.stats).toEqual([
      { label: "followers", value: "595018" },
      { label: "following", value: "3974" },
      { label: "posts", value: "4110" },
    ]);
    expect(p!.extra).toBeNull(); // unverified account
  });

  it("surfaces a valid platform verification", () => {
    const p = normalizeBluesky({
      handle: "bsky.app",
      verification: { verifiedStatus: "valid", trustedVerifierStatus: "none" },
    });
    expect(p!.extra).toBe("verified by Bluesky");
  });

  it("ignores a verification block that is not a valid status", () => {
    expect(normalizeBluesky({ handle: "a.bsky.social", verification: { verifiedStatus: "none" } })!.extra).toBeNull();
    expect(normalizeBluesky({ handle: "a.bsky.social", verification: "nonsense" })!.extra).toBeNull();
  });

  it("rejects the 'Profile not found' error body rather than inventing an account", () => {
    // The appview answers a missing handle with 400 + this body. It carries no
    // handle, so it can never become a profile even if a caller forwards it.
    expect(normalizeBluesky({ error: "InvalidRequest", message: "Profile not found" })).toBeNull();
  });

  it("rejects junk and non-objects", () => {
    expect(normalizeBluesky(null)).toBeNull();
    expect(normalizeBluesky("nope")).toBeNull();
    expect(normalizeBluesky({ handle: "   " })).toBeNull();
  });

  it("defaults absent counts to zero and an unparseable date to null", () => {
    const p = normalizeBluesky({ handle: "sparse.bsky.social", createdAt: "not-a-date" });
    expect(p!.stats.map((s) => s.value)).toEqual(["0", "0", "0"]);
    expect(p!.joinedYear).toBeNull();
    expect(p!.displayName).toBeNull();
    expect(p!.bio).toBeNull();
    expect(p!.avatarUrl).toBeNull();
    expect(p!.location).toBeNull();
  });

  it("percent-encodes a handle into the profile URL", () => {
    expect(normalizeBluesky({ handle: "a b.bsky.social" })!.url)
      .toBe("https://bsky.app/profile/a%20b.bsky.social");
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

// ── The four providers added after the keyless-API sweep ─────────────────────
// Each was promoted only after 4 known-real and 4 known-absent handles produced
// a clean 200/404 split, so these tests pin the SHAPE rather than the existence
// check: a partial payload must collapse to null or to honest nulls, never to
// invented detail.

describe("normalizeMastodon", () => {
  const raw = {
    acct: "Gargron", username: "Gargron", display_name: "Eugen Rochko",
    note: "<p>Founder of <a href='#'>Mastodon</a>. &amp; more</p>",
    url: "https://mastodon.social/@Gargron", avatar: "https://a/av.png",
    followers_count: 382432, following_count: 736, statuses_count: 82161,
    created_at: "2016-03-16T00:00:00.000Z", bot: false,
  };

  it("maps a full account", () => {
    expect(normalizeMastodon(raw)).toEqual({
      platform: "Mastodon", category: "social", handle: "Gargron",
      url: "https://mastodon.social/@Gargron", avatarUrl: "https://a/av.png",
      displayName: "Eugen Rochko", bio: "Founder of Mastodon . & more",
      stats: [
        { label: "followers", value: "382432" },
        { label: "following", value: "736" },
        { label: "posts", value: "82161" },
      ],
      joinedYear: "2016", location: null, extra: null,
    });
  });

  it("falls back to username when acct is absent, and builds the URL", () => {
    const out = normalizeMastodon({ username: "solo" })!;
    expect(out.handle).toBe("solo");
    expect(out.url).toBe("https://mastodon.social/@solo");
  });

  it("surfaces a bot flag", () => {
    expect(normalizeMastodon({ acct: "feedbot", bot: true })!.extra).toBe("flagged as a bot account");
  });

  it("zeroes absent counts rather than inventing them", () => {
    expect(normalizeMastodon({ acct: "x" })!.stats.every((s) => s.value === "0")).toBe(true);
  });

  it("returns null for a non-object or a payload with no handle", () => {
    expect(normalizeMastodon(null)).toBeNull();
    expect(normalizeMastodon("nope")).toBeNull();
    expect(normalizeMastodon({ error: "Record not found" })).toBeNull();
  });
});

describe("normalizeCodeberg", () => {
  const raw = {
    login: "crystal", full_name: "Crystal Realname", html_url: "https://codeberg.org/crystal",
    avatar_url: "https://c/av", description: "<b>hi</b>", location: "Berlin",
    website: "https://example.org", pronouns: "she/her",
    followers_count: 12, following_count: 3, created: "2020-09-23T05:33:24+02:00",
  };

  it("maps a full account and folds website + pronouns into extra", () => {
    const out = normalizeCodeberg(raw)!;
    expect(out).toMatchObject({
      platform: "Codeberg", category: "developer", handle: "crystal",
      displayName: "Crystal Realname", bio: "hi", location: "Berlin", joinedYear: "2020",
    });
    expect(out.extra).toBe("site: https://example.org · pronouns: she/her");
  });

  it("does not echo the login back as a display name", () => {
    expect(normalizeCodeberg({ login: "crystal", full_name: "crystal" })!.displayName).toBeNull();
  });

  it("builds the profile URL when html_url is missing", () => {
    expect(normalizeCodeberg({ login: "a b" })!.url).toBe("https://codeberg.org/a%20b");
  });

  it("leaves extra null when neither website nor pronouns is set", () => {
    expect(normalizeCodeberg({ login: "x" })!.extra).toBeNull();
  });

  it("includes only the field that is present", () => {
    expect(normalizeCodeberg({ login: "x", website: "https://s" })!.extra).toBe("site: https://s");
    expect(normalizeCodeberg({ login: "x", pronouns: "they/them" })!.extra).toBe("pronouns: they/them");
  });

  it("returns null without a login", () => {
    expect(normalizeCodeberg({ full_name: "No Login" })).toBeNull();
    expect(normalizeCodeberg(undefined)).toBeNull();
  });
});

describe("normalizeChessCom", () => {
  const raw = {
    username: "hikaru", name: "Hikaru Nakamura", url: "https://www.chess.com/member/Hikaru",
    avatar: "https://c/av.png", followers: 1408833, location: "Florida",
    country: "https://api.chess.com/pub/country/US", joined: 1389043258,
    title: "GM", twitch_url: "https://twitch.tv/gmhikaru",
  };

  it("maps a full player and exposes the Twitch cross-pivot", () => {
    const out = normalizeChessCom(raw)!;
    expect(out).toMatchObject({
      platform: "Chess.com", category: "gaming", handle: "hikaru",
      displayName: "Hikaru Nakamura", location: "Florida", joinedYear: "2014",
    });
    expect(out.extra).toBe("GM title · Twitch: https://twitch.tv/gmhikaru");
    expect(out.stats).toEqual([{ label: "followers", value: "1408833" }]);
  });

  it("falls back to the ISO country code when there is no free-text location", () => {
    expect(normalizeChessCom({ username: "x", country: "https://api.chess.com/pub/country/DE" })!.location).toBe("DE");
  });

  it("reports a null location when neither field is present", () => {
    expect(normalizeChessCom({ username: "x" })!.location).toBeNull();
  });

  it("includes only the part of extra that exists", () => {
    expect(normalizeChessCom({ username: "x", title: "IM" })!.extra).toBe("IM title");
    expect(normalizeChessCom({ username: "x", twitch_url: "https://t/x" })!.extra).toBe("Twitch: https://t/x");
    expect(normalizeChessCom({ username: "x" })!.extra).toBeNull();
  });

  it("builds the member URL when the API omits it", () => {
    expect(normalizeChessCom({ username: "a b" })!.url).toBe("https://www.chess.com/member/a%20b");
  });

  it("returns null without a username", () => {
    expect(normalizeChessCom({ name: "Nobody" })).toBeNull();
    expect(normalizeChessCom(42)).toBeNull();
  });
});

describe("normalizeLichess", () => {
  it("maps a full account including the last-seen date", () => {
    const out = normalizeLichess({
      id: "thibault", username: "thibault", url: "https://lichess.org/@/thibault",
      createdAt: 1290415680000, seenAt: 1788281802455,
      profile: { firstName: "Thibault", lastName: "Duplessis", bio: "Lichess founder", location: "France" },
    })!;
    expect(out).toMatchObject({
      platform: "Lichess", category: "gaming", handle: "thibault",
      displayName: "Thibault Duplessis", bio: "Lichess founder", location: "France", joinedYear: "2010",
    });
    expect(out.extra).toContain("last seen 2026-");
  });

  it("reports a closed account, which is all the API returns for one", () => {
    const out = normalizeLichess({ id: "hikaru", username: "Hikaru", disabled: true })!;
    expect(out.extra).toBe("account closed");
    expect(out.joinedYear).toBeNull();
    expect(out.displayName).toBeNull();
    expect(out.bio).toBeNull();
    expect(out.location).toBeNull();
  });

  it("reports a ToS flag", () => {
    expect(normalizeLichess({ username: "x", tosViolation: true })!.extra).toBe("flagged for ToS violation");
  });

  it("falls back to id when username is absent, and builds the URL", () => {
    const out = normalizeLichess({ id: "solo" })!;
    expect(out.handle).toBe("solo");
    expect(out.url).toBe("https://lichess.org/@/solo");
  });

  it("uses the profile country when there is no location", () => {
    expect(normalizeLichess({ username: "x", profile: { country: "BR" } })!.location).toBe("BR");
  });

  it("builds a display name from whichever name part exists", () => {
    expect(normalizeLichess({ username: "x", profile: { firstName: "Ann" } })!.displayName).toBe("Ann");
    expect(normalizeLichess({ username: "x", profile: {} })!.displayName).toBeNull();
  });

  it("ignores a non-numeric or zero seenAt/createdAt", () => {
    const out = normalizeLichess({ username: "x", seenAt: 0, createdAt: "nope" })!;
    expect(out.extra).toBeNull();
    expect(out.joinedYear).toBeNull();
  });

  it("returns null without a username or id", () => {
    expect(normalizeLichess({ disabled: true })).toBeNull();
    expect(normalizeLichess([])).toBeNull();
  });
});
