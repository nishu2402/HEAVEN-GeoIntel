// ── XMP packets, wherever they are embedded ─────────────────────────────────
//
// Adobe's XMP is the one metadata format that travels across file types: the
// same RDF packet appears in a PDF, a JPEG's APP1 segment, a TIFF tag and a
// WebP chunk. It is worth reading wherever it appears, because it carries two
// things the older metadata blocks do not: the tool that produced the file, and
// a pair of identifiers (xmpMM:DocumentID, xmpMM:InstanceID) that make two
// files provably revisions of one original.
//
// Producers disagree about how to serialise a property: some write it as an
// attribute on rdf:Description, others as a child element, often wrapped in an
// rdf:Alt/rdf:li pair for a localisable string. Both forms are read here so a
// property is not missed because of who wrote the file.

import type { MetaField } from "./types";

// A real XMP packet is a few kilobytes. The window is far larger so it never
// truncates one, while still bounding the scan of a packet with no trailer.
const MAX_XMP_PACKET = 1 << 20;

export function decodeXmlEntities(v: string): string {
  return v
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, "&");
}

/** The XMP packet's text within `s`, or null when there is none. */
export function xmpPacket(s: string): string | null {
  const full = /<x:xmpmeta[\s\S]*?<\/x:xmpmeta>/.exec(s);
  if (full) return full[0];
  // A packet whose closing trailer was cut off still holds readable properties,
  // so the fallback reads a bounded window from wherever the packet opens.
  const open = s.search(/<\?xpacket begin|<x:xmpmeta/);
  if (open < 0) return null;
  return s.slice(open, open + MAX_XMP_PACKET);
}

/** Read one XMP property, in either the attribute or the element form. */
export function xmpValue(xmp: string, tag: string): string | null {
  const attr = new RegExp(`\\b${tag}="([^"]*)"`).exec(xmp);
  if (attr && attr[1].trim()) return decodeXmlEntities(attr[1].trim());
  const el = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`).exec(xmp);
  if (!el) return null;
  const text = decodeXmlEntities(el[1].replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim());
  return text.length ? text : null;
}

export interface XmpSpec { tag: string; label: string; group: string; sensitive?: boolean }

/** Map a packet to fields, in the order the specs declare. */
export function xmpFields(xmp: string, specs: readonly XmpSpec[]): MetaField[] {
  const out: MetaField[] = [];
  for (const spec of specs) {
    const v = xmpValue(xmp, spec.tag);
    if (v !== null) out.push({ label: spec.label, value: v, group: spec.group, sensitive: spec.sensitive });
  }
  return out;
}

// XMP writes its dates in ISO 8601 already, so unlike a PDF Info dictionary's
// "D:" form they are surfaced exactly as the file states them.
export const XMP_DOCUMENT: readonly XmpSpec[] = [
  { tag: "xmp:CreatorTool", label: "Authoring tool", group: "XMP", sensitive: true },
  { tag: "xmp:CreateDate", label: "XMP created", group: "XMP" },
  { tag: "xmp:ModifyDate", label: "XMP modified", group: "XMP" },
  { tag: "xmp:MetadataDate", label: "XMP metadata touched", group: "XMP" },
  { tag: "xmpMM:DocumentID", label: "Document ID", group: "XMP", sensitive: true },
  { tag: "xmpMM:OriginalDocumentID", label: "Original document ID", group: "XMP", sensitive: true },
  { tag: "xmpMM:InstanceID", label: "Instance ID", group: "XMP" },
  { tag: "pdf:Producer", label: "XMP producer", group: "XMP" },
  { tag: "pdfaid:part", label: "PDF/A conformance", group: "XMP" },
  { tag: "dc:format", label: "Declared format", group: "XMP" },
];

// What an image's packet carries instead: the rights and credit block, the
// editing history's software, and the camera serial some raw converters copy
// through, which ties every photo from one body together.
export const XMP_IMAGE: readonly XmpSpec[] = [
  { tag: "xmp:CreatorTool", label: "Authoring tool", group: "XMP", sensitive: true },
  { tag: "xmp:CreateDate", label: "XMP created", group: "XMP" },
  { tag: "xmp:ModifyDate", label: "XMP modified", group: "XMP" },
  { tag: "dc:creator", label: "Creator", group: "XMP", sensitive: true },
  { tag: "dc:title", label: "Title", group: "XMP" },
  { tag: "dc:description", label: "Description", group: "XMP" },
  { tag: "dc:rights", label: "Rights", group: "XMP" },
  { tag: "photoshop:Credit", label: "Credit", group: "XMP" },
  { tag: "photoshop:City", label: "City", group: "XMP", sensitive: true },
  { tag: "photoshop:State", label: "State", group: "XMP", sensitive: true },
  { tag: "photoshop:Country", label: "Country", group: "XMP", sensitive: true },
  { tag: "photoshop:DateCreated", label: "Date created", group: "XMP", sensitive: true },
  { tag: "aux:SerialNumber", label: "Camera serial", group: "XMP", sensitive: true },
  { tag: "aux:LensSerialNumber", label: "Lens serial", group: "XMP", sensitive: true },
  { tag: "xmpMM:DocumentID", label: "Document ID", group: "XMP", sensitive: true },
  { tag: "xmpMM:InstanceID", label: "Instance ID", group: "XMP" },
  { tag: "Iptc4xmpCore:Location", label: "Location", group: "XMP", sensitive: true },
  { tag: "GPano:ProjectionType", label: "Panorama projection", group: "XMP" },
];
