import { describe, it, expect } from "vitest";
import { classifyTakeover, scanTakeover } from "@/lib/analysis/subdomainTakeover";

describe("classifyTakeover", () => {
  it("flags well-known takeover-prone services with a fingerprint", () => {
    const s3 = classifyTakeover("assets.s3-us-west-2.amazonaws.com");
    expect(s3?.service).toBe("AWS S3");
    expect(s3?.status).toBe("vulnerable");
    expect(s3?.fingerprint).toMatch(/NoSuchBucket|bucket does not exist/);

    expect(classifyTakeover("foo.s3.amazonaws.com")?.service).toBe("AWS S3");
    expect(classifyTakeover("victim.github.io")?.service).toBe("GitHub Pages");
    expect(classifyTakeover("victim.github.io")?.status).toBe("edge-case");
    expect(classifyTakeover("app.herokuapp.com")?.service).toBe("Heroku");
    expect(classifyTakeover("x.azurewebsites.net")?.service).toBe("Microsoft Azure");
    expect(classifyTakeover("cdn.fastly.net")?.service).toBe("Fastly");
    expect(classifyTakeover("shop.myshopify.com")?.service).toBe("Shopify");
    expect(classifyTakeover("site.pantheonsite.io")?.service).toBe("Pantheon");
    expect(classifyTakeover("repo.bitbucket.io")?.service).toBe("Bitbucket");
    expect(classifyTakeover("proj.surge.sh")?.service).toBe("Surge.sh");
    expect(classifyTakeover("blog.ghost.io")?.service).toBe("Ghost");
    expect(classifyTakeover("app.wpengine.com")?.service).toBe("WP Engine");
    expect(classifyTakeover("help.zendesk.com")?.service).toBe("Zendesk");
    expect(classifyTakeover("docs.readthedocs.io")?.service).toBe("Read the Docs");
    expect(classifyTakeover("status.statuspage.io")?.service).toBe("Statuspage");
    expect(classifyTakeover("go.launchrock.com")?.service).toBe("LaunchRock");
  });

  it("normalises case and a trailing FQDN dot", () => {
    expect(classifyTakeover("Victim.GitHub.IO.")?.service).toBe("GitHub Pages");
  });

  it("returns null for an unrelated or empty host", () => {
    expect(classifyTakeover("www.example.com")).toBeNull();
    expect(classifyTakeover("cloudflare.com")).toBeNull();
    expect(classifyTakeover("   ")).toBeNull();
    // a look-alike that is NOT the service's real suffix must not match
    expect(classifyTakeover("github.io.evil.com")).toBeNull();
  });
});

describe("scanTakeover", () => {
  it("classifies and de-duplicates a list of CNAME targets", () => {
    const signals = scanTakeover([
      "a.github.io",
      "a.github.io",       // duplicate host → collapsed
      "b.s3.amazonaws.com",
      "harmless.example.com",
    ]);
    expect(signals.map((s) => s.service)).toEqual(["GitHub Pages", "AWS S3"]);
  });

  it("returns [] when nothing matches", () => {
    expect(scanTakeover(["one.example.com", "two.example.org"])).toEqual([]);
  });
});
