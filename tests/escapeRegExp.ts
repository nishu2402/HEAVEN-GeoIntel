/**
 * Escape a string for literal use inside a RegExp.
 *
 * The backslash is inside the character class, so it is escaped along with the
 * other metacharacters rather than left to combine with whatever the caller
 * adds next — the gap CodeQL's js/incomplete-sanitization query points at when
 * a hand-written `.replace(/\./g, "\\.")` escapes dots but not backslashes.
 */
export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
