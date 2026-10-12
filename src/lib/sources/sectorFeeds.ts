import type { SourcesConfig } from "@/lib/config";
import { findMentions, hasContextWords, isAmbiguousAlias, type AliasIndex } from "@/lib/engine/entities";
import { newestDate, parseFeed } from "./feeds";
import { toCandidate } from "./candidates";
import type { SafeFetcher } from "./fetcher";
import type { Candidate, FeedItem } from "./types";

/**
 * Channel C: the push model. Fetch every global sector/news feed ONCE per run, then match items to VC aliases with the
 * alias index (whole-word, collision-safe). One fetch serves all 50 VCs.
 */
export interface SectorFeedHealth {
  name: string;
  url: string;
  ok: boolean;
  status: number;
  items: number;
  newest: string | null;
  error?: string;
}

export interface SectorItem extends FeedItem {
  feedName: string;
}

export function enabledSectorFeeds(cfg: SourcesConfig) {
  return cfg.sector_feeds_push_model.filter((f) => (f as { status?: string }).status !== "DISABLED");
}

export async function fetchSectorFeeds(fetcher: SafeFetcher, cfg: SourcesConfig): Promise<{ items: SectorItem[]; health: SectorFeedHealth[] }> {
  const items: SectorItem[] = [];
  const health: SectorFeedHealth[] = [];
  for (const f of enabledSectorFeeds(cfg)) {
    const r = await fetcher.fetch(f.url, { skipRobots: true });
    if (!r.ok) {
      health.push({ name: f.name, url: f.url, ok: false, status: r.status, items: 0, newest: null, error: r.error });
      continue;
    }
    try {
      const parsed = parseFeed(r.body);
      health.push({ name: f.name, url: f.url, ok: parsed.items.length > 0, status: r.status, items: parsed.items.length, newest: newestDate(parsed.items) });
      for (const it of parsed.items) items.push({ ...it, feedName: f.name });
    } catch (e) {
      health.push({ name: f.name, url: f.url, ok: false, status: r.status, items: 0, newest: null, error: (e as Error).message });
    }
  }
  return { items, health };
}

/** Items whose title/summary mention a VC (ambiguous aliases need VC-context words nearby). */
export function matchItemsToVcs(items: SectorItem[], index: AliasIndex): Map<string, SectorItem[]> {
  const byVc = new Map<string, SectorItem[]>();
  for (const it of items) {
    const hay = `${it.title}\n${it.summary}`;
    const vcs = new Set<string>();
    for (const m of findMentions(hay, index)) {
      if (isAmbiguousAlias(m.alias) && !hasContextWords(hay, m.index, m.alias.length)) continue;
      vcs.add(m.vcId);
    }
    for (const id of vcs) byVc.set(id, [...(byVc.get(id) ?? []), it]);
  }
  return byVc;
}

export function sectorItemsToCandidates(items: SectorItem[]): Candidate[] {
  return items
    .map((it) => (it.link ? toCandidate({ url: it.link, channel: "sector_feed", title: it.title, publishedHint: it.publishedIso ?? it.published, sourceName: it.feedName, snippet: it.summary }) : null))
    .filter((c): c is Candidate => c !== null);
}
