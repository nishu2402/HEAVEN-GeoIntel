// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import OpsecPanel from "@/components/shared/OpsecPanel";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("<OpsecPanel>", () => {
  it("opens to disclose global notes and per-mode exposure, then closes", () => {
    render(<OpsecPanel />);
    // Closed initially.
    expect(screen.queryByText(/your footprint/i)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Opsec/i }));
    expect(screen.getByText(/your footprint/i)).toBeTruthy();
    // Global note about server-side proxying.
    expect(screen.getByText(/upstreams see this instance's IP/i)).toBeTruthy();
    // domain touches the target; image is in-browser; both badges render.
    expect(screen.getByText(/touches target/i)).toBeTruthy();
    expect(screen.getByText(/in-browser/i)).toBeTruthy();
    expect(screen.getAllByText(/third-party only/i).length).toBeGreaterThan(0);
    // image discloses to no one.
    expect(screen.getByText(/no one: parsed locally/i)).toBeTruthy();
    // a keyless third party is named.
    expect(screen.getByText(/CIRCL hashlookup/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Close/i }));
    expect(screen.queryByText(/your footprint/i)).toBeNull();
  });

  it("closes when the backdrop is clicked", () => {
    const { container } = render(<OpsecPanel />);
    fireEvent.click(screen.getByRole("button", { name: /Opsec/i }));
    // The backdrop is the outermost fixed overlay; clicking it closes the panel.
    const overlay = container.querySelector(".fixed.inset-0") as HTMLElement;
    fireEvent.click(overlay);
    expect(screen.queryByText(/your footprint/i)).toBeNull();
  });
});
