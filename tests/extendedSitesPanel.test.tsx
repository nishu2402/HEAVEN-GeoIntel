// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import ExtendedSitesPanel from "@/components/username/ExtendedSitesPanel";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("<ExtendedSitesPanel>", () => {
  it("renders nothing for a blank handle", () => {
    const { container } = render(<ExtendedSitesPanel username="   " />);
    expect(container.firstChild).toBeNull();
  });

  it("stays collapsed until opened, then reveals categories and their links on demand", () => {
    render(<ExtendedSitesPanel username="torvalds" />);

    // Collapsed: only the one toggle button, no category rows, no attribution.
    expect(screen.getByText(/EXTENDED SWEEP: \d+ more sites/)).toBeTruthy();
    expect(screen.queryByText(/WhatsMyName/)).toBeNull();
    expect(screen.getAllByRole("button")).toHaveLength(1);

    // Open the overlay → category buttons + attribution link appear.
    fireEvent.click(screen.getByText(/EXTENDED SWEEP/));
    expect(screen.getByText(/WhatsMyName/)).toBeTruthy();
    const buttons = screen.getAllByRole("button");
    expect(buttons.length).toBeGreaterThan(1);

    const linksBefore = screen.getAllByRole("link").length; // just the attribution link
    // Expand the first category → its site links render.
    fireEvent.click(buttons[1]);
    const linksAfter = screen.getAllByRole("link").length;
    expect(linksAfter).toBeGreaterThan(linksBefore);

    // Collapse the category again → links go away.
    fireEvent.click(buttons[1]);
    expect(screen.getAllByRole("link").length).toBe(linksBefore);

    // Close the whole overlay.
    fireEvent.click(screen.getByText(/EXTENDED SWEEP/));
    expect(screen.queryByText(/WhatsMyName/)).toBeNull();
  });
});
