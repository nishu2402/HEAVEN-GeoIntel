// ── Can this number belong to anyone? (pure, no network) ─────────────────────
//
// Breach indexes and infostealer corpora are full of numbers nobody owns. People
// type +1 999-999-9999 or the London drama number into signup forms, the form
// accepts it, the database leaks, and the string ends up in LeakCheck and
// Cavalier like any real subscriber line. Querying those indexes with such a
// number returns hits — real hits, for a real leaked record — that belong to no
// one.
//
// Reporting them as "this number is exposed" is a false positive, and a loud
// one: a live sweep on 2026-09-12 scored +1 999-999-9999 at 100/CRITICAL off 5
// infostealer records and 1000 breach rows, and +44 20 7946 0958 (Ofcom's
// reserved drama range) at 73/CRITICAL with a named Vidar infection.
//
// So before attributing anything to a number, decide whether the number can be
// held at all. Two ways it cannot:
//
//   invalid    libphonenumber's own verdict. If the strict "max" metadata says
//              the digits are not a valid number for the country, no carrier can
//              have issued it.
//   fictional  a range a regulator has reserved for film, TV and documentation,
//              and permanently withheld from assignment.
//
// This mirrors ipClassify's non-routable short-circuit: a precise offline answer
// beats firing upstreams that can only produce misleading hits.

import type { PhoneAnalysis } from "./phoneAnalysis";

export type AssignabilityReason = "invalid" | "fictional";

export interface Assignability {
  /** False when no subscriber can hold this number. */
  assignable: boolean;
  /** Why not. null when the number is assignable. */
  reason: AssignabilityReason | null;
  /** One sentence for the UI and the report. */
  detail: string;
  /** The reserved block that matched, for a "fictional" verdict. */
  block: string | null;
}

interface ReservedBlock {
  /** Leading digits of the NATIONAL number (no country code, no trunk zero). */
  prefix: string;
  /** Total national-number length the block occupies. */
  length: number;
  /** How the block is written in the regulator's own documentation. */
  label: string;
}

// Ofcom reserves these for drama and never assigns them, so a hit on one is
// always someone's placeholder. Written as national numbers: the published form
// "020 7946 0958" is national 2079460958, the trunk 0 dropped.
// https://www.ofcom.org.uk/phones-and-broadband/phone-numbers/
const UK_DRAMA: ReservedBlock[] = [
  { prefix: "2079460", length: 10, label: "020 7946 0000-0999 (London)" },
  { prefix: "1134960", length: 10, label: "0113 496 0000-0999 (Leeds)" },
  { prefix: "1144960", length: 10, label: "0114 496 0000-0999 (Sheffield)" },
  { prefix: "1154960", length: 10, label: "0115 496 0000-0999 (Nottingham)" },
  { prefix: "1164960", length: 10, label: "0116 496 0000-0999 (Leicester)" },
  { prefix: "1174960", length: 10, label: "0117 496 0000-0999 (Bristol)" },
  { prefix: "1184960", length: 10, label: "0118 496 0000-0999 (Reading)" },
  { prefix: "1214960", length: 10, label: "0121 496 0000-0999 (Birmingham)" },
  { prefix: "1314960", length: 10, label: "0131 496 0000-0999 (Edinburgh)" },
  { prefix: "1414960", length: 10, label: "0141 496 0000-0999 (Glasgow)" },
  { prefix: "1514960", length: 10, label: "0151 496 0000-0999 (Liverpool)" },
  { prefix: "1614960", length: 10, label: "0161 496 0000-0999 (Manchester)" },
  { prefix: "1914980", length: 10, label: "0191 498 0000-0999 (Tyneside)" },
  { prefix: "2890180", length: 10, label: "028 9018 0000-0999 (Northern Ireland)" },
  { prefix: "2920180", length: 10, label: "029 2018 0000-0999 (Cardiff)" },
  { prefix: "1632960", length: 10, label: "01632 960000-960999 (no area)" },
  { prefix: "7700900", length: 10, label: "07700 900000-900999 (mobile)" },
  { prefix: "8081570", length: 10, label: "08081 570000-570999 (freephone)" },
  { prefix: "9098790", length: 10, label: "09098 790000-790999 (premium rate)" },
  { prefix: "3069990", length: 10, label: "03069 990000-990999 (non-geographic)" },
];

/**
 * NANP fiction: 555-0100 through 555-0199 in ANY area code, withheld from
 * assignment for exactly this purpose. The rest of the 555 exchange is not
 * blanket-reserved (555-1212 is live directory assistance), so only the
 * documented 01XX line range counts.
 */
function nanpFictional(national: string): ReservedBlock | null {
  // Area code, the 555 exchange, then a line number in 0100-0199 — written as
  // one pattern so the length and the digit positions cannot disagree.
  const m = /^(\d{3})555(01\d{2})$/.exec(national);
  if (!m) return null;
  return {
    prefix: `${m[1]}555`,
    length: 10,
    label: `(${m[1]}) 555-0100-0199 (NANP fiction range)`,
  };
}

function ukDrama(national: string): ReservedBlock | null {
  return UK_DRAMA.find((b) => national.length === b.length && national.startsWith(b.prefix)) ?? null;
}

/**
 * Decide whether a parsed number can belong to a subscriber.
 *
 * Callers use this to gate identity attribution: when `assignable` is false, do
 * not query breach or infostealer indexes with the number and do not score it,
 * because any hit describes a leaked form field rather than a person.
 */
export function classifyAssignability(analysis: PhoneAnalysis): Assignability {
  if (!analysis.isValid) {
    return {
      assignable: false,
      reason: "invalid",
      detail:
        "Not a valid number for its country, so no carrier ever issued it. Breach and infostealer indexes were not queried: any hit would be someone's placeholder, not this number's owner.",
      block: null,
    };
  }

  const national = analysis.nationalNumber.replace(/\D/g, "");
  const block =
    analysis.country === "GB" ? ukDrama(national)
    : analysis.countryCallingCode === "+1" ? nanpFictional(national)
    : null;

  if (block) {
    return {
      assignable: false,
      reason: "fictional",
      detail: `Inside ${block.label}, a block the regulator reserves for drama and documentation and never assigns. Breach and infostealer indexes were not queried: any hit would be someone's placeholder, not this number's owner.`,
      block: block.label,
    };
  }

  return { assignable: true, reason: null, detail: "", block: null };
}
