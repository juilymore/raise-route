import { describe, expect, it } from "vitest";
import { checkWindow, dateFromUrl, extractPageDates, isResurfaced, parseDate, reconcileEventDate, resolveDate } from "@/lib/engine/dates";
import { v3DateResolved, v4DateCoherence, v5Window, v6NotResurfaced } from "@/lib/engine/validators";

const TODAY = "2026-10-12";
const cfg = { window_days: 30, future_date_tolerance_days: 1 };

describe("parseDate", () => {
  it("parses ISO, RFC-822 and prose dates and never guesses", () => {
    expect(parseDate("2026-10-07T09:30:00+05:30")).toBe("2026-10-07");
    expect(parseDate("Tue, 06 Oct 2026 08:00:00 GMT")).toBe("2026-10-06");
    expect(parseDate("12 October 2026")).toBe("2026-10-12");
    expect(parseDate("Oct 3, 2026")).toBe("2026-10-03");
    expect(parseDate("2026-02-31")).toBeNull();
    expect(parseDate("yesterday")).toBeNull();
    expect(parseDate("")).toBeNull();
    expect(parseDate(null)).toBeNull();
  });
  it("reads /YYYY/MM/DD/ from URLs", () => {
    expect(dateFromUrl("https://x.com/2026/10/05/post-title")).toBe("2026-10-05");
    expect(dateFromUrl("https://x.com/blog/post-2026")).toBeNull();
  });
});

describe("window (V5)", () => {
  it("a 31-day-old event is rejected as OLD_EVENT; exactly 30 days is accepted", () => {
    expect(v5Window("2026-09-11", TODAY, cfg)).toMatchObject({ ok: false, code: "OLD_EVENT" });
    expect(v5Window("2026-09-12", TODAY, cfg)).toMatchObject({ ok: true, ageDays: 30 });
  });
  it("a +3 day future date is rejected as FUTURE_DATE; +1 is tolerated", () => {
    expect(v5Window("2026-10-15", TODAY, cfg)).toMatchObject({ ok: false, code: "FUTURE_DATE" });
    expect(v5Window("2026-10-13", TODAY, cfg)).toMatchObject({ ok: true });
    expect(checkWindow("2026-10-12", TODAY, 30, 1).ok).toBe(true);
  });
});

describe("date ladder (V3) and dateModified rules", () => {
  const html = (head: string) => `<html><head>${head}</head><body><article><h1>t</h1></article></body></html>`;
  it("JSON-LD datePublished is rung 1 and wins over everything", () => {
    const page = extractPageDates(html(`<script type="application/ld+json">{"@type":"NewsArticle","datePublished":"2026-10-05T10:00:00Z","dateModified":"2026-10-11"}</script><meta property="article:published_time" content="2026-09-01">`));
    const r = resolveDate({ page, feedPublished: "Wed, 07 Oct 2026 00:00:00 GMT", url: "https://a.com/2026/08/01/x" });
    expect(r).toMatchObject({ date: "2026-10-05", basis: "structured_metadata", rung: 1 });
  });
  it("handles JSON-LD @graph and ignores malformed JSON-LD", () => {
    const g = extractPageDates(html(`<script type="application/ld+json">{"@graph":[{"@type":"Organization"},{"@type":"BlogPosting","datePublished":"2026-10-02"}]}</script>`));
    expect(g.jsonLdPublished).toBe("2026-10-02");
    const bad = extractPageDates(html(`<script type="application/ld+json">{not json</script>`));
    expect(bad.jsonLdPublished).toBeNull();
  });
  it("falls through meta -> feed -> <time> -> URL -> explicit model date in that order", () => {
    expect(resolveDate({ page: extractPageDates(html(`<meta property="article:published_time" content="2026-10-04">`)) })).toMatchObject({ rung: 2, date: "2026-10-04" });
    expect(resolveDate({ feedPublished: "2026-10-03T00:00:00Z" })).toMatchObject({ rung: 3, basis: "published_date" });
    const t = extractPageDates(`<article><time datetime="2026-10-02">x</time></article>`);
    expect(resolveDate({ page: t })).toMatchObject({ rung: 4 });
    expect(resolveDate({ url: "https://a.com/2026/10/01/p" })).toMatchObject({ rung: 5 });
    expect(resolveDate({ modelExplicitDate: "2026-09-30" })).toMatchObject({ rung: 6, basis: "explicit_in_text" });
  });
  it("dateModified ALONE never produces an event date => DATE_UNVERIFIED", () => {
    const page = extractPageDates(html(`<meta property="article:modified_time" content="2026-10-10"><script type="application/ld+json">{"@type":"Article","dateModified":"2026-10-10"}</script>`));
    expect(page.jsonLdModified).toBe("2026-10-10");
    expect(page.jsonLdPublished).toBeNull();
    const r = resolveDate({ page });
    expect(r).toBeNull();
    expect(v3DateResolved(r)).toMatchObject({ ok: false, code: "DATE_UNVERIFIED" });
  });
  it("old datePublished + recent dateModified is a resurfaced (OLD) article (V6)", () => {
    expect(isResurfaced("2023-04-01", "2026-10-09", TODAY, 30)).toBe(true);
    expect(v6NotResurfaced("2023-04-01", "2026-10-09", TODAY, 30)).toMatchObject({ ok: false, code: "OLD_EVENT" });
    expect(v6NotResurfaced("2026-10-05", "2026-10-09", TODAY, 30).ok).toBe(true);
    expect(v6NotResurfaced("2023-04-01", "2023-05-01", TODAY, 30).ok).toBe(true);
  });
});

describe("date coherence (V4)", () => {
  it("model date after published+1d is incoherent", () => {
    expect(v4DateCoherence("2026-10-09", "2026-10-05")).toMatchObject({ ok: false, code: "DATE_INCOHERENT" });
  });
  it("model date within 1 day after published is accepted", () => {
    expect(reconcileEventDate("2026-10-06", "2026-10-05")).toMatchObject({ ok: true, eventDate: "2026-10-06" });
  });
  it("model date >14d before published is capped to the published date (cannot inflate recency)", () => {
    expect(reconcileEventDate("2026-09-01", "2026-10-05")).toEqual({ ok: true, eventDate: "2026-10-05", capped: true });
  });
  it("no model date uses the published date", () => {
    expect(reconcileEventDate(null, "2026-10-05")).toEqual({ ok: true, eventDate: "2026-10-05", capped: false });
  });
});
