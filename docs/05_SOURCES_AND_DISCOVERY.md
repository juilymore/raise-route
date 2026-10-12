# 05 · Sources & Discovery  (exam rule E1: *use live external data wherever possible*)

Config lives in `config/sources.json` (every URL is a *hint* with `verify: true` — smoke-test in phase P03 and **disable** failing ones). Never scrape LinkedIn or X/Twitter (ToS, fragile, and the exam doesn't need them).

## 1. Channels (cheapest/most reliable first)
| # | Channel | How | Strengths | Weaknesses / guardrails |
|---|---|---|---|---|
| A | **Official feeds** (`rss`/`atom`/`youtube_rss`/`podcast_rss`) | Per VC: read `<link rel=alternate>` on the website, probe `probe_paths`, YouTube channel RSS, podcast RSS. Store in `source_registry` with health. | Primary source ⇒ top evidence quality; exact dates | Not every VC has a blog; feeds break (track `consecutive_failures`) |
| B | **Google News RSS** per VC | 2 queries from `google_news_rss.query_templates` (+1 per tracked person), `when:30d`. Resolve redirect links to publisher URL. | Free, no key, broad press coverage | Redirect URLs; `when:` is a hint only; verify dates yourself; be polite (1 req/s) |
| C | **Sector feeds — push model** | Fetch the 9 global sector/news feeds **once per run**; match items to VC aliases with the alias index; cache items in `app_settings['run:<id>:sector_items']` | 1 fetch serves 50 VCs; catches funding news | Needs entity-matching discipline (§4) |
| D | **Gemini grounded search** (`googleSearch`) | See `docs/04 §4`. Harvest grounding URLs only. | Finds what RSS can't (talks, podcasts, small blogs) | Not free on Gemini 3.x; billed per search; budget & only for weak-coverage / high-fit VCs |
| E | *(optional)* **Tavily / Exa** | Raw results only, date-filtered (`days=30`, `topic=news` / `startPublishedDate`), `include_answer=false`. | Extra recall | **Never use their LLM/answer endpoints** (exam: Gemini only). Free credits are small |
| F | *(M3)* **Portfolio-diff** | Snapshot hash + entity list of a fund's portfolio page; new entry ⇒ `portfolio_activity` with `event_date_basis = first_observed` | Direct investment evidence | Date = first observed, not announcement ⇒ lower evidence points; needs a dated confirmation to be strong |

**Per-VC task budget** (`max_pages_per_vc_per_run = 12`): take all candidates from A–E, canonicalise URLs (strip tracking params, lower-case host, resolve redirects), drop those already stored for this VC (`unique(vc_id, canonical_url)` — only re-process if content hash changed), rank by (primary domain first, newest published hint, relevance keyword hit in title), keep top 12. Previously-extracted candidates are **not** re-sent to Gemini (saves quota); their signals simply age in/out of the 30-day window each run.

## 2. Fetching rules (C7)
SSRF guard on every hop: only http/https; resolve DNS and reject private/loopback/link-local/metadata ranges (10/8, 172.16/12, 192.168/16, 127/8, 169.254/16, ::1, fc00::/7…) **including after each redirect**; max 4 redirects; 8 s timeout; 1.5 MB cap; honour `robots.txt`; 1 s per-domain delay; identify with the bot User-Agent; never send cookies/credentials; refuse `never_fetch` domains. Extract main text with `cheerio` (strip nav/footer/script/style; prefer `<article>`/`main`; keep title, headings). Paywalled/blocked pages ⇒ `FETCH_FAILED` (counts as channel failure, not evidence).

## 3. Date resolution ladder (the exam is about the *past 30 days* — dates are everything)
1 JSON-LD `datePublished` · 2 `article:published_time` / `og:` / `itemprop=datePublished` · 3 RSS/Atom `pubDate`/`published` · 4 `<time datetime>` in the article header · 5 `/YYYY/MM/DD/` in URL · 6 explicit date stated in text and returned by Gemini (`explicit_in_text`) · 7 nothing ⇒ **`DATE_UNVERIFIED` ⇒ cannot become a signal**.
Never use: `dateModified`, fetch time, "today", or a search engine's "age" label as the event date. `event_date` (when it happened) ≠ `published_at` (when it was written) ≠ `retrieved_at` (when we fetched it) — store all three. If model `event_date` is more than 14 days before `published_at`, cap with published date (reduces recency). If `datePublished` is old but `dateModified` is recent ⇒ old article resurfacing ⇒ `OLD_EVENT`.

## 4. Entity resolution (C8) — "which VC is this really about?"
- **Alias index:** from `vc_pipeline.firm` + `aliases` (+ former names like "Sequoia Capital India", "SAIF Partners", "Matrix Partners India"). Match whole-word, case-sensitive for single-token brand names (avoid "accelerate"), case-insensitive otherwise.
- **Collision list** (needs VC-context words within ±80 chars: venture, capital, partners, fund, VC, invest, backed, led): *Accel, Eclipse, Emergence, Initialized, Precursor, Insight, Antler, Susa, Together, Better, Prime, Titan, Lightspeed (vs Lightspeed India), Blume, Elevation, Bessemer (company vs fund), General Catalyst*.
- **Person attribution** only if the person ∈ `tracked_people` *and* named in the excerpt *and* `vc_role ∈ {author, speaker, host, lead_investor}`; otherwise the signal is **firm-level**. A firm's investment never proves a partner personally decided it.
- Ambiguous after rules ⇒ one cheap `disambiguate` call ⇒ else reject `AMBIGUOUS_ENTITY`.

## 5. Dedupe & independence (C11)
`cluster_key = sha1(vc_id | type_family | slug(subject_entity) | event_week_bucket±1)`; type families: {investment, portfolio_activity, fund_news} · {blog_post, thesis_update} · {interview, podcast, conference} · {news_mention, team_news, other}. Same cluster ⇒ **one signal**, extra URLs go to `supporting_sources`. A supporting source is **independent** only if: distinct registrable domain, text shingle similarity <0.85 versus the primary, and domain ∉ `wire_and_pr_syndicators` (a press-release re-run is the same evidence). `independent_source_count` drives the corroboration bonus — never raw article counts.

## 6. Coverage & "quiet" semantics (never confuse failure with inactivity)
Per VC per run record `stats = {channels:{A:ok|fail|none, B:…, C:…, D:…}, fetched, failed, candidates, extracted}`.
- `QUIET` requires: ≥1 per-VC channel (A or B) **ok** and ≥2 channels ok overall and no unprocessed-candidate backlog due to budget.
- Otherwise 0 qualifying ⇒ `PARTIAL`; all failed ⇒ `FAILED` ⇒ `ASSESSMENT_INCOMPLETE`.
- UI shows "Sources checked: official feed ✓ · news ✓ · sector feeds ✓ · grounded search ✗ (quota)" next to the quiet sentence. A VC with no official feed is common — that's fine as long as B and C worked.

## 7. Politeness, caching, determinism
`ETag`/`Last-Modified` stored per registry source; skip unchanged feeds. In-run fetch cache by canonical URL. **Fixtures:** record real HTTP responses (feeds, articles, Gemini outputs) into `fixtures/` (VCR-style) so tests and the demo replay are deterministic and don't burn quota.

## 8. Smoke test checklist (P03)
For each configured source: HTTP 200 · parses · ≥1 dated item in last 90 days · classified (`OK`/`FAILING`/`DISABLED`). Print a table; commit only sources that pass. For 5 sample VCs, print the candidates found per channel so a human can eyeball plausibility **before** Gemini is involved.
