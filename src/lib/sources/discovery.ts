import type { SourcesConfig } from "@/lib/config";
import { discoverFeedLinks, newestDate, parseFeed, youtubeFeedFromHtml } from "./feeds";
import type { SafeFetcher } from "./fetcher";
import type { FeedItem } from "./types";

/**
 * Channel A: official feed auto-discovery for one VC website.
 * Order: <link rel=alternate> on the homepage -> YouTube channel feed linked from the page -> probe_paths.
 * A feed only counts if it parses AND has at least one item. Health goes to source_registry (see recordHealth in the pipeline).
 */
export interface DiscoveredFeed {
  url: string;
  kind: "rss" | "atom" | "youtube_rss";
  items: FeedItem[];
  newest: string | null;
  via: "link_rel" | "youtube" | "probe";
}

export interface DiscoveryResult {
  website: string;
  homepage: { ok: boolean; status: number; error?: string };
  feed: DiscoveredFeed | null;
  tried: string[];
}

async function tryFeed(fetcher: SafeFetcher, url: string, via: DiscoveredFeed["via"]): Promise<DiscoveredFeed | null> {
  const r = await fetcher.fetch(url, { skipRobots: via === "youtube" });
  if (!r.ok) return null;
  try {
    const f = parseFeed(r.body);
    if (f.items.length === 0) return null;
    return { url: r.finalUrl, kind: via === "youtube" ? "youtube_rss" : f.kind, items: f.items, newest: newestDate(f.items), via };
  } catch {
    return null; // an HTML 200 on a probe path is not a feed
  }
}

export async function discoverOfficialFeed(fetcher: SafeFetcher, cfg: SourcesConfig, website: string): Promise<DiscoveryResult> {
  const site = /^https?:\/\//.test(website) ? website : `https://${website}`;
  const tried: string[] = [];
  const home = await fetcher.fetch(site);
  const homepage = { ok: home.ok, status: home.status, error: home.error };
  const candidates: Array<{ url: string; via: DiscoveredFeed["via"] }> = [];
  if (home.ok) {
    for (const u of discoverFeedLinks(home.body, home.finalUrl, cfg.official_feed_discovery.link_rel_alternate_types)) candidates.push({ url: u, via: "link_rel" });
    const yt = youtubeFeedFromHtml(home.body);
    if (yt) candidates.push({ url: yt, via: "youtube" });
  }
  const base = home.ok ? home.finalUrl : site;
  for (const p of cfg.official_feed_discovery.probe_paths) {
    try {
      candidates.push({ url: new URL(p, base).toString(), via: "probe" });
    } catch {
      /* skip */
    }
  }
  for (const c of candidates) {
    if (tried.includes(c.url)) continue;
    tried.push(c.url);
    const f = await tryFeed(fetcher, c.url, c.via);
    if (f) return { website: site, homepage, feed: f, tried };
    if (c.via === "probe" && tried.filter((t) => !t.includes("youtube")).length >= 8 && !home.ok) break; // site is down: stop probing
  }
  return { website: site, homepage, feed: null, tried };
}
