/**
 * Pure parts of the SSRF guard (no DNS, no network): URL syntax rules and IP-range checks that understand
 * decimal / hex / octal / short IPv4 forms and IPv6 incl. IPv4-mapped. The impure part (DNS resolution + redirect
 * re-check) lives in the fetcher (P04) and must call assertPublicAddresses() on every hop.
 */
export type SsrfResult = { ok: true; url: URL } | { ok: false; code: "SSRF_BLOCKED"; detail: string };

const block = (detail: string): SsrfResult => ({ ok: false, code: "SSRF_BLOCKED", detail });

/** inet_aton-style parse: "127.0.0.1", "2130706433", "0x7f000001", "0177.0.0.1", "127.1". Returns uint32 or null. */
export function parseIPv4(host: string): number | null {
  const parts = host.split(".");
  if (parts.length < 1 || parts.length > 4 || parts.some((p) => p === "")) return null;
  const nums: number[] = [];
  for (const p of parts) {
    let n: number;
    if (/^0x[0-9a-f]+$/i.test(p)) n = parseInt(p, 16);
    else if (/^0[0-7]+$/.test(p)) n = parseInt(p, 8);
    else if (/^(0|[1-9][0-9]*)$/.test(p)) n = parseInt(p, 10);
    else return null;
    if (!Number.isFinite(n) || n < 0) return null;
    nums.push(n);
  }
  const last = nums[nums.length - 1]!;
  const leading = nums.slice(0, -1);
  if (leading.some((n) => n > 255)) return null;
  const remainingBytes = 4 - leading.length;
  if (last >= 256 ** remainingBytes) return null;
  let v = 0;
  for (const n of leading) v = v * 256 + n;
  return v * 256 ** remainingBytes + last;
}

const v4 = (a: number, b: number, c: number, d: number) => ((a * 256 + b) * 256 + c) * 256 + d;
const inV4 = (ip: number, base: number, bits: number) => {
  const size = 2 ** (32 - bits);
  return ip >= base && ip < base + size;
};
const BLOCKED_V4: Array<[number, number]> = [
  [v4(0, 0, 0, 0), 8],
  [v4(10, 0, 0, 0), 8],
  [v4(100, 64, 0, 0), 10], // carrier-grade NAT
  [v4(127, 0, 0, 0), 8],
  [v4(169, 254, 0, 0), 16], // link-local + cloud metadata 169.254.169.254
  [v4(172, 16, 0, 0), 12],
  [v4(192, 0, 0, 0), 24],
  [v4(192, 0, 2, 0), 24],
  [v4(192, 168, 0, 0), 16],
  [v4(198, 18, 0, 0), 15],
  [v4(198, 51, 100, 0), 24],
  [v4(203, 0, 113, 0), 24],
  [v4(224, 0, 0, 0), 4], // multicast
  [v4(240, 0, 0, 0), 4], // reserved + broadcast
];
export const isBlockedIPv4 = (ip: number) => BLOCKED_V4.some(([base, bits]) => inV4(ip, base, bits));

/** Parse an IPv6 literal (no brackets) into 8 16-bit groups, or null. Supports "::" and a trailing dotted IPv4. */
export function parseIPv6(raw: string): number[] | null {
  let s = raw.toLowerCase();
  const zone = s.indexOf("%");
  if (zone >= 0) s = s.slice(0, zone);
  if (!/^[0-9a-f:.]+$/.test(s) || !s.includes(":")) return null;
  let tail: number[] = [];
  const lastColon = s.lastIndexOf(":");
  const maybeV4 = s.slice(lastColon + 1);
  if (maybeV4.includes(".")) {
    const ip = parseIPv4(maybeV4);
    if (ip === null) return null;
    tail = [Math.floor(ip / 65536), ip % 65536];
    s = s.slice(0, lastColon + 1) + "0:0";
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const toGroups = (h: string) => (h === "" ? [] : h.split(":"));
  const head = toGroups(halves[0]!);
  const rest = halves.length === 2 ? toGroups(halves[1]!) : [];
  if (halves.length === 1 && head.length !== 8) return null;
  const fill = 8 - head.length - rest.length;
  if (halves.length === 2 && fill < 1) return null;
  const groups = [...head, ...Array<string>(halves.length === 2 ? fill : 0).fill("0"), ...rest];
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  const out = groups.map((g) => parseInt(g, 16));
  if (tail.length) {
    out[6] = tail[0]!;
    out[7] = tail[1]!;
  }
  return out;
}

export function isBlockedIPv6(g: number[]): boolean {
  const [a, b, c, d, e, f, g6, h] = g as [number, number, number, number, number, number, number, number];
  const embeddedV4 = g6 * 65536 + h;
  const allZeroTo = (n: number) => g.slice(0, n).every((x) => x === 0);
  if (allZeroTo(7) && (h === 0 || h === 1)) return true; // :: and ::1
  if (allZeroTo(5) && f === 0xffff) return isBlockedIPv4(embeddedV4); // ::ffff:a.b.c.d (IPv4-mapped)
  if (allZeroTo(6)) return true; // ::a.b.c.d deprecated IPv4-compatible
  if (a === 0x64 && b === 0xff9b && c === 0 && d === 0 && e === 0 && f === 0) return isBlockedIPv4(embeddedV4); // NAT64
  if (a === 0x2002) return isBlockedIPv4(b * 65536 + c); // 6to4 embeds IPv4
  if ((a & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((a & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((a & 0xffc0) === 0xfec0) return true; // fec0::/10 site-local
  if ((a & 0xff00) === 0xff00) return true; // multicast
  if (a === 0x2001 && b === 0x0db8) return true; // documentation
  return false;
}

/** True when `host` (hostname or IP literal, brackets optional) is a private/loopback/link-local/reserved address. */
export function isBlockedIpLiteral(host: string): boolean | null {
  const h = host.replace(/^\[|\]$/g, "");
  if (h.includes(":")) {
    const g = parseIPv6(h);
    return g === null ? true : isBlockedIPv6(g); // unparseable IPv6 => block
  }
  const labels = h.split(".");
  const looksNumeric = labels.length > 0 && labels.every((l) => /^(0x[0-9a-f]+|[0-9]+)$/i.test(l));
  if (!looksNumeric) return null; // not an IP literal: it is a DNS name
  const ip = parseIPv4(h);
  return ip === null ? true : isBlockedIPv4(ip); // numeric-looking but malformed => block
}

const BLOCKED_NAME = /(^|\.)(localhost|local|localdomain|internal|intranet|lan|home|corp|private)$/i;
const METADATA_NAMES = new Set(["metadata.google.internal", "metadata", "instance-data"]);

export interface UrlRules {
  allowedSchemes: string[];
  neverFetch: string[];
}

/** V1 (pure half): scheme, credentials, port, hostname shape, IP literal ranges, never_fetch domains. */
export function checkUrlSyntax(raw: string, rules: UrlRules): SsrfResult {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return block("not a valid URL");
  }
  const scheme = u.protocol.replace(":", "");
  if (!rules.allowedSchemes.includes(scheme)) return block(`scheme ${scheme} not allowed`);
  if (u.username || u.password) return block("credentials in URL");
  if (u.port && u.port !== "80" && u.port !== "443") return block(`port ${u.port} not allowed`);
  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  if (!host) return block("empty host");
  const literal = isBlockedIpLiteral(host);
  if (literal === true) return block("private, loopback, link-local or reserved IP");
  if (literal === null) {
    if (BLOCKED_NAME.test(host) || METADATA_NAMES.has(host)) return block("internal hostname");
    if (!host.includes(".")) return block("single-label hostname");
  }
  for (const d of rules.neverFetch) {
    const dom = d.toLowerCase();
    if (host === dom || host.endsWith(`.${dom}`)) return block(`domain ${dom} is on the never_fetch list`);
  }
  return { ok: true, url: u };
}

/** Impure half support: after DNS resolution (and after every redirect), every returned address must be public. */
export function assertPublicAddresses(addrs: string[]): SsrfResult | { ok: true } {
  if (addrs.length === 0) return block("host did not resolve");
  for (const a of addrs) {
    const b = isBlockedIpLiteral(a);
    if (b === true || b === null) return block(`resolved to non-public address ${a}`);
  }
  return { ok: true };
}
