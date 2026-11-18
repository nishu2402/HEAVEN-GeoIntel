// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { installResizeObserver, fireIntersection } from "./testUtils";
import SectionRail from "@/components/shared/SectionRail";

installResizeObserver(); // stubs Element.scrollIntoView
afterEach(cleanup);

describe("<SectionRail>", () => {
  it("renders the label and one button per item", () => {
    render(<SectionRail items={[{ id: "sec-a", label: "Alpha" }, { id: "sec-b", label: "Beta" }]} />);
    expect(screen.getByText("Sections")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Alpha" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Beta" })).toBeTruthy();
  });

  it("renders nothing when there are no items", () => {
    const { container } = render(<SectionRail items={[]} />);
    expect(container.querySelector("nav")).toBeNull();
  });

  it("marks the clicked section active and leaves the others unmarked", () => {
    render(
      <div>
        <SectionRail items={[{ id: "sec-a", label: "Alpha" }, { id: "sec-b", label: "Beta" }]} />
        <div id="sec-a">A</div>
        <div id="sec-b">B</div>
      </div>,
    );
    const alpha = screen.getByRole("button", { name: "Alpha" });
    const beta = screen.getByRole("button", { name: "Beta" });
    expect(alpha.getAttribute("aria-current")).toBeNull();
    fireEvent.click(alpha);
    expect(alpha.getAttribute("aria-current")).toBe("true");
    expect(beta.getAttribute("aria-current")).toBeNull();
  });

  it("a click is a no-op when the target id is absent from the page", () => {
    render(<SectionRail items={[{ id: "missing", label: "Gone" }]} />);
    expect(() => fireEvent.click(screen.getByRole("button", { name: "Gone" }))).not.toThrow();
  });

  it("pins the clicked section through the smooth scroll, then releases on settle", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      render(
        <div>
          <SectionRail items={[{ id: "sec-a", label: "Alpha" }, { id: "sec-b", label: "Beta" }]} />
          <div id="sec-a">A</div>
          <div id="sec-b">B</div>
        </div>,
      );
      const alpha = screen.getByRole("button", { name: "Alpha" });
      const beta = screen.getByRole("button", { name: "Beta" });
      // Clicking Alpha pins it and starts the (stubbed) smooth scroll.
      act(() => { fireEvent.click(alpha); });
      expect(alpha.getAttribute("aria-current")).toBe("true");
      // A scroll tick during the animation keeps the pin alive, and Beta crossing
      // the band mid-scroll does not steal the highlight: the rail holds Alpha.
      act(() => { window.dispatchEvent(new Event("scroll")); });
      act(() => fireIntersection({ "sec-b": true }));
      expect(alpha.getAttribute("aria-current")).toBe("true");
      expect(beta.getAttribute("aria-current")).toBeNull();
      // The scroll stops; after the settle delay the pin releases. The rail is
      // already on Alpha (where the click landed), so nothing changes yet.
      act(() => { vi.advanceTimersByTime(200); });
      expect(alpha.getAttribute("aria-current")).toBe("true");
      // With the pin lifted the spy is live again: a further scroll moves the rail
      // to whatever now sits in the band (Beta).
      act(() => { window.dispatchEvent(new Event("scroll")); });
      expect(beta.getAttribute("aria-current")).toBe("true");
      expect(alpha.getAttribute("aria-current")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("auto-highlights the section scrolled into the band and drops the one that left it", () => {
    render(
      <div>
        <SectionRail items={[{ id: "sec-a", label: "Alpha" }, { id: "sec-b", label: "Beta" }]} />
        <div id="sec-a">A</div>
        <div id="sec-b">B</div>
      </div>,
    );
    const alpha = screen.getByRole("button", { name: "Alpha" });
    const beta = screen.getByRole("button", { name: "Beta" });
    // Alpha scrolled out of the band, Beta scrolled in: the rail follows Beta.
    act(() => fireIntersection({ "sec-a": false, "sec-b": true }));
    expect(beta.getAttribute("aria-current")).toBe("true");
    expect(alpha.getAttribute("aria-current")).toBeNull();
  });

  it("keeps the last highlight in a gap between two sections", () => {
    render(
      <div>
        <SectionRail items={[{ id: "sec-a", label: "Alpha" }, { id: "sec-b", label: "Beta" }]} />
        <div id="sec-a">A</div>
        <div id="sec-b">B</div>
      </div>,
    );
    const alpha = screen.getByRole("button", { name: "Alpha" });
    act(() => fireIntersection({ "sec-a": true }));
    expect(alpha.getAttribute("aria-current")).toBe("true");
    // The band sits in the gap between the two sections: Alpha has scrolled just
    // above it and Beta has not reached it. The rail holds Alpha instead of
    // flickering off. (The real panels are taller than the band, so this gap
    // never actually opens, but the guard is here regardless.)
    document.getElementById("sec-a")!.getBoundingClientRect = () =>
      ({ top: -100, bottom: -20, left: 0, right: 0, width: 0, height: 80, x: 0, y: -100, toJSON: () => ({}) }) as DOMRect;
    document.getElementById("sec-b")!.getBoundingClientRect = () =>
      ({ top: 400, bottom: 500, left: 0, right: 0, width: 0, height: 100, x: 0, y: 400, toJSON: () => ({}) }) as DOMRect;
    act(() => fireIntersection({ "sec-a": false }));
    expect(alpha.getAttribute("aria-current")).toBe("true");
  });

  it("falls back to the last section when scrolled past the bottom", () => {
    render(
      <div>
        <SectionRail items={[{ id: "sec-a", label: "Alpha" }, { id: "sec-b", label: "Beta" }]} />
        <div id="sec-a">A</div>
        <div id="sec-b">B</div>
      </div>,
    );
    const alpha = screen.getByRole("button", { name: "Alpha" });
    const beta = screen.getByRole("button", { name: "Beta" });
    act(() => fireIntersection({ "sec-a": true }));
    expect(alpha.getAttribute("aria-current")).toBe("true");
    // The whole stack has scrolled above the band (both rects sit above the band
    // line, which jsdom's zero rects already satisfy): we jumped to the very
    // bottom, so the rail moves to the last section rather than keeping Alpha.
    act(() => fireIntersection({ "sec-a": false }));
    expect(beta.getAttribute("aria-current")).toBe("true");
    expect(alpha.getAttribute("aria-current")).toBeNull();
  });

  it("falls back to the first section when the band empties near the top", () => {
    render(
      <div>
        <SectionRail items={[{ id: "sec-a", label: "Alpha" }, { id: "sec-b", label: "Beta" }]} />
        <div id="sec-a">A</div>
        <div id="sec-b">B</div>
      </div>,
    );
    const alpha = screen.getByRole("button", { name: "Alpha" });
    const beta = screen.getByRole("button", { name: "Beta" });
    // Beta is in the band first.
    act(() => fireIntersection({ "sec-b": true }));
    expect(beta.getAttribute("aria-current")).toBe("true");
    // Scroll back to the very top: the band empties while the first section still
    // sits below the band line, so the rail resets to Alpha rather than leaving
    // Beta lit. jsdom does no layout, so stub the rect to place sec-a below it.
    document.getElementById("sec-a")!.getBoundingClientRect = () =>
      ({ top: 500, bottom: 560, left: 0, right: 0, width: 0, height: 60, x: 0, y: 500, toJSON: () => ({}) }) as DOMRect;
    act(() => fireIntersection({ "sec-b": false }));
    expect(alpha.getAttribute("aria-current")).toBe("true");
    expect(beta.getAttribute("aria-current")).toBeNull();
  });

  it("re-checks on scroll so a jump straight to the top resets the rail", () => {
    render(
      <div>
        <SectionRail items={[{ id: "sec-a", label: "Alpha" }, { id: "sec-b", label: "Beta" }]} />
        <div id="sec-a">A</div>
        <div id="sec-b">B</div>
      </div>,
    );
    const alpha = screen.getByRole("button", { name: "Alpha" });
    const beta = screen.getByRole("button", { name: "Beta" });
    // After the band empties, Beta is lit as the last section. Now place the first
    // section below the band (we are at the very top): an instant jump there moves
    // nothing through the band, so the observer stays silent and only a scroll
    // event can reset the rail to the first section.
    act(() => fireIntersection({ "sec-b": true }));
    act(() => fireIntersection({ "sec-b": false }));
    expect(beta.getAttribute("aria-current")).toBe("true");
    document.getElementById("sec-a")!.getBoundingClientRect = () =>
      ({ top: 500, bottom: 560, left: 0, right: 0, width: 0, height: 60, x: 0, y: 500, toJSON: () => ({}) }) as DOMRect;
    act(() => { window.dispatchEvent(new Event("scroll")); });
    expect(alpha.getAttribute("aria-current")).toBe("true");
    expect(beta.getAttribute("aria-current")).toBeNull();
  });

  it("does not observe when the page has no matching sections", () => {
    // Only one of the two ids has an element, so the filter drops the other and
    // the rail still wires up without throwing.
    const { container } = render(
      <div>
        <SectionRail items={[{ id: "sec-a", label: "Alpha" }, { id: "ghost", label: "Ghost" }]} />
        <div id="sec-a">A</div>
      </div>,
    );
    expect(container.querySelector("nav")).not.toBeNull();
    act(() => fireIntersection({ "sec-a": true }));
    expect(screen.getByRole("button", { name: "Alpha" }).getAttribute("aria-current")).toBe("true");
  });

  it("draws a divider only where the group changes", () => {
    const { container } = render(
      <SectionRail items={[
        { id: "a", label: "A", group: "one" },
        { id: "b", label: "B", group: "one" },
        { id: "c", label: "C", group: "two" },
      ]} />,
    );
    // one group boundary (one -> two) => exactly one divider
    expect(container.querySelectorAll("span[aria-hidden='true']").length).toBe(1);
  });
});
