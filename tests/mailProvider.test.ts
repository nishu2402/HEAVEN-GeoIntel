import { describe, it, expect } from "vitest";
import { classifyMailHost, buildMailProviderData, type MxHost } from "@/lib/analysis/mailProvider";

describe("classifyMailHost", () => {
  it("attributes well-known mail-exchanger suffixes to their provider", () => {
    expect(classifyMailHost("aspmx.l.google.com")?.category).toBe("google");
    expect(classifyMailHost("alt1.gmail-smtp-in.l.google.com")?.label).toBe("Google Workspace");
    expect(classifyMailHost("example-com.mail.protection.outlook.com")?.category).toBe("microsoft");
    expect(classifyMailHost("mx.example.pphosted.com")?.category).toBe("proofpoint");
    expect(classifyMailHost("us-smtp-inbound-1.mimecast.com")?.category).toBe("mimecast");
    expect(classifyMailHost("mx.zoho.com")?.category).toBe("zoho");
    expect(classifyMailHost("mx.yandex.net")?.category).toBe("yandex");
    expect(classifyMailHost("mail.protonmail.ch")?.category).toBe("proton");
    expect(classifyMailHost("in1-smtp.messagingengine.com")?.category).toBe("fastmail");
    expect(classifyMailHost("mx01.mail.icloud.com")?.category).toBe("apple");
    expect(classifyMailHost("inbound-smtp.us-east-1.amazonses.com")?.category).toBe("amazon");
    expect(classifyMailHost("route1.mx.cloudflare.net")?.category).toBe("cloudflare");
    expect(classifyMailHost("mx00.gmx.net")?.category).toBe("gmx");
    expect(classifyMailHost("smtp.secureserver.net")?.category).toBe("godaddy");
    expect(classifyMailHost("mx1.emailsrvr.com")?.category).toBe("rackspace");
    expect(classifyMailHost("mx1.qq.com")?.category).toBe("tencent");
    expect(classifyMailHost("mx.163.com")?.category).toBe("netease");
  });

  it("is case- and trailing-dot-insensitive", () => {
    expect(classifyMailHost("ASPMX.L.GOOGLE.COM.")?.category).toBe("google");
  });

  it("returns null for a host with no known signature", () => {
    expect(classifyMailHost("mail.self-hosted-example.test")).toBeNull();
  });
});

describe("buildMailProviderData", () => {
  it("reports no exchangers when the list is empty", () => {
    expect(buildMailProviderData([])).toEqual({
      hasMx: false, mxHosts: [], provider: "No published mail exchangers", category: "none",
    });
  });

  it("skips empty and duplicate hosts and orders by priority", () => {
    const records: MxHost[] = [
      { host: "ALT2.aspmx.l.google.com.", priority: 5 },
      { host: "", priority: 1 },                            // dropped: empty
      { host: "aspmx.l.google.com", priority: 1 },
      { host: "aspmx.l.google.com", priority: 1 },          // dropped: duplicate
    ];
    const out = buildMailProviderData(records);
    expect(out.hasMx).toBe(true);
    expect(out.category).toBe("google");
    expect(out.provider).toBe("Google Workspace");
    // primary (priority 1) first, then priority 5, both normalized (lowercased,
    // trailing dot stripped)
    expect(out.mxHosts).toEqual(["aspmx.l.google.com", "alt2.aspmx.l.google.com"]);
  });

  it("sorts a null priority last and breaks ties by hostname", () => {
    const out = buildMailProviderData([
      { host: "z.self.test", priority: null },
      { host: "b.self.test", priority: 10 },
      { host: "a.self.test", priority: 10 },
    ]);
    // priority 10 pair sorted a,b; the null-priority host falls to the end
    expect(out.mxHosts).toEqual(["a.self.test", "b.self.test", "z.self.test"]);
    expect(out.category).toBe("other");
    expect(out.provider).toBe("Self-managed or unrecognized provider");
  });

  it("classifies from the first recognized host when the primary is unbranded", () => {
    // The primary (lowest priority) host is unrecognized; a lower-preference host
    // carries the signature. The scan continues past the miss and attributes it.
    const out = buildMailProviderData([
      { host: "mail.unknown-relay.test", priority: 1 },
      { host: "backup.mail.protection.outlook.com", priority: 20 },
    ]);
    expect(out.category).toBe("microsoft");
    expect(out.provider).toBe("Microsoft 365");
    expect(out.mxHosts[0]).toBe("mail.unknown-relay.test");
  });
});
