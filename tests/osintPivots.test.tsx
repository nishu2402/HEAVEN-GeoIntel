// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import OsintPivots from "@/components/osint/OsintPivots";
import { BLOCK_CAVEAT, BLOCK_LIMIT } from "@/lib/osint/accessTier";
import EmailOsintPivots from "@/components/email/EmailOsintPivots";
import { readFileSync } from "node:fs";
import { join } from "node:path";

afterEach(cleanup);

describe("<OsintPivots>", () => {
  it("renders the free/captcha links by default and encodes the number into URLs", () => {
    render(<OsintPivots e164="+14155552671" national="(415) 555-2671" country="US" />);
    expect(screen.getByText(/OSINT PIVOT MATRIX/)).toBeTruthy();
    // WhatsApp uses the bare digits; Google uses the encoded E.164
    const whatsapp = screen.getByText("WhatsApp").closest("a")!;
    expect(whatsapp.getAttribute("href")).toBe("https://wa.me/14155552671");
    const google = screen.getByText("Google").closest("a")!;
    expect(google.getAttribute("href")).toContain(encodeURIComponent("+14155552671"));
    // login/paid links are hidden by default
    expect(screen.queryByText("Truecaller")).toBeNull();
    expect(screen.queryByText("Whitepages")).toBeNull();
    // US-only badge present on a US-only link that the default filter shows.
    // TruePeopleSearch used to stand in here; it is now `blocked` and hidden.
    expect(within(screen.getByText("That's Them").closest("a")!).getByText("[US]")).toBeTruthy();
  });

  it("reveals login/paid links when those filters are toggled on", () => {
    render(<OsintPivots e164="+14155552671" national="4155552671" />);
    fireEvent.click(screen.getByRole("button", { name: /login/i }));
    expect(screen.getByText("Truecaller")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /paid/i }));
    expect(screen.getByText("Whitepages")).toBeTruthy();
    // toggling free off hides the free links but keeps login/paid
    fireEvent.click(screen.getByRole("button", { name: /● FREE/ }));
    expect(screen.queryByText("WhatsApp")).toBeNull();
    expect(screen.getByText("Truecaller")).toBeTruthy();
  });

  it("re-enables FREE when the last active filter is removed", () => {
    render(<OsintPivots e164="+14155552671" national="4155552671" />);
    // Defaults are free + captcha + app; turn all three off → guard restores FREE
    fireEvent.click(screen.getByRole("button", { name: /● CAPTCHA/ }));
    fireEvent.click(screen.getByRole("button", { name: /● APP/ }));
    fireEvent.click(screen.getByRole("button", { name: /● FREE/ }));
    // FREE is back on (never allowed to reach zero filters)
    expect(screen.getByRole("button", { name: /● FREE/ })).toBeTruthy();
    expect(screen.getByText("WhatsApp")).toBeTruthy();
  });

  it("collapses and expands a category section", () => {
    render(<OsintPivots e164="+14155552671" national="4155552671" />);
    const header = screen.getByRole("button", { name: /MESSAGING/ });
    expect(screen.getByText("WhatsApp")).toBeTruthy();
    fireEvent.click(header); // collapse
    expect(screen.queryByText("WhatsApp")).toBeNull();
    fireEvent.click(header); // expand
    expect(screen.getByText("WhatsApp")).toBeTruthy();
  });

  it("hides categories that have no links under the active filter", () => {
    render(<OsintPivots e164="+14155552671" national="4155552671" />);
    // turn on only PAID → messaging + search have no paid links, so those headers vanish
    fireEvent.click(screen.getByRole("button", { name: /○ PAID/ }));
    fireEvent.click(screen.getByRole("button", { name: /● FREE/ }));
    fireEvent.click(screen.getByRole("button", { name: /● CAPTCHA/ }));
    fireEvent.click(screen.getByRole("button", { name: /● APP/ }));
    expect(screen.queryByText(/MESSAGING/)).toBeNull();
    expect(screen.getByText(/IDENTITY \/ REVERSE LOOKUP/)).toBeTruthy(); // has paid links
  });

  it("renders app-scheme deep links as copy buttons, never as anchors", () => {
    // Regression guard for the tool's most-reported bug: tg:/viber:/sms: in an
    // <a href> makes a desktop browser answer the click with "can't open this
    // page" (and target="_blank" strands a dead tab). Nothing outside http(s)
    // may reach an href.
    render(<OsintPivots e164="+14155552671" national="4155552671" />);
    for (const a of Array.from(document.querySelectorAll("a[href]"))) {
      expect(a.getAttribute("href")).toMatch(/^https?:\/\//);
    }
    // …and the deep links are still offered, as copy rows.
    for (const label of ["Telegram", "Viber", "iMessage"]) {
      const row = screen.getByText(label).closest("button");
      expect(row).toBeTruthy();
      expect(row!.getAttribute("title")).toMatch(/^Copy (tg|viber|sms):/);
    }
  });

  it("points the repaired links at URLs that resolve", () => {
    // Each of these replaced a measured 404 / dead host. Pinned so a future
    // edit cannot quietly restore the broken form.
    render(<OsintPivots e164="+14155552671" national="4155552671" />);
    const href = (label: string) => screen.getByText(label).closest("a")!.getAttribute("href");
    expect(href("NumLookup")).toBe("https://www.numlookup.com/?q=14155552671");
    expect(href("IPQS Phone")).toBe("https://www.ipqualityscore.com/free-phone-number-lookup");
    // radaris.com/p/{n} silently served the marketing homepage — no lookup ran,
    // and nothing about the response said so. /phone/{n} redirects to a
    // state-specific results page and reports "No Records Found" honestly.
    expect(href("Radaris")).toBe("https://radaris.com/phone/14155552671");
    // who-called.co.uk answers "The page you requested was removed."
    expect(href("tellows")).toBe("https://www.tellows.com/num/14155552671");
  });

  it("hides hard-blocked sources by default and shows them behind the filter", () => {
    // Verified in a real browser, not by a script: TruePeopleSearch,
    // FastPeopleSearch, USPhoneBook and PeekYou answer a genuine Chrome session
    // with Cloudflare's "Sorry, you have been blocked" — no challenge is
    // offered, so unlike a CAPTCHA row there is nothing the analyst can solve.
    render(<OsintPivots e164="+14155552671" national="4155552671" />);
    for (const label of ["TruePeopleSearch", "FastPeopleSearch", "USPhoneBook", "PeekYou"]) {
      expect(screen.queryByText(label), `${label} must be hidden by default`).toBeNull();
    }
    fireEvent.click(screen.getByRole("button", { name: /blocked/i }));
    expect(screen.getByText("PeekYou")).toBeTruthy();
  });

  it("tells the analyst on the row that the block is one address's experience", () => {
    // The four sites refused a residential line outside the US, which rules out
    // the datacenter explanation and leaves the visitor's country untested. A
    // badge that hid that would be asserting a property of the site the tool has
    // no evidence for — and this is the one moment it matters, because the row
    // is only on screen at all because somebody went looking for it.
    render(<OsintPivots e164="+14155552671" national="4155552671" />);
    fireEvent.click(screen.getByRole("button", { name: /blocked/i }));
    expect(screen.getAllByText(BLOCK_LIMIT).length).toBe(4);
    expect(screen.getByText("PeekYou").closest("a")?.getAttribute("title")).toBe(BLOCK_CAVEAT);
  });

  it("drops a source that fabricates results rather than tiering it", () => {
    // ZabaSearch returned a full owner record ("Kincannon Lindsay Sales", age
    // 44) for 415-555-2671, a number Radaris correctly reports as having no
    // record. A source that invents a person cannot be shown at any tier in a
    // tool whose whole premise is no false positives.
    render(<OsintPivots e164="+14155552671" national="4155552671" />);
    fireEvent.click(screen.getByRole("button", { name: /blocked/i }));
    fireEvent.click(screen.getByRole("button", { name: /paid/i }));
    fireEvent.click(screen.getByRole("button", { name: /login/i }));
    expect(screen.queryByText("ZabaSearch")).toBeNull();
  });

  it("defaults the country to 'us' when none is given", () => {
    render(<OsintPivots e164="+14155552671" national="4155552671" />);
    fireEvent.click(screen.getByRole("button", { name: /login/i }));
    const truecaller = screen.getByText("Truecaller").closest("a")!;
    expect(truecaller.getAttribute("href")).toContain("/us/");
  });

  it("falls back to 'us' in the URL when an empty country string is passed", () => {
    render(<OsintPivots e164="+14155552671" national="4155552671" country="" />);
    fireEvent.click(screen.getByRole("button", { name: /login/i }));
    const truecaller = screen.getByText("Truecaller").closest("a")!;
    expect(truecaller.getAttribute("href")).toContain("/us/"); // (country || "us")
  });
});

describe("<EmailOsintPivots>", () => {
  it("renders all category groups with email- and domain-encoded URLs", () => {
    render(<EmailOsintPivots email="a+b@example.com" domain="example.com" />);
    expect(screen.getByText(/EMAIL OSINT MATRIX/)).toBeTruthy();
    expect(screen.getByText(/BREACH \/ CREDENTIAL EXPOSURE/)).toBeTruthy();
    expect(screen.getByText(/IDENTITY \/ OSINT CORRELATION/)).toBeTruthy();
    expect(screen.getByText(/SOCIAL MEDIA \/ OPEN WEB/)).toBeTruthy();
    expect(screen.getByText(/DOMAIN \/ INFRASTRUCTURE INTEL/)).toBeTruthy();

    // email is percent-encoded (the "+" must not stay literal)
    const leakcheck = screen.getByText("LeakCheck").closest("a")!;
    expect(leakcheck.getAttribute("href")).toContain(encodeURIComponent("a+b@example.com"));
    // domain links use the domain
    const mx = screen.getByText("MXToolbox").closest("a")!;
    expect(mx.getAttribute("href")).toBe("https://mxtoolbox.com/domain/example.com");
    // every link opens safely in a new tab
    for (const a of Array.from(document.querySelectorAll("a"))) {
      expect(a.getAttribute("rel")).toBe("noopener noreferrer");
      expect(a.getAttribute("target")).toBe("_blank");
    }
  });

  it("labels paid and login services instead of showing them as plain links", () => {
    // This panel used to carry no tiers, so Dehashed and Snusbase looked exactly
    // like a free search engine and the analyst met the paywall only after
    // leaving the tool.
    render(<EmailOsintPivots email="a@example.com" domain="example.com" />);
    expect(screen.queryByText("Dehashed")).toBeNull(); // paid: filtered out by default
    fireEvent.click(screen.getByRole("button", { name: /○ PAID/ }));
    const dehashed = screen.getByText("Dehashed").closest("a")!;
    expect(within(dehashed).getByText("PAID")).toBeTruthy();
  });

  it("toggles a tier off, and never lets the matrix reach zero filters", () => {
    render(<EmailOsintPivots email="a@example.com" domain="example.com" />);
    expect(screen.getByText("LeakCheck")).toBeTruthy();
    // Turning FREE off hides the free rows…
    fireEvent.click(screen.getByRole("button", { name: /● FREE/ }));
    expect(screen.queryByText("LeakCheck")).toBeNull();
    // …and turning the remaining defaults off restores FREE rather than
    // rendering an empty panel, which reads as a broken screen.
    fireEvent.click(screen.getByRole("button", { name: /● CAPTCHA/ }));
    fireEvent.click(screen.getByRole("button", { name: /● APP/ }));
    expect(screen.getByRole("button", { name: /● FREE/ })).toBeTruthy();
    expect(screen.getByText("LeakCheck")).toBeTruthy();
  });

  it("drops a category header once the filter empties that category", () => {
    render(<EmailOsintPivots email="a@example.com" domain="example.com" />);
    expect(screen.getByText(/SOCIAL MEDIA \/ OPEN WEB/)).toBeTruthy();
    // Every social link is FREE, so showing only PAID empties that group.
    fireEvent.click(screen.getByRole("button", { name: /○ PAID/ }));
    fireEvent.click(screen.getByRole("button", { name: /● FREE/ }));
    fireEvent.click(screen.getByRole("button", { name: /● CAPTCHA/ }));
    fireEvent.click(screen.getByRole("button", { name: /● APP/ }));
    expect(screen.queryByText(/SOCIAL MEDIA \/ OPEN WEB/)).toBeNull();
    expect(screen.getByText(/BREACH \/ CREDENTIAL EXPOSURE/)).toBeTruthy(); // has paid links
  });

  it("sends EmailRep to a page that exists", () => {
    // https://emailrep.io/{email} answers 404; the report lives at the root.
    render(<EmailOsintPivots email="a@example.com" domain="example.com" />);
    expect(screen.getByText("EmailRep.io").closest("a")!.getAttribute("href"))
      .toBe("https://emailrep.io/");
  });
});

describe("everything that states the pivot matrix's size agrees with the matrix", () => {
  // The same drift the username catalog had: the README claimed 38 links and
  // 18 in the identity group while the array held 37 and 17, because removing
  // ZabaSearch and re-tiering four sites changed the array and nothing else.
  // Prose that counts something has to be checked against the thing it counts.
  const readme = readFileSync(join(process.cwd(), "README.md"), "utf8");

  /** Enable every chip, so the headers report totals rather than a filtered view. */
  function renderAll() {
    render(<OsintPivots e164="+14155552671" national="4155552671" />);
    for (const tier of [/login/i, /paid/i, /blocked/i]) {
      fireEvent.click(screen.getByRole("button", { name: tier }));
    }
  }

  it("the README's badge, feature table and heading name the real total", () => {
    renderAll();
    const header = screen.getByText(/OSINT PIVOT MATRIX/).textContent ?? "";
    const total = Number(/\/\s*(\d+)\s*shown/i.exec(header)?.[1]);
    expect(total).toBeGreaterThan(0);
    expect(readme).toContain(`Phone_Pivots-${total}_across_6_access_tiers`);
    expect(readme).toContain(`${total} links across 5 categories`);
    expect(readme).toContain(`### Phone OSINT Pivots: ${total} links, 5 categories`);
  });

  it("the README's per-category table matches the rendered groups", () => {
    renderAll();
    const rows: [RegExp, string][] = [
      [/IDENTITY \/ REVERSE LOOKUP/, "Identity / Reverse Lookup"],
      [/MESSAGING/,                   "Messaging: Is it Registered?"],
      [/SPAM \/ ABUSE REPORTS/,       "Spam / Abuse Reports"],
      [/CARRIER \/ HLR \/ TELECOM/,   "Carrier / HLR / Telecom"],
      [/SEARCH ENGINES/,              "Search Engines (broad)"],
    ];
    let summed = 0;
    for (const [heading, readmeName] of rows) {
      const text = screen.getByText(heading).textContent ?? "";
      const n = Number(/\((\d+)\)/.exec(text)?.[1]);
      expect(n, `${readmeName} rendered no count`).toBeGreaterThan(0);
      summed += n;
      expect(readme, `README count for ${readmeName}`).toContain(`| **${readmeName}** | ${n} |`);
    }
    // Internally consistent and still wrong is the other failure mode.
    const header = screen.getByText(/OSINT PIVOT MATRIX/).textContent ?? "";
    expect(summed).toBe(Number(/\/\s*(\d+)\s*shown/i.exec(header)?.[1]));
  });
});
