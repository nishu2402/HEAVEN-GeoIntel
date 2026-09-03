// ── Offline IP scope classification (IANA special-purpose registries) ────────
// Deterministic, zero-API classification of an IP against the IANA IPv4/IPv6
// Special-Purpose Address Registries (RFC 6890 and friends). This lets the IP
// lookup answer "this is a private / loopback / CGNAT / documentation address —
// not a routable public host" instead of firing geolocation APIs at an address
// they can never resolve. Pure math + fixed RFC ranges → no false data.

export type IpScope =
  | "global"
  | "private"
  | "loopback"
  | "link-local"
  | "cgnat"
  | "documentation"
  | "benchmarking"
  | "multicast"
  | "reserved"
  | "unspecified"
  | "unique-local"
  | "protocol"
  | "translation";

export interface IpClassification {
  scope: IpScope;
  /** Short human label, e.g. "Private (RFC 1918)". */
  label: string;
  /** One-line explanation for the UI. */
  description: string;
  /** True only for a normal, globally-routable public address. */
  isGloballyRoutable: boolean;
  /** The defining RFC, or null for plain global unicast. */
  rfc: string | null;
}

interface Range {
  cidr: string;
  scope: IpScope;
  label: string;
  description: string;
  rfc: string;
}

const PRIVATE_DESC = "Internal/private network address: not routable on the public internet.";
const DOC_DESC = "Reserved for documentation/examples: never assigned to a real host.";

// IPv4 special-purpose blocks. Order is specific-first; the blocks are disjoint
// so the first containing range wins.
const V4_RANGES: Range[] = [
  { cidr: "0.0.0.0/8",       scope: "unspecified",   label: '"This" network',              description: 'The "this host on this network" block: not a routable destination.', rfc: "RFC 1122" },
  { cidr: "10.0.0.0/8",      scope: "private",       label: "Private (RFC 1918)",          description: PRIVATE_DESC, rfc: "RFC 1918" },
  { cidr: "100.64.0.0/10",   scope: "cgnat",         label: "Carrier-grade NAT",           description: "Shared CGNAT address space inside an ISP: not a unique public host.", rfc: "RFC 6598" },
  { cidr: "127.0.0.0/8",     scope: "loopback",      label: "Loopback",                    description: "Loopback address: always refers to the local machine.", rfc: "RFC 1122" },
  { cidr: "169.254.0.0/16",  scope: "link-local",    label: "Link-local (APIPA)",          description: "Auto-configured link-local address: only valid on the local segment.", rfc: "RFC 3927" },
  { cidr: "172.16.0.0/12",   scope: "private",       label: "Private (RFC 1918)",          description: PRIVATE_DESC, rfc: "RFC 1918" },
  { cidr: "192.0.0.0/24",    scope: "protocol",      label: "IETF protocol assignments",   description: "Reserved for IETF protocol assignments: not a normal host.", rfc: "RFC 6890" },
  { cidr: "192.0.2.0/24",    scope: "documentation", label: "Documentation (TEST-NET-1)",  description: DOC_DESC, rfc: "RFC 5737" },
  { cidr: "192.88.99.0/24",  scope: "protocol",      label: "6to4 relay anycast (deprecated)", description: "Former 6to4 relay anycast block: deprecated.", rfc: "RFC 7526" },
  { cidr: "192.168.0.0/16",  scope: "private",       label: "Private (RFC 1918)",          description: PRIVATE_DESC, rfc: "RFC 1918" },
  { cidr: "198.18.0.0/15",   scope: "benchmarking",  label: "Benchmarking",                description: "Reserved for network benchmarking: not a real host.", rfc: "RFC 2544" },
  { cidr: "198.51.100.0/24", scope: "documentation", label: "Documentation (TEST-NET-2)",  description: DOC_DESC, rfc: "RFC 5737" },
  { cidr: "203.0.113.0/24",  scope: "documentation", label: "Documentation (TEST-NET-3)",  description: DOC_DESC, rfc: "RFC 5737" },
  { cidr: "224.0.0.0/4",     scope: "multicast",     label: "Multicast",                   description: "Multicast group address: not a single unicast host.", rfc: "RFC 5771" },
  { cidr: "240.0.0.0/4",     scope: "reserved",      label: "Reserved",                    description: "Reserved for future use (includes the 255.255.255.255 broadcast).", rfc: "RFC 1112" },
];

// IPv6 special-purpose blocks. Exact /128 addresses are listed before the wider
// prefixes so they match first.
const V6_RANGES: Range[] = [
  { cidr: "::1/128",       scope: "loopback",      label: "Loopback",              description: "IPv6 loopback: always the local machine.", rfc: "RFC 4291" },
  { cidr: "::/128",        scope: "unspecified",   label: "Unspecified",           description: "The unspecified address (::): not a routable destination.", rfc: "RFC 4291" },
  { cidr: "::ffff:0:0/96", scope: "translation",   label: "IPv4-mapped",           description: "IPv4-mapped IPv6 address: represents an IPv4 host.", rfc: "RFC 4291" },
  { cidr: "64:ff9b::/96",  scope: "translation",   label: "IPv4/IPv6 translation", description: "NAT64 translation prefix (well-known).", rfc: "RFC 6052" },
  { cidr: "2001:db8::/32", scope: "documentation", label: "Documentation",         description: DOC_DESC, rfc: "RFC 3849" },
  { cidr: "fc00::/7",      scope: "unique-local",  label: "Unique local (ULA)",    description: "Private IPv6 range: not routable on the public internet.", rfc: "RFC 4193" },
  { cidr: "fe80::/10",     scope: "link-local",    label: "Link-local",            description: "Link-local address: only valid on the local segment.", rfc: "RFC 4291" },
  { cidr: "ff00::/8",      scope: "multicast",     label: "Multicast",             description: "Multicast group address: not a single unicast host.", rfc: "RFC 4291" },
];

// Addresses are represented as unit arrays (4 octets for IPv4, 8 hextets for
// IPv6) so prefix matching stays within 32-bit-safe integer math — no BigInt,
// so the ES2017 target is happy.
function parseV4(ip: string): number[] | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  const out: number[] = [];
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const v = Number(p);
    if (v > 255) return null;
    out.push(v);
  }
  return out;
}

function parseV6(ip: string): number[] | null {
  let s = ip.split("%")[0]; // strip a zone id if present
  // Expand an embedded IPv4 tail (e.g. ::ffff:1.2.3.4) into two hextets.
  const v4m = s.match(/^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (v4m) {
    const v4 = parseV4(v4m[2]);
    if (v4 === null) return null;
    s = v4m[1] + ((v4[0] << 8) | v4[1]).toString(16) + ":" + ((v4[2] << 8) | v4[3]).toString(16);
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  // With "::" at least one group is elided (missing >= 1); without it the address
  // must already be a full 8 groups (missing === 0).
  if (halves.length === 2 ? missing < 1 : missing !== 0) return null;
  const groups = [...head, ...Array(missing).fill("0"), ...tail];
  const out: number[] = [];
  for (const g of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
    out.push(parseInt(g, 16));
  }
  return out;
}

// True when `addr` and `net` agree on the first `prefixLen` bits. `unitBits` is
// 8 for IPv4 octets, 16 for IPv6 hextets.
function matchPrefix(addr: number[], net: number[], prefixLen: number, unitBits: number): boolean {
  let remaining = prefixLen;
  for (let i = 0; i < addr.length && remaining > 0; i++) {
    if (remaining >= unitBits) {
      if (addr[i] !== net[i]) return false;
      remaining -= unitBits;
    } else {
      const shift = unitBits - remaining;
      if (addr[i] >> shift !== net[i] >> shift) return false;
      remaining = 0;
    }
  }
  return true;
}

const GLOBAL: IpClassification = {
  scope: "global",
  label: "Public",
  description: "Globally-routable public address.",
  isGloballyRoutable: true,
  rfc: null,
};

/**
 * Classify an IP by its IANA special-purpose scope. Returns null only when the
 * string is not a parseable IPv4/IPv6 literal. A normal public address returns
 * the `global` classification (isGloballyRoutable: true).
 */
export function classifyIp(ip: string): IpClassification | null {
  const isV6 = ip.includes(":");
  const parse = isV6 ? parseV6 : parseV4;
  const addr = parse(ip);
  if (addr === null) return null;

  const ranges = isV6 ? V6_RANGES : V4_RANGES;
  const unitBits = isV6 ? 16 : 8;
  for (const r of ranges) {
    const [net, lenStr] = r.cidr.split("/");
    if (matchPrefix(addr, parse(net)!, Number(lenStr), unitBits)) {
      return { scope: r.scope, label: r.label, description: r.description, isGloballyRoutable: false, rfc: r.rfc };
    }
  }
  return GLOBAL;
}
