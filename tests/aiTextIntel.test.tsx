// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import AiTextIntel from "@/components/shared/AiTextIntel";

afterEach(() => cleanup());

// The panel is a thin view over the on-device model: type text, see extracted
// identifiers plus a topic/language read-out, and hand each one to a lookup or
// the whole set to the graph. Both the rich path and the empty path are covered.

function setup() {
  const onAddEntities = vi.fn();
  const onQuickLookup = vi.fn();
  render(<AiTextIntel onAddEntities={onAddEntities} onQuickLookup={onQuickLookup} />);
  const box = screen.getByLabelText("Text to analyze");
  return { onAddEntities, onQuickLookup, box };
}

describe("<AiTextIntel>", () => {
  it("shows only the input before any text is entered", () => {
    setup();
    expect(screen.queryByText(/Identifiers \(/)).toBeNull();
    expect(screen.queryByText(/No identifiers found/)).toBeNull();
  });

  it("extracts identifiers, labels the topic and language, and wires the actions", () => {
    const { onAddEntities, onQuickLookup, box } = setup();
    fireEvent.change(box, {
      target: { value: "the leaked password dump from 8.8.8.8 and admin@example.com at https://evil.io/x" },
    });

    // Topic badge (credentials) and language badge (en) both render.
    expect(screen.getByText(/credentials ·/i)).toBeTruthy();
    expect(screen.getByText(/lang: en/i)).toBeTruthy();

    // The identifier list appears with a count and a run button per row.
    expect(screen.getByText(/Identifiers \(/)).toBeTruthy();
    const runButtons = screen.getAllByRole("button", { name: /run/i });
    expect(runButtons.length).toBeGreaterThan(0);
    fireEvent.click(runButtons[0]);
    expect(onQuickLookup).toHaveBeenCalled();

    // The bulk "add to graph" hands the mapped entities to the session graph.
    const addBtn = screen.getByRole("button", { name: /Add \d+ to graph/i });
    fireEvent.click(addBtn);
    expect(onAddEntities).toHaveBeenCalled();
    expect(onAddEntities.mock.calls[0][0].some((e: { kind: string }) => e.kind === "ip")).toBe(true);
  });

  it("states plainly when text has no identifiers, topic or language", () => {
    const { box } = setup();
    fireEvent.change(box, { target: { value: "%%% $$$ ^^^ &&&" } });
    expect(screen.getByText(/No identifiers found/)).toBeTruthy();
    // Neutral topic and unknown language render no badge.
    expect(screen.queryByText(/lang:/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /Add \d+ to graph/i })).toBeNull();
  });
});
