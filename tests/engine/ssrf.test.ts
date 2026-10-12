import { describe, expect, it } from "vitest";
import { loadSources } from "@/lib/config";
import { assertPublicAddresses, checkUrlSyntax, isBlockedIpLiteral, parseIPv4, parseIPv6 } from "@/lib/engine/ssrf";
import { v1Url } from "@/lib/engine/validators";

const sources = loadSources();
const rules = { allowedSchemes: ["http", "https"], neverFetch: ["linkedin.com", "x.com"] };
const blocked = (u: string) => !checkUrlSyntax(u, rules).ok;

describe("SSRF guard (pure parts)", () => {
  it("blocks the cloud metadata address", () => {
    expect(blocked("http://169.254.169.254/latest/meta-data/")).toBe(true);
    expect(v1Url("http://169.254.169.254/", sources)).toMatchObject({ ok: false, code: "SSRF_BLOCKED" });
  });
  it("blocks hex, decimal, octal and short IPv4 spellings of loopback", () => {
    expect(blocked("http://0x7f000001/")).toBe(true);
    expect(blocked("http://2130706433/")).toBe(true);
    expect(blocked("http://0177.0.0.1/")).toBe(true);
    expect(blocked("http://127.1/")).toBe(true);
    expect(blocked("http://0x7f.0.0.1/")).toBe(true);
    expect(isBlockedIpLiteral("0x7f000001")).toBe(true);
    expect(parseIPv4("0x7f000001")).toBe(2130706433);
    expect(parseIPv4("127.1")).toBe(2130706433);
  });
  it("blocks private ranges, link-local, CGNAT and this-network", () => {
    for (const ip of ["10.0.0.1", "172.16.5.4", "172.31.255.255", "192.168.1.1", "100.64.0.1", "0.0.0.0", "224.0.0.1", "255.255.255.255"]) {
      expect(blocked(`http://${ip}/`), ip).toBe(true);
    }
    expect(blocked("http://172.32.0.1/")).toBe(false); // just outside 172.16/12
    expect(blocked("http://8.8.8.8/")).toBe(false);
  });
  it("blocks IPv6 loopback, unique-local, link-local, mapped and NAT64/6to4 forms", () => {
    for (const h of ["[::1]", "[::]", "[fc00::1]", "[fd12:3456::1]", "[fe80::1]", "[::ffff:127.0.0.1]", "[::ffff:7f00:1]", "[::ffff:a00:1]", "[64:ff9b::7f00:1]", "[2002:7f00:1::]", "[2001:db8::1]"]) {
      expect(blocked(`http://${h}/`), h).toBe(true);
    }
    expect(blocked("http://[2606:4700:4700::1111]/")).toBe(false); // a public address
  });
  it("blocks bad schemes, credentials, odd ports and internal names", () => {
    expect(blocked("file:///etc/passwd")).toBe(true);
    expect(blocked("ftp://example.com/")).toBe(true);
    expect(blocked("gopher://example.com/")).toBe(true);
    expect(blocked("http://user:pw@example.com/")).toBe(true);
    expect(blocked("http://example.com:22/")).toBe(true);
    expect(blocked("http://localhost/")).toBe(true);
    expect(blocked("http://foo.localhost/")).toBe(true);
    expect(blocked("http://metadata.google.internal/")).toBe(true);
    expect(blocked("http://intranet/")).toBe(true);
    expect(blocked("not a url")).toBe(true);
  });
  it("blocks never_fetch domains and their subdomains but not look-alikes", () => {
    expect(blocked("https://www.linkedin.com/in/someone")).toBe(true);
    expect(blocked("https://x.com/user")).toBe(true);
    expect(blocked("https://notlinkedin.com/")).toBe(false);
  });
  it("allows ordinary public https URLs", () => {
    expect(checkUrlSyntax("https://blume.vc/blog/post", rules).ok).toBe(true);
    expect(checkUrlSyntax("http://example.com:80/x", rules).ok).toBe(true);
  });
  it("assertPublicAddresses rejects any private DNS answer (rebinding / redirect re-check)", () => {
    expect(assertPublicAddresses(["93.184.216.34"]).ok).toBe(true);
    expect(assertPublicAddresses(["93.184.216.34", "10.0.0.5"]).ok).toBe(false);
    expect(assertPublicAddresses(["::ffff:192.168.0.1"]).ok).toBe(false);
    expect(assertPublicAddresses([]).ok).toBe(false);
  });
  it("parseIPv6 handles :: and embedded IPv4", () => {
    expect(parseIPv6("::1")).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
    expect(parseIPv6("::ffff:1.2.3.4")).toEqual([0, 0, 0, 0, 0, 0xffff, 0x0102, 0x0304]);
    expect(parseIPv6("1::2::3")).toBeNull();
  });
});

describe("audit hardening: extra reserved IPv6/IPv4 ranges", () => {
  it("blocks IPv4-translated, Teredo, local-use NAT64, discard and 6to4 relay", () => {
    for (const h of ["http://[::ffff:0:127.0.0.1]/", "http://[2001:0:7f00:1::]/", "http://[64:ff9b:1::1]/", "http://[100::1]/", "http://192.88.99.1/"]) {
      expect(blocked(h), h).toBe(true);
    }
  });
});
