/**
 * npm run smoke:sources [-- --write] [-- --record]
 * Tests EVERY configured source against the real internet and prints a table (HTTP status, parses?, #items, newest item date).
 *   --write   sets "status": "DISABLED" in config/sources.json for sector feeds that fail (so we never ship broken sources)
 *   --record  saves small real responses to fixtures/ for deterministic tests
 * Then, for 5 sample VCs, prints the candidate URLs per channel with dates, BEFORE any Gemini call.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { loadSources } from "../src/lib/config";
import { buildAliasIndex } from "../src/lib/engine/entities";
import { daysBetween } from "../src/lib/engine/scoring";
import { discoverOfficialFeed } from "../src/lib/sources/discovery";
import { SafeFetcher } from "../src/lib/sources/fetcher";
import { parseFeed } from "../src/lib/sources/feeds";
import { buildQueries, fetchGoogleNews, newsItemsToCandidates } from "../src/lib/sources/googleNews";
import { fetchSectorFeeds, matchItemsToVcs } from "../src/lib/sources/sectorFeeds";
import { extractArticle } from "../src/lib/sources/extract";
// @ts-expect-error plain JS helper
import { connectOwner } from "./_db.mjs";

const WRITE = process.argv.includes("--write");
const RECORD = process.argv.includes("--record");
const TODAY = new Date().toISOString().slice(0, 10);
const SAMPLE = ["Blume Ventures", "Accel", "Peak XV Partners", "Dynamo Ventures", "Lightspeed India"];

const cfg = loadSources();
const fetcher = new SafeFetcher(cfg);
const pad = (s: unknown, n: number) => String(s ?? "").slice(0, n).padEnd(n);
const line = (...cols: Array<[unknown, number]>) => console.log(cols.map(([v, n]) => pad(v, n)).join(" "));

async function main() {
  console.log(`\n=== Smoke test ${TODAY} (user agent: ${cfg.fetch.user_agent}) ===\n`);

  // ---- sector feeds (channel C)
  console.log("SECTOR FEEDS (push channel)");
  line(["name", 22], ["HTTP", 5], ["parses", 7], ["items", 6], ["newest", 11], ["age(d)", 7], ["verdict", 10], ["note", 30]);
  const { items: sectorItems, health } = await fetchSectorFeeds(fetcher, cfg);
  const verdicts = new Map<string, "OK" | "FAILING">();
  for (const h of health) {
    const age = h.newest ? daysBetween(h.newest, TODAY) : null;
    const ok = h.ok && h.status === 200 && age !== null && age <= 90;
    verdicts.set(h.url, ok ? "OK" : "FAILING");
    line([h.name, 22], [h.status, 5], [h.ok, 7], [h.items, 6], [h.newest ?? "-", 11], [age ?? "-", 7], [ok ? "OK" : "FAILING", 10], [h.error ?? "", 30]);
  }
  if (WRITE) {
    const raw = JSON.parse(readFileSync("config/sources.json", "utf8"));
    for (const f of raw.sector_feeds_push_model) {
      f.status = verdicts.get(f.url) === "OK" ? "OK" : "DISABLED";
      f.last_smoke_test = TODAY;
    }
    writeFileSync("config/sources.json", JSON.stringify(raw, null, 2) + "\n");
    console.log("\nconfig/sources.json updated (failing feeds -> DISABLED).");
  }

  // ---- 5 sample VCs from the real DB
  const client = await connectOwner();
  const { rows } = await client.query(
    "select id, slug, firm, aliases, tracked_people, website from public.vc_pipeline where firm = any($1) order by firm",
    [SAMPLE],
  );
  const { rows: all } = await client.query("select id, firm, aliases, tracked_people from public.vc_pipeline");
  await client.end();
  const index = buildAliasIndex(all.map((r: any) => ({ id: r.id, firm: r.firm, aliases: r.aliases, tracked_people: r.tracked_people }))); // eslint-disable-line @typescript-eslint/no-explicit-any
  const matched = matchItemsToVcs(sectorItems, index);
  console.log(`\nSector items fetched: ${sectorItems.length}; items matching any of the 50 VCs: ${[...matched.values()].reduce((a, b) => a + b.length, 0)}`);

  const gnDeps = {
    get: async (u: string) => {
      const r = await fetcher.fetch(u, { skipRobots: true });
      return { ok: r.ok, body: r.body };
    },
  };
  const summary: Array<{ firm: string; A: string; B: string; C: string }> = [];

  for (const vc of rows as any[]) { // eslint-disable-line @typescript-eslint/no-explicit-any
    console.log(`\n--- ${vc.firm} (${vc.website}) ---`);
    // A: official feed
    const d = await discoverOfficialFeed(fetcher, cfg, vc.website);
    if (d.feed) {
      console.log(`A official feed: ${d.feed.url} (${d.feed.via}, ${d.feed.items.length} items, newest ${d.feed.newest ?? "?"})`);
      for (const it of d.feed.items.slice(0, 3)) console.log(`   ${it.publishedIso ?? "no-date"}  ${it.title.slice(0, 80)}  ${it.link}`);
    } else {
      console.log(`A official feed: none found (homepage ${d.homepage.ok ? "ok" : `FAILED ${d.homepage.error ?? d.homepage.status}`}; probed ${d.tried.length} URLs)`);
    }
    // B: Google News
    let bTotal = 0;
    let bOkQueries = 0;
    const queries = buildQueries(cfg, vc.firm, vc.tracked_people.slice(0, 1));
    const bCands = [];
    for (const q of queries.slice(0, 2)) {
      const gn = await fetchGoogleNews(fetcher, cfg, q);
      if (gn.ok) bOkQueries++;
      const recent = gn.items.filter((i) => i.publishedIso && daysBetween(i.publishedIso, TODAY) <= 30).slice(0, 4);
      const { candidates, unresolved } = await newsItemsToCandidates(recent, gnDeps);
      bTotal += gn.items.length;
      bCands.push(...candidates);
      console.log(`B news query ${gn.ok ? "ok" : "FAILED " + gn.error}: ${gn.items.length} items (${recent.length} in last 30d, ${candidates.length} resolved, ${unresolved.length} unresolved)`);
    }
    for (const c of bCands.slice(0, 5)) console.log(`   ${String(c.publishedHint).slice(0, 10)}  ${c.sourceName ?? ""}  ${c.title?.slice(0, 70)}\n      ${c.url}`);
    // C: sector feeds
    const cItems = matched.get(vc.id) ?? [];
    console.log(`C sector feeds: ${cItems.length} matching items`);
    for (const it of cItems.slice(0, 3)) console.log(`   ${it.publishedIso ?? "no-date"}  [${it.feedName}] ${it.title.slice(0, 80)}`);
    summary.push({ firm: vc.firm, A: d.feed ? "ok" : "none", B: `${bOkQueries}/2 queries ok, ${bTotal} items`, C: `${cItems.length} items` });

    if (RECORD && vc.firm === "Peak XV Partners" && bCands[0]) {
      mkdirSync("fixtures/articles", { recursive: true });
      const art = await fetcher.fetch(bCands[0].url);
      if (art.ok) {
        const a = extractArticle(art.body);
        writeFileSync("fixtures/articles/news_article_sample.html", art.body.slice(0, 60_000));
        console.log(`   recorded article fixture (${art.body.length} bytes; extracted ${a.text.length} chars; dates ${JSON.stringify(a.dates)})`);
      }
    }
  }

  console.log("\nSUMMARY (per-VC channels)");
  line(["VC", 20], ["A official", 12], ["B news", 32], ["C sector", 12]);
  for (const s of summary) line([s.firm, 20], [s.A, 12], [s.B, 32], [s.C, 12]);

  if (RECORD) {
    mkdirSync("fixtures/feeds", { recursive: true });
    const first = cfg.sector_feeds_push_model.find((f) => verdicts.get(f.url) === "OK");
    if (first) {
      const r = await fetcher.fetch(first.url, { skipRobots: true, useCache: true });
      const items = (r.body.match(/<item>[\s\S]*?<\/item>/g) ?? []).slice(0, 3).join("\n");
      const head = r.body.slice(0, r.body.indexOf("<item>"));
      writeFileSync("fixtures/feeds/sector_feed_sample.xml", `${head}${items}\n</channel></rss>\n`);
    }
    const gn = await fetcher.fetch(`https://news.google.com/rss/search?q=${encodeURIComponent('"Peak XV" when:30d')}&hl=en-IN&gl=IN&ceid=IN:en`, { skipRobots: true, useCache: false });
    if (gn.ok) {
      const items = (gn.body.match(/<item>[\s\S]*?<\/item>/g) ?? []).slice(0, 3).join("\n");
      writeFileSync("fixtures/feeds/google_news_sample.xml", `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>fixture</title>${items}</channel></rss>\n`);
      parseFeed(readFileSync("fixtures/feeds/google_news_sample.xml", "utf8"));
    }
    console.log("\nfixtures recorded under fixtures/ (real responses, truncated).");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
