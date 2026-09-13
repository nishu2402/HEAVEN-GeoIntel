// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import ResolvedIdentityCard from "@/components/username/ResolvedIdentityCard";
import type { IdentitySignals, LinkProof } from "@/lib/types";

const sig = (over: Partial<IdentitySignals> = {}): IdentitySignals => ({ names: [], locations: [], avatars: [], bios: [], ...over });

const avatarProof = (a: string, b: string): LinkProof => ({
  kind: "avatar",
  platforms: [a, b],
  detail: `same profile photo on ${a} and ${b} (100% perceptual match)`,
});

beforeEach(cleanup);

describe("ResolvedIdentityCard", () => {
  it("self-hides when there is nothing to resolve", () => {
    const { container } = render(<ResolvedIdentityCard identity={sig()} />);
    expect(container.firstChild).toBeNull();
  });

  it("calls an unproven fusion a CANDIDATE and lists the rest as leads", () => {
    // The `torvalds` shape: one real account plus other people holding the same
    // handle. The card used to present all of it as one person.
    render(<ResolvedIdentityCard identity={sig({
      names: [{ value: "Linus Torvalds", source: "GitHub" }],
      locations: [
        { value: "Portland, OR", source: "GitHub" },
        { value: "GT", source: "Chess.com" },
        { value: "Bern", source: "Lichess" },
      ],
    })} />);
    expect(screen.getByText("IDENTITY CANDIDATE")).toBeTruthy();
    expect(screen.getByText("Linus Torvalds")).toBeTruthy();
    expect(screen.getByText("Portland, OR")).toBeTruthy();
    expect(screen.getByText(/Nothing links these accounts beyond the shared handle/)).toBeTruthy();
    expect(screen.getByText(/UNLINKED CANDIDATES \(2\)/)).toBeTruthy();
    expect(screen.getByText(/GT/)).toBeTruthy();
    expect(screen.getByText(/Bern/)).toBeTruthy();
  });

  it("calls a proven fusion RESOLVED and shows the proof it rests on", () => {
    render(<ResolvedIdentityCard
      identity={sig({
        names: [{ value: "Daniel Stenberg", source: "GitHub" }, { value: "daniel:// stenberg://", source: "Mastodon" }],
        avatars: [{ url: "https://a/x.png", source: "GitHub" }],
      })}
      proofs={[avatarProof("GitHub", "Mastodon")]}
    />);
    expect(screen.getByText("RESOLVED IDENTITY")).toBeTruthy();
    expect(screen.getByText("HIGH")).toBeTruthy();
    expect(screen.getByText(/2\/2 linked accounts agree/)).toBeTruthy();
    expect(screen.getByText(/same profile photo on GitHub and Mastodon/)).toBeTruthy();
    expect(screen.getByText("from GitHub + Mastodon")).toBeTruthy();
    expect((document.querySelector("img") as HTMLImageElement).src).toContain("x.png");
  });

  it("names a contradiction between linked accounts instead of averaging it away", () => {
    render(<ResolvedIdentityCard
      identity={sig({
        names: [{ value: "Ada", source: "A" }, { value: "Bob", source: "B" }],
        locations: [{ value: "Berlin", source: "A" }, { value: "Lisbon", source: "B" }],
      })}
      proofs={[avatarProof("A", "B")]}
    />);
    expect(screen.getByText(/linked accounts disagree on name: Ada \(A\) vs Bob \(B\)/)).toBeTruthy();
    expect(screen.getByText(/linked accounts disagree on location: Berlin \(A\) vs Lisbon \(B\)/)).toBeTruthy();
    expect(screen.getByText("LOW")).toBeTruthy();
  });

  it("prefers the server's own resolution when the response carries one", () => {
    render(<ResolvedIdentityCard
      identity={sig({ names: [{ value: "ignored", source: "X" }] })}
      resolved={{
        name: { value: "From the server", sources: ["x"], agreement: 1, total: 1 },
        location: null,
        avatar: null,
        confidence: 77,
        label: "high",
        cluster: { platforms: ["X", "Y"], proofs: [] },
        unlinked: [],
        conflicts: [],
      }}
    />);
    expect(screen.getByText("From the server")).toBeTruthy();
    expect(screen.getByText("77")).toBeTruthy();
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

  it("renders a location-only, name-less identity", () => {
    render(<ResolvedIdentityCard identity={sig({ locations: [{ value: "Berlin", source: "A" }] })} />);
    expect(screen.getByText("Berlin")).toBeTruthy();
    expect(screen.queryByText(/linked accounts agree/)).toBeNull(); // no name block
  });
});
