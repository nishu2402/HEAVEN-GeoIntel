// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import SettingsPanel from "@/components/shared/SettingsPanel";
import {
  PROVIDER_KEYS, keyLabel, providerForKey, sourceForKey, sourceKeyLabel, displayKeyLabel,
} from "@/lib/client/keyNames";

// Settings is the one place every API key can be entered. It is driven by the
// server's own allow-list (GET /api/keys), so these fake that endpoint and prove
// the panel writes through it, never renders a stored value, and says what
// happened when a write fails.

type KeySource = "ui" | "env" | null;

const NAMES = ["GEMINI_API_KEY", "OPENAI_API_KEY", "IPQS_API_KEY", "TWILIO_AUTH_TOKEN"];

let keys: Record<string, KeySource> = {};
let getStatus = 200;
let postStatus = 200;
let deleteStatus = 200;
let getThrows = false;
let writeThrows = false;
const posted: { name: string; value: string }[] = [];
const deleted: string[] = [];

const res = (body: unknown, status: number) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;

async function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = String(input);
  const method = init?.method ?? "GET";
  if (method === "GET") {
    if (getThrows) throw new Error("offline");
    return res({ keys, names: NAMES }, getStatus);
  }
  if (writeThrows) throw new Error("offline");
  if (method === "POST") {
    posted.push(JSON.parse(String(init!.body)) as { name: string; value: string });
    return res(postStatus === 200 ? { ok: true } : { error: "bad" }, postStatus);
  }
  deleted.push(new URL(url, "http://x").searchParams.get("name")!);
  return res(deleteStatus === 200 ? { ok: true } : { error: "bad" }, deleteStatus);
}

beforeEach(() => {
  keys = Object.fromEntries(NAMES.map((n) => [n, null]));
  getStatus = postStatus = deleteStatus = 200;
  getThrows = writeThrows = false;
  posted.length = 0;
  deleted.length = 0;
  vi.stubGlobal("fetch", vi.fn(fakeFetch));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const open = async () => {
  render(<SettingsPanel />);
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: /^settings$/i })); });
  await act(async () => {});
};

const field = (name: string) => screen.getByLabelText(name) as HTMLInputElement;
const saveFor = (name: string) =>
  field(name).closest("div.rounded-md")!.querySelector("button")! as HTMLButtonElement;
/** The row's own status chip, which is not the only place ".env" is mentioned. */
const chipFor = (name: string) =>
  field(name).closest("div.rounded-md")!.querySelector("span.uppercase")!.textContent;

describe("<SettingsPanel>", () => {
  it("lists every key the server accepts, split by what it is for", async () => {
    await open();
    // The AI rows carry the provider's own name and a link to its console; the
    // rest are OSINT source keys.
    expect(screen.getByText("Google Gemini")).toBeTruthy();
    expect(screen.getByText("OpenAI")).toBeTruthy();
    // An OSINT row carries the provider's real name from the source manifest,
    // not the env var title-cased into "Ipqs" or "Hibp"; Twilio needs two
    // credentials, so its rows say which one they are.
    expect(screen.getByText("IPQualityScore")).toBeTruthy();
    expect(screen.getByText("Twilio Lookup: Auth Token")).toBeTruthy();
    expect(screen.getByText(/AI analyst/i)).toBeTruthy();
    expect(screen.getByText(/OSINT sources/i)).toBeTruthy();
    expect(screen.getAllByText("not set")).toHaveLength(NAMES.length);
    expect(screen.getByText(/0 saved on this machine/i)).toBeTruthy();
  });

  it("points at a signup page for an OSINT key, not just the AI ones", async () => {
    // The pane exists to collect keys, so a row that cannot say where its key
    // comes from sends the operator back out to search for it.
    await open();
    const row = screen.getByText("IPQualityScore").closest("div.rounded-md")!;
    const link = row.querySelector("a")!;
    expect(link.textContent).toMatch(/create a key/i);
    expect(link.getAttribute("href")).toBe("https://www.ipqualityscore.com");
  });

  it("offers only the providers the server allows, not every provider it knows of", async () => {
    // The allow-list is the server's; a provider missing from it has no row, so
    // the panel can never offer a key the store would refuse.
    await open();
    expect(screen.queryByText("Groq")).toBeNull();
    expect(PROVIDER_KEYS.some((p) => p.label === "Groq")).toBe(true);
  });

  it("marks where each key already lives, and offers to remove only its own", async () => {
    keys = { ...keys, GEMINI_API_KEY: "ui", OPENAI_API_KEY: "env" };
    await open();
    expect(chipFor("GEMINI_API_KEY")).toBe("saved here");
    expect(chipFor("OPENAI_API_KEY")).toBe("from .env");
    expect(screen.getByText(/1 saved on this machine/i)).toBeTruthy();
    // A key set in the environment is changed where it was set, so there is
    // nothing here to remove.
    expect(screen.getByRole("button", { name: /Remove Google Gemini key/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Remove OpenAI key/i })).toBeNull();
    // Even a saved key leaves the field blank: the store never reads a value back.
    expect(field("GEMINI_API_KEY").value).toBe("");
    expect(field("GEMINI_API_KEY").placeholder).toMatch(/replace the saved key/i);
  });

  it("keeps Save disabled until something is actually typed", async () => {
    await open();
    expect(saveFor("GEMINI_API_KEY").disabled).toBe(true);
    fireEvent.change(field("GEMINI_API_KEY"), { target: { value: "   " } });
    expect(saveFor("GEMINI_API_KEY").disabled).toBe(true);
    fireEvent.change(field("GEMINI_API_KEY"), { target: { value: "AQ.key" } });
    expect(saveFor("GEMINI_API_KEY").disabled).toBe(false);
  });

  it("saves a typed key, clears the field and says so", async () => {
    await open();
    fireEvent.change(field("GEMINI_API_KEY"), { target: { value: " AQ.key " } });
    keys = { ...keys, GEMINI_API_KEY: "ui" };
    await act(async () => { fireEvent.click(saveFor("GEMINI_API_KEY")); });
    // Trimmed, sent under the allow-listed name, and confirmed in words.
    expect(posted).toEqual([{ name: "GEMINI_API_KEY", value: "AQ.key" }]);
    expect(field("GEMINI_API_KEY").value).toBe("");
    expect(screen.getByRole("status").textContent).toMatch(/Gemini key saved on this machine/i);
    expect(chipFor("GEMINI_API_KEY")).toBe("saved here");
  });

  it("keeps what was pasted when the server rejects it", async () => {
    postStatus = 400;
    await open();
    fireEvent.change(field("GEMINI_API_KEY"), { target: { value: "AQ.bad" } });
    await act(async () => { fireEvent.click(saveFor("GEMINI_API_KEY")); });
    expect(screen.getByRole("alert").textContent).toMatch(/rejected the Google Gemini key/i);
    // Clearing it on a rejection looks exactly like success and loses the paste.
    expect(field("GEMINI_API_KEY").value).toBe("AQ.bad");
  });

  it("removes a saved key and says so", async () => {
    keys = { ...keys, GEMINI_API_KEY: "ui" };
    await open();
    keys = { ...keys, GEMINI_API_KEY: null };
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Remove Google Gemini key/i })); });
    expect(deleted).toEqual(["GEMINI_API_KEY"]);
    expect(screen.getByRole("status").textContent).toMatch(/Gemini key removed from this machine/i);
    expect(chipFor("GEMINI_API_KEY")).toBe("not set");
  });

  it("reports a refused removal instead of implying it worked", async () => {
    deleteStatus = 500;
    keys = { ...keys, GEMINI_API_KEY: "ui" };
    await open();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Remove Google Gemini key/i })); });
    expect(screen.getByRole("alert").textContent).toMatch(/could not remove the Google Gemini key/i);
    expect(chipFor("GEMINI_API_KEY")).toBe("saved here");
  });

  it("reports a server it cannot reach, on the read and on both writes", async () => {
    getThrows = true;
    await open();
    expect(screen.getByText(/Could not load the key list/i)).toBeTruthy();

    getThrows = false;
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /retry/i })); });
    expect(screen.getByText("Google Gemini")).toBeTruthy();

    writeThrows = true;
    fireEvent.change(field("GEMINI_API_KEY"), { target: { value: "AQ.key" } });
    await act(async () => { fireEvent.click(saveFor("GEMINI_API_KEY")); });
    expect(screen.getByRole("alert").textContent).toMatch(/Could not reach the server to save/i);
  });

  it("reports a server it cannot reach on a removal too", async () => {
    keys = { ...keys, GEMINI_API_KEY: "ui" };
    await open();
    writeThrows = true;
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Remove Google Gemini key/i })); });
    expect(screen.getByRole("alert").textContent).toMatch(/Could not reach the server to remove/i);
    expect(chipFor("GEMINI_API_KEY")).toBe("saved here");
  });

  it("shows a non-200 key list as a failure rather than an empty pane", async () => {
    getStatus = 500;
    await open();
    expect(screen.getByText(/Could not load the key list/i)).toBeTruthy();
  });

  it("hides what is typed until asked, and closes on the X and the backdrop", async () => {
    await open();
    expect(field("GEMINI_API_KEY").type).toBe("password");
    fireEvent.click(screen.getByRole("button", { name: /show what I type/i }));
    expect(field("GEMINI_API_KEY").type).toBe("text");
    fireEvent.click(screen.getByRole("button", { name: /hide what I type/i }));
    expect(field("GEMINI_API_KEY").type).toBe("password");

    fireEvent.click(screen.getByRole("button", { name: /close settings/i }));
    expect(screen.queryByText("Google Gemini")).toBeNull();

    // Reopening reuses the map it already has; clicking inside keeps it open and
    // the backdrop closes it.
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /^settings$/i })); });
    fireEvent.click(screen.getByText("Google Gemini"));
    expect(screen.getByText("Google Gemini")).toBeTruthy();
    fireEvent.click(document.querySelector(".bg-black\\/75")!.parentElement!);
    expect(screen.queryByText("Google Gemini")).toBeNull();
  });

  it("asks the server once, not on every open", async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: /close settings/i }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /^settings$/i })); });
    const reads = (fetch as ReturnType<typeof vi.fn>).mock.calls.filter((c) => (c[1] as RequestInit | undefined)?.method === undefined);
    expect(reads).toHaveLength(1);
  });
});

describe("key names", () => {
  it("reads an env-var name the way a person would say it", () => {
    expect(keyLabel("GEMINI_API_KEY")).toBe("Gemini");
    expect(keyLabel("TWILIO_ACCOUNT_SID")).toBe("Account Sid");
    // Title-casing runs over the whole string, so the acronym is restored last.
    expect(keyLabel("RAPIDAPI_KEY")).toBe("RapidAPI Key");
  });

  it("tells an AI provider's key from an OSINT source's", () => {
    expect(providerForKey("GEMINI_API_KEY")).toBe("gemini");
    expect(providerForKey("IPQS_API_KEY")).toBeNull();
  });

  it("names an OSINT key after its provider, qualifying one that needs two", () => {
    expect(sourceKeyLabel("HIBP_API_KEY")).toBe("Have I Been Pwned");
    expect(sourceKeyLabel("EMAILREP_API_KEY")).toBe("EmailRep.io");
    expect(sourceKeyLabel("TWILIO_ACCOUNT_SID")).toBe("Twilio Lookup: Account Sid");
    // A key the manifest does not describe still reads as something, which is
    // what a newly allow-listed source looks like before its entry lands.
    expect(sourceKeyLabel("SOMETHING_API_KEY")).toBe("Something");
    expect(sourceForKey("SOMETHING_API_KEY")).toBeNull();
  });

  it("shows a key under one name whether it is listed or written about", () => {
    // The row and the sentence confirming a save have to agree.
    expect(displayKeyLabel("GEMINI_API_KEY")).toBe("Google Gemini");
    expect(displayKeyLabel("HIBP_API_KEY")).toBe("Have I Been Pwned");
  });

  it("carries the store name, label, console and free-tier flag for every provider", () => {
    const gemini = PROVIDER_KEYS.find((p) => p.provider === "gemini")!;
    expect(gemini).toMatchObject({ name: "GEMINI_API_KEY", label: "Google Gemini", free: true });
    expect(gemini.console).toMatch(/^https:\/\//);
    expect(PROVIDER_KEYS.find((p) => p.provider === "openai")!.free).toBe(false);
  });
});
