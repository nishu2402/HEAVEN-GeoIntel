// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import Term from "@/components/shared/Term";
import GlanceCard from "@/components/shared/GlanceCard";
import CopyLinkButton from "@/components/shared/CopyLinkButton";

afterEach(cleanup);

describe("<Term> jargon tooltip", () => {
  it("renders a known acronym as an <abbr> with an explanatory title", () => {
    render(<Term k="NPA" />);
    const el = screen.getByText("NPA");
    expect(el.tagName.toLowerCase()).toBe("abbr");
    expect(el.getAttribute("title") ?? "").toMatch(/area code/i);
  });

  it("passes unknown keys through as plain text (no tooltip)", () => {
    const { container } = render(<Term k="ZZZ">plain</Term>);
    expect(container.textContent).toBe("plain");
    expect(container.querySelector("abbr")).toBeNull();
  });
});

describe("<GlanceCard>", () => {
  it("renders the heading and every tile", () => {
    render(
      <GlanceCard
        tiles={[{ label: "Country", value: "US" }, { label: "Risk", value: "35" }]}
      />,
    );
    expect(screen.getByText("[ AT A GLANCE ]")).toBeTruthy();
    expect(screen.getByText("Country")).toBeTruthy();
    expect(screen.getByText("US")).toBeTruthy();
    expect(screen.getByText("35")).toBeTruthy();
  });
});

describe("<CopyLinkButton>", () => {
  it("flips from COPY LINK to LINK COPIED on click", () => {
    render(<CopyLinkButton />);
    const btn = screen.getByRole("button");
    expect(btn.textContent).toMatch(/COPY LINK/);
    fireEvent.click(btn);
    expect(btn.textContent).toMatch(/LINK COPIED/);
  });
});
