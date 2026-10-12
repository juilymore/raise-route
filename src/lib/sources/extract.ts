import * as cheerio from "cheerio";
import { extractPageDates, type PageDates } from "@/lib/engine/dates";

export interface Article {
  title: string;
  headings: string[];
  text: string;
  dates: PageDates;
  canonicalUrl: string | null;
  htmlLang: string | null;
}

const NOISE = "script, style, noscript, nav, footer, aside, form, iframe, svg, header nav, [role=navigation], [role=banner], [aria-hidden=true], .cookie, .newsletter, .share, .related";
export const MAX_TEXT_CHARS = 20_000;

/** Main-text extraction: prefer <article>/<main>, strip chrome, keep title and headings. Pure; no network. */
export function extractArticle(html: string): Article {
  const dates = extractPageDates(html); // read dates BEFORE stripping scripts (JSON-LD lives in <script>)
  const $ = cheerio.load(html);
  const title = ($('meta[property="og:title"]').attr("content") ?? $("title").first().text() ?? $("h1").first().text() ?? "").replace(/\s+/g, " ").trim();
  const canonicalUrl = $('link[rel="canonical"]').attr("href")?.trim() ?? null;
  const htmlLang = $("html").attr("lang")?.trim() ?? null;
  $(NOISE).remove();
  const root = [$("article").first(), $("main").first(), $("[role=main]").first()].find((n) => n.length && n.text().trim().length > 200) ?? $("body");
  const headings = root.find("h1, h2, h3").map((_, el) => $(el).text().replace(/\s+/g, " ").trim()).get().filter(Boolean).slice(0, 20);
  const blocks = root
    .find("p, li, h1, h2, h3, h4, blockquote, td, figcaption")
    .map((_, el) => $(el).text().replace(/\s+/g, " ").trim())
    .get()
    .filter((t) => t.length > 0);
  // If the page has no block elements at all (rare), fall back to the raw text.
  let text = blocks.length ? blocks.join("\n") : root.text().replace(/\s+/g, " ").trim();
  if (text.length > MAX_TEXT_CHARS) text = text.slice(0, MAX_TEXT_CHARS);
  return { title, headings, text, dates, canonicalUrl, htmlLang };
}
