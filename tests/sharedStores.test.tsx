// @vitest-environment jsdom
import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { installMemoryLocalStorage } from "./testUtils";

import ConsentGate from "@/components/shared/ConsentGate";
import EffectsToggle from "@/components/shared/EffectsToggle";
import { ThemeProvider, useTheme } from "@/components/shared/ThemeProvider";
import Term from "@/components/shared/Term";

// Completes coverage of the useSyncExternalStore components: the SSR snapshot
// closures (only invoked by react-dom/server), the localStorage-blocked catch,
// and the setTheme / bidirectional-toggle paths. Together these prove the
// server-stable render (no hydration mismatch) as well as the client behaviour.

beforeAll(() => { installMemoryLocalStorage(); });
beforeEach(() => { localStorage.clear(); document.documentElement.removeAttribute("data-theme"); });
afterEach(cleanup);

describe("server-snapshot (SSR) rendering", () => {
  it("ConsentGate renders nothing on the server (getServerSnapshot=false)", () => {
    expect(renderToStaticMarkup(<ConsentGate />)).toBe("");
  });

  it("EffectsToggle renders the stable on-state on the server", () => {
    const html = renderToStaticMarkup(<EffectsToggle />);
    expect(html).toContain("Turn off visual effects"); // on-by-default snapshot
  });

  it("ThemeProvider exposes the dark/unmounted default on the server", () => {
    const Probe = () => { const { theme, mounted } = useTheme(); return <span>{theme}:{String(mounted)}</span>; };
    expect(renderToStaticMarkup(<ThemeProvider><Probe /></ThemeProvider>)).toContain("dark:false");
  });
});

describe("<ConsentGate> localStorage blocked", () => {
  it("stays hidden (no throw) when localStorage.getItem is blocked", () => {
    const throwing = {
      getItem: () => { throw new Error("blocked"); },
      setItem: () => {}, removeItem: () => {}, clear: () => {}, key: () => null, length: 0,
    } as unknown as Storage;
    const orig = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", { value: throwing, configurable: true });
    try {
      render(<ConsentGate />);
      expect(screen.queryByRole("dialog")).toBeNull(); // needsConsent caught → false
    } finally {
      if (orig) Object.defineProperty(globalThis, "localStorage", orig);
    }
  });
});

describe("<ThemeProvider> setTheme + toggle", () => {
  it("drives <html data-theme> via setTheme and toggles both directions", () => {
    const Probe = () => {
      const { theme, setTheme, toggle } = useTheme();
      return (
        <>
          <span data-testid="theme">{theme}</span>
          <button onClick={() => setTheme("light")}>set-light</button>
          <button onClick={toggle}>toggle</button>
        </>
      );
    };
    render(<ThemeProvider><Probe /></ThemeProvider>);
    expect(screen.getByTestId("theme").textContent).toBe("dark");

    fireEvent.click(screen.getByText("set-light"));               // setTheme
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(screen.getByTestId("theme").textContent).toBe("light");

    fireEvent.click(screen.getByText("toggle"));                  // light → dark
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    fireEvent.click(screen.getByText("toggle"));                  // dark → light
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  it("useTheme outside a provider returns inert defaults (no crash)", () => {
    const Probe = () => {
      const { theme, mounted, toggle, setTheme } = useTheme();
      toggle();            // default no-op
      setTheme("light");   // default no-op
      return <span>{theme}:{String(mounted)}</span>;
    };
    render(<Probe />);
    expect(screen.getByText("dark:false")).toBeTruthy();
  });
});

describe("<Term>", () => {
  it("wraps a known term in an <abbr> with its definition (key label, then a custom child label)", () => {
    const { rerender } = render(<Term k="ASN" />);
    const abbr = screen.getByText("ASN");
    expect(abbr.tagName.toLowerCase()).toBe("abbr");
    expect(abbr.getAttribute("title")).toMatch(/autonomous system number/i);

    rerender(<Term k="ASN">the network id</Term>);
    expect(screen.getByText("the network id").tagName.toLowerCase()).toBe("abbr");
  });

  it("renders plain text (no <abbr>) for an unknown term: child label, then the raw key", () => {
    const { rerender, container } = render(<Term k="ZZZ">just text</Term>);
    expect(screen.getByText("just text")).toBeTruthy();
    expect(container.querySelector("abbr")).toBeNull();

    rerender(<Term k="ZZZ" />);
    expect(screen.getByText("ZZZ")).toBeTruthy();
    expect(container.querySelector("abbr")).toBeNull();
  });
});
