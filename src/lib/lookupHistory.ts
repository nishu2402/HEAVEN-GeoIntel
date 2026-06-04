// ── Cross-mode lookup history (client, localStorage) ─────────────────────────
// Records every successful lookup (phone/email/username/ip/domain) so the user
// can re-run a recent one with a click. Newest first, de-duped by kind+value,
// capped. A custom event lets any mounted history view update live.

export type LookupKind = "phone" | "email" | "username" | "ip" | "domain";

export interface LookupItem {
  kind: LookupKind;
  value: string;
  ts: number;
}

const KEY = "hv-lookups-v1";
const MAX = 30;
export const LOOKUPS_EVENT = "hv-lookups-changed";

export function getLookups(): LookupItem[] {
  try {
    const raw = localStorage.getItem(KEY);
    const arr = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(arr) ? (arr as LookupItem[]) : [];
  } catch {
    return [];
  }
}

export function pushLookup(kind: LookupKind, value: string): void {
  try {
    const v = value.trim();
    if (!v) return;
    const next = getLookups().filter((i) => !(i.kind === kind && i.value.toLowerCase() === v.toLowerCase()));
    next.unshift({ kind, value: v, ts: Date.now() });
    localStorage.setItem(KEY, JSON.stringify(next.slice(0, MAX)));
    window.dispatchEvent(new CustomEvent(LOOKUPS_EVENT));
  } catch {
    /* private mode / quota — history is best-effort */
  }
}

export function clearLookups(): void {
  try {
    localStorage.removeItem(KEY);
    window.dispatchEvent(new CustomEvent(LOOKUPS_EVENT));
  } catch {
    /* ignore */
  }
}
