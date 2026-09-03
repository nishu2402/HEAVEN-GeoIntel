import { describe, it, expect } from "vitest";
import { analyzeHeaders } from "@/lib/analysis/emailHeaders";

const SAMPLE = `Return-Path: <alice@sender.example>
Received: from mx.corp.example (mx.corp.example [203.0.113.9])
	by mail.recipient.example (Postfix) with ESMTPS id ABCD
	for <bob@recipient.example>; Tue, 02 Sep 2026 10:00:10 +0000
Received: from smtp.sender.example (smtp.sender.example [198.51.100.7])
	by mx.corp.example with ESMTP id WXYZ; Tue, 02 Sep 2026 10:00:00 +0000
Authentication-Results: mx.corp.example; spf=pass smtp.mailfrom=sender.example;
	dkim=pass header.d=sender.example; dmarc=pass
From: Alice <alice@sender.example>
To: Bob <bob@recipient.example>
Subject: Quarterly numbers
Date: Tue, 02 Sep 2026 09:59:58 +0000
Message-ID: <abc123@sender.example>`;

describe("analyzeHeaders", () => {
  const a = analyzeHeaders(SAMPLE);

  it("orders hops oldest-first and extracts sender IPs", () => {
    expect(a.hops).toHaveLength(2);
    expect(a.hops[0].index).toBe(0);
    expect(a.hops[0].from).toBe("smtp.sender.example"); // origin (earliest)
    expect(a.hops[0].ip).toBe("198.51.100.7");
    expect(a.hops[1].from).toBe("mx.corp.example");
    expect(a.hops[1].ip).toBe("203.0.113.9");
    expect(a.hops[1].protocol).toBe("ESMTPS");
  });

  it("recovers the origin IP for an IP-mode pivot", () => {
    expect(a.originIp).toBe("198.51.100.7");
  });

  it("computes the delay between dated hops", () => {
    expect(a.hops[0].delaySeconds).toBeNull();  // no earlier hop
    expect(a.hops[1].delaySeconds).toBe(10);    // 10:00:00 → 10:00:10
  });

  it("parses the message headers and auth results", () => {
    expect(a.from).toBe("Alice <alice@sender.example>");
    expect(a.to).toBe("Bob <bob@recipient.example>");
    expect(a.subject).toBe("Quarterly numbers");
    expect(a.messageId).toBe("<abc123@sender.example>");
    expect(a.returnPath).toBe("<alice@sender.example>");
    expect(a.spf).toBe("pass");
    expect(a.dkim).toBe("pass");
    expect(a.dmarc).toBe("pass");
  });

  it("returns an empty analysis for a block with no headers", () => {
    const e = analyzeHeaders("this is not a header block");
    expect(e.hops).toEqual([]);
    expect(e.originIp).toBeNull();
    expect(e.from).toBeNull();
    expect(e.spf).toBeNull();
  });

  it("falls back to Received-SPF when Authentication-Results is absent", () => {
    const r = analyzeHeaders("Received-SPF: Pass (sender ok)\nFrom: x@y.z");
    expect(r.spf).toBe("pass");
    expect(r.dkim).toBeNull();
  });

  it("handles a Received line with no timestamp, no IP, and reports null Received-SPF verdict", () => {
    const r = analyzeHeaders("Received: from localhost by localhost with LMTP\nReceived-SPF: \n");
    expect(r.hops[0].timestamp).toBeNull();
    expect(r.hops[0].ip).toBeNull();
    expect(r.hops[0].delaySeconds).toBeNull();
    expect(r.spf).toBeNull(); // blank Received-SPF has no verdict token
  });

  it("rejects an out-of-range IPv4 rather than reporting a false origin", () => {
    const r = analyzeHeaders("Received: from evil (evil [999.1.1.1]); Tue, 02 Sep 2026 10:00:00 +0000");
    expect(r.hops[0].ip).toBeNull();
    expect(r.originIp).toBeNull();
  });

  it("leaves delay null when one hop's timestamp is unparseable", () => {
    const r = analyzeHeaders(
      "Received: from a by b; not-a-date\n" +
      "Received: from c by d; Tue, 02 Sep 2026 10:00:00 +0000",
    );
    // ordered oldest-first: hop0 = the second Received (dated), hop1 = first (bad date)
    expect(r.hops[1].delaySeconds).toBeNull();
  });

  it("handles a middle hop with an empty timestamp on both sides of the delay loop", () => {
    // newest→oldest in text: dated, empty-";", dated → oldest-first hop0 dated,
    // hop1 empty-ts, hop2 dated. Exercises both null-timestamp branches.
    const r = analyzeHeaders(
      "Received: from r3 by x; Tue, 02 Sep 2026 10:00:20 +0000\n" +
      "Received: from r2 by x;\n" +
      "Received: from r1 by x; Tue, 02 Sep 2026 10:00:00 +0000",
    );
    expect(r.hops[1].timestamp).toBeNull(); // trailing ";" → empty → null
    expect(r.hops[1].delaySeconds).toBeNull();
    expect(r.hops[2].delaySeconds).toBeNull();
  });

  it("returns null SPF when Received-SPF has no leading verdict word", () => {
    expect(analyzeHeaders("Received-SPF: -none-").spf).toBeNull();
  });

  it("returns null for an auth key absent from Authentication-Results", () => {
    const r = analyzeHeaders("Authentication-Results: mx.example; spf=pass");
    expect(r.spf).toBe("pass");
    expect(r.dkim).toBeNull(); // present header, but no dkim= token
  });

  it("tolerates a header block that begins with a continuation line", () => {
    const r = analyzeHeaders("  orphaned continuation\nFrom: x@y.z");
    expect(r.from).toBe("x@y.z");
  });
});
