/** One-off: save a small REAL article page (first resolvable Google News result that is fetchable) as a test fixture. */
import { writeFileSync, mkdirSync } from "node:fs";
import { loadSources } from "../src/lib/config";
import { extractArticle } from "../src/lib/sources/extract";
import { SafeFetcher } from "../src/lib/sources/fetcher";
import { buildQueries, fetchGoogleNews, newsItemsToCandidates } from "../src/lib/sources/googleNews";

async function main() {
const cfg = loadSources();
const f = new SafeFetcher(cfg);
const gn = await fetchGoogleNews(f, cfg, buildQueries(cfg, "Peak XV Partners")[1]!);
const { candidates } = await newsItemsToCandidates(gn.items.slice(0, 12), { get: async (u) => { const r = await f.fetch(u, { skipRobots: true }); return { ok: r.ok, body: r.body }; } });
for (const c of candidates) {
  const r = await f.fetch(c.url);
  console.log(r.ok ? "OK  " : `${r.status || r.errorCode}`, c.url.slice(0, 100));
  if (!r.ok) continue;
  const a = extractArticle(r.body);
  if (a.text.length < 400) continue;
  mkdirSync("fixtures/articles", { recursive: true });
  writeFileSync("fixtures/articles/news_article_sample.html", r.body.slice(0, 400_000));
  writeFileSync("fixtures/articles/news_article_sample.meta.json", JSON.stringify({ url: c.url, fetchedAt: new Date().toISOString(), extractedChars: a.text.length, dates: a.dates }, null, 2));
  console.log("recorded", c.url, "chars", a.text.length, JSON.stringify(a.dates));
  break;
}
}
main().catch((e) => { console.error(e); process.exit(1); });
