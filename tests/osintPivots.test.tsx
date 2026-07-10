// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import OsintPivots from "@/components/osint/OsintPivots";
import EmailOsintPivots from "@/components/email/EmailOsintPivots";

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
    // US-only badge present on a US-only link
    expect(within(screen.getByText("TruePeopleSearch").closest("a")!).getByText("[US]")).toBeTruthy();
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
    // start with free + captcha on; turn both off → guard restores FREE
    fireEvent.click(screen.getByRole("button", { name: /● CAPTCHA/ }));
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
    expect(screen.queryByText(/MESSAGING/)).toBeNull();
    expect(screen.getByText(/IDENTITY \/ REVERSE LOOKUP/)).toBeTruthy(); // has paid links
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
    const intelx = screen.getByText("IntelligenceX").closest("a")!;
    expect(intelx.getAttribute("href")).toContain(encodeURIComponent("a+b@example.com"));
    // domain links use the domain
    const mx = screen.getByText("MXToolbox").closest("a")!;
    expect(mx.getAttribute("href")).toBe("https://mxtoolbox.com/domain/example.com");
    // every link opens safely in a new tab
    for (const a of Array.from(document.querySelectorAll("a"))) {
      expect(a.getAttribute("rel")).toBe("noopener noreferrer");
      expect(a.getAttribute("target")).toBe("_blank");
    }
  });
});
