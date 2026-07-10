// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, act, within } from "@testing-library/react";
import CasesPanel from "@/components/cases/CasesPanel";
import { buildCaseJson } from "@/lib/analysis/caseReport";
import { mergeCaseInto } from "@/lib/analysis/caseMerge";
import type { InvestigationCase, CaseEntity, EntityKind } from "@/lib/types";

// CasesPanel is the one component that owns server state, so it is tested
// against a faithful in-memory stand-in for /api/cases (same verbs, same
// payloads, same merge semantics as caseStore). That lets us assert the thing
// that actually matters: the panel's view never drifts from the server's truth
// — a rejected DELETE must not make a case disappear from the UI.

// ── fake /api/cases ──────────────────────────────────────────────────────────
let store: InvestigationCase[] = [];
let ids = 0;
const fail = { get: false, post: false, del: false };
let deleteStatus = 200;
let postError: string | null = null;
let postSilent = false;
let getOmitsCases = false;

const res = (body: unknown, ok = true, status = 200) =>
  ({ ok, status, json: async () => body }) as unknown as Response;

const mkCase = (name: string, entities: CaseEntity[] = [], notes = ""): InvestigationCase => {
  const now = 1_700_000_000_000 + ++ids * 1000;
  return { id: `c${ids}`, name, createdAt: now, updatedAt: now, entities, notes };
};
const ent = (kind: EntityKind, value: string, addedAt = 1_700_000_500_000): CaseEntity => ({ kind, value, addedAt });

async function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = String(input);
  const method = init?.method ?? "GET";

  if (method === "GET") {
    if (fail.get) throw new Error("offline");
    if (getOmitsCases) return res({});
    return res({ cases: [...store].sort((a, b) => b.updatedAt - a.updatedAt) });
  }

  if (method === "DELETE") {
    if (fail.del) throw new Error("offline");
    if (deleteStatus !== 200) return res({ error: "Not found" }, false, deleteStatus);
    if (url.includes("all=1")) { store = []; return res({ ok: true }); }
    const id = new URL(url, "http://localhost").searchParams.get("id")!;
    store = store.filter((c) => c.id !== id);
    return res({ ok: true });
  }

  if (fail.post) throw new Error("offline");
  if (postSilent) return res({}); // neither `case` nor `error`
  if (postError) return res({ error: postError });
  const body = JSON.parse(String(init!.body)) as Record<string, string>;
  const target = store.find((c) => c.id === body.id);
  const touch = (c: InvestigationCase) => { c.updatedAt = Date.now(); return res({ case: { ...c } }); };

  switch (body.action) {
    case "create": {
      const c = mkCase(body.name?.trim() || "Untitled");
      store.push(c);
      return res({ case: { ...c } });
    }
    case "addEntity": {
      if (!target) return res({ error: "Not found" }, false, 404);
      if (!target.entities.some((e) => e.kind === body.kind && e.value === body.value)) {
        target.entities = [...target.entities, ent(body.kind as EntityKind, body.value)];
      }
      return touch(target);
    }
    case "removeEntity": {
      if (!target) return res({ error: "Not found" }, false, 404);
      target.entities = target.entities.filter((e) => !(e.kind === body.kind && e.value === body.value));
      return touch(target);
    }
    case "notes": {
      if (!target) return res({ error: "Not found" }, false, 404);
      target.notes = body.notes;
      return touch(target);
    }
    case "import": {
      const payload = body as unknown as { case: { name: string; notes: string; entities: CaseEntity[] } };
      const c = mkCase(payload.case.name || "Imported", payload.case.entities, payload.case.notes);
      store.push(c);
      return res({ case: { ...c } });
    }
    case "merge": {
      const source = store.find((c) => c.id === body.sourceId);
      if (!target || !source) return res({ error: "Not found" }, false, 404);
      const merged = mergeCaseInto(target, source);
      target.entities = merged.entities;
      target.notes = merged.notes;
      store = store.filter((c) => c.id !== source.id);
      return touch(target);
    }
    /* v8 ignore next -- the panel only ever sends the actions above */
    default: return res({ error: "Unknown action" }, false, 400);
  }
}

// ── DOM stubs jsdom lacks / that would navigate ──────────────────────────────
const downloads: { href: string; download: string }[] = [];
let confirmReply = true;
let opened: { html: string } | null = null;
let popupBlocked = false;

const objectUrl = { create: URL.createObjectURL, revoke: URL.revokeObjectURL };

beforeEach(() => {
  store = []; ids = 0; downloads.length = 0;
  fail.get = fail.post = fail.del = false;
  deleteStatus = 200; postError = null; confirmReply = true; opened = null; popupBlocked = false;
  getOmitsCases = false; postSilent = false;

  vi.stubGlobal("fetch", vi.fn(fakeFetch));
  URL.createObjectURL = vi.fn(() => "blob:mock");
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(window, "confirm").mockImplementation(() => confirmReply);
  vi.spyOn(window, "open").mockImplementation(() => {
    if (popupBlocked) return null;
    opened = { html: "" };
    return { document: { write: (h: string) => { opened!.html = h; }, close: () => {} } } as unknown as Window;
  });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    downloads.push({ href: this.href, download: this.download });
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  URL.createObjectURL = objectUrl.create;
  URL.revokeObjectURL = objectUrl.revoke;
});

/** Render and let the mount-time GET /api/cases settle. */
async function mount() {
  const utils = render(<CasesPanel />);
  await act(async () => {});
  return utils;
}
const click = async (el: Element) => { await act(async () => { fireEvent.click(el); }); };
const btn = (name: RegExp | string) => screen.getByRole("button", { name });
const typeIn = (el: Element, value: string) => fireEvent.change(el, { target: { value } });

/** Import chains Blob.text() → crypto.subtle.digest(), which settle on macrotasks. */
const settle = async () => {
  for (let i = 0; i < 3; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
};
const importFile = async (text: string) => {
  const input = document.querySelector('input[type="file"]')!;
  const file = new File([text], "case.json", { type: "application/json" });
  await act(async () => { fireEvent.change(input, { target: { files: [file] } }); });
  await settle();
};

describe("<CasesPanel> loading + list", () => {
  it("shows a spinner, then the empty state when the server has no cases", async () => {
    render(<CasesPanel />);
    expect(screen.getByText(/loading…/i)).toBeTruthy();
    await act(async () => {});
    expect(screen.getByText(/no cases yet/i)).toBeTruthy();
  });

  it("surfaces a load failure instead of claiming there are no cases, and retries", async () => {
    fail.get = true;
    await mount();
    // The bug this guards: an unreachable server used to render "No cases yet",
    // asserting an empty list the panel never actually read.
    expect(screen.queryByText(/no cases yet/i)).toBeNull();
    expect(screen.getByText(/could not load cases/i)).toBeTruthy();

    fail.get = false;
    store = [mkCase("Recovered")];
    await click(btn(/retry/i));
    expect(screen.getByText("Recovered")).toBeTruthy();
    expect(screen.queryByText(/could not load cases/i)).toBeNull();
  });

  it("treats a response with no `cases` field as an empty list", async () => {
    getOmitsCases = true;
    await mount();
    expect(screen.getByText(/no cases yet/i)).toBeTruthy();
    expect(screen.queryByText(/could not load cases/i)).toBeNull();
  });

  it("selects the first case on load and refreshes on demand", async () => {
    store = [mkCase("Alpha")];
    await mount();
    expect(screen.getByText(/alpha — 0 identifiers/i)).toBeTruthy();
    store.push(mkCase("Beta"));
    await click(btn(/refresh/i));
    expect(screen.getByText("Beta")).toBeTruthy();
  });
});

describe("<CasesPanel> create / delete", () => {
  it("creates a case from the button and from Enter, clearing the field", async () => {
    await mount();
    const name = screen.getByPlaceholderText(/new case name/i) as HTMLInputElement;
    typeIn(name, "Acme phishing");
    await click(btn(/create/i));
    expect(screen.getByText(/acme phishing — 0 identifiers/i)).toBeTruthy();
    expect(name.value).toBe("");

    typeIn(name, "Second");
    await act(async () => { fireEvent.keyDown(name, { key: "Enter" }); });
    expect(screen.getByText(/second — 0 identifiers/i)).toBeTruthy();
    // a non-Enter key does not submit
    typeIn(name, "Third");
    await act(async () => { fireEvent.keyDown(name, { key: "a" }); });
    expect(screen.queryByText(/third — 0 identifiers/i)).toBeNull();
  });

  it("deletes the active case (clearing selection) and a non-active one (keeping it)", async () => {
    store = [mkCase("Alpha"), mkCase("Beta")];
    await mount();
    // The list is newest-first, so Beta loads as the active case.
    expect(screen.getByText(/beta — 0 identifiers/i)).toBeTruthy();

    // Delete Alpha (not active): Beta stays selected.
    await click(screen.getByLabelText("Delete Alpha"));
    expect(screen.queryByText("Alpha")).toBeNull();
    expect(screen.getByText(/beta — 0 identifiers/i)).toBeTruthy();

    // Delete Beta (active): the detail pane disappears.
    await click(screen.getByLabelText("Delete Beta"));
    expect(screen.queryByText(/analyst notes/i)).toBeNull();
    expect(screen.getByText(/no cases yet/i)).toBeTruthy();
  });

  it("deletes via the keyboard (Enter on the trash affordance), ignoring other keys", async () => {
    store = [mkCase("Alpha")];
    await mount();
    const trash = screen.getByLabelText("Delete Alpha");
    await act(async () => { fireEvent.keyDown(trash, { key: "x" }); });
    expect(screen.getByText("Alpha")).toBeTruthy();
    await act(async () => { fireEvent.keyDown(trash, { key: "Enter" }); });
    expect(screen.queryByText("Alpha")).toBeNull();
  });

  it("keeps a case visible when the server refuses to delete it", async () => {
    store = [mkCase("Alpha")];
    await mount();
    deleteStatus = 404;
    await click(screen.getByLabelText("Delete Alpha"));
    // The regression: local state used to drop the case regardless of the response,
    // so it silently reappeared on the next refresh.
    expect(screen.getByText("Alpha")).toBeTruthy();
    expect(screen.getByText(/delete failed/i)).toBeTruthy();
    expect(store).toHaveLength(1);
  });

  it("keeps a case visible when the delete request never reaches the server", async () => {
    store = [mkCase("Alpha")];
    await mount();
    fail.del = true;
    await click(screen.getByLabelText("Delete Alpha"));
    expect(screen.getByText("Alpha")).toBeTruthy();
    expect(screen.getByText(/delete failed — server unreachable/i)).toBeTruthy();
  });

  it("reports a POST that fails outright and one the server rejects", async () => {
    await mount();
    typeIn(screen.getByPlaceholderText(/new case name/i), "X");
    fail.post = true;
    await click(btn(/create/i));
    expect(screen.getByText(/request failed — server unreachable/i)).toBeTruthy();
    expect(screen.getByText(/no cases yet/i)).toBeTruthy();

    fail.post = false; postError = "Request failed";
    await click(btn(/create/i));
    expect(screen.getByText("Request failed")).toBeTruthy();

    // a response carrying neither `case` nor `error` is simply a no-op
    postError = null; postSilent = true;
    await click(btn(/create/i));
    expect(screen.getByText(/no cases yet/i)).toBeTruthy();
  });
});

describe("<CasesPanel> entities, notes, graph", () => {
  it("adds entities by button and Enter, switches kind, and removes one", async () => {
    store = [mkCase("Alpha")];
    await mount();
    const value = screen.getByPlaceholderText(/value to add/i) as HTMLInputElement;

    // guard: an empty value is a no-op
    await click(btn(/^add$/i));
    expect(screen.getByText(/no identifiers yet/i)).toBeTruthy();

    typeIn(value, " +14155552671 ");
    await click(btn(/^add$/i));
    expect(screen.getAllByLabelText("Remove")).toHaveLength(1); // one entity chip
    expect(screen.getByText(/alpha — 1 identifier$/i)).toBeTruthy(); // singular
    expect(value.value).toBe("");
    expect(store[0]!.entities[0]).toMatchObject({ kind: "phone", value: "+14155552671" }); // trimmed

    // switch kind, add by Enter → plural
    fireEvent.change(screen.getByLabelText("Identifier type"), { target: { value: "domain" } });
    typeIn(value, "evil.example");
    await act(async () => { fireEvent.keyDown(value, { key: "Enter" }); });
    expect(screen.getByText(/alpha — 2 identifiers/i)).toBeTruthy();
    // a non-Enter key does not submit
    typeIn(value, "ignored.example");
    await act(async () => { fireEvent.keyDown(value, { key: "b" }); });
    expect(store[0]!.entities).toHaveLength(2);

    await click(screen.getAllByLabelText("Remove")[0]!); // removes the phone chip
    expect(screen.getAllByLabelText("Remove")).toHaveLength(1);
    expect(store[0]!.entities.map((e) => e.value)).toEqual(["evil.example"]);
  });

  it("saves notes, shows SAVED, and reverts the label after the timeout", async () => {
    vi.useFakeTimers();
    try {
      store = [mkCase("Alpha")];
      render(<CasesPanel />);
      await act(async () => {});
      typeIn(screen.getByPlaceholderText(/timeline, hypotheses/i), "suspect uses VPN");
      await act(async () => { fireEvent.click(btn(/save notes/i)); });
      expect(btn(/saved/i)).toBeTruthy();
      expect(store[0]!.notes).toBe("suspect uses VPN");
      act(() => { vi.advanceTimersByTime(1600); });
      expect(btn(/save notes/i)).toBeTruthy();
    } finally { vi.useRealTimers(); }
  });

  it("resets the notes draft when the active case changes", async () => {
    store = [mkCase("Alpha", [], "alpha notes"), mkCase("Beta", [], "beta notes")];
    await mount();
    const notes = () => screen.getByPlaceholderText(/timeline, hypotheses/i) as HTMLTextAreaElement;
    expect(notes().value).toBe("beta notes"); // Beta is newest → active
    typeIn(notes(), "unsaved edit");
    await click(screen.getByText("Alpha"));
    expect(notes().value).toBe("alpha notes");
    await click(screen.getByText("Beta"));
    expect(notes().value).toBe("beta notes"); // the unsaved edit is discarded
  });

  it("persists graph edits back into the case (add + remove)", async () => {
    store = [mkCase("Alpha", [ent("ip", "8.8.8.8")])];
    await mount();
    const nodeInput = screen.getByPlaceholderText(/add a node/i);
    typeIn(nodeInput, "1.1.1.1");
    await act(async () => { fireEvent.keyDown(nodeInput, { key: "Enter" }); });
    expect(store[0]!.entities.map((e) => e.value).sort()).toEqual(["1.1.1.1", "8.8.8.8"]);

    await click(btn(/^clear$/i));
    expect(store[0]!.entities).toHaveLength(0);
  });
});

describe("<CasesPanel> cross-case correlation + timeline", () => {
  it("surfaces identifiers shared across cases and jumps to a case from the chip", async () => {
    store = [mkCase("Alpha", [ent("ip", "8.8.8.8")]), mkCase("Beta", [ent("ip", "8.8.8.8"), ent("email", "x@y.z")])];
    await mount();
    const links = screen.getByText(/cross-case links/i).parentElement!;
    expect(within(links).getByText("8.8.8.8")).toBeTruthy();
    expect(within(links).getByText(/in 2 cases:/i)).toBeTruthy();
    expect(within(links).queryByText("x@y.z")).toBeNull(); // only in one case

    await click(within(links).getByRole("button", { name: "Alpha" }));
    expect(screen.getByText(/alpha — 1 identifier$/i)).toBeTruthy();
  });

  it("renders the created marker plus one event per identifier, oldest first", async () => {
    store = [mkCase("Alpha", [ent("ip", "8.8.8.8", 1_700_000_900_000), ent("email", "a@b.c", 1_700_000_800_000)])];
    await mount();
    expect(screen.getByText(/timeline — 3 events/i)).toBeTruthy();
    const rows = screen.getByText(/timeline — 3 events/i).parentElement!.querySelectorAll("div > span:last-child");
    expect(Array.from(rows).map((r) => r.textContent)).toEqual(["Case created", "a@b.c", "8.8.8.8"]);
  });

  it("uses the singular event label for a case with no identifiers", async () => {
    store = [mkCase("Alpha")];
    await mount();
    expect(screen.getByText(/timeline — 1 event$/i)).toBeTruthy();
  });
});

describe("<CasesPanel> merge", () => {
  const twoCases = () => { store = [mkCase("Target", [ent("ip", "8.8.8.8")]), mkCase("Source", [ent("email", "a@b.c")], "src notes")]; };

  it("hides the merge panel until there is more than one case", async () => {
    store = [mkCase("Solo")];
    await mount();
    expect(screen.queryByLabelText(/case to merge in/i)).toBeNull();
  });

  it("folds a case in, deletes the source, and confirms first", async () => {
    twoCases();
    await mount();
    await click(screen.getByText("Target")); // make Target active
    const select = screen.getByLabelText(/case to merge in/i);
    expect(within(select as HTMLElement).queryByText(/^Target/)).toBeNull(); // cannot merge into itself

    // decline the confirm → nothing happens
    confirmReply = false;
    typeIn(select, "c2");
    await click(btn(/merge in/i));
    expect(store).toHaveLength(2);

    confirmReply = true;
    await click(btn(/merge in/i));
    expect(store).toHaveLength(1);
    expect(store[0]!.entities.map((e) => e.value).sort()).toEqual(["8.8.8.8", "a@b.c"]);
    expect(store[0]!.notes).toMatch(/Merged from "Source"/);
    expect(screen.getByText(/merged "source" in/i)).toBeTruthy();
    expect(screen.queryByText("Source")).toBeNull();
  });

  it("keeps the source case when the server rejects the merge", async () => {
    twoCases();
    await mount();
    await click(screen.getByText("Target"));
    typeIn(screen.getByLabelText(/case to merge in/i), "c2");
    postError = "Not found";
    await click(btn(/merge in/i));
    expect(screen.getByText("Not found")).toBeTruthy();
    expect(store).toHaveLength(2); // nothing deleted locally either
  });

  it("is inert when the selected source no longer exists", async () => {
    store = [mkCase("Target"), mkCase("Doomed"), mkCase("Third")];
    await mount();
    await click(screen.getByText("Target"));
    typeIn(screen.getByLabelText(/case to merge in/i), "c2"); // Doomed
    await click(screen.getByLabelText("Delete Doomed"));      // …then delete it
    await click(btn(/merge in/i));
    expect(window.confirm).not.toHaveBeenCalled();
    expect(store).toHaveLength(2);
  });
});

describe("<CasesPanel> exports", () => {
  const withCase = async () => { store = [mkCase("Acme phishing", [ent("ip", "8.8.8.8")], "notes")]; await mount(); };

  it("exports JSON, Markdown, CSV, STIX and Maltego with slugged filenames", async () => {
    await withCase();
    // JSON + Markdown exports are async (they hash the payload); the rest are
    // sync, so assert on the set of filenames, not the click order.
    for (const label of [/^json$/i, /^report$/i, /^csv$/i, /^stix$/i, /^maltego$/i]) await click(btn(label));
    await settle(); // let the async JSON + Markdown exports finish hashing
    expect(downloads.map((d) => d.download.replace(/-\d+\./, ".")).sort()).toEqual([
      "case-acme-phishing.csv", "case-acme-phishing.json", "case-acme-phishing.maltego.csv",
      "case-acme-phishing.md", "case-acme-phishing.stix.json",
    ]);
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(5);
    expect(screen.getByText(/maltego csv exported/i)).toBeTruthy();
  });

  it("falls back to the `case` slug when the name has no slug-able characters", async () => {
    store = [mkCase("!!! ???")];
    await mount();
    await click(btn(/^csv$/i));
    expect(downloads[0]!.download).toMatch(/^case-case-\d+\.csv$/);
  });

  it("opens a printable report, and reports a blocked pop-up", async () => {
    await withCase();
    await click(btn(/print\/pdf/i));
    await settle(); // buildPrintableHtml hashes the payload before window.open
    expect(opened!.html).toContain("HEAVEN-GeoIntel — Acme phishing");
    expect(screen.getByText(/opening printable report/i)).toBeTruthy();

    popupBlocked = true;
    await click(btn(/print\/pdf/i));
    await settle();
    expect(screen.getByText(/pop-up blocked/i)).toBeTruthy();
  });

  it("clears the flash message after its timeout", async () => {
    vi.useFakeTimers();
    try {
      store = [mkCase("Alpha")];
      render(<CasesPanel />);
      await act(async () => {});
      await act(async () => { fireEvent.click(btn(/^csv$/i)); });
      expect(screen.getByText(/csv exported/i)).toBeTruthy();
      act(() => { vi.advanceTimersByTime(2500); });
      expect(screen.queryByText(/csv exported/i)).toBeNull();
    } finally { vi.useRealTimers(); }
  });
});

describe("<CasesPanel> import", () => {
  const exported = async (over: Record<string, unknown> = {}) => {
    const { json } = await buildCaseJson(mkCase("Imported case", [ent("ip", "8.8.8.8")], "n"));
    return JSON.stringify({ ...JSON.parse(json), ...over });
  };

  it("opens the hidden file picker from the IMPORT button", async () => {
    await mount();
    const picker = vi.spyOn(document.querySelector('input[type="file"]') as HTMLInputElement, "click").mockImplementation(() => {});
    await click(btn(/^import$/i));
    expect(picker).toHaveBeenCalled();
  });

  it("does nothing when the picker is dismissed with no file", async () => {
    await mount();
    await act(async () => { fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [] } }); });
    expect(screen.getByText(/no cases yet/i)).toBeTruthy();
  });

  it("reports a file that is not a case report", async () => {
    await mount();
    await importFile("{}");
    expect(screen.getByText(/not a heaven-geointel case report/i)).toBeTruthy();
    expect(store).toHaveLength(0);
  });

  it("reports a file that is not even JSON", async () => {
    await mount();
    await importFile("<<<nope>>>");
    expect(screen.getByText(/not valid json/i)).toBeTruthy();
  });

  it("imports a hash-matched report and calls it verified — without prompting", async () => {
    await mount();
    await importFile(await exported());
    expect(window.confirm).not.toHaveBeenCalled();
    expect(screen.getByText(/imported — integrity verified/i)).toBeTruthy();
    expect(store[0]!.entities).toHaveLength(1);
  });

  it("never calls a hash-less report verified; it prompts and labels it UNVERIFIED", async () => {
    await mount();
    const env = JSON.parse(await exported());
    delete env.integrity;
    const text = JSON.stringify(env);

    confirmReply = false; // decline → no import at all
    await importFile(text);
    expect(window.confirm).toHaveBeenCalledWith(expect.stringMatching(/no integrity hash/i));
    expect(store).toHaveLength(0);

    confirmReply = true;
    await importFile(text);
    // The regression: this used to announce "Imported — integrity verified" for a
    // report that carried no hash to verify against.
    expect(screen.getByText(/imported — unverified \(no integrity hash\)/i)).toBeTruthy();
    expect(store).toHaveLength(1);
  });

  it("warns on a hash mismatch, then labels the import as tampered", async () => {
    await mount();
    const env = JSON.parse(await exported());
    env.case.entities[0].value = "1.1.1.1"; // mutate after signing
    const text = JSON.stringify(env);

    confirmReply = false;
    await importFile(text);
    expect(window.confirm).toHaveBeenCalledWith(expect.stringMatching(/does NOT match/i));
    expect(store).toHaveLength(0);

    confirmReply = true;
    await importFile(text);
    expect(screen.getByText(/imported — hash mismatch/i)).toBeTruthy();
  });

  it("survives a report whose entities are malformed rather than failing silently", async () => {
    await mount();
    const env = JSON.parse(await exported());
    env.case.entities = [null, { kind: "bogus" }, { kind: "ip", value: "8.8.8.8" }];
    confirmReply = true; // repaired payload no longer matches the hash → prompts
    await importFile(JSON.stringify(env));
    expect(screen.getByText(/imported — hash mismatch/i)).toBeTruthy();
    expect(store[0]!.entities).toHaveLength(1);
  });

  it("does not select a case when the import request fails", async () => {
    await mount();
    const text = await exported();
    postError = "Request failed";
    await importFile(text);
    expect(screen.getByText("Request failed")).toBeTruthy();
    expect(screen.queryByText(/analyst notes/i)).toBeNull();
  });
});

describe("<CasesPanel> wipe all", () => {
  it("requires confirmation, then clears everything", async () => {
    store = [mkCase("Alpha")];
    await mount();
    confirmReply = false;
    await click(btn(/wipe all/i));
    expect(screen.getByText("Alpha")).toBeTruthy();

    confirmReply = true;
    await click(btn(/wipe all/i));
    expect(screen.getByText(/all local data wiped/i)).toBeTruthy();
    expect(screen.getByText(/no cases yet/i)).toBeTruthy();
  });

  it("keeps the cases on screen when the wipe fails", async () => {
    store = [mkCase("Alpha")];
    await mount();
    deleteStatus = 500;
    await click(btn(/wipe all/i));
    expect(screen.getByText("Alpha")).toBeTruthy();
    expect(screen.getByText(/wipe failed/i)).toBeTruthy();

    deleteStatus = 200; fail.del = true;
    await click(btn(/wipe all/i));
    expect(screen.getByText("Alpha")).toBeTruthy();
    expect(screen.getByText(/wipe failed — server unreachable/i)).toBeTruthy();
  });
});
