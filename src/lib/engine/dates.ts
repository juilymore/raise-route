import * as cheerio from "cheerio";
import { daysBetween } from "./scoring";

/**
 * Date resolution ladder (docs/05 section 3). event_date != published_at != retrieved_at.
 * NEVER used as an event date: dateModified, fetch time, "today", a search engine's age label.
 */
export type DateBasis = "structured_metadata" | "published_date" | "explicit_in_text";

export interface ResolvedDate {
  date: string; // yyyy-mm-dd
  basis: DateBasis;
  rung: 1 | 2 | 3 | 4 | 5 | 6;
  source: string;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const pad = (n: number) => String(n).padStart(2, "0");

function valid(y: number, m: number, d: number): string | null {
  if (y < 1990 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** Parse ISO-8601, RFC-822 (RSS pubDate) and "12 October 2026" / "Oct 12, 2026" into yyyy-mm-dd, or null. Never guesses. */
export function parseDate(input: string | null | undefined): string | null {
  if (!input) return null;
  const s = input.trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s]|$)/);
  if (m) {
    // Take the calendar date as written (publisher's date). Timezone shifts of hours must not change the day silently.
    return valid(+m[1]!, +m[2]!, +m[3]!);
  }
  m = s.match(/^(?:[A-Za-z]{3,9},?\s+)?(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})/);
  if (m) {
    const mi = MONTHS.indexOf(m[2]!.slice(0, 3).toLowerCase());
    return mi >= 0 ? valid(+m[3]!, mi + 1, +m[1]!) : null;
  }
  m = s.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})/);
  if (m) {
    const mi = MONTHS.indexOf(m[1]!.slice(0, 3).toLowerCase());
    return mi >= 0 ? valid(+m[3]!, mi + 1, +m[2]!) : null;
  }
  return null;
}

/** /YYYY/MM/DD/ in a URL path (rung 5, lower certainty). */
export function dateFromUrl(url: string): string | null {
  const m = url.match(/\/((?:19|20)\d{2})\/(\d{1,2})\/(\d{1,2})(?:\/|$|[-_.?#])/);
  return m ? valid(+m[1]!, +m[2]!, +m[3]!) : null;
}

type Json = unknown;
function* walkJsonLd(node: Json): Generator<Record<string, unknown>> {
  if (Array.isArray(node)) {
    for (const n of node) yield* walkJsonLd(n);
  } else if (node && typeof node === "object") {
    const o = node as Record<string, unknown>;
    yield o;
    if (o["@graph"]) yield* walkJsonLd(o["@graph"]);
  }
}

export interface PageDates {
  jsonLdPublished: string | null;
  jsonLdModified: string | null;
  metaPublished: string | null;
  metaModified: string | null;
  timeTag: string | null;
}

/** Pull every date-ish signal out of an HTML page. Pure (no network). */
export function extractPageDates(html: string): PageDates {
  const $ = cheerio.load(html);
  let jsonLdPublished: string | null = null;
  let jsonLdModified: string | null = null;
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const data = JSON.parse($(el).contents().text());
      for (const o of walkJsonLd(data)) {
        const type = String(o["@type"] ?? "");
        if (!/Article|NewsArticle|BlogPosting|Report|WebPage|Event|Podcast|VideoObject/i.test(type)) continue;
        jsonLdPublished ??= parseDate(typeof o.datePublished === "string" ? o.datePublished : null);
        jsonLdModified ??= parseDate(typeof o.dateModified === "string" ? o.dateModified : null);
      }
    } catch {
      /* malformed JSON-LD is common; ignore */
    }
  });
  const meta = (sel: string) => parseDate($(sel).first().attr("content"));
  const metaPublished =
    meta('meta[property="article:published_time"]') ??
    meta('meta[property="og:published_time"]') ??
    meta('meta[itemprop="datePublished"]') ??
    parseDate($('[itemprop="datePublished"]').first().attr("content") ?? $('[itemprop="datePublished"]').first().attr("datetime"));
  const metaModified =
    meta('meta[property="article:modified_time"]') ?? meta('meta[property="og:updated_time"]') ?? meta('meta[itemprop="dateModified"]');
  const timeTag = parseDate($("article time[datetime], header time[datetime], main time[datetime]").first().attr("datetime"));
  return { jsonLdPublished, jsonLdModified, metaPublished, metaModified, timeTag };
}

export interface LadderInput {
  page?: Partial<PageDates>;
  feedPublished?: string | null; // RSS/Atom pubDate/published, already ISO or RFC-822
  url?: string;
  modelExplicitDate?: string | null; // only when Gemini says event_date_basis = explicit_in_text
}

/** Walk the ladder top to bottom; the first rung that yields a valid date wins. null => DATE_UNVERIFIED. */
export function resolveDate(i: LadderInput): ResolvedDate | null {
  const p = i.page ?? {};
  if (p.jsonLdPublished) return { date: p.jsonLdPublished, basis: "structured_metadata", rung: 1, source: "json-ld datePublished" };
  if (p.metaPublished) return { date: p.metaPublished, basis: "structured_metadata", rung: 2, source: "meta published_time" };
  const feed = parseDate(i.feedPublished);
  if (feed) return { date: feed, basis: "published_date", rung: 3, source: "feed pubDate" };
  if (p.timeTag) return { date: p.timeTag, basis: "published_date", rung: 4, source: "time[datetime]" };
  const fromUrl = i.url ? dateFromUrl(i.url) : null;
  if (fromUrl) return { date: fromUrl, basis: "published_date", rung: 5, source: "url path" };
  const model = parseDate(i.modelExplicitDate);
  if (model) return { date: model, basis: "explicit_in_text", rung: 6, source: "explicit in text (model)" };
  return null;
}

export interface WindowCheck {
  ok: boolean;
  ageDays: number;
  code?: "OLD_EVENT" | "FUTURE_DATE";
}

/** V5: -tolerance <= age <= window. age = runDate - eventDate. */
export function checkWindow(eventDate: string, runDate: string, windowDays: number, futureToleranceDays: number): WindowCheck {
  const age = daysBetween(eventDate, runDate);
  if (age < -futureToleranceDays) return { ok: false, ageDays: age, code: "FUTURE_DATE" };
  if (age > windowDays) return { ok: false, ageDays: age, code: "OLD_EVENT" };
  return { ok: true, ageDays: age };
}

/** V6: old datePublished with a recent dateModified is an old article resurfacing. Only datePublished counts as the event date. */
export function isResurfaced(published: string | null, modified: string | null, runDate: string, windowDays: number): boolean {
  if (!published || !modified) return false;
  return daysBetween(published, runDate) > windowDays && daysBetween(modified, runDate) <= windowDays;
}

/**
 * V4: coherence between the model's event_date and the published date.
 * - model date later than published + 1 day  -> DATE_INCOHERENT
 * - model date > 14 days before published     -> cap with the published date (reduces recency, never inflates it)
 */
export function reconcileEventDate(
  modelEventDate: string | null,
  publishedDate: string,
): { ok: true; eventDate: string; capped: boolean } | { ok: false; code: "DATE_INCOHERENT" } {
  if (!modelEventDate) return { ok: true, eventDate: publishedDate, capped: false };
  const diff = daysBetween(publishedDate, modelEventDate); // positive => model date after published
  if (diff > 1) return { ok: false, code: "DATE_INCOHERENT" };
  if (diff < -14) return { ok: true, eventDate: publishedDate, capped: true };
  return { ok: true, eventDate: modelEventDate, capped: false };
}
