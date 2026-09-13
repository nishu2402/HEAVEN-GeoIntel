// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import AvatarCorrelationPanel from "@/components/username/AvatarCorrelationPanel";
import type { AvatarCluster } from "@/lib/types";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

// The hashing itself moved to the server (see lib/server/avatarHash.ts): the
// browser could only read pixels from hosts that send CORS headers, and two of
// the three avatar hosts in a measured lookup send none. The panel now renders
// what the server found.

const cluster = (over: Partial<AvatarCluster> = {}): AvatarCluster => ({
  sources: ["GitHub", "Mastodon"],
  urls: ["https://cdn/a.png", "https://cdn/b.png"],
  similarity: 100,
  ...over,
});

describe("<AvatarCorrelationPanel>", () => {
  it("renders nothing when there is neither a match nor an explanation", () => {
    const { container } = render(<AvatarCorrelationPanel clusters={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("shows a cross-platform match and renders only safe image URLs", () => {
    render(<AvatarCorrelationPanel clusters={[cluster({ urls: ["https://cdn/a.png", "javascript:alert(1)"] })]} />);
    expect(screen.getByText(/AVATAR MATCH/)).toBeTruthy();
    expect(screen.getByText(/100% match/)).toBeTruthy();
    expect(screen.getByText(/GitHub · Mastodon/)).toBeTruthy();
    // The unsafe URL is dropped rather than rendered as an image source.
    const imgs = document.querySelectorAll("img");
    expect(imgs).toHaveLength(1);
    expect(imgs[0].getAttribute("src")).toBe("https://cdn/a.png");
  });

  it("explains an avatar it could not compare instead of silently dropping it", () => {
    render(<AvatarCorrelationPanel
      clusters={[]}
      skipped={[{ url: "https://m/missing.png", source: "Mastodon", reason: "Mastodon default avatar" }]}
    />);
    expect(screen.getByText(/No two profile photos matched/)).toBeTruthy();
    expect(screen.getByText(/Mastodon: not compared \(Mastodon default avatar\)/)).toBeTruthy();
  });

  it("says the comparison runs on the server and excludes platform defaults", () => {
    render(<AvatarCorrelationPanel clusters={[cluster()]} />);
    expect(screen.getByText(/computed on the server/i)).toBeTruthy();
    expect(screen.getByText(/default avatars are excluded/i)).toBeTruthy();
  });
});
