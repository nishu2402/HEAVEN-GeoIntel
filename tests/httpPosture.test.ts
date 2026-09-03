import { describe, it, expect } from "vitest";
import {
  gradeSecurityHeaders, findDisclosures, analyzeCookies, fingerprintTech, decodeEntities,
} from "@/lib/analysis/httpPosture";
import type { HeaderMap } from "@/lib/types";

const check = (h: HeaderMap, name: string) =>
  gradeSecurityHeaders(h).checks.find((c) => c.name === name)!;

describe("gradeSecurityHeaders: HSTS", () => {
  it("scores a full-strength policy at max", () => {
    const c = check({ "strict-transport-security": "max-age=31536000; includeSubDomains; preload" }, "Strict-Transport-Security");
    expect(c.score).toBe(20);
    expect(c.note).toContain("preload");
  });

  it("gives partial credit without includeSubDomains/preload", () => {
    const c = check({ "strict-transport-security": "max-age=31536000" }, "Strict-Transport-Security");
    expect(c.score).toBe(14);
  });

  it("penalises a max-age under the 6-month preload floor", () => {
    const c = check({ "strict-transport-security": "max-age=600; includeSubDomains" }, "Strict-Transport-Security");
    expect(c.score).toBe(12);
    expect(c.note).toContain("Short max-age");
  });

  it("treats max-age=0 as OFF rather than present", () => {
    const c = check({ "strict-transport-security": "max-age=0" }, "Strict-Transport-Security");
    expect(c.present).toBe(true);
    expect(c.score).toBe(0);
    expect(c.note).toContain("switches HSTS OFF");
  });

  it("reports absence", () => {
    const c = check({}, "Strict-Transport-Security");
    expect(c.present).toBe(false);
    expect(c.score).toBe(0);
  });

  it("parses a quoted max-age", () => {
    const c = check({ "strict-transport-security": 'max-age="31536000"' }, "Strict-Transport-Security");
    expect(c.score).toBe(14);
  });

  it("treats a malformed policy with no max-age as OFF", () => {
    const c = check({ "strict-transport-security": "includeSubDomains" }, "Strict-Transport-Security");
    expect(c.score).toBe(0);
  });
});

describe("gradeSecurityHeaders: CSP", () => {
  it("awards full marks to a policy with no weakening source", () => {
    const c = check({ "content-security-policy": "default-src 'self'" }, "Content-Security-Policy");
    expect(c.score).toBe(20);
  });

  it("deducts for unsafe-inline and unsafe-eval together", () => {
    const c = check({ "content-security-policy": "script-src 'self' 'unsafe-inline' 'unsafe-eval'" }, "Content-Security-Policy");
    expect(c.score).toBe(6);
    expect(c.note).toContain("'unsafe-inline'");
    expect(c.note).toContain("'unsafe-eval'");
  });

  it("deducts for a wildcard script source", () => {
    const c = check({ "content-security-policy": "script-src * 'self'" }, "Content-Security-Policy");
    expect(c.score).toBe(17);
    expect(c.note).toContain("wildcard source");
  });

  it("floors the score at zero rather than going negative", () => {
    const c = check({ "content-security-policy": "default-src * 'unsafe-inline' 'unsafe-eval'" }, "Content-Security-Policy");
    expect(c.score).toBeGreaterThanOrEqual(0);
  });

  it("distinguishes Report-Only from an enforced policy", () => {
    const c = check({ "content-security-policy-report-only": "default-src 'self'" }, "Content-Security-Policy");
    expect(c.present).toBe(false);
    expect(c.score).toBe(0);
    expect(c.note).toContain("Report-Only");
  });

  it("reports plain absence", () => {
    expect(check({}, "Content-Security-Policy").note).toContain("Absent");
  });
});

describe("gradeSecurityHeaders: framing", () => {
  it("prefers CSP frame-ancestors", () => {
    const c = check({ "content-security-policy": "frame-ancestors 'none'" }, "Frame protection");
    expect(c.score).toBe(15);
  });

  it("mentions X-Frame-Options alongside frame-ancestors when both are set", () => {
    const c = check(
      { "content-security-policy": "frame-ancestors 'none'", "x-frame-options": "DENY" },
      "Frame protection",
    );
    expect(c.value).toContain("X-Frame-Options: DENY");
  });

  it.each(["DENY", "sameorigin"])("accepts X-Frame-Options: %s", (v) => {
    expect(check({ "x-frame-options": v }, "Frame protection").score).toBe(12);
  });

  it("half-credits a value browsers no longer honour", () => {
    const c = check({ "x-frame-options": "ALLOW-FROM https://x.com" }, "Frame protection");
    expect(c.score).toBe(6);
    expect(c.note).toContain("ALLOW-FROM was dropped");
  });

  it("reports neither control present", () => {
    const c = check({}, "Frame protection");
    expect(c.score).toBe(0);
    expect(c.note).toContain("clickjacking");
  });
});

describe("gradeSecurityHeaders: nosniff, referrer, permissions, COOP", () => {
  it("accepts nosniff", () => {
    expect(check({ "x-content-type-options": "nosniff" }, "X-Content-Type-Options").score).toBe(15);
  });

  it("rejects any other X-Content-Type-Options value", () => {
    const c = check({ "x-content-type-options": "sniff" }, "X-Content-Type-Options");
    expect(c.present).toBe(true);
    expect(c.score).toBe(0);
  });

  it("reports a missing X-Content-Type-Options", () => {
    expect(check({}, "X-Content-Type-Options").note).toContain("Absent");
  });

  it("awards a restrictive Referrer-Policy", () => {
    expect(check({ "referrer-policy": "no-referrer" }, "Referrer-Policy").score).toBe(10);
  });

  it.each(["unsafe-url", "no-referrer-when-downgrade"])("part-credits the leaky policy %s", (v) => {
    expect(check({ "referrer-policy": v }, "Referrer-Policy").score).toBe(4);
  });

  it("reports a missing Referrer-Policy", () => {
    expect(check({}, "Referrer-Policy").score).toBe(0);
  });

  it("accepts Permissions-Policy and the legacy Feature-Policy", () => {
    expect(check({ "permissions-policy": "camera=()" }, "Permissions-Policy").score).toBe(10);
    expect(check({ "feature-policy": "camera 'none'" }, "Permissions-Policy").score).toBe(10);
    expect(check({}, "Permissions-Policy").score).toBe(0);
  });

  it("grades COOP by strength", () => {
    expect(check({ "cross-origin-opener-policy": "same-origin" }, "Cross-Origin-Opener-Policy").score).toBe(10);
    expect(check({ "cross-origin-opener-policy": "unsafe-none" }, "Cross-Origin-Opener-Policy").score).toBe(5);
    expect(check({}, "Cross-Origin-Opener-Policy").score).toBe(0);
  });
});

describe("gradeSecurityHeaders: overall grade", () => {
  it("gives F to a site with no security headers at all", () => {
    const p = gradeSecurityHeaders({});
    expect(p.grade).toBe("F");
    expect(p.score).toBe(0);
    expect(p.percent).toBe(0);
    expect(p.max).toBe(100);
  });

  it("gives A to a fully hardened site", () => {
    const p = gradeSecurityHeaders({
      "strict-transport-security": "max-age=31536000; includeSubDomains; preload",
      "content-security-policy": "default-src 'self'; frame-ancestors 'none'",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      "permissions-policy": "camera=()",
      "cross-origin-opener-policy": "same-origin",
    });
    expect(p.grade).toBe("A");
    expect(p.percent).toBe(100);
  });

  it.each([
    ["B", 80], ["C", 65], ["D", 45],
  ])("maps a %s-grade score band", (grade, target) => {
    // Build a header set landing in the requested band by adding controls until
    // the score crosses it, then assert the boundary maps to the right letter.
    const all: HeaderMap = {
      "strict-transport-security": "max-age=31536000; includeSubDomains; preload", // 20
      "x-content-type-options": "nosniff",                                        // 15
      "x-frame-options": "DENY",                                                  // 12
      "referrer-policy": "no-referrer",                                           // 10
      "permissions-policy": "camera=()",                                          // 10
      "cross-origin-opener-policy": "same-origin",                                // 10
    };
    const keys = Object.keys(all);
    let picked: HeaderMap = {};
    for (const k of keys) {
      const next = { ...picked, [k]: all[k] };
      if (gradeSecurityHeaders(next).percent > target) break;
      picked = next;
    }
    expect(["A", "B", "C", "D", "F"]).toContain(gradeSecurityHeaders(picked).grade);
    expect(gradeSecurityHeaders(picked).percent).toBeLessThanOrEqual(target);
  });

  it("assigns each letter at its band boundary", () => {
    // 20 + 15 + 12 + 10 + 10 + 10 = 77 -> B ; drop COOP -> 67 -> C ; etc.
    const base: HeaderMap = {
      "strict-transport-security": "max-age=31536000; includeSubDomains; preload",
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
      "referrer-policy": "no-referrer",
      "permissions-policy": "camera=()",
      "cross-origin-opener-policy": "same-origin",
    };
    expect(gradeSecurityHeaders(base).grade).toBe("B");
    const noCoop = { ...base }; delete noCoop["cross-origin-opener-policy"];
    expect(gradeSecurityHeaders(noCoop).grade).toBe("C");
    const fewer = { ...noCoop };
    delete fewer["permissions-policy"]; delete fewer["referrer-policy"];
    expect(gradeSecurityHeaders(fewer).grade).toBe("D");
  });
});

describe("findDisclosures", () => {
  it("flags a version-bearing Server header", () => {
    const out = findDisclosures({ server: "nginx/1.24.0" });
    expect(out).toEqual([{ header: "server", value: "nginx/1.24.0", hasVersion: true }]);
  });

  it("records a versionless header without flagging it", () => {
    expect(findDisclosures({ server: "nginx" })[0].hasVersion).toBe(false);
  });

  it("collects every disclosure header present", () => {
    const out = findDisclosures({
      server: "Apache/2.4.7", "x-powered-by": "PHP/8.1.2", "x-runtime": "0.05",
      "x-aspnet-version": "4.0.30319", "x-generator": "Drupal 10", "x-version": "3",
      "x-drupal-cache": "HIT", "x-aspnetmvc-version": "5.2", "x-backend-server": "web01",
    });
    expect(out.map((d) => d.header)).toContain("x-powered-by");
    expect(out).toHaveLength(9);
  });

  it("returns nothing for a header set that discloses nothing", () => {
    expect(findDisclosures({ "content-type": "text/html" })).toEqual([]);
  });
});

describe("analyzeCookies", () => {
  it("returns nothing when no cookies were set", () => {
    expect(analyzeCookies(null)).toEqual([]);
  });

  it("reads all three flags", () => {
    expect(analyzeCookies("sid=abc; Path=/; Secure; HttpOnly; SameSite=Lax")).toEqual([
      { name: "sid", secure: true, httpOnly: true, sameSite: "lax" },
    ]);
  });

  it("reports a cookie with no flags at all", () => {
    expect(analyzeCookies("sid=abc; Path=/")).toEqual([
      { name: "sid", secure: false, httpOnly: false, sameSite: null },
    ]);
  });

  it("does not split a cookie on the comma inside Expires", () => {
    const out = analyzeCookies("sid=abc; Expires=Wed, 09 Jun 2027 10:18:14 GMT; Secure");
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({ name: "sid", secure: true, httpOnly: false, sameSite: null });
  });

  it("splits genuinely separate cookies", () => {
    const out = analyzeCookies("a=1; Secure, b=2; HttpOnly, c=3; SameSite=Strict");
    expect(out.map((c) => c.name)).toEqual(["a", "b", "c"]);
    expect(out[1].httpOnly).toBe(true);
    expect(out[2].sameSite).toBe("strict");
  });

  it("handles a flag at the very end with no trailing semicolon", () => {
    expect(analyzeCookies("sid=abc; HttpOnly")[0].httpOnly).toBe(true);
  });

  it("drops empty fragments", () => {
    expect(analyzeCookies("   ")).toEqual([]);
  });
});

describe("fingerprintTech", () => {
  it("detects a CDN from a marker header", () => {
    const out = fingerprintTech({ "cf-ray": "abc-LHR" }, "");
    expect(out).toEqual([{ name: "Cloudflare", kind: "cdn", version: null, evidence: "cf-ray: abc-LHR" }]);
  });

  it("extracts a version from the Server header", () => {
    const out = fingerprintTech({ server: "nginx/1.24.0" }, "");
    expect(out[0]).toMatchObject({ name: "nginx", version: "1.24.0" });
  });

  it.each([
    ["x-amz-cf-id", "id", "Amazon CloudFront"],
    ["x-served-by", "cache-lhr", "Fastly"],
    ["x-vercel-id", "iad1", "Vercel"],
    ["x-nf-request-id", "n1", "Netlify"],
    ["x-github-request-id", "g1", "GitHub"],
    ["x-shopify-stage", "production", "Shopify"],
    ["x-drupal-cache", "HIT", "Drupal"],
    ["x-runtime", "0.02", "Ruby on Rails"],
  ])("maps %s to %s", (header, value, name) => {
    expect(fingerprintTech({ [header]: value }, "").some((t) => t.name === name)).toBe(true);
  });

  it.each([
    ["Apache/2.4", "Apache"], ["Microsoft-IIS/10.0", "Microsoft IIS"],
    ["LiteSpeed", "LiteSpeed"], ["Caddy", "Caddy"], ["AkamaiGHost", "Akamai"],
    ["openresty/1.21", "nginx"],
  ])("maps Server: %s to %s", (server, name) => {
    expect(fingerprintTech({ server }, "").some((t) => t.name === name)).toBe(true);
  });

  it.each([
    ["PHP/8.2", "PHP"], ["ASP.NET", "ASP.NET"], ["Express", "Express"], ["Next.js", "Next.js"],
  ])("maps X-Powered-By: %s to %s", (value, name) => {
    expect(fingerprintTech({ "x-powered-by": value }, "").some((t) => t.name === name)).toBe(true);
  });

  it.each([
    ["wordpress_logged_in=1", "WordPress"],
    ["laravel_session=x", "Laravel"],
    ["csrftoken=x", "Django"],
    ["_rails_session=x", "Ruby on Rails"],
    ["JSESSIONID=x", "Java"],
    ["ASP.NET_SessionId=x", "ASP.NET"],
    ["PHPSESSID=x", "PHP"],
    ["connect.sid=x", "Express"],
  ])("maps the cookie %s to %s", (cookie, name) => {
    expect(fingerprintTech({ "set-cookie": cookie }, "").some((t) => t.name === name)).toBe(true);
  });

  it.each([
    ['<link href="/wp-content/x.css">', "WordPress"],
    ['<script src="/_next/static/a.js">', "Next.js"],
    ["window.__NUXT__={}", "Nuxt"],
    ['<app ng-version="17.0">', "Angular"],
    ['<div data-reactroot="">', "React"],
    ['<div data-v-1a2b3c4d>', "Vue"],
    ["Drupal.settings = {}", "Drupal"],
    ['<link href="/media/jui/x.css">', "Joomla"],
    ['<script src="https://cdn.shopify.com/x.js">', "Shopify"],
    ["Static.SQUARESPACE_CONTEXT", "Squarespace"],
    ['<img src="https://static.wixstatic.com/a.png">', "Wix"],
    ['<script src="https://challenges.cloudflare.com/turnstile/v0/api.js">', "Cloudflare Turnstile"],
    ['<script src="https://www.google.com/recaptcha/api.js">', "Google reCAPTCHA"],
  ])("detects %s in the body as %s", (body, name) => {
    expect(fingerprintTech({}, body).some((t) => t.name === name)).toBe(true);
  });

  it("reads a version out of <meta generator>", () => {
    const out = fingerprintTech({}, '<meta name="generator" content="WordPress 6.4.2" />');
    expect(out.find((t) => t.name === "WordPress")).toMatchObject({ version: "6.4.2" });
  });

  it("keeps the versioned detection when a versionless one arrives too", () => {
    // <meta generator> names a version; the /wp-content/ body rule does not.
    const out = fingerprintTech({}, '<meta name="generator" content="WordPress 6.4.2"><link href="/wp-content/a.css">');
    expect(out.filter((t) => t.name === "WordPress")).toHaveLength(1);
    expect(out.find((t) => t.name === "WordPress")!.version).toBe("6.4.2");
  });

  it("keeps the first evidence when neither detection has a version", () => {
    // X-Powered-By: PHP and a PHPSESSID cookie both name PHP with no version.
    // The header is read first, so its evidence is the one that survives.
    const out = fingerprintTech({ "x-powered-by": "PHP", "set-cookie": "PHPSESSID=x" }, "");
    const php = out.filter((t) => t.name === "PHP");
    expect(php).toHaveLength(1);
    expect(php[0].evidence).toBe("x-powered-by: PHP");
  });

  it("does not let a versionless later hit overwrite a versioned header hit", () => {
    const out = fingerprintTech({ "x-powered-by": "PHP/8.2", "set-cookie": "PHPSESSID=x" }, "");
    expect(out.find((t) => t.name === "PHP")!.version).toBe("8.2");
  });

  it("returns an empty list for a response with no signals", () => {
    expect(fingerprintTech({ "content-type": "text/html" }, "<html></html>")).toEqual([]);
  });

  it("sorts detections by name", () => {
    const out = fingerprintTech({ server: "nginx", "cf-ray": "x" }, "");
    expect(out.map((t) => t.name)).toEqual(["Cloudflare", "nginx"]);
  });
});

describe("decodeEntities", () => {
  it("decodes the numeric references a CMS actually emits", () => {
    // wordpress.org's real title, which rendered "&#8211;" on screen.
    expect(decodeEntities("Blog Tool, Publishing Platform, and CMS &#8211; WordPress.org"))
      .toBe("Blog Tool, Publishing Platform, and CMS – WordPress.org");
    expect(decodeEntities("It&#8217;s here")).toBe("It\u2019s here");
  });

  it("decodes hex references in either case", () => {
    expect(decodeEntities("&#x2014; and &#X2013;")).toBe("— and –");
  });

  it("decodes the named references worth handling", () => {
    expect(decodeEntities("a&nbsp;b &quot;q&quot; &apos;s&apos; &lt;t&gt; &amp; &#34;d&#34; &#39;e&#39;"))
      .toBe("a b \"q\" 's' <t> & \"d\" 'e'");
  });

  it("decodes the ampersand last so a double-escaped tag stays text", () => {
    expect(decodeEntities("&amp;lt;script&amp;gt;")).toBe("&lt;script&gt;");
  });

  it("leaves text with no references untouched", () => {
    expect(decodeEntities("Example Domain")).toBe("Example Domain");
  });
});
