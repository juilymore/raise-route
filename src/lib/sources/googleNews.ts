import type { SourcesConfig } from "@/lib/config";
import { parseFeed } from "./feeds";
import { toCandidate } from "./candidates";
import type { SafeFetcher } from "./fetcher";
import type { Candidate, FeedItem } from "./types";

/**
 * Channel B: Google News RSS per VC (no key). Result links are Google redirect URLs (news.google.com/rss/articles/<id>);
 * decodeGoogleNewsUrl() resolves them to the publisher URL. `when:30d` is only a hint: dates are still verified by the ladder.
 * Verified live 2026-10-12: signature+timestamp page fetch, then the batchexecute "Fbv4je" call returns the publisher URL.
 * This is an undocumented Google endpoint and can change; failure is reported as an unresolved candidate, never as evidence.
 */
export function buildQueries(cfg: SourcesConfig, firm: string, people: string[] = []): string[] {
  const g = cfg.google_news_rss;
  const qs = g.query_templates.map((t) => t.replaceAll("{firm}", firm));
  for (const p of people.slice(0, 2)) qs.push(g.person_query_template.replaceAll("{person}", p).replaceAll("{firm}", firm));
  return qs;
}

export const feedUrlFor = (cfg: SourcesConfig, query: string) => cfg.google_news_rss.url_template.replace("{query}", encodeURIComponent(query));

export const isGoogleNewsLink = (u: string) => /^https?:\/\/news\.google\.com\/(rss\/)?articles\//.test(u);

export function googleArticleId(link: string): string | null {
  const m = link.match(/articles\/([^?/#]+)/);
  return m ? m[1]! : null;
}

/** Old-style ids embed the URL in plain protobuf; try that before any network call. */
export function decodeEmbeddedUrl(id: string): string | null {
  try {
    const raw = Buffer.from(id.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("latin1");
    const m = raw.match(/https?:\/\/[\x21-\x7e]+/);
    return m ? m[0] : null;
  } catch {
    return null;
  }
}

export interface GnDeps {
  /** Page fetch (GET) - goes through the SSRF-safe fetcher. */
  get: (url: string) => Promise<{ ok: boolean; body: string }>;
  /** batchexecute POST. news.google.com is a fixed, trusted host, so a plain fetch is used. */
  post?: (url: string, body: string) => Promise<string>;
}

export async function decodeGoogleNewsUrl(link: string, deps: GnDeps): Promise<string | null> {
  const id = googleArticleId(link);
  if (!id) return null;
  const embedded = decodeEmbeddedUrl(id);
  if (embedded) return embedded;
  const page = await deps.get(`https://news.google.com/rss/articles/${id}`);
  if (!page.ok) return null;
  const sg = page.body.match(/data-n-a-sg="([^"]+)"/)?.[1];
  const ts = page.body.match(/data-n-a-ts="([^"]+)"/)?.[1];
  if (!sg || !ts) return null;
  const inner = `["garturlreq",[["X","X",["X","X"],null,null,1,1,"US:en",null,1,null,null,null,null,null,0,1],"X","X",1,[1,1,1],1,1,null,0,0,null,0],"${id}",${ts},"${sg}"]`;
  const body = "f.req=" + encodeURIComponent(JSON.stringify([[["Fbv4je", inner, null, "generic"]]]));
  const post =
    deps.post ??
    (async (url: string, b: string) => {
      const r = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded;charset=UTF-8", "user-agent": "Mozilla/5.0" },
        body: b,
        redirect: "error", // fixed trusted host: never follow a redirect off it
        signal: AbortSignal.timeout(8000),
      });
      return r.text();
    });
  try {
    const t = await post("https://news.google.com/_/DotsSplashUi/data/batchexecute", body);
    const line = t.split("\n").find((l) => l.startsWith("[["));
    if (!line) return null;
    const url = (JSON.parse(JSON.parse(line)[0][2]) as unknown[])[1];
    return typeof url === "string" && /^https?:\/\//.test(url) ? url : null;
  } catch {
    return null;
  }
}

export interface GnResult {
  query: string;
  ok: boolean;
  error?: string;
  items: FeedItem[];
}

export async function fetchGoogleNews(fetcher: SafeFetcher, cfg: SourcesConfig, query: string): Promise<GnResult> {
  const r = await fetcher.fetch(feedUrlFor(cfg, query), { skipRobots: true }); // an RSS API endpoint, not a crawl target
  if (!r.ok) return { query, ok: false, error: r.error ?? `HTTP ${r.status}`, items: [] };
  try {
    return { query, ok: true, items: parseFeed(r.body).items };
  } catch (e) {
    return { query, ok: false, error: (e as Error).message, items: [] };
  }
}

/** Resolve redirect links to publisher URLs and turn items into candidates (unresolvable ones are returned separately). */
export async function newsItemsToCandidates(
  items: FeedItem[],
  deps: GnDeps,
): Promise<{ candidates: Candidate[]; unresolved: FeedItem[] }> {
  const candidates: Candidate[] = [];
  const unresolved: FeedItem[] = [];
  for (const it of items) {
    const url = isGoogleNewsLink(it.link) ? await decodeGoogleNewsUrl(it.link, deps) : it.link;
    const c = url ? toCandidate({ url, channel: "news_rss", title: it.title, publishedHint: it.publishedIso ?? it.published, sourceName: it.sourceName, snippet: it.summary }) : null;
    if (c) candidates.push(c);
    else unresolved.push(it);
  }
  return { candidates, unresolved };
}
