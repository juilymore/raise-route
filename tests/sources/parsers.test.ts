import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadSources } from "@/lib/config";
import { buildAliasIndex } from "@/lib/engine/entities";
import { canonicalizeUrl, classifySource, selectCandidates, toCandidate } from "@/lib/sources/candidates";
import { extractArticle } from "@/lib/sources/extract";
import { discoverFeedLinks, newestDate, parseFeed, youtubeFeedFromHtml } from "@/lib/sources/feeds";
import { buildQueries, decodeEmbeddedUrl, decodeGoogleNewsUrl, feedUrlFor, googleArticleId, newsItemsToCandidates } from "@/lib/sources/googleNews";
import { exaRequestBody, searchExa, searchTavily, tavilyRequestBody } from "@/lib/sources/searchApis";
import { matchItemsToVcs, type SectorItem } from "@/lib/sources/sectorFeeds";

const cfg = loadSources();

const RSS = `<?xml version="1.0"?><rss version="2.0"><channel><title>Sector &amp; News</title>
<item><title>Accel leads $10M round in a &lt;b&gt;freight&lt;/b&gt; startup</title><link>https://news.example.com/a</link><pubDate>Sat, 10 Oct 2026 08:00:00 GMT</pubDate><description>&lt;p&gt;Accel, the venture firm, led it.&lt;/p&gt;</description><source url="https://reuters.com">Reuters</source></item>
<item><title>Accelerating adoption of cloud</title><link>https://news.example.com/b</link><pubDate>Fri, 09 Oct 2026 08:00:00 GMT</pubDate><description>Nothing about the firm.</description></item>
</channel></rss>`;
const ATOM = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>Blog</title>
<entry><title>Why logistics software</title><link rel="alternate" href="https://v.example.com/p/1"/><link rel="edit" href="https://v.example.com/edit/1"/><published>2026-10-05T10:00:00Z</published><updated>2026-10-11T10:00:00Z</updated><summary>An essay</summary></entry></feed>`;

describe("feed parsing", () => {
  it("parses RSS, strips HTML, keeps source info and ISO dates", () => {
    const f = parseFeed(RSS);
    expect(f.kind).toBe("rss");
    expect(f.title).toBe("Sector & News");
    expect(f.items).toHaveLength(2);
    expect(f.items[0]).toMatchObject({ title: "Accel leads $10M round in a freight startup", link: "https://news.example.com/a", publishedIso: "2026-10-10", sourceName: "Reuters", sourceUrl: "https://reuters.com" });
    expect(f.items[0]!.summary).toBe("Accel, the venture firm, led it.");
    expect(newestDate(f.items)).toBe("2026-10-10");
  });
  it("parses Atom: alternate link, <published> wins over <updated>", () => {
    const f = parseFeed(ATOM);
    expect(f.kind).toBe("atom");
    expect(f.items[0]).toMatchObject({ link: "https://v.example.com/p/1", publishedIso: "2026-10-05" });
  });
  it("rejects HTML and garbage as not-a-feed", () => {
    expect(() => parseFeed("<html><body>hi</body></html>")).toThrow(/not an RSS/);
    expect(() => parseFeed("")).toThrow();
  });
  it("handles a single-item feed (object, not array)", () => {
    expect(parseFeed(`<rss><channel><title>t</title><item><title>one</title><link>https://x.com/1</link></item></channel></rss>`).items).toHaveLength(1);
  });
  it("discovers feed links and a YouTube channel feed from HTML", () => {
    const h = `<head><link rel="alternate" type="application/rss+xml" href="/feed.xml"><link rel="alternate" type="text/html" href="/x"></head><a href="https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv">yt</a>`;
    expect(discoverFeedLinks(h, "https://v.example.com/", cfg.official_feed_discovery.link_rel_alternate_types)).toEqual(["https://v.example.com/feed.xml"]);
    expect(youtubeFeedFromHtml(h)).toBe("https://www.youtube.com/feeds/videos.xml?channel_id=UCabcdefghijklmnopqrstuv");
  });
  it("parses the recorded real fixtures when present", () => {
    for (const f of ["fixtures/feeds/sector_feed_sample.xml", "fixtures/feeds/google_news_sample.xml"]) {
      if (!existsSync(f)) continue;
      const items = parseFeed(readFileSync(f, "utf8")).items;
      expect(items.length).toBeGreaterThan(0);
      expect(items.every((i) => i.title && i.link)).toBe(true);
    }
  });
});

describe("sector push model matching", () => {
  const index = buildAliasIndex([
    { id: "accel", firm: "Accel", aliases: ["Accel India"], tracked_people: [] },
    { id: "blume", firm: "Blume Ventures", aliases: ["Blume"], tracked_people: [] },
  ]);
  const items: SectorItem[] = parseFeed(RSS).items.map((i) => ({ ...i, feedName: "Test" }));
  it("matches the real firm and ignores 'Accelerating'", () => {
    const m = matchItemsToVcs(items, index);
    expect(m.get("accel")?.map((i) => i.link)).toEqual(["https://news.example.com/a"]);
    expect(m.has("blume")).toBe(false);
  });
});

describe("article extraction", () => {
  const page = `<html lang="en"><head><title>Fallback title</title><meta property="og:title" content="Accel backs Acme"/>
<script type="application/ld+json">{"@type":"NewsArticle","datePublished":"2026-10-04T05:00:00+05:30","dateModified":"2026-10-11"}</script></head>
<body><nav>Home About Contact</nav><article><h1>Accel backs Acme</h1><p>${"Accel invested in Acme Freight. ".repeat(12)}</p><p>Second paragraph about trucking.</p></article><footer>Copyright junk</footer></body></html>`;
  it("keeps the article, strips chrome, and reads structured dates (published, not modified)", () => {
    const a = extractArticle(page);
    expect(a.title).toBe("Accel backs Acme");
    expect(a.text).toContain("Second paragraph about trucking.");
    expect(a.text).not.toContain("Copyright junk");
    expect(a.text).not.toContain("Home About Contact");
    expect(a.dates.jsonLdPublished).toBe("2026-10-04");
    expect(a.dates.jsonLdModified).toBe("2026-10-11");
    expect(a.htmlLang).toBe("en");
  });
  it("extracts the recorded real article when present", () => {
    const f = "fixtures/articles/news_article_sample.html";
    if (!existsSync(f)) return;
    const a = extractArticle(readFileSync(f, "utf8"));
    expect(a.text.length).toBeGreaterThan(200);
    const meta = JSON.parse(readFileSync("fixtures/articles/news_article_sample.meta.json", "utf8")) as { dates: { jsonLdPublished: string | null; jsonLdModified: string | null } };
    // Real page: published date must come from datePublished; a later dateModified must not become the event date.
    expect(a.dates.jsonLdPublished).toBe(meta.dates.jsonLdPublished);
    expect(a.dates.jsonLdPublished).not.toBeNull();
    expect(a.title.length).toBeGreaterThan(10);
  });
});

describe("candidates", () => {
  it("canonicalises URLs (tracking params, www, fragments, trailing slash)", () => {
    expect(canonicalizeUrl("https://WWW.Example.com/Post/?utm_source=x&b=2&a=1#frag")).toBe("https://example.com/Post?a=1&b=2");
    expect(canonicalizeUrl("https://example.com:443/a/")).toBe("https://example.com/a");
  });
  it("classifies sources from config domain classes", () => {
    expect(classifySource("https://www.reuters.com/x", ["blume.vc"], cfg)).toBe("reputable_news");
    expect(classifySource("https://www.freightwaves.com/x", ["blume.vc"], cfg)).toBe("trade_press");
    expect(classifySource("https://blume.vc/blog/post", ["blume.vc"], cfg)).toBe("official_blog");
    expect(classifySource("https://blume.vc/", ["blume.vc"], cfg)).toBe("official_site");
    expect(classifySource("https://www.youtube.com/watch?v=1", [], cfg)).toBe("video");
    expect(classifySource("https://random.example.org/", [], cfg)).toBe("other");
  });
  it("selects: dedupes, drops already-stored, ranks official first then newest, caps the count", () => {
    const mk = (url: string, hint: string, title = "") => toCandidate({ url, channel: "news_rss", publishedHint: hint, title })!;
    const all = [
      mk("https://news.example.com/old?utm_source=a", "2026-09-20"),
      mk("https://news.example.com/old", "2026-09-20"), // duplicate after canonicalisation
      mk("https://news.example.com/new", "2026-10-09"),
      mk("https://blume.vc/blog/x", "2026-09-15"),
      mk("https://news.example.com/stored", "2026-10-10"),
    ];
    const out = selectCandidates(all, { vcDomains: ["blume.vc"], alreadyStored: new Set([canonicalizeUrl("https://news.example.com/stored")]), max: 3, cfg });
    expect(out.map((c) => c.canonicalUrl)).toEqual(["https://blume.vc/blog/x", "https://news.example.com/new", "https://news.example.com/old"]);
  });
});

describe("Google News", () => {
  it("builds queries from config and per-person queries", () => {
    const q = buildQueries(cfg, "Blume Ventures", ["Karthik Reddy"]);
    expect(q[0]).toContain('"Blume Ventures"');
    expect(q[0]).toContain("when:30d");
    expect(q[q.length - 1]).toContain("Karthik Reddy");
    expect(feedUrlFor(cfg, '"A B"')).toContain("q=%22A%20B%22");
  });
  it("extracts the article id and decodes old-style embedded URLs without a network call", () => {
    const embedded = Buffer.from("\x08\x13\x22\x20https://publisher.example.com/story/1?x=1\xd2\x01\x00").toString("base64url");
    expect(googleArticleId(`https://news.google.com/rss/articles/${embedded}?oc=5`)).toBe(embedded);
    expect(decodeEmbeddedUrl(embedded)).toContain("https://publisher.example.com/story/1");
  });
  it("decodes new-style links through the page signature + batchexecute exchange (mocked)", async () => {
    const id = "CBMiNEWSTYLEfakeIdWithoutEmbeddedUrl";
    const inner = JSON.stringify(["garturlres", "https://www.reuters.com/world/story-1/", 1]);
    const response = `)]}'\n\n123\n${JSON.stringify([["wrb.fr", "Fbv4je", inner, null, null, null, "generic"]])}\n`;
    const url = await decodeGoogleNewsUrl(`https://news.google.com/rss/articles/${id}?oc=5`, {
      get: async () => ({ ok: true, body: `<c-wiz><div data-n-a-sg="SIG123" data-n-a-ts="1791794582"></div></c-wiz>` }),
      post: async (_u, body) => {
        expect(decodeURIComponent(body)).toContain("SIG123");
        return response;
      },
    });
    expect(url).toBe("https://www.reuters.com/world/story-1/");
  });
  it("returns null (unresolved, not evidence) when the signature is missing or the exchange fails", async () => {
    const link = "https://news.google.com/rss/articles/CBMiNEWSTYLEfakeId2?oc=5";
    expect(await decodeGoogleNewsUrl(link, { get: async () => ({ ok: true, body: "<html></html>" }) })).toBeNull();
    expect(await decodeGoogleNewsUrl(link, { get: async () => ({ ok: false, body: "" }) })).toBeNull();
    expect(
      await decodeGoogleNewsUrl(link, { get: async () => ({ ok: true, body: `<div data-n-a-sg="s" data-n-a-ts="1">` }), post: async () => { throw new Error("net"); } }),
    ).toBeNull();
  });
  it("turns items into candidates, separating unresolved ones", async () => {
    const items = parseFeed(RSS).items;
    const { candidates, unresolved } = await newsItemsToCandidates(items, { get: async () => ({ ok: false, body: "" }) });
    expect(candidates).toHaveLength(2); // non-Google links pass straight through
    expect(unresolved).toHaveLength(0);
    const g = [{ title: "t", link: "https://news.google.com/rss/articles/CBMiXXXXXXXXXXXXXXXXXXXX?oc=5", published: null, publishedIso: null, summary: "" }];
    const r = await newsItemsToCandidates(g, { get: async () => ({ ok: false, body: "" }) });
    expect(r.unresolved).toHaveLength(1);
  });
});

describe("optional search APIs (raw results only)", () => {
  it("never asks for an LLM answer and is skipped without a key", async () => {
    expect(tavilyRequestBody("q").include_answer).toBe(false);
    expect(JSON.stringify(exaRequestBody("q", "2026-09-12"))).not.toMatch(/answer|summary|text/i);
    expect(await searchTavily("q", undefined)).toEqual([]);
    expect(await searchExa("q", "2026-09-12", undefined)).toEqual([]);
  });
  it("maps raw results to candidates and surfaces HTTP errors", async () => {
    const ok = async () => ({ ok: true, status: 200, json: async () => ({ results: [{ url: "https://a.example.com/x?utm_source=z", title: "T", published_date: "2026-10-01", content: "c" }, { title: "no url" }] }) });
    const c = await searchTavily("q", "key", ok);
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ channel: "search_api", canonicalUrl: "https://a.example.com/x", publishedHint: "2026-10-01" });
    await expect(searchExa("q", "2026-09-12", "key", async () => ({ ok: false, status: 401, json: async () => ({}) }))).rejects.toThrow(/401/);
  });
});
