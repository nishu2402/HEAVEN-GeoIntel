// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, act, waitFor } from "@testing-library/react";
import InvestigationGraph, { mergeGraph } from "@/components/graph/InvestigationGraph";
import type { InvestigationCase } from "@/lib/types";
import type { GraphEntity } from "@/components/graph/LinkGraph";
import { installResizeObserver } from "./testUtils";

// The graph is the picture of what the analyst has, and it used to be the
// picture of what this browser tab happened to remember. These pin the two
// claims that fixed: a saved case's identifiers AND its inferred edges belong on
// the canvas, and an identifier seen in two cases gets called out, because that
// is invisible once it is just another dot.

installResizeObserver();
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const ent = (kind: string, value: string) => ({ kind, value, addedAt: 1 }) as InvestigationCase["entities"][number];

const kase = (over: Partial<InvestigationCase> = {}): InvestigationCase => ({
  id: "c1",
  name: "Kestrel",
  createdAt: 1,
  updatedAt: 2,
  entities: [ent("domain", "example.com")],
  ...over,
});

const session: GraphEntity[] = [{ kind: "email", value: "a@example.com" }];

const mount = (cases: InvestigationCase[], entities = session, onChange = vi.fn()) =>
  act(async () => {
    render(<InvestigationGraph sessionEntities={entities} onChange={onChange} loadCases={async () => cases} />);
  });

describe("mergeGraph", () => {
  it("adds a case's identifiers to the session's own", () => {
    const { entities } = mergeGraph(session, [kase()]);
    expect(entities).toEqual([
      { kind: "email", value: "a@example.com" },
      { kind: "domain", value: "example.com" },
    ]);
  });

  it("does not draw the same identifier twice, whatever its casing", () => {
    // The store dedupes on a lowercased value; the graph has to agree or the
    // canvas shows one identifier as two separate nodes.
    const { entities } = mergeGraph(
      [{ kind: "domain", value: "Example.COM" }],
      [kase({ entities: [ent("domain", "example.com")] })],
    );
    expect(entities).toHaveLength(1);
  });

  it("counts an identifier shared by two cases once, across both", () => {
    const { entities } = mergeGraph([], [
      kase(),
      kase({ id: "c2", name: "Osprey", entities: [ent("domain", "example.com")] }),
    ]);
    expect(entities).toEqual([{ kind: "domain", value: "example.com" }]);
  });

  it("carries a case's derived edges, which are the inference the dots lose", () => {
    const { links } = mergeGraph([], [kase({
      entities: [ent("domain", "example.com"), ent("ip", "1.2.3.4")],
      edges: [{
        from: { kind: "domain", value: "example.com" },
        to: { kind: "ip", value: "1.2.3.4" },
        reason: "A record",
        addedAt: 1,
      }],
    })]);
    expect(links).toEqual([{
      from: { kind: "domain", value: "example.com" },
      to: { kind: "ip", value: "1.2.3.4" },
      reason: "A record",
      addedAt: 1,
    }]);
  });

  it("treats a case with no edges as a case with no edges", () => {
    expect(mergeGraph([], [kase()]).links).toEqual([]);
  });

  it("reports the identifiers that appear in more than one case", () => {
    const { shared } = mergeGraph([], [
      kase(),
      kase({ id: "c2", name: "Osprey" }),
    ]);
    expect(shared).toHaveLength(1);
    expect(shared[0]).toMatchObject({ kind: "domain", value: "example.com", count: 2 });
  });
});

describe("<InvestigationGraph>", () => {
  it("loads the saved cases on mount and folds them in", async () => {
    await mount([kase()]);
    await waitFor(() => expect(screen.getByText(/\+1 identifiers/)).toBeTruthy());
  });

  it("says nothing about a count when the cases add no new identifier", async () => {
    await mount([kase({ entities: [ent("email", "a@example.com")] })]);
    expect(screen.queryByText(/identifiers\)/)).toBeNull();
    expect(screen.getByText(/include saved cases/)).toBeTruthy();
  });

  it("drops the case half of the graph when the box is unticked", async () => {
    await mount([kase()]);
    await waitFor(() => expect(screen.getByText(/\+1 identifiers/)).toBeTruthy());
    fireEvent.click(screen.getByRole("checkbox"));
    expect(screen.queryByText(/\+1 identifiers/)).toBeNull();
    // The cross-case callout is a claim about cases, so it goes with them.
    expect(screen.queryByText(/SHARED ACROSS CASES/)).toBeNull();
  });

  it("calls out an identifier that shows up in two investigations", async () => {
    await mount([kase(), kase({ id: "c2", name: "Osprey" })]);
    await waitFor(() => expect(screen.getByText(/SHARED ACROSS CASES: 1/)).toBeTruthy());
    expect(screen.getByText(/in Kestrel, Osprey/)).toBeTruthy();
  });

  it("shows no cross-case section when nothing is shared", async () => {
    await mount([kase()]);
    expect(screen.queryByText(/SHARED ACROSS CASES/)).toBeNull();
  });

  it("lists at most a dozen shared identifiers", async () => {
    // A long list stops being a signal; the count above it still tells the truth.
    const many = Array.from({ length: 15 }, (_, i) => ent("domain", `d${i}.test`));
    await mount([kase({ entities: many }), kase({ id: "c2", name: "Osprey", entities: many })]);
    await waitFor(() => expect(screen.getByText(/SHARED ACROSS CASES: 15/)).toBeTruthy());
    expect(screen.getAllByText("domain")).toHaveLength(12);
  });

  it("reloads on request and disables the button while it is working", async () => {
    let release: (v: InvestigationCase[]) => void = () => {};
    const pending = new Promise<InvestigationCase[]>((r) => { release = r; });
    let first = true;
    await act(async () => {
      render(<InvestigationGraph
        sessionEntities={session}
        onChange={vi.fn()}
        loadCases={() => { if (first) { first = false; return Promise.resolve([]); } return pending; }}
      />);
    });
    const button = screen.getByRole("button", { name: /Reload cases/i }) as HTMLButtonElement;
    await act(async () => { fireEvent.click(button); });
    expect(button.disabled).toBe(true);
    await act(async () => { release([kase()]); await pending; });
    expect(button.disabled).toBe(false);
    await waitFor(() => expect(screen.getByText(/\+1 identifiers/)).toBeTruthy());
  });

  it("hands edits back to the caller", async () => {
    const onChange = vi.fn();
    await mount([], [{ kind: "domain", value: "example.com" }], onChange);
    fireEvent.click(screen.getByRole("button", { name: /clear/i }));
    expect(onChange).toHaveBeenCalledWith([]);
  });
});

describe("<InvestigationGraph> talking to the endpoint", () => {
  it("reads /api/cases uncached and merges what it finds", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true, status: 200, json: async () => ({ cases: [kase()] }),
    }) as Response);
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => { render(<InvestigationGraph sessionEntities={session} onChange={vi.fn()} />); });
    await waitFor(() => expect(screen.getByText(/\+1 identifiers/)).toBeTruthy());
    // A cached case list would show a stale investigation as the current one.
    expect(fetchMock).toHaveBeenCalledWith("/api/cases", { cache: "no-store" });
  });

  it("draws the session's own nodes when the case list is refused", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }) as Response));
    await act(async () => { render(<InvestigationGraph sessionEntities={session} onChange={vi.fn()} />); });
    expect(screen.queryByText(/identifiers\)/)).toBeNull();
  });

  it("tolerates a response with no cases key", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }) as Response));
    await act(async () => { render(<InvestigationGraph sessionEntities={session} onChange={vi.fn()} />); });
    expect(screen.queryByText(/identifiers\)/)).toBeNull();
  });
});
