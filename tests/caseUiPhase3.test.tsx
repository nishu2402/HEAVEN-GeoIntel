// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import AddToCase from "@/components/shared/AddToCase";
import LinkGraph from "@/components/graph/LinkGraph";
import CasesPanel from "@/components/cases/CasesPanel";
import { installMemoryLocalStorage } from "./testUtils";
import type { InvestigationCase } from "@/lib/types";

beforeEach(() => { installMemoryLocalStorage(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const jsonRes = (body: unknown, status = 200) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;

/** Record every POST body so a test can assert what the panel actually sent. */
function stubApi(handler: (url: string, opts?: RequestInit) => Response | Promise<Response>) {
  const posts: Record<string, unknown>[] = [];
  vi.stubGlobal("fetch", vi.fn(async (u: string | URL, opts?: RequestInit) => {
    if (opts?.method === "POST") posts.push(JSON.parse(String(opts.body)));
    return handler(String(u), opts);
  }));
  return posts;
}

const CASE: InvestigationCase = { id: "c1", name: "Alpha", createdAt: 1, updatedAt: 1, entities: [] };

// ── AddToCase: edges + snapshots ─────────────────────────────────────────────

describe("<AddToCase> with derived edges and a snapshot", () => {
  const entities = [
    { kind: "email" as const, value: "ada@example.com" },
    { kind: "domain" as const, value: "example.com" },
  ];
  const edges = [{
    from: { kind: "email" as const, value: "ada@example.com" },
    to: { kind: "domain" as const, value: "example.com" },
    reason: "Email domain",
  }];

  async function openAndPin(props: Parameters<typeof AddToCase>[0], alsoRelated = false) {
    render(<AddToCase {...props} />);
    fireEvent.click(screen.getByRole("button", { name: /add to case/i }));
    await screen.findByRole("menuitem", { name: /alpha/i });
    if (alsoRelated) fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("menuitem", { name: /alpha/i }));
    await screen.findByRole("button", { name: /pinned/i });
  }

  it("sends only edges whose BOTH ends were actually pinned", async () => {
    const posts = stubApi((_u, o) => (o?.method === "POST" ? jsonRes({ case: CASE }) : jsonRes({ cases: [CASE] })));
    // Related entities are NOT included, so the edge points at an identifier the
    // case does not contain — persisting it would put a phantom node in the graph.
    await openAndPin({ entities, edges });
    expect(posts.filter((p) => p.action === "addEdges")).toHaveLength(0);
  });

  it("sends the edge once the related identifier is pinned too", async () => {
    const posts = stubApi((_u, o) => (o?.method === "POST" ? jsonRes({ case: CASE }) : jsonRes({ cases: [CASE] })));
    await openAndPin({ entities, edges }, true);
    const sent = posts.find((p) => p.action === "addEdges");
    expect(sent).toBeTruthy();
    expect((sent!.edges as unknown[])).toHaveLength(1);
  });

  it("does not post an addEdges call when there are no edges", async () => {
    const posts = stubApi((_u, o) => (o?.method === "POST" ? jsonRes({ case: CASE }) : jsonRes({ cases: [CASE] })));
    await openAndPin({ entities: [entities[0]], edges: [] });
    expect(posts.some((p) => p.action === "addEdges")).toBe(false);
  });

  it("posts the snapshot and shows the baseline message", async () => {
    const posts = stubApi((_u, o) => {
      if (o?.method !== "POST") return jsonRes({ cases: [CASE] });
      const body = JSON.parse(String(o.body)) as { action: string };
      if (body.action === "snapshot") {
        return jsonRes({ case: CASE, diff: { kind: "email", value: "ada@example.com", previousAt: null, currentAt: 2, baseline: true, changes: [], cacheInvolved: false } });
      }
      return jsonRes({ case: CASE });
    });
    await openAndPin({
      entities: [entities[0]],
      snapshot: { kind: "email", value: "ada@example.com", facts: { breaches: 1 } },
    });
    expect(posts.some((p) => p.action === "snapshot")).toBe(true);
    expect(await screen.findByText(/Baseline recorded/)).toBeTruthy();
  });

  it("lists what changed since the previous pin", async () => {
    stubApi((_u, o) => {
      if (o?.method !== "POST") return jsonRes({ cases: [CASE] });
      const body = JSON.parse(String(o.body)) as { action: string };
      if (body.action === "snapshot") {
        return jsonRes({ case: CASE, diff: {
          kind: "email", value: "a@x.com", previousAt: 1_700_000_000_000, currentAt: 2,
          baseline: false, cacheInvolved: true,
          changes: Array.from({ length: 8 }, (_, i) => ({ fact: `f${i}`, from: i, to: i + 1 })),
        } });
      }
      return jsonRes({ case: CASE });
    });
    await openAndPin({ entities: [entities[0]], snapshot: { kind: "email", value: "a@x.com", facts: {} } });
    expect(await screen.findByText(/8 changes since/)).toBeTruthy();
    expect(screen.getAllByText(/^f\d$/)).toHaveLength(6); // list is capped at 6
    expect(screen.getByText(/came from the result cache/)).toBeTruthy();
  });

  it("uses singular wording for one change and renders an em-dash for a missing side", async () => {
    stubApi((_u, o) => {
      if (o?.method !== "POST") return jsonRes({ cases: [CASE] });
      const body = JSON.parse(String(o.body)) as { action: string };
      if (body.action === "snapshot") {
        return jsonRes({ case: CASE, diff: {
          kind: "ip", value: "8.8.8.8", previousAt: 1_700_000_000_000, currentAt: 2,
          baseline: false, cacheInvolved: false,
          changes: [{ fact: "reverse", from: null, to: null }],
        } });
      }
      return jsonRes({ case: CASE });
    });
    await openAndPin({ entities: [entities[0]], snapshot: { kind: "ip", value: "8.8.8.8", facts: {} } });
    expect(await screen.findByText(/1 change since/)).toBeTruthy();
    expect(screen.getAllByText("—")).toHaveLength(2);
    expect(screen.queryByText(/came from the result cache/)).toBeNull();
  });

  it("reports an unchanged result honestly, flagging a cached comparison", async () => {
    stubApi((_u, o) => {
      if (o?.method !== "POST") return jsonRes({ cases: [CASE] });
      const body = JSON.parse(String(o.body)) as { action: string };
      if (body.action === "snapshot") {
        return jsonRes({ case: CASE, diff: {
          kind: "ip", value: "8.8.8.8", previousAt: 1_700_000_000_000, currentAt: 2,
          baseline: false, changes: [], cacheInvolved: true,
        } });
      }
      return jsonRes({ case: CASE });
    });
    await openAndPin({ entities: [entities[0]], snapshot: { kind: "ip", value: "8.8.8.8", facts: {} } });
    expect(await screen.findByText(/Nothing changed since/)).toBeTruthy();
    expect(screen.getByText(/one side was served from cache/)).toBeTruthy();
  });

  it("renders no diff card when the server returned none", async () => {
    stubApi((_u, o) => (o?.method === "POST" ? jsonRes({ case: CASE }) : jsonRes({ cases: [CASE] })));
    await openAndPin({ entities: [entities[0]], snapshot: { kind: "ip", value: "8.8.8.8", facts: {} } });
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("attaches edges and a snapshot when creating a brand-new case", async () => {
    const posts = stubApi((_u, o) => {
      if (o?.method !== "POST") return jsonRes({ cases: [] });
      const body = JSON.parse(String(o.body)) as { action: string };
      if (body.action === "create") return jsonRes({ case: { ...CASE, id: "new", name: "Fresh" } });
      if (body.action === "snapshot") return jsonRes({ case: CASE, diff: { baseline: true, changes: [], previousAt: null, currentAt: 1, kind: "email", value: "a@x.com", cacheInvolved: false } });
      return jsonRes({ case: CASE });
    });
    render(<AddToCase entities={entities} edges={edges} snapshot={{ kind: "email", value: "ada@example.com", facts: {} }} />);
    fireEvent.click(screen.getByRole("button", { name: /add to case/i }));
    fireEvent.click(await screen.findByRole("checkbox"));
    fireEvent.change(screen.getByLabelText(/new case name/i), { target: { value: "Fresh" } });
    fireEvent.click(screen.getByRole("button", { name: /create case and pin/i }));
    await screen.findByRole("button", { name: /pinned/i });
    expect(posts.map((p) => p.action)).toEqual(["create", "addEntity", "addEntity", "addEdges", "snapshot"]);
  });
});

// ── LinkGraph: derived links ─────────────────────────────────────────────────

describe("<LinkGraph> derived links", () => {
  const entities = [
    { kind: "email" as const, value: "ada@example.com" },
    { kind: "domain" as const, value: "example.com" },
    { kind: "ip" as const, value: "8.8.8.8" },
  ];

  it("draws a dashed link between two present nodes, labelled with its reason", () => {
    const { container } = render(<LinkGraph entities={entities} links={[
      { from: entities[0], to: entities[1], reason: "Email domain" },
    ]} />);
    const dashed = container.querySelectorAll('line[stroke-dasharray="5 4"]');
    expect(dashed).toHaveLength(1);
    expect(container.innerHTML).toContain("ada@example.com → example.com · Email domain");
  });

  it("ignores a link naming an identifier that is no longer in the graph", () => {
    const { container } = render(<LinkGraph entities={entities} links={[
      { from: entities[0], to: { kind: "domain", value: "removed.com" }, reason: "gone" },
      { from: { kind: "ip", value: "1.1.1.1" }, to: entities[1], reason: "also gone" },
    ]} />);
    expect(container.querySelectorAll('line[stroke-dasharray="5 4"]')).toHaveLength(0);
  });

  it("drops a self-link and de-dupes identical links", () => {
    const { container } = render(<LinkGraph entities={entities} links={[
      { from: entities[0], to: entities[0], reason: "self" },
      { from: entities[0], to: entities[1], reason: "same" },
      { from: entities[0], to: entities[1], reason: "same" },
    ]} />);
    expect(container.querySelectorAll('line[stroke-dasharray="5 4"]')).toHaveLength(1);
  });

  it("matches endpoints case-insensitively", () => {
    const { container } = render(<LinkGraph entities={entities} links={[
      { from: { kind: "email", value: "ADA@EXAMPLE.COM" }, to: { kind: "domain", value: "EXAMPLE.COM" }, reason: "case" },
    ]} />);
    expect(container.querySelectorAll('line[stroke-dasharray="5 4"]')).toHaveLength(1);
  });

  it("draws none when links is absent or empty", () => {
    const a = render(<LinkGraph entities={entities} />);
    expect(a.container.querySelectorAll('line[stroke-dasharray="5 4"]')).toHaveLength(0);
    cleanup();
    const b = render(<LinkGraph entities={entities} links={[]} />);
    expect(b.container.querySelectorAll('line[stroke-dasharray="5 4"]')).toHaveLength(0);
  });

  it("highlights a derived link when either endpoint is hovered", () => {
    const { container } = render(<LinkGraph entities={entities} links={[
      { from: entities[0], to: entities[1], reason: "Email domain" },
    ]} />);
    const nodeGroups = container.querySelectorAll("g");
    fireEvent.mouseEnter(nodeGroups[0]);
    const dashed = container.querySelector('line[stroke-dasharray="5 4"]')!;
    expect(dashed.getAttribute("stroke-opacity")).toBe("0.95");
    fireEvent.mouseEnter(nodeGroups[2]);
    expect(container.querySelector('line[stroke-dasharray="5 4"]')!.getAttribute("stroke-opacity")).toBe("0.15");
  });
});

// ── CasesPanel: the optional lock ────────────────────────────────────────────

describe("<CasesPanel> when the case store is locked", () => {
  it("shows only the unlock form — no list, no wipe, no export", async () => {
    stubApi(() => jsonRes({ error: "Case store locked", locked: true }, 401));
    render(<CasesPanel />);
    expect(await screen.findByText(/CASE STORE LOCKED/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /wipe all/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /import/i })).toBeNull();
  });

  it("unlocks with the right password and loads the cases", async () => {
    let unlocked = false;
    stubApi((_u, o) => {
      if (o?.method === "POST") { unlocked = true; return jsonRes({ ok: true, locked: false }); }
      return unlocked ? jsonRes({ cases: [CASE] }) : jsonRes({ locked: true }, 401);
    });
    render(<CasesPanel />);
    fireEvent.change(await screen.findByLabelText(/case password/i), { target: { value: "hunter2" } });
    fireEvent.click(screen.getByRole("button", { name: /^unlock$/i }));
    expect(await screen.findByText("Alpha")).toBeTruthy();
  });

  it("unlocks on Enter as well as the button", async () => {
    let unlocked = false;
    stubApi((_u, o) => {
      if (o?.method === "POST") { unlocked = true; return jsonRes({ ok: true }); }
      return unlocked ? jsonRes({ cases: [] }) : jsonRes({ locked: true }, 401);
    });
    render(<CasesPanel />);
    const input = await screen.findByLabelText(/case password/i);
    fireEvent.change(input, { target: { value: "hunter2" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await screen.findByText(/INVESTIGATION CASES/);
  });

  it("reports a wrong password without unlocking", async () => {
    stubApi((_u, o) => (o?.method === "POST" ? jsonRes({ error: "Incorrect password" }, 401) : jsonRes({ locked: true }, 401)));
    render(<CasesPanel />);
    fireEvent.change(await screen.findByLabelText(/case password/i), { target: { value: "wrong" } });
    fireEvent.click(screen.getByRole("button", { name: /^unlock$/i }));
    expect(await screen.findByText("Incorrect password")).toBeTruthy();
    expect(screen.getByText(/CASE STORE LOCKED/)).toBeTruthy();
  });

  it("reports an unreachable server during unlock", async () => {
    let first = true;
    vi.stubGlobal("fetch", vi.fn(async (_u: string, o?: RequestInit) => {
      if (o?.method === "POST") throw new Error("offline");
      if (first) { first = false; return jsonRes({ locked: true }, 401); }
      return jsonRes({ locked: true }, 401);
    }));
    render(<CasesPanel />);
    fireEvent.change(await screen.findByLabelText(/case password/i), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: /^unlock$/i }));
    expect(await screen.findByText(/server unreachable/)).toBeTruthy();
  });

  it("ignores keys other than Enter in the password field", async () => {
    const posts = stubApi(() => jsonRes({ locked: true }, 401));
    render(<CasesPanel />);
    const input = await screen.findByLabelText(/case password/i);
    fireEvent.change(input, { target: { value: "x" } });
    fireEvent.keyDown(input, { key: "a" });
    expect(posts).toHaveLength(0);
  });

  it("keeps the unlock button disabled until something is typed", async () => {
    stubApi(() => jsonRes({ locked: true }, 401));
    render(<CasesPanel />);
    const btn = await screen.findByRole("button", { name: /^unlock$/i });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });
});

// ── CasesPanel: the graph + change history for an unlocked store ─────────────

describe("<CasesPanel> renders the persisted graph and history", () => {
  it("passes stored edges to the graph and shows the change history", async () => {
    const rich: InvestigationCase = {
      ...CASE,
      entities: [
        { kind: "email", value: "ada@example.com", addedAt: 1 },
        { kind: "domain", value: "example.com", addedAt: 2 },
      ],
      edges: [{
        from: { kind: "email", value: "ada@example.com" },
        to: { kind: "domain", value: "example.com" },
        reason: "Email domain", addedAt: 3,
      }],
      snapshots: [
        { kind: "domain", value: "example.com", takenAt: 10, facts: { subdomains: 3 } },
        { kind: "domain", value: "example.com", takenAt: 20, facts: { subdomains: 8 } },
      ],
    };
    stubApi(() => jsonRes({ cases: [rich] }));
    const { container } = await act(async () => render(<CasesPanel />));
    expect(await screen.findByText(/CHANGE HISTORY — 2 snapshots/)).toBeTruthy();
    expect(container.querySelectorAll('line[stroke-dasharray="5 4"]')).toHaveLength(1);
    expect(screen.getByText("8")).toBeTruthy();
  });
});
