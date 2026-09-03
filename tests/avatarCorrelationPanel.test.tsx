// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import AvatarCorrelationPanel, { type ComputeHash } from "@/components/username/AvatarCorrelationPanel";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const A = BigInt("0xF0F0F0F0F0F0F0F0");
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

/** A compute that looks each URL up in a fixed table (null = unreadable). */
const from = (table: Record<string, bigint | null>): ComputeHash => (url) => Promise.resolve(table[url] ?? null);

describe("<AvatarCorrelationPanel>", () => {
  it("renders nothing with fewer than two avatars", async () => {
    const { container } = render(<AvatarCorrelationPanel avatars={[{ url: "https://cdn/a.png", source: "GitHub" }]} compute={from({})} />);
    await flush();
    expect(container.firstChild).toBeNull();
  });

  it("shows a cross-platform match, rendering safe avatars and skipping unsafe URLs", async () => {
    const { container } = render(<AvatarCorrelationPanel
      avatars={[
        { url: "https://cdn/a.png", source: "GitHub" },
        { url: "javascript:alert(1)", source: "GitLab" }, // unsafe URL → image skipped
      ]}
      compute={from({ "https://cdn/a.png": A, "javascript:alert(1)": A })}
    />);
    await flush();
    expect(screen.getByText(/AVATAR MATCH/)).toBeTruthy();
    expect(screen.getByText(/100% match/)).toBeTruthy();
    expect(screen.getByText(/GitHub · GitLab/)).toBeTruthy();
    // Only the safe (https) avatar renders as an image; the javascript: URL is dropped.
    expect(container.querySelectorAll("img")).toHaveLength(1);
  });

  it("drops avatars that cannot be read, keeping a match among the rest", async () => {
    render(<AvatarCorrelationPanel
      avatars={[
        { url: "https://cdn/a.png", source: "GitHub" },
        { url: "https://cdn/b.png", source: "GitLab" },
        { url: "https://cdn/c.png", source: "Reddit" }, // unreadable → null
      ]}
      compute={from({ "https://cdn/a.png": A, "https://cdn/b.png": A, "https://cdn/c.png": null })}
    />);
    await flush();
    expect(screen.getByText(/GitHub · GitLab/)).toBeTruthy();
    expect(screen.queryByText(/Reddit/)).toBeNull();
  });

  it("self-hides when no two avatars perceptually match", async () => {
    const { container } = render(<AvatarCorrelationPanel
      avatars={[
        { url: "https://cdn/a.png", source: "GitHub" },
        { url: "https://cdn/b.png", source: "Reddit" },
      ]}
      compute={from({ "https://cdn/a.png": A, "https://cdn/b.png": ~A & ((BigInt(1) << BigInt(64)) - BigInt(1)) })}
    />);
    await flush();
    expect(container.firstChild).toBeNull();
  });

  it("falls back to the in-browser hasher when no compute is injected", async () => {
    // jsdom loads no image, so the default hasher never resolves and the panel
    // stays hidden — this just exercises the default-parameter path.
    const { container } = render(<AvatarCorrelationPanel avatars={[
      { url: "https://cdn/a.png", source: "GitHub" },
      { url: "https://cdn/b.png", source: "GitLab" },
    ]} />);
    await flush();
    expect(container.firstChild).toBeNull();
  });
});
