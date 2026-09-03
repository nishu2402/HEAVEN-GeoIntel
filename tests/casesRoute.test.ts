import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { GET, POST, DELETE } from "@/app/api/cases/route";
import { deleteAllCases } from "@/lib/server/caseStore";

// Drives the cases HTTP layer (action dispatch + status codes) against a
// hermetic HV_DATA_DIR. The underlying caseStore is unit-tested separately;
// this covers the route's request parsing, validation, and error mapping.

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "hv-casesroute-"));
  process.env.HV_DATA_DIR = dir;
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.HV_DATA_DIR;
});
beforeEach(async () => { await deleteAllCases(); });

/** A GET request object — the handler reads cookies off it for the case lock. */
const getReq = () => new NextRequest("http://localhost/api/cases");

const req = (body: unknown, method = "POST") =>
  new Request("http://localhost/api/cases", {
    method,
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  }) as unknown as NextRequest;

const del = (qs: string) =>
  DELETE(new NextRequest(`http://localhost/api/cases${qs}`, { method: "DELETE" }));

describe("GET /api/cases", () => {
  it("returns an empty list initially", async () => {
    const res = await GET(getReq());
    expect(res.status).toBe(200);
    expect((await res.json()).cases).toEqual([]);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
});

describe("POST /api/cases: happy-path actions", () => {
  it("creates, renames, sets notes, adds and removes an entity", async () => {
    const created = await (await POST(req({ action: "create", name: "Op Aurora" }))).json();
    expect(created.case.name).toBe("Op Aurora");
    const id = created.case.id as string;

    const renamed = await (await POST(req({ action: "rename", id, name: "Op Borealis" }))).json();
    expect(renamed.case.name).toBe("Op Borealis");

    const noted = await (await POST(req({ action: "notes", id, notes: "primary handle" }))).json();
    expect(noted.case.notes).toBe("primary handle");

    const added = await (await POST(req({ action: "addEntity", id, kind: "phone", value: "+14155552671" }))).json();
    expect(added.case.entities).toHaveLength(1);

    const removed = await (await POST(req({ action: "removeEntity", id, kind: "phone", value: "+14155552671" }))).json();
    expect(removed.case.entities).toHaveLength(0);
  });

  it("imports a previously-exported case as a new case", async () => {
    const res = await POST(req({
      action: "import",
      case: { name: "Reimport", entities: [{ kind: "email", value: "a@b.com" }] },
    }));
    const json = await res.json();
    expect(json.case.name).toBe("Reimport");
    expect(json.case.entities.map((e: { kind: string }) => e.kind)).toEqual(["email"]);
  });
});

describe("POST /api/cases: merge", () => {
  it("merges a source case into the target and deletes the source", async () => {
    const target = await (await POST(req({ action: "create", name: "Target" }))).json();
    await POST(req({ action: "addEntity", id: target.case.id, kind: "phone", value: "+14155552671" }));
    const source = await (await POST(req({ action: "create", name: "Source" }))).json();
    await POST(req({ action: "addEntity", id: source.case.id, kind: "email", value: "a@b.com" }));

    const res = await POST(req({ action: "merge", id: target.case.id, sourceId: source.case.id }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.case.id).toBe(target.case.id);
    expect(json.case.entities.map((e: { kind: string }) => e.kind).sort()).toEqual(["email", "phone"]);

    const list = (await (await GET(getReq())).json()).cases as { id: string }[];
    expect(list.map((c) => c.id)).not.toContain(source.case.id);
  });

  it("400 when merge is missing id or sourceId", async () => {
    expect((await POST(req({ action: "merge", id: "x" }))).status).toBe(400);
    expect((await POST(req({ action: "merge", sourceId: "y" }))).status).toBe(400);
  });

  it("404 when the target or source case doesn't exist", async () => {
    const c = await (await POST(req({ action: "create", name: "solo" }))).json();
    expect((await POST(req({ action: "merge", id: "ghost", sourceId: c.case.id }))).status).toBe(404);
    expect((await POST(req({ action: "merge", id: c.case.id, sourceId: "ghost" }))).status).toBe(404);
  });
});

describe("POST /api/cases: validation + error mapping", () => {
  it("400 on invalid JSON", async () => {
    const res = await POST(req("{ broken"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Invalid JSON body");
  });

  it("400 on an unknown action", async () => {
    const res = await POST(req({ action: "explode" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Unknown action");
  });

  it("400 when rename is missing an id", async () => {
    expect((await POST(req({ action: "rename", name: "x" }))).status).toBe(400);
  });

  it("404 when renaming a case that doesn't exist", async () => {
    const res = await POST(req({ action: "rename", id: "ghost", name: "x" }));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("Not found");
  });

  it("400 on addEntity with a bad kind", async () => {
    const created = await (await POST(req({ action: "create", name: "c" }))).json();
    const res = await POST(req({ action: "addEntity", id: created.case.id, kind: "bogus", value: "x" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Bad kind");
  });

  it("400 on addEntity missing fields", async () => {
    expect((await POST(req({ action: "addEntity", id: "x" }))).status).toBe(400);
  });

  it("400 on import with no case payload", async () => {
    expect((await POST(req({ action: "import" }))).status).toBe(400);
  });
});

describe("DELETE /api/cases", () => {
  it("deletes a single case by id, 404s when it's already gone", async () => {
    const created = await (await POST(req({ action: "create", name: "temp" }))).json();
    const id = created.case.id as string;
    expect((await del(`?id=${id}`)).status).toBe(200);
    expect((await del(`?id=${id}`)).status).toBe(404);
  });

  it("400 when neither id nor all is given", async () => {
    const res = await del("");
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Missing id or all=1");
  });

  it("wipes everything (cases + audit) on ?all=1", async () => {
    await POST(req({ action: "create", name: "a" }));
    await POST(req({ action: "create", name: "b" }));
    const res = await del("?all=1");
    expect((await res.json()).wiped).toBe("all");
    expect((await (await GET(getReq())).json()).cases).toEqual([]);
  });
});
