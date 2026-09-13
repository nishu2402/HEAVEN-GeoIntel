import { describe, it, expect } from "vitest";
import {
  parseBody,
  phoneBody,
  emailBody,
  usernameBody,
  ipBody,
  domainBody,
  bulkBody,
  sweepBody,
  typosquatBody,
  evidenceBody,
} from "@/lib/server/validation";

// The request-body gate every API route runs first. It must reject malformed,
// oversized, and wrong-shape payloads cheaply and NEVER throw. A rejection also
// has to SAY what was wrong: `{"error":"Invalid request body"}` and nothing else
// is what made a misspelled field indistinguishable from a rejected value.

// Duck-typed Request — parseBody only ever calls `.json()`.
const reqOf = (json: unknown, throws = false) =>
  ({ json: async () => { if (throws) throw new SyntaxError("bad json"); return json; } }) as unknown as Request;

describe("parseBody", () => {
  it("returns typed data for a valid body", async () => {
    const out = await parseBody(reqOf({ number: "+14155552671" }), phoneBody);
    expect(out).toEqual({ ok: true, data: { number: "+14155552671" } });
  });

  it("reports unparseable JSON rather than throwing", async () => {
    const out = await parseBody(reqOf(null, true), phoneBody);
    expect(out.ok).toBe(false);
    expect(out.ok === false && out.problem.error).toBe("Request body must be valid JSON");
  });

  it("names the missing field, which is the whole point of the change", async () => {
    // Posting `{"phone": …}` to the phone endpoint — whose field is `number` —
    // used to return a bare "Invalid request body".
    const out = await parseBody(reqOf({ phone: "+12024561111" }), phoneBody);
    expect(out.ok).toBe(false);
    expect(out.ok === false && out.problem).toEqual({
      error: "Invalid request body: `number` is required",
      field: "number",
    });
  });

  it("distinguishes a wrong type from a missing field", async () => {
    const out = await parseBody(reqOf({ number: 123 }), phoneBody);
    expect(out.ok === false && out.problem).toEqual({
      error: "Invalid request body: `number` must be a string",
      field: "number",
    });
  });

  it("describes a body that is not an object at all", async () => {
    const out = await parseBody(reqOf("a string"), phoneBody);
    expect(out.ok === false && out.problem).toEqual({
      error: "Invalid request body: the body must be a object",
    });
  });

  it("reports length bounds in both directions", async () => {
    const short = await parseBody(reqOf({ number: "" }), phoneBody);
    expect(short.ok === false && short.problem.error).toBe(
      "Invalid request body: `number` must be at least 1 characters",
    );
    const long = await parseBody(reqOf({ number: "9".repeat(33) }), phoneBody);
    expect(long.ok === false && long.problem.error).toBe(
      "Invalid request body: `number` must be at most 32 characters",
    );
    expect((await parseBody(reqOf({ number: "9".repeat(32) }), phoneBody)).ok).toBe(true);
  });

  it("reports array bounds in the array's own words", async () => {
    const empty = await parseBody(reqOf({ items: [] }), bulkBody);
    expect(empty.ok === false && empty.problem.error).toBe(
      "Invalid request body: `items` needs at least 1 entry",
    );
    const big = await parseBody(reqOf({ items: Array(1001).fill("x") }), bulkBody);
    expect(big.ok === false && big.problem.error).toBe(
      "Invalid request body: `items` accepts at most 1000 entries",
    );
  });

  it("lists the allowed values for an enum", async () => {
    const out = await parseBody(reqOf({ action: "nope", caseId: "abc" }), evidenceBody);
    expect(out.ok === false && out.problem.error).toBe(
      "Invalid request body: `action` must be one of: capture, verify",
    );
  });
});

describe("body schemas: bounds", () => {
  it("emailBody enforces 3..254", () => {
    expect(emailBody.safeParse({ email: "a@b" }).success).toBe(true);
    expect(emailBody.safeParse({ email: "ab" }).success).toBe(false);
    expect(emailBody.safeParse({ email: "a@" + "x".repeat(253) }).success).toBe(false);
  });

  it("usernameBody enforces 1..64", () => {
    expect(usernameBody.safeParse({ username: "torvalds" }).success).toBe(true);
    expect(usernameBody.safeParse({ username: "" }).success).toBe(false);
    expect(usernameBody.safeParse({ username: "x".repeat(65) }).success).toBe(false);
  });

  it("ipBody / domainBody enforce upper bounds", () => {
    expect(ipBody.safeParse({ ip: "8.8.8.8" }).success).toBe(true);
    expect(ipBody.safeParse({ ip: "x".repeat(65) }).success).toBe(false);
    expect(domainBody.safeParse({ domain: "example.com" }).success).toBe(true);
    expect(domainBody.safeParse({ domain: "x".repeat(254) }).success).toBe(false);
  });

  it("bulkBody takes `items` for any mode and still takes the old `numbers`", () => {
    expect(bulkBody.safeParse({ items: ["example.com"], mode: "auto" }).success).toBe(true);
    expect(bulkBody.safeParse({ numbers: ["+14155552671"] }).success).toBe(true);
    expect(bulkBody.safeParse({ items: [] }).success).toBe(false);
    expect(bulkBody.safeParse({ items: Array(1001).fill("1") }).success).toBe(false);
    expect(bulkBody.safeParse({ numbers: ["9".repeat(41)] }).success).toBe(false);
    expect(bulkBody.safeParse({ items: ["x"], mode: "telepathy" }).success).toBe(false);
  });

  it("sweepBody bounds the page window", () => {
    expect(sweepBody.safeParse({ username: "torvalds" }).success).toBe(true);
    expect(sweepBody.safeParse({ username: "torvalds", offset: 60, limit: 80 }).success).toBe(true);
    expect(sweepBody.safeParse({ username: "torvalds", limit: 81 }).success).toBe(false);
    expect(sweepBody.safeParse({ username: "torvalds", offset: -1 }).success).toBe(false);
  });

  it("typosquatBody bounds how many candidates may be resolved", () => {
    expect(typosquatBody.safeParse({ domain: "example.com" }).success).toBe(true);
    expect(typosquatBody.safeParse({ domain: "example.com", limit: 300 }).success).toBe(true);
    expect(typosquatBody.safeParse({ domain: "example.com", limit: 301 }).success).toBe(false);
  });

  it("evidenceBody requires a path-safe case id", () => {
    expect(evidenceBody.safeParse({ action: "verify", caseId: "abc-123" }).success).toBe(true);
    expect(evidenceBody.safeParse({ action: "verify", caseId: "../etc" }).success).toBe(false);
  });
});
