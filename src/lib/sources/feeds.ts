import * as cheerio from "cheerio";
import { XMLParser } from "fast-xml-parser";
import { parseDate } from "@/lib/engine/dates";
import type { FeedItem } from "./types";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  parseTagValue: false,
  trimValues: true,
  processEntities: true,
});

const arr = <T>(v: T | T[] | undefined): T[] => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);
const text = (v: unknown): string => {
  if (v === undefined || v === null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (typeof v === "object" && "#text" in (v as object)) return text((v as Record<string, unknown>)["#text"]);
  return "";
};
const stripHtml = (s: string) => cheerio.load(`<div>${s}</div>`)("div").text().replace(/\s+/g, " ").trim();

export interface ParsedFeed {
  kind: "rss" | "atom";
  title: string;
  items: FeedItem[];
}

/** Parse RSS 2.0, RSS 1.0 (RDF) and Atom into a common shape. Throws if the document is not a feed. */
export function parseFeed(xml: string): ParsedFeed {
  const doc = parser.parse(xml) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  if (doc.rss?.channel) {
    const ch = Array.isArray(doc.rss.channel) ? doc.rss.channel[0] : doc.rss.channel;
    const items = arr(ch.item).map((it: Record<string, any>): FeedItem => { // eslint-disable-line @typescript-eslint/no-explicit-any
      const published = text(it.pubDate) || text(it["dc:date"]) || null;
      const src = it.source;
      return {
        title: stripHtml(text(it.title)),
        link: text(it.link).trim() || text(it.guid).trim(),
        published,
        publishedIso: parseDate(published),
        summary: stripHtml(text(it.description) || text(it["content:encoded"])).slice(0, 600),
        sourceName: src ? text(src) || undefined : undefined,
        sourceUrl: src && typeof src === "object" ? (src["@_url"] as string | undefined) : undefined,
      };
    });
    return { kind: "rss", title: stripHtml(text(ch.title)), items };
  }
  if (doc["rdf:RDF"]) {
    const rdf = doc["rdf:RDF"];
    const items = arr(rdf.item).map((it: Record<string, any>): FeedItem => { // eslint-disable-line @typescript-eslint/no-explicit-any
      const published = text(it["dc:date"]) || null;
      return { title: stripHtml(text(it.title)), link: text(it.link), published, publishedIso: parseDate(published), summary: stripHtml(text(it.description)).slice(0, 600) };
    });
    return { kind: "rss", title: stripHtml(text(rdf.channel?.title)), items };
  }
  if (doc.feed) {
    const f = doc.feed;
    const items = arr(f.entry).map((e: Record<string, any>): FeedItem => { // eslint-disable-line @typescript-eslint/no-explicit-any
      const links = arr(e.link) as Array<Record<string, string> | string>;
      const alt = links.find((l) => typeof l === "object" && (l["@_rel"] === "alternate" || !l["@_rel"])) ?? links[0];
      const link = typeof alt === "string" ? alt : (alt?.["@_href"] ?? "");
      const published = text(e.published) || text(e.updated) || null; // Atom <updated> is a last resort; <published> wins
      return {
        title: stripHtml(text(e.title)),
        link,
        published,
        publishedIso: parseDate(published),
        summary: stripHtml(text(e.summary) || text(e.content)).slice(0, 600),
      };
    });
    return { kind: "atom", title: stripHtml(text(f.title)), items };
  }
  throw new Error("not an RSS/Atom feed");
}

export function newestDate(items: FeedItem[]): string | null {
  const ds = items.map((i) => i.publishedIso).filter((d): d is string => !!d);
  return ds.length ? ds.reduce((a, b) => (a > b ? a : b)) : null;
}

/** <link rel="alternate" type="application/rss+xml|atom+xml"> feed URLs advertised by an HTML page. */
export function discoverFeedLinks(html: string, baseUrl: string, types: string[]): string[] {
  const $ = cheerio.load(html);
  const out: string[] = [];
  $('link[rel~="alternate"]').each((_, el) => {
    const type = ($(el).attr("type") ?? "").toLowerCase();
    const href = $(el).attr("href");
    if (!href || !types.some((t) => type.includes(t))) return;
    try {
      out.push(new URL(href, baseUrl).toString());
    } catch {
      /* ignore malformed href */
    }
  });
  return [...new Set(out)];
}

/** YouTube channel id found in page links, e.g. youtube.com/channel/UCxxxx -> its public RSS feed URL. */
export function youtubeFeedFromHtml(html: string): string | null {
  const m = html.match(/youtube\.com\/channel\/(UC[\w-]{20,})/);
  return m ? `https://www.youtube.com/feeds/videos.xml?channel_id=${m[1]}` : null;
}
