import { describe, it, expect } from "vitest";
import {
  parseBody,
  phoneBody,
  emailBody,
  usernameBody,
  ipBody,
  domainBody,
  bulkBody,
} from "@/lib/server/validation";

// The request-body gate every API route runs first. It must reject malformed,
// oversized, and wrong-shape payloads cheaply and NEVER throw (bad JSON → null,
// which each route turns into a 400).

// Duck-typed Request — parseBody only ever calls `.json()`.
const reqOf = (json: unknown, throws = false) =>
  ({ json: async () => { if (throws) throw new SyntaxError("bad json"); return json; } }) as unknown as Request;

describe("parseBody", () => {
  it("returns typed data for a valid body", async () => {
    const out = await parseBody(reqOf({ number: "+14155552671" }), phoneBody);
    expect(out).toEqual({ number: "+14155552671" });
  });

  it("returns null on invalid JSON (never throws)", async () => {
    expect(await parseBody(reqOf(null, true), phoneBody)).toBeNull();
  });

  it("returns null when the shape/type is wrong", async () => {
    expect(await parseBody(reqOf({ number: 123 }), phoneBody)).toBeNull();
    expect(await parseBody(reqOf({}), phoneBody)).toBeNull();
    expect(await parseBody(reqOf({ wrong: "x" }), phoneBody)).toBeNull();
    expect(await parseBody(reqOf("a string"), phoneBody)).toBeNull();
  });

  it("returns null for empty and oversized strings (length bounds)", async () => {
    expect(await parseBody(reqOf({ number: "" }), phoneBody)).toBeNull();
    expect(await parseBody(reqOf({ number: "9".repeat(33) }), phoneBody)).toBeNull();
    expect(await parseBody(reqOf({ number: "9".repeat(32) }), phoneBody)).not.toBeNull();
  });
});

describe("body schemas — bounds", () => {
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

  it("bulkBody requires 1..25 numbers, each <=40 chars", () => {
    expect(bulkBody.safeParse({ numbers: ["+14155552671"] }).success).toBe(true);
    expect(bulkBody.safeParse({ numbers: [] }).success).toBe(false);
    expect(bulkBody.safeParse({ numbers: Array(26).fill("1") }).success).toBe(false);
    expect(bulkBody.safeParse({ numbers: ["9".repeat(41)] }).success).toBe(false);
  });
});
