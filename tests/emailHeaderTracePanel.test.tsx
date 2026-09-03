// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import EmailHeaderTracePanel from "@/components/email/EmailHeaderTracePanel";

const SAMPLE = `Received: from mx.corp.example (mx.corp.example [203.0.113.9])
	by mail.recipient.example with ESMTPS; Tue, 02 Sep 2026 10:00:10 +0000
Received: from smtp.sender.example (smtp.sender.example [198.51.100.7])
	by mx.corp.example with ESMTP; Tue, 02 Sep 2026 10:00:00 +0000
Authentication-Results: mx; spf=pass; dkim=fail; dmarc=pass
From: Alice <alice@sender.example>
Subject: Hi`;

beforeEach(cleanup);

function paste(text: string) {
  fireEvent.change(screen.getByPlaceholderText(/Paste the full header block/), { target: { value: text } });
}

describe("EmailHeaderTracePanel", () => {
  it("traces hops, shows auth verdicts and the origin IP with a callback pivot", () => {
    const onIpLookup = vi.fn();
    render(<EmailHeaderTracePanel onIpLookup={onIpLookup} />);
    paste(SAMPLE);
    fireEvent.click(screen.getByText("Trace path"));

    expect(screen.getByText(/SPF: PASS/)).toBeTruthy();
    expect(screen.getByText(/DKIM: FAIL/)).toBeTruthy();
    expect(screen.getByText("198.51.100.7")).toBeTruthy(); // origin IP
    expect(screen.getByText("HOP 0")).toBeTruthy();
    expect(screen.getByText("HOP 1")).toBeTruthy();
    expect(screen.getByText("Alice <alice@sender.example>")).toBeTruthy();

    fireEvent.click(screen.getByText("Look up as IP →"));
    expect(onIpLookup).toHaveBeenCalledWith("198.51.100.7");

    // Clear resets the panel.
    fireEvent.click(screen.getByText("Clear"));
    expect(screen.queryByText("HOP 0")).toBeNull();
  });

  it("falls back to a deep link when no onIpLookup is provided", () => {
    render(<EmailHeaderTracePanel />);
    paste(SAMPLE);
    fireEvent.click(screen.getByText("Trace path"));
    const link = screen.getByText("Look up as IP →").closest("a") as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("?mode=ip&q=198.51.100.7");
  });

  it("shows a helpful message when no Received hops are present", () => {
    render(<EmailHeaderTracePanel />);
    paste("From: only@headers.example");
    fireEvent.click(screen.getByText("Trace path"));
    expect(screen.getByText(/No Received hops found/)).toBeTruthy();
  });

  it("does nothing on an empty paste", () => {
    render(<EmailHeaderTracePanel />);
    fireEvent.click(screen.getByText("Trace path")); // raw is empty
    expect(screen.queryByText(/No Received hops/)).toBeNull();
    expect(screen.queryByText("HOP 0")).toBeNull();
  });

  it("renders undated hops (null delay) without an origin IP or auth results", () => {
    render(<EmailHeaderTracePanel />);
    paste("Received: from a by b with LMTP\nReceived: from c by d with LMTP");
    fireEvent.click(screen.getByText("Trace path"));
    expect(screen.getByText("HOP 0")).toBeTruthy();
    expect(screen.getByText("HOP 1")).toBeTruthy();
    expect(screen.getByText("—")).toBeTruthy(); // hop 1 has no computable delay
    expect(screen.queryByText(/Origin IP/)).toBeNull();
    expect(screen.queryByText(/SPF:/)).toBeNull();
  });
});
