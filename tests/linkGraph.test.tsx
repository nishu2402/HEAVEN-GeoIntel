// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import LinkGraph, { type GraphEntity } from "@/components/graph/LinkGraph";

// Full interaction coverage for the link-analysis graph: the read-only hint, the
// editable add/edit/remove/clear flow, dedupe guards, and PNG export (canvas +
// Image are stubbed since jsdom has no real 2D context).

// A kind label (e.g. "EMAIL") appears both as an SVG <text> node and as an
// <option>; target the graph node explicitly by the <text> selector.
const node = (label: string) => screen.getByText(label, { selector: "text" });

afterEach(cleanup);

const FIVE: GraphEntity[] = [
  { kind: "phone", value: "+14155552671" },
  { kind: "email", value: "a@b.com" },
  { kind: "username", value: "neo" },
  { kind: "ip", value: "8.8.8.8" },
  { kind: "domain", value: "this-is-a-really-long-domain-name.example.com" }, // triggers label truncation
];

describe("<LinkGraph> read-only", () => {
  it("shows the empty hint when there are no entities and no onChange", () => {
    render(<LinkGraph entities={[]} />);
    expect(screen.getByText(/no entities yet/i)).toBeTruthy();
  });

  it("renders one node per entity with the legend, and ignores clicks (not editable)", () => {
    render(<LinkGraph entities={FIVE} title="SESSION LINK GRAPH" />);
    expect(screen.getByText(/session link graph/i)).toBeTruthy();
    expect(screen.getByText(/— 5 nodes/i)).toBeTruthy();
    // legend chip per kind present
    expect(screen.getByText(/PHONE \(1\)/)).toBeTruthy();
    expect(screen.getByText(/DOMAIN \(1\)/)).toBeTruthy();
    // truncated long label ends with an ellipsis
    expect(screen.getByText(/this-is-a-really-long…/)).toBeTruthy();
    // clicking a node does nothing (no edit panel appears) when read-only
    fireEvent.click(node("PHONE"));
    expect(screen.queryByText(/editing node/i)).toBeNull();
    // no add form / clear button in read-only mode
    expect(screen.queryByRole("button", { name: /add node/i })).toBeNull();
  });

  it("uses the single-node angle branch for exactly one entity", () => {
    render(<LinkGraph entities={[{ kind: "ip", value: "1.1.1.1" }]} />);
    expect(screen.getByText(/— 1 node$/i)).toBeTruthy();
  });

  it("omits legend chips for kinds with no nodes", () => {
    render(<LinkGraph entities={[{ kind: "phone", value: "+1" }, { kind: "phone", value: "+2" }]} />);
    expect(screen.getByText(/PHONE \(2\)/)).toBeTruthy();       // present kind → chip
    expect(screen.queryByText(/EMAIL \(/)).toBeNull();           // absent kind → no chip
  });
});

describe("<LinkGraph> editable", () => {
  it("renders the canvas + add form even when empty, and adds a node", () => {
    const onChange = vi.fn();
    render(<LinkGraph entities={[]} onChange={onChange} />);
    expect(screen.getByText(/editable/i)).toBeTruthy();
    // change the add-form kind select, then add a node of that kind
    fireEvent.change(screen.getByLabelText("New node type"), { target: { value: "domain" } });
    const input = screen.getByPlaceholderText(/add a node/i);
    fireEvent.change(input, { target: { value: "  example.com  " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith([{ kind: "domain", value: "example.com" }]);
  });

  it("ignores an empty add and a duplicate add (clearing the field)", () => {
    const onChange = vi.fn();
    render(<LinkGraph entities={[{ kind: "phone", value: "+1" }]} onChange={onChange} />);
    const input = screen.getByPlaceholderText(/add a node/i) as HTMLInputElement;
    // a non-Enter keydown does not submit
    fireEvent.change(input, { target: { value: "x" } });
    fireEvent.keyDown(input, { key: "a" });
    expect(onChange).not.toHaveBeenCalled();
    // whitespace-only value submitted via Enter (the button is disabled) → no-op
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).not.toHaveBeenCalled();
    // duplicate (same kind+value, case-insensitive) → cleared, no onChange
    fireEvent.change(input, { target: { value: "+1" } });
    fireEvent.click(screen.getByRole("button", { name: /add node/i }));
    expect(onChange).not.toHaveBeenCalled();
    expect(input.value).toBe("");
  });

  it("selects a node, edits its value, and saves through onChange", () => {
    const onChange = vi.fn();
    render(<LinkGraph entities={FIVE} onChange={onChange} />);
    fireEvent.click(node("EMAIL")); // select the email node
    expect(screen.getByText(/editing node #2/i)).toBeTruthy();
    const editInput = screen.getByPlaceholderText(/node value/i);
    fireEvent.change(editInput, { target: { value: "changed@b.com" } });
    fireEvent.keyDown(editInput, { key: "Enter" });
    expect(onChange).toHaveBeenCalled();
    const next = onChange.mock.calls[0][0] as GraphEntity[];
    expect(next[1]).toEqual({ kind: "email", value: "changed@b.com" });
  });

  it("removes a node, and cancels an edit with Escape / the cancel button", () => {
    const onChange = vi.fn();
    render(<LinkGraph entities={FIVE} onChange={onChange} />);
    fireEvent.click(node("IP"));
    fireEvent.click(screen.getByRole("button", { name: /remove node/i }));
    expect((onChange.mock.calls[0][0] as GraphEntity[]).some((e) => e.value === "8.8.8.8")).toBe(false);

    // re-select and cancel via Escape (no onChange), then via the cancel button
    onChange.mockClear();
    fireEvent.click(node("PHONE"));
    fireEvent.keyDown(screen.getByPlaceholderText(/node value/i), { key: "Escape" });
    expect(screen.queryByText(/editing node/i)).toBeNull();

    fireEvent.click(node("PHONE"));
    fireEvent.click(screen.getByRole("button", { name: /cancel edit/i }));
    expect(screen.queryByText(/editing node/i)).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("blocks saving an empty value and a duplicate (dedupe on save deselects)", () => {
    const onChange = vi.fn();
    render(<LinkGraph entities={FIVE} onChange={onChange} />);
    // empty value → SAVE disabled, and calling save is a no-op
    fireEvent.click(node("USERNAME"));
    const editInput = screen.getByPlaceholderText(/node value/i);
    fireEvent.change(editInput, { target: { value: "   " } });
    fireEvent.keyDown(editInput, { key: "Enter" });
    expect(onChange).not.toHaveBeenCalled();

    // edit the phone to collide with the existing email? different kind → not a dup.
    // Make it collide with itself's kind+another value that already exists:
    fireEvent.click(node("USERNAME"));
    const editInput2 = screen.getByPlaceholderText(/node value/i);
    // change kind to email + value a@b.com → duplicate of node #2 → save deselects, no change
    fireEvent.change(screen.getByLabelText("Node type"), { target: { value: "email" } });
    fireEvent.change(editInput2, { target: { value: "A@B.com" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByText(/editing node/i)).toBeNull();
  });

  it("hovers a node and clears the whole graph", () => {
    const onChange = vi.fn();
    render(<LinkGraph entities={FIVE} onChange={onChange} />);
    const phone = node("PHONE");
    fireEvent.mouseEnter(phone);
    fireEvent.mouseLeave(phone);
    fireEvent.click(screen.getByRole("button", { name: /^clear$/i }));
    expect(onChange).toHaveBeenCalledWith([]);
  });
});

describe("<LinkGraph> PNG export", () => {
  let ctxValue: unknown;
  beforeEach(() => {
    class FakeImage {
      onload: (() => void) | null = null;
      _src = "";
      set src(v: string) { this._src = v; this.onload?.(); }
      get src() { return this._src; }
    }
    vi.stubGlobal("Image", FakeImage);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => ctxValue as never);
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/png;base64,AAAA");
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it("draws to a canvas and triggers a download when a 2D context is available", () => {
    ctxValue = { fillStyle: "", fillRect: vi.fn(), drawImage: vi.fn() };
    render(<LinkGraph entities={FIVE} onChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /png/i }));
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalled();
  });

  it("bails out safely when the 2D context is unavailable", () => {
    ctxValue = null;
    render(<LinkGraph entities={FIVE} onChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /png/i }));
    expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled();
  });
});
