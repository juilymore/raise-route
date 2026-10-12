export type Channel = "official_feed" | "news_rss" | "sector_feed" | "grounded_search" | "search_api";

export type SourceType =
  | "official_site" | "official_blog" | "portfolio_announcement" | "reputable_news" | "trade_press"
  | "podcast" | "video" | "event_page" | "social" | "other";

/** A URL worth fetching for one VC, with whatever the discovering channel already knew about it. */
export interface Candidate {
  url: string;
  canonicalUrl: string;
  channel: Channel;
  title?: string;
  /** Raw date hint from the channel (feed pubDate etc). Never an event date by itself. */
  publishedHint?: string | null;
  sourceName?: string;
  snippet?: string;
}

export interface FeedItem {
  title: string;
  link: string;
  /** Raw pubDate/published/updated string as found in the feed. */
  published: string | null;
  /** yyyy-mm-dd if the raw date parsed, else null. */
  publishedIso: string | null;
  summary: string;
  sourceName?: string;
  sourceUrl?: string;
}

export interface FetchResult {
  ok: boolean;
  status: number;
  url: string;
  finalUrl: string;
  contentType: string;
  body: string;
  truncated: boolean;
  redirects: string[];
  /** SSRF_BLOCKED | ROBOTS_DISALLOWED | TIMEOUT | TOO_LARGE | NETWORK | HTTP | REDIRECT_LOOP */
  errorCode?: string;
  error?: string;
}
