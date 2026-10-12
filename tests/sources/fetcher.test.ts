import { describe, expect, it } from "vitest";
import { loadSources } from "@/lib/config";
import { SafeFetcher, robotsAllows, type FetcherDeps } from "@/lib/sources/fetcher";

const cfg = loadSources();
const html = (n = 600) => "<html><body><article><p>" + "word ".repeat(n) + "</p></article></body></html>";

function make(responses: Record<string, () => Response>, resolveMap: Record<string, string[]> = {}, extra: Partial<FetcherDeps> = {}) {
  const requested: string[] = [];
  const deps: FetcherDeps = {
    resolve: async (h) => resolveMap[h] ?? ["93.184.216.34"],
    request: async (url) => {
      requested.push(url.toString());
      const r = responses[url.toString()];
      return r ? r() : new Response("not found", { status: 404 });
    },
    sleep: async () => {},
    ...extra,
  };
  return { fetcher: new SafeFetcher(cfg, deps), requested };
}

describe("SafeFetcher SSRF behaviour", () => {
  it("refuses private IP literals without making any request", async () => {
    const { fetcher, requested } = make({});
    const r = await fetcher.fetch("http://169.254.169.254/latest/meta-data/");
    expect(r).toMatchObject({ ok: false, errorCode: "SSRF_BLOCKED" });
    expect(requested).toHaveLength(0);
  });
  it("refuses a public-looking name that RESOLVES to a private address (DNS rebinding)", async () => {
    const { fetcher, requested } = make({}, { "evil.example.com": ["10.0.0.5"] });
    const r = await fetcher.fetch("https://evil.example.com/x");
    expect(r).toMatchObject({ ok: false, errorCode: "SSRF_BLOCKED" });
    expect(requested).toHaveLength(0);
  });
  it("re-checks every redirect hop: a redirect to the metadata IP is blocked", async () => {
    const { fetcher, requested } = make({
      "https://ok.example.com/robots.txt": () => new Response("", { status: 404 }),
      "https://ok.example.com/start": () => new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data/" } }),
    });
    const r = await fetcher.fetch("https://ok.example.com/start");
    expect(r).toMatchObject({ ok: false, errorCode: "SSRF_BLOCKED" });
    expect(r.redirects).toEqual(["http://169.254.169.254/latest/meta-data/"]);
    expect(requested.some((u) => u.includes("169.254"))).toBe(false);
  });
  it("blocks a redirect to a hostname that resolves privately", async () => {
    const { fetcher } = make(
      {
        "https://a.example.com/robots.txt": () => new Response("", { status: 404 }),
        "https://a.example.com/": () => new Response(null, { status: 301, headers: { location: "https://internal.example.com/secret" } }),
      },
      { "internal.example.com": ["192.168.1.10"] },
    );
    expect(await fetcher.fetch("https://a.example.com/")).toMatchObject({ ok: false, errorCode: "SSRF_BLOCKED" });
  });
  it("blocks never_fetch domains (linkedin.com)", async () => {
    const { fetcher } = make({});
    expect(await fetcher.fetch("https://www.linkedin.com/in/someone")).toMatchObject({ ok: false, errorCode: "SSRF_BLOCKED" });
  });
  it("stops after max_redirects", async () => {
    const loop = () => new Response(null, { status: 302, headers: { location: "https://loop.example.com/again" } });
    const { fetcher } = make({ "https://loop.example.com/robots.txt": () => new Response("", { status: 404 }), "https://loop.example.com/again": loop, "https://loop.example.com/": loop });
    expect(await fetcher.fetch("https://loop.example.com/")).toMatchObject({ ok: false, errorCode: "REDIRECT_LOOP" });
  });
});

describe("SafeFetcher normal behaviour", () => {
  it("returns the body and final URL after following a safe redirect", async () => {
    const { fetcher } = make({
      "https://a.example.com/robots.txt": () => new Response("", { status: 404 }),
      "https://b.example.org/robots.txt": () => new Response("", { status: 404 }),
      "https://a.example.com/old": () => new Response(null, { status: 301, headers: { location: "https://b.example.org/new" } }),
      "https://b.example.org/new": () => new Response(html(), { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }),
    });
    const r = await fetcher.fetch("https://a.example.com/old");
    expect(r).toMatchObject({ ok: true, status: 200, finalUrl: "https://b.example.org/new" });
    expect(r.redirects).toEqual(["https://b.example.org/new"]);
    expect(r.body).toContain("word word");
  });
  it("reports HTTP errors as not ok (403 paywall)", async () => {
    const { fetcher } = make({
      "https://p.example.com/robots.txt": () => new Response("", { status: 404 }),
      "https://p.example.com/a": () => new Response("forbidden", { status: 403 }),
    });
    expect(await fetcher.fetch("https://p.example.com/a")).toMatchObject({ ok: false, status: 403, errorCode: "HTTP" });
  });
  it("caps the body at max_bytes and flags truncation", async () => {
    const big = "x".repeat(cfg.fetch.max_bytes + 5000);
    const { fetcher } = make({
      "https://big.example.com/robots.txt": () => new Response("", { status: 404 }),
      "https://big.example.com/a": () => new Response(big, { status: 200 }),
    });
    const r = await fetcher.fetch("https://big.example.com/a");
    expect(r.ok).toBe(true);
    expect(r.truncated).toBe(true);
    expect(r.body.length).toBeLessThanOrEqual(cfg.fetch.max_bytes);
  });
  it("sends the bot user agent and no cookies", async () => {
    let seen: Record<string, string> = {};
    const { fetcher } = make(
      { "https://h.example.com/robots.txt": () => new Response("", { status: 404 }), "https://h.example.com/a": () => new Response("ok " + "x".repeat(500)) },
      {},
      {
        request: async (url, init) => {
          if (!url.pathname.includes("robots")) seen = init.headers;
          return url.pathname.includes("robots") ? new Response("", { status: 404 }) : new Response("ok");
        },
      },
    );
    await fetcher.fetch("https://h.example.com/a");
    expect(seen["user-agent"]).toBe(cfg.fetch.user_agent);
    expect(Object.keys(seen).map((k) => k.toLowerCase())).not.toContain("cookie");
  });
  it("applies the per-domain delay between hits to the same host", async () => {
    const sleeps: number[] = [];
    let t = 1_000_000;
    const { fetcher } = make(
      { "https://d.example.com/robots.txt": () => new Response("", { status: 404 }), "https://d.example.com/a": () => new Response("a"), "https://d.example.com/b": () => new Response("b") },
      {},
      { now: () => t, sleep: async (ms) => { sleeps.push(ms); t += ms; } },
    );
    await fetcher.fetch("https://d.example.com/a");
    await fetcher.fetch("https://d.example.com/b");
    expect(sleeps.some((ms) => ms > 0 && ms <= cfg.fetch.per_domain_delay_ms)).toBe(true);
  });
  it("caches by URL within a run", async () => {
    const { fetcher, requested } = make({ "https://c.example.com/robots.txt": () => new Response("", { status: 404 }), "https://c.example.com/a": () => new Response("a") });
    await fetcher.fetch("https://c.example.com/a");
    await fetcher.fetch("https://c.example.com/a");
    expect(requested.filter((u) => u.endsWith("/a"))).toHaveLength(1);
  });
});

describe("robots.txt", () => {
  const robots = "User-agent: *\nDisallow: /private\nAllow: /private/ok\n\nUser-agent: VCIntelBot\nDisallow: /blocked-for-us\n";
  it("uses the group for our UA token, longest match wins", () => {
    expect(robotsAllows(robots, "/blocked-for-us/x", "VCIntelBot")).toBe(false);
    expect(robotsAllows(robots, "/private/x", "VCIntelBot")).toBe(true); // our specific group has no rule for /private
    expect(robotsAllows(robots, "/private/x", "OtherBot")).toBe(false);
    expect(robotsAllows(robots, "/private/ok/y", "OtherBot")).toBe(true);
    expect(robotsAllows("", "/anything", "VCIntelBot")).toBe(true);
    expect(robotsAllows("User-agent: *\nDisallow:", "/x", "VCIntelBot")).toBe(true);
    expect(robotsAllows("User-agent: *\nDisallow: /", "/x", "VCIntelBot")).toBe(false);
  });
  it("a fetch disallowed by robots.txt is not performed", async () => {
    const { fetcher, requested } = make({
      "https://r.example.com/robots.txt": () => new Response("User-agent: *\nDisallow: /secret", { status: 200 }),
      "https://r.example.com/secret/page": () => new Response("data"),
    });
    const r = await fetcher.fetch("https://r.example.com/secret/page");
    expect(r).toMatchObject({ ok: false, errorCode: "ROBOTS_DISALLOWED" });
    expect(requested.some((u) => u.includes("/secret/page"))).toBe(false);
  });
});
