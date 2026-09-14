// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import ChangeInboxPanel from "@/components/cases/ChangeInboxPanel";
import type { Inbox, InboxChange } from "@/lib/analysis/changeInbox";

// The inbox is the only place the tool says a monitored fact moved, so the two
// claims it makes have to stay apart: "first seen" is a baseline and never a
// change, and a diff drawn against a cached lookup says so rather than passing
// itself off as fresh.

afterEach(() => { cleanup(); });

const change = (over: Partial<InboxChange> = {}): InboxChange => ({
  caseId: "c1",
  caseName: "Operation Kestrel",
  kind: "domain",
  value: "example.com",
  at: Date.UTC(2026, 8, 14, 9, 30),
  fact: "subdomains",
  from: 3,
  to: 9,
  cacheInvolved: false,
  unread: true,
  ...over,
});

const inbox = (over: Partial<Inbox> = {}): Inbox => ({
  changes: [change()],
  unread: 1,
  baselines: 0,
  ...over,
});

describe("<ChangeInboxPanel> with nothing to report", () => {
  it("asks for a re-run when no identifier has even a first snapshot", () => {
    render(<ChangeInboxPanel inbox={inbox({ changes: [], unread: 0, baselines: 0 })} />);
    expect(screen.getByText(/Re-run a pinned lookup to start comparing/)).toBeTruthy();
  });

  it("counts a lone baseline as waiting, not as a change", () => {
    // One snapshot is not a comparison. Reporting it as a change is the false
    // positive this panel exists to avoid.
    render(<ChangeInboxPanel inbox={inbox({ changes: [], unread: 0, baselines: 1 })} />);
    expect(screen.getByText(/1 identifier has a first snapshot/)).toBeTruthy();
    expect(screen.queryByText(/unread of/)).toBeNull();
  });

  it("agrees with itself about plural baselines", () => {
    render(<ChangeInboxPanel inbox={inbox({ changes: [], unread: 0, baselines: 4 })} />);
    expect(screen.getByText(/4 identifiers have a first snapshot/)).toBeTruthy();
  });
});

describe("<ChangeInboxPanel> with changes", () => {
  it("heads the list with how many are unread out of the total", () => {
    render(<ChangeInboxPanel inbox={inbox({
      changes: [change(), change({ caseId: "c2", unread: false })],
      unread: 1,
    })} />);
    expect(screen.getByText(/CHANGES: 1 unread of 2/)).toBeTruthy();
  });

  it("spells out a fact that moved, and where it moved from", () => {
    render(<ChangeInboxPanel inbox={inbox()} />);
    expect(screen.getByText(/subdomains: 3 → 9/)).toBeTruthy();
    expect(screen.getByText("domain example.com")).toBeTruthy();
    expect(screen.getByText("Operation Kestrel")).toBeTruthy();
  });

  it("says 'not reported' rather than inventing a number on either end", () => {
    // A fact absent from one snapshot is unknown, which is not the same as zero.
    render(<ChangeInboxPanel inbox={inbox({
      changes: [change({ from: null, to: 12 }), change({ caseId: "c2", fact: "mx", from: "a.mx", to: null })],
    })} />);
    expect(screen.getByText(/subdomains: not reported → 12/)).toBeTruthy();
    expect(screen.getByText(/mx: a\.mx → not reported/)).toBeTruthy();
  });

  it("flags a diff that compared against a cached lookup", () => {
    const { container } = render(<ChangeInboxPanel inbox={inbox({
      changes: [change({ cacheInvolved: true }), change({ caseId: "c2", cacheInvolved: false })],
    })} />);
    expect(within(container).getAllByText("cached side")).toHaveLength(1);
  });

  it("marks only the unread rows", () => {
    const { container } = render(<ChangeInboxPanel inbox={inbox({
      changes: [change(), change({ caseId: "c2", unread: false })],
      unread: 1,
    })} />);
    expect(container.querySelectorAll("span.text-\\[var\\(--hv-green\\)\\]")).toHaveLength(1);
  });
});

describe("<ChangeInboxPanel> marking read", () => {
  it("marks every case that has something unread, once each", () => {
    const onMarkRead = vi.fn();
    render(<ChangeInboxPanel onMarkRead={onMarkRead} inbox={inbox({
      changes: [
        change({ caseId: "c1" }),
        change({ caseId: "c1", fact: "mx" }),
        change({ caseId: "c2" }),
        change({ caseId: "c3", unread: false }),
      ],
      unread: 3,
    })} />);
    fireEvent.click(screen.getByRole("button", { name: /Mark all read/i }));
    // c1 twice over is still one case, and a case with nothing unread is left alone.
    expect(onMarkRead.mock.calls.map((c) => c[0])).toEqual(["c1", "c2"]);
  });

  it("offers nothing to mark when everything has been read", () => {
    render(<ChangeInboxPanel onMarkRead={vi.fn()} inbox={inbox({
      changes: [change({ unread: false })],
      unread: 0,
    })} />);
    expect(screen.queryByRole("button", { name: /Mark all read/i })).toBeNull();
  });

  it("renders read-only when no handler was given", () => {
    render(<ChangeInboxPanel inbox={inbox()} />);
    expect(screen.queryByRole("button", { name: /Mark all read/i })).toBeNull();
    expect(screen.getByText(/CHANGES: 1 unread of 1/)).toBeTruthy();
  });
});
