// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import ResolvedIdentityCard from "@/components/username/ResolvedIdentityCard";
import type { IdentitySignals } from "@/lib/types";

const sig = (over: Partial<IdentitySignals> = {}): IdentitySignals => ({ names: [], locations: [], avatars: [], bios: [], ...over });

beforeEach(cleanup);

describe("ResolvedIdentityCard", () => {
  it("self-hides when there is nothing to resolve", () => {
    const { container } = render(<ResolvedIdentityCard identity={sig()} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders a high-confidence identity with name, agreement, location and avatar", () => {
    render(<ResolvedIdentityCard identity={sig({
      names: [{ value: "Linus Torvalds", source: "GitHub" }, { value: "linus torvalds", source: "GitLab" }, { value: "L T", source: "Reddit" }],
      locations: [{ value: "Portland", source: "GitHub" }],
      avatars: [{ url: "https://a/x.png", source: "GitHub" }],
    })} />);
    expect(screen.getByText("MOST-LIKELY IDENTITY")).toBeTruthy();
    expect(screen.getByText("HIGH")).toBeTruthy();
    expect(screen.getByText("Linus Torvalds")).toBeTruthy();
    expect(screen.getByText(/2\/3 platforms agree/)).toBeTruthy();
    expect(screen.getByText("Portland")).toBeTruthy();
    expect((document.querySelector("img") as HTMLImageElement).src).toContain("x.png");
  });

  it("hides the avatar when the image fails to load", () => {
    render(<ResolvedIdentityCard identity={sig({
      names: [{ value: "Ada", source: "A" }],
      avatars: [{ url: "https://a/broken.png", source: "A" }],
    })} />);
    const img = document.querySelector("img") as HTMLImageElement;
    fireEvent.error(img);
    expect(document.querySelector("img")).toBeNull();
  });

  it("renders a low-confidence single-source name (singular 'platform')", () => {
    render(<ResolvedIdentityCard identity={sig({ names: [{ value: "Solo", source: "X" }] })} />);
    expect(screen.getByText("LOW")).toBeTruthy();
    expect(screen.getByText(/1\/1 platform agree/)).toBeTruthy(); // singular
    expect(document.querySelector("img")).toBeNull(); // no avatar
  });

  it("renders a two-source unanimous name as medium confidence", () => {
    render(<ResolvedIdentityCard identity={sig({ names: [{ value: "Ada", source: "A" }, { value: "ada", source: "B" }] })} />);
    expect(screen.getByText("MEDIUM")).toBeTruthy(); // 35 + 20 + 10 = 65
    expect(screen.getByText("Ada")).toBeTruthy();
  });

  it("renders a location-only, name-less identity", () => {
    render(<ResolvedIdentityCard identity={sig({ locations: [{ value: "Berlin", source: "A" }] })} />);
    expect(screen.getByText("Berlin")).toBeTruthy();
    expect(screen.queryByText(/platform/)).toBeNull(); // no name block
  });
});
