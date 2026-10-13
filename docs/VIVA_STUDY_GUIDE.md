# RaiseRoute: Viva Study Guide

How to use this: read Part 1 first (the story), then Parts 2 to 8 (how it works), then spend most of your time on Part 9 (the question bank) and Part 10 (the weak spots). Each topic is explained twice: **In simple words** (say this first) and **Technically** (say this if they push).

Facts in this file were checked against the code and the live system. Numbers that came from a specific run say so, because they change run to run.

---

## PART 1. THE STORY

### 1.1 The 30-second pitch
**In simple words:** Vikram is raising money for his logistics software company, FreightLoop. He tracks 50 investors in a spreadsheet, but the spreadsheet cannot tell him who to contact *this week*. RaiseRoute checks all 50 investors against live public news and blog posts from the last 30 days, finds real activity (an investment, an interview, a post about supply chain), proves each find with a link, a date and an exact quote, and then tells Vikram: contact these people today, wait on these, and these are quiet. It never touches his own notes or contact history.

**Technically:** A Next.js app on Vercel with a Neon Postgres database. A scheduled job (Vercel Cron, Monday and Thursday 03:00 UTC) starts a chunked, idempotent pipeline: per investor it collects candidate URLs from four channels, fetches pages through an SSRF-safe fetcher, resolves a trustworthy publication date, asks Gemini Flash to extract a structured event with a verbatim quote, validates it with 15 deterministic validators, scores it with a config-driven 100-point engine, picks a relationship-aware action, and writes only signal columns through one database function (`apply_assessment`). A four-layer integrity guard makes it impossible for the pipeline to change the founder's notes and contact history, and each run stores a SHA-256 before/after receipt.

### 1.2 What the exam asked (Problem Statement 10)
- Twice a week, before Vikram starts work, tell him **which VCs are worth contacting this week and why**.
- "Why" must be an **observable signal from the past 30 days**: something they wrote, said in an interview, invested in, or appeared at.
- For quiet VCs, **say so**, so he does not spend energy there.
- Each run must **update the table** so it is current when he opens it.
- **Never overwrite** his manual notes or contact history. Update only the signal-derived columns: last signal date, signal summary, follow-up score, recommended action.
- Exam rules: use **live external data** (and some data at submission), **all AI must be Gemini Flash (no Claude)**, **deploy on Vercel**, submit **URL + GitHub link + Components Map**.

### 1.3 How you are graded
Build 60 (Components Map 10, Working Vercel link 10, Design 10, Backend logic and build quality 25, Demo video 5) and Viva 40. For "Hard" problems the PDF says you are tested on: multi-step systems, tool/API usage, backend logic, technical trade-offs, reliability of the whole system. It also says a strong working solution beats a half-working harder one. So **in the viva, talk about trade-offs and reliability, not feature lists.**

### 1.4 The five design principles (memorise these; every answer comes back to one)
1. **Never fabricate.** No invented signals, dates, quotes. Unknown stays unknown.
2. **Failure is never silence.** If a source fails, the investor is "Incomplete", never "Quiet".
3. **AI reads, code decides.** Gemini extracts facts; deterministic code validates, scores and chooses the action.
4. **Founder data is untouchable.** Enforced by the database, not by promises in code.
5. **Everything is auditable.** Every rejected item, every AI call, every score has a recorded reason.

---

## PART 2. THE SYSTEM END TO END

### 2.1 One scan, step by step
1. **Trigger.** Vercel Cron calls `/api/cron/run` with a secret bearer token (Mon + Thu 03:00 UTC = 08:30 IST), or Vikram presses **Run now** (`/api/founder/run`).
2. **Start the run.** `start_run()` creates a `pipeline_runs` row with an idempotent `run_key` (same key = same run) and stores a **fingerprint (SHA-256) of all founder-owned data**. One `run_tasks` row is created per investor (50).
3. **Shared context.** The orchestrator loads the company profile (FreightLoop), the alias index (names and tracked people for matching), and the nine **sector feeds** (fetched once, matched to investors by name).
4. **Per investor** (3 at a time, claimed from the queue):
   - **Collect candidates** from channels A, B, C (and D when grounding is enabled).
   - **Store candidates first** (in `evidence_candidates`), before any interpretation, so nothing is lost.
   - **Fetch** each selected page safely (SSRF guard, robots.txt, size and time caps).
   - **Resolve the date** with the date ladder.
   - **Validate** V1 to V8 before spending an AI call.
   - **Gemini extracts** a structured event with a verbatim quote (no tools, JSON only).
   - **Validate again** (quote exists, relevance, duplicates, etc.).
   - **Signals** that pass are stored in `signals`; rejects are kept with a reason code.
   - **Score and action** are computed by pure code.
   - **Snapshot** (immutable `recommendations` row) is written.
   - **`apply_assessment()`** updates only the signal columns of `vc_pipeline`.
5. **Chunking.** An invocation stops starting new investors when time is nearly up (budget 240 s) and **calls itself again** (`/api/pipeline/continue`, using `waitUntil`) until all tasks are done.
6. **Finalize.** `finalize_run()` recomputes the founder-data fingerprint and stores `founder_data_intact` (true if before = after, or null if Vikram edited during the run).
7. **Digest.** An email digest is built from the snapshots and archived; it is sent only on request (or automatically if `DIGEST_AUTO_SEND=true`; it is currently false).
8. **Dashboard** reads everything from the database.

**In simple words:** a conveyor belt with 50 stations, one per investor. Each station finds news, checks it is real and recent, asks the AI to read it, then plain code decides how exciting it is. A guard at the end only lets four columns of Vikram's table be changed.

### 2.2 Architecture map (what the picture shows)
Rows are actors: Vikram, Scheduler, Source Collector, Gemini Flash, Rules Engine, Database, Delivery (email and website). Columns are stages: Trigger, Input, Context, Processing, AI, Output. The image is `docs/components-map.png`. The detailed table is `docs/02_ARCHITECTURE_AND_COMPONENTS_MAP.md`.

> Note for the viva: `docs/02` once described a GitHub Actions *backup* scheduler (C3). It was never built; only the CI workflow (`ci.yml`, runs `npm run verify` on every push) exists. Do not claim a backup scheduler. The real backup is the **Run now** button and **Resume**.

### 2.3 Tech stack and why
| Piece | Choice | Why |
|---|---|---|
| Framework | Next.js 16 App Router, TypeScript strict | One codebase for UI and API; deploys to Vercel natively; types catch bugs |
| Styling | Tailwind v4 | Fast, consistent design tokens |
| Database | Neon Postgres | Real Postgres: privileges, triggers, functions (needed for the integrity guard). Serverless, scales to zero. (The brief said Supabase; same Postgres, see Part 10.) |
| DB driver | `@neondatabase/serverless` | Works in serverless functions |
| Hosting | Vercel Hobby, region bom1 (Mumbai) | Required by exam; low latency for India |
| Scheduler | Vercel Cron | Free, built in |
| AI | Gemini Flash only | Exam rule. Reached through OpenRouter (see Part 10) |
| Validation | zod 4 | Validates AI output and API inputs |
| Parsing | `fast-xml-parser`, `cheerio` | RSS/Atom and HTML |
| Email | Resend | Simple API, free tier |
| Tests | Vitest | Fast |

---

## PART 3. WHERE THE SIGNALS COME FROM

### 3.1 The four channels
**In simple words:** for each investor we look in four places for recent news. Think of asking four different people "has this investor done anything lately?".

| Channel | What | Technically |
|---|---|---|
| **A. Official feed** | The investor's own blog or news feed | Auto-discovery: `<link rel="alternate">` tags and probe paths (`/feed`, `/rss`, `/blog/feed`...), parsed as RSS/Atom |
| **B. Google News RSS** | Searches about the investor in the last 30 days | `news.google.com/rss/search?q=...when:30d`, two query templates per firm plus per tracked person. Links are Google redirect URLs and are decoded to the publisher URL |
| **C. Sector feeds** | Logistics and supply-chain trade press | Nine feeds fetched once per run; items are matched to investors by alias ("push model") |
| **D. Grounded search** | Gemini with Google Search to find extra links | Only when needed (fewer than 3 candidates) and only on the Google SDK path. **Currently disabled** because we reach Gemini through OpenRouter |

Each channel result is recorded per investor as `ok`, `fail`, `none` (nothing exists, e.g. no feed) or `skipped`. These states are shown on each run page and investor page.

### 3.2 What "signal types" exist
investment, portfolio activity, thesis update, fund news, blog post, interview, podcast, conference, team news, news mention, other. Each has base points in the scoring config.

### 3.3 What we deliberately do NOT use
LinkedIn and X (terms of service, fragile), paid data vendors, and any search API's built-in "answer" feature. Raw links and page text only.

---

## PART 4. TRUSTING THE EVIDENCE

### 4.1 Why this part matters
The danger of an AI tool is confident nonsense: an invented quote, a wrong date, the wrong company with a similar name. Vikram would embarrass himself in an email. So the AI is never trusted; **code verifies everything the AI says.**

### 4.2 The date ladder (never trust "last modified")
**In simple words:** "when did this happen?" is surprisingly hard. We ask, in order, from most to least trustworthy, and take the first answer.
1. JSON-LD `datePublished` in the page
2. Meta tag `article:published_time`
3. The feed's own `pubDate`
4. A `<time datetime>` element that is a *published* time (not "updated")
5. A date in the URL path (`/2026/09/24/`)
6. A date the model read in the text, **only if that date really appears in the page text**

Never used: `dateModified`, the time we fetched the page, "today", a search engine's "2 days ago" label. An old article that was edited recently is treated as old (V6). If no rung gives a date, the candidate is rejected `DATE_UNVERIFIED`.

### 4.3 The 15 validators (V1 to V15)
| ID | Checks | Reject code |
|---|---|---|
| V1 | URL is http(s), not on a never-fetch list, not a private/internal address | SSRF_BLOCKED |
| V2 | HTTP 200 and at least 400 characters of real article text | FETCH_FAILED |
| V3 | The date ladder produced a date | DATE_UNVERIFIED |
| V4 | Model's event date and the published date agree (model date cannot be later than published + 1 day) | DATE_INCOHERENT |
| V5 | Event is within the 30-day window (up to 1 day in the future tolerated) | OLD_EVENT / FUTURE_DATE |
| V6 | Old published date with a recent modified date is an old article resurfacing | OLD_EVENT |
| V7 | The page is really about this investor (alias rules, name-collision list, context words) | AMBIGUOUS_ENTITY |
| V8 | The investor's role is real activity, not just "mentioned in a list" | NOT_ATTRIBUTABLE |
| V9 | The quote is at most 300 characters and **appears in the fetched page text** (whitespace/case/quote-normalised) | QUOTE_NOT_FOUND |
| V10 | Relevance tier is not "none" (keyword cross-check may only *downgrade*) | IRRELEVANT |
| V11 | The model's JSON matches the schema (one repair retry allowed) | INVALID_MODEL_OUTPUT |
| V12 | Live evidence is never marked synthetic | SYNTHETIC |
| V13 | Duplicate or syndicated copy of an accepted event is merged as a supporting source, never counted as independent | DUPLICATE_SYNDICATED |
| V14 | Investment signals need a named company that appears in the text | NOT_ATTRIBUTABLE |
| V15 | English only | LANGUAGE_UNSUPPORTED |

The database also enforces some of this (migration 0005): a signal must have a verified quote, an http(s) source and cannot be dated in the future.

### 4.4 Entity resolution (right investor, right person)
Names like "Accel" or "Eclipse" collide with ordinary words and other companies. An **alias index** (firm names, aliases, tracked people) plus a collision list and context-word checks decide whether a page is about the investor. Attribution is **firm-level or person-level**; a firm-level signal never names a partner (the outreach drafter enforces this).

### 4.5 Dedupe and independence
One event is one signal. Ten sites copying one press release is not ten confirmations. Events are clustered by normalised subject, date within 7 days and text similarity (shingles). Only *independent* sources add corroboration points.

---

## PART 5. HOW GEMINI IS USED (AND NOT USED)

### 5.1 In simple words
Gemini is the reader, not the judge. It reads an article and fills in a form: what happened, when, who did it, how relevant to logistics, and the exact sentence that proves it. It never gives a score and never decides who to contact.

### 5.2 Technically
- **Two-phase design (from the spec):** grounded discovery (finds links) is separate from extraction. Extraction runs with **no tools** and a **strict JSON schema**, so untrusted web text cannot trigger tool use.
- **Prompt-injection safe:** page text is wrapped as delimited data, sanitised, and the system prompt says never to obey instructions inside it. An eval case contains a prompt-injection canary; the app rejected it.
- **Validation:** output is parsed with zod. If invalid, **one repair retry** (the model is shown the problems); a second failure is rejected.
- **Model fallback:** primary `gemini-3.7-flash`, then `gemini-3.6-flash`, `gemini-3.8-flash` (all Flash). 404/400/403 go to the next model immediately; 429 waits for the server's retry-delay (up to 20 s) once.
- **Cap and ledger:** at most 200 calls per run, concurrency 3. **Every call writes a row to `llm_calls`**, and the database rejects any model name that does not start with `gemini-`. This is your proof for "Gemini only".
- **Structured output quirk:** Gemini rejects some JSON-schema keywords (`pattern`, `maxItems`...), found by bisecting live; they are stripped from what the model is told, but zod still enforces them on the answer.
- **Outreach drafts** (optional feature): input is only the company profile, the investor firm, validated signals and a status label. **No notes, no contact history ever reach Gemini.** Drafts are never sent automatically.

### 5.3 The OpenRouter question (be ready)
Gemini is called through **OpenRouter** (`google/gemini-3.7-flash`) using a transport layer (`src/lib/gemini/openrouter.ts`). The Google SDK transport also exists and is selected if no OpenRouter key is set. In the ledger the model name is always `gemini-*`. **Honest consequences:** Google Search grounding is a Google-API feature, so channel D is off on this path; coverage rests on channels A, B, C. See Part 10.

---

## PART 6. SCORING AND ACTIONS

### 6.1 Principle
**Score = how strong the moment is. Action = what Vikram should do.** The score has no relationship component; relationship status acts only in the action engine. (An earlier draft had both, which double-counted. We fixed it.)

### 6.2 The 100 points (config in `config/scoring.v1.json`, no magic numbers in code)
| Factor | Max | In simple words |
|---|---|---|
| Relevance | 30 | How close to logistics/supply chain (direct 100%, adjacent 60%, B2B software 40%, broad 15%) |
| Recency | 20 | Fresher is better, linear over the 30 days |
| Strength | 20 | An investment (20) beats a blog post (13) beats a mention (8); rumours count 40% |
| Corroboration | 10 | More independent events/sources agreeing |
| Evidence quality | 10 | Official source > news > social; structured date > guessed date; quote verified |
| Fund fit | 10 | Stage (seed-friendly), sector, region. Unknown = neutral, never invented |

Two protections: **relevance damping** (a fresh but irrelevant post cannot look like an opportunity; recency and evidence points are multiplied by a tier factor, e.g. broad = 0.35) and **no signal = no score** (the score is empty, never 0, so a fit-only number cannot look like an opportunity).

### 6.3 Worked example you can quote
Direct investment 5 days ago, official announcement, verified quote, seed logistics fund: relevance 30 + recency 17 + strength 20 + corroboration 0 + evidence 10 + fit 9 = **86, REACH_OUT_NOW**. The same signal where Vikram emailed 3 days ago is **HOLD (recent contact)**. A fresh blog about AI chips scores about 31 and is **DON'T PRIORITIZE**.

### 6.4 The actions (first matching rule wins)
| Action | Meaning | When |
|---|---|---|
| **Reach out now** | Strong, fresh, relevant. Send a first message | You haven't contacted them, score at least 60, and all gates pass (direct/adjacent relevance, quote verified, stage fits, not a rumour, not synthetic, event within 21 days) |
| **Follow up now** | You know them and they did something new | You are waiting for a reply, at least 7 days passed, their top signal is newer than your last contact, score at least 50, gates pass |
| **Monitor** | Some activity, not yet | Score at least 35 with relevant tier; or good score but a gate failed ("gate capped") |
| **On hold** | Already in touch: do not message again yet | Reconnect date in the future; in a conversation or meeting scheduled; waiting for a reply with unknown date or under 7 days |
| **Don't prioritize** | Nothing relevant or recent | Quiet, passed, generic activity, weak signal |
| **Incomplete** | We could not tell | The check failed or was partial with no signal found |

### 6.5 "Why is it On hold and not Monitor?" (a likely question)
Monitor means *you have not contacted them and their activity is not strong enough yet*. On hold means *you are already in touch*, so even a strong new signal should not trigger another email right now. This is the "relationship-aware" requirement: the app respects Vikram's contact history. The reason is shown on the card (recent contact, awaiting response, reconnect date, active conversation). The only way a waiting investor becomes **Follow up now** is when 7+ days passed *and* they did something new after his last contact.

### 6.6 Editable scoring (added late)
Settings has the rubric as tables. The defaults stay in the config file (they still reproduce the 30 golden test vectors). Edits are stored as **overrides** in `app_settings` and layered on at the start of each run. Validation: points must total 100, thresholds must satisfy reach out ≥ follow up ≥ monitor, tier weights between 0 and 1, only known numeric fields are editable. The score version is labelled `v1.0.0+custom.N`. Scoring is still done by code; Gemini never sees these numbers.

### 6.7 Known simplification (say it before they find it)
The follow-up "hook" test looks at the **top** signal only. If the best signal is older than the last contact but a weaker, newer one exists, the result is Monitor, not Follow up.

---

## PART 7. PROTECTING VIKRAM'S DATA (the 4-layer Integrity Guard)

### 7.1 In simple words
A bank vault with four locks. Even if the program had a bug, it could not rewrite his notes, because the database itself refuses.

### 7.2 The four layers (technical)
1. **Privileges.** The app connects as a restricted role `app_service` that has **no INSERT/UPDATE/DELETE privilege on `vc_pipeline`**. It cannot write the table directly at all.
2. **One write door.** Signal columns are changed only through `apply_assessment()`, a `SECURITY DEFINER` function whose UPDATE **names each column explicitly**. Extra keys in the input are ignored. It writes: last signal date, signal summary, follow-up score, recommended action, plus derived columns (hold reason, action reason, assessment status, score breakdown, fit score, qualifying signal count, previous score/action, scoring version, last run id, assessed-at).
3. **Trigger.** A trigger on `vc_pipeline` rejects any change to a non-system column unless the actor is the founder path. Tested: even the table owner cannot change notes via the pipeline path.
4. **Receipt.** Every run stores a SHA-256 fingerprint of all founder-owned data **before and after**. `founder_data_intact = true` means byte-identical. A founder-edit counter prevents false alarms when Vikram edits during a run (then the result is "not applicable", shown honestly).

Founder-owned columns include: name, firm, thesis, website, region, stage focus, sector tags, aliases, tracked people, contact status, last contact date, reconnect-after, **personal notes**, **contact history**. Founder writes go only through `founder_update_vc()` and `founder_append_contact_event()`, which allow-list keys.

### 7.3 Notes history (added late)
A trigger copies the **old and new** note to `vc_note_history` with a timestamp whenever notes change. Nothing is lost, and it is shown on the investor page ("Earlier versions" and in "Full history"). Contact events (calls, emails) are the "call history" and are append-only.

### 7.4 Proof
`npm run db:test` runs 30 checks (rolled back): app role cannot write, owner path cannot bypass the column guard, apply_assessment ignores founder keys, etc. All pass. All completed runs show `founder_data_intact = true`.

### 7.5 The columns question
The exam says update "only last signal date, signal summary, follow-up score, recommended action". We update those four **plus system-derived columns** (reason, breakdown, etc.), all in the system-owned list and none founder-owned. If asked: "The four required columns are exactly as asked. The extra ones are derived metadata that make the recommendation explainable; none of them is something Vikram writes."

---

## PART 8. RELIABILITY AND OPERATIONS

### 8.1 Why chunking
Serverless functions have time limits. 50 investors at 20 to 60 seconds each cannot run in one call. So work is a **task queue** (`run_tasks`): each invocation claims a few tasks (`claim_run_tasks`, with a stale-claim timeout), processes them for up to the time budget, then triggers itself again.

### 8.2 Idempotency
`run_key` makes starting a run safe to repeat (cron retry, double click). A finished run is returned untouched. Cron uses `cron-YYYY-MM-DD`; manual uses a minute-granular key. Only one run can be active at a time (database rule).

### 8.3 Run now and Resume
Run now starts a scan; if one is already running it resumes it instead of starting a second. A cooldown of 30 minutes limits manual runs. On a run's page, **Resume this run** (if stuck) or **Retry (new run)** (if some investors had problems).

### 8.4 Failure handling
A failed channel, a blocked page or an AI failure turns an investor into **Partial** (Incomplete), never Quiet. A task that crashes is marked FAILED with the error and the run continues. Rate limits go to fallback models. A per-run call cap prevents runaway cost.

### 8.5 The schedule
`vercel.json` cron `0 3 * * 1,4` (Monday and Thursday 03:00 UTC = 08:30 IST). On the Hobby plan a cron may fire any time within that hour. The route requires the bearer secret (401 otherwise). **It has not yet fired by itself:** the first scheduled run is Thursday 15 October 2026. One earlier "cron" run was me calling the route by hand with the secret to test the path. Say this openly.

### 8.6 Observability
`/runs` and `/runs/[id]`: per-investor channel results (✓ ✗ – ·), rejected evidence grouped by code, source health, the AI ledger (all Gemini), the integrity receipt.

### 8.7 Email digest
Built from the snapshots after each run and archived exactly (immutable). Status is truthful: **Sent** only when Resend returns a message id; otherwise Failed or Preview. Resend's free plan only delivers to the account owner's email; the recipient is set to that address. Auto-send is off by default.

---

## PART 9. THE QUESTION BANK

Each answer has a **Simple** and a **Technical** line. Practise saying the simple one, then the technical one only if they ask for more.

### A. The "Incomplete" questions (study these hardest)

**Q1. Why are some investors left "Incomplete"? Why didn't you just fix it?**
- *Simple:* Because for those investors we found news articles but the news websites refused to let our program open them (they block automated readers or sit behind paywalls). If we cannot read the article, we cannot check the date or the quote. So we cannot honestly say they did something, and we also cannot honestly say they did nothing. "Incomplete" is the truthful answer: "we could not tell".
- *Technical:* In the latest run, for the incomplete investors channels A/B/C returned fine (candidates found) but the fetch stage failed (`FETCH_FAILED`: 403, empty body, paywall stub, or under 400 characters of text) so `fetched_ok = 0`, the `incomplete` flag set, and `assessment = PARTIAL`, which the action engine maps to `ASSESSMENT_INCOMPLETE`. Quiet requires: at least one per-investor channel ok, at least two channels ok, and `!incomplete`.

**Q2. Isn't that just a failure of your system?**
- *Simple:* It is a limit of the data access, and the system handles it correctly. A system that says "quiet" when it is blind would mislead Vikram into ignoring an investor who just made a big announcement. That is worse than saying "unknown".
- *Technical:* This is the explicit rule "search/fetch failure ⇒ ASSESSMENT_INCOMPLETE, never quiet" (principle 2). It is tested: unreachable-database tests, an all-fetches-fail case, and the evals' paywall-stub case.

**Q3. Why not get around the blocks?**
- *Simple:* Three reasons: it would break the sites' rules (we respect robots.txt and do not pretend to be a person's browser), it would add cost and fragility, and it is outside the scope of a 12-day exam build.
- *Technical:* Options were a headless browser, a paid scraping API (proxies, CAPTCHA solving) or a paid news API. Each adds cost, terms-of-service risk and moving parts; none changes the trust model. The fetcher is deliberately polite: `robots.txt` respected, per-domain delay, size and time caps, honest user agent.

**Q4. What would you do to reduce incomplete investors?**
- Re-run later (some sites recover; the dashboard says so).
- Prefer official feeds and sector feeds (channel A, C) which are fetched as feeds, not article pages.
- Add a licensed news API for the blocked publishers.
- Use the RSS summary text as *unverified* evidence labelled as such, never as a verified signal.
- Re-enable Google-grounded search (needs a Google key with billing).

**Q5. Why did the number of incomplete change between runs (16 quiet / 7 partial vs 7 quiet / 16 partial)?**
- *Simple:* Different run, different conditions: the second run had grounded search skipped for more investors and some sites blocked more that day. The system reports what it could and could not check on that day.
- *Technical:* Channel D was budgeted and then disabled; fetch success depends on publisher behaviour and rate limits at that moment.

**Q6. What is the difference between Quiet and Incomplete?**
- *Simple:* Quiet: "we checked properly and found nothing in 30 days." Incomplete: "we could not check properly."
- *Technical:* Quiet needs `perVcOk && okChannels >= 2 && !incomplete`. The exact quiet sentence is shown: "No qualifying signal found in the sources checked in the past 30 days."

**Q7. How does the dashboard explain incomplete investors?**
- It states the count, says it is not the same as quiet, lists causes with counts (publisher blocked the reader, a source did not answer, more articles than one run can read), and tells him what to do (Run now again later, or open the investor to see exactly what failed).

### B. Requirements and scope

**Q8. Does it meet the problem statement?** Walk the checklist: live data (445 candidates from live fetches); 30-day signals with source and quote; quiet VCs listed; table updated by each run (all 50 rows share the latest `last_run_id`); notes and contact history untouched (guard + receipt); Gemini only; deployed on Vercel; GitHub link; Components Map.

**Q9. "Twice a week" proof?** Cron is configured; Run now exists; the first scheduled run is Thursday 15 October. Show `vercel.json` and the Cron Jobs page (screenshot after Thursday).

**Q10. Where is "why" shown?** On each suggestion card (one sentence), on the investor page ("What made this investor stand out": title, summary, quote with a verified tick, source link and date), and the factor-by-factor score breakdown.

**Q11. Where do the quiet VCs appear?** Dashboard "Quiet investors" with the required sentence, Pipeline filter, and the investor page.

**Q12. The brief says "Supabase table". You used Neon.** *Simple:* I chose Neon. Both are Postgres; the table and its protection are the same. *Technical:* The guard design uses plain Postgres features (roles, grants, triggers, `SECURITY DEFINER` functions) that work identically. Migrations create Supabase-style roles on Neon.

**Q13. What was the starting data?** 50 investors from the seed CSV (kept for the same columns). Tracked people came from the user's spreadsheet for 6 overlapping firms. Relationship data (status, dates, notes) is **synthetic starter data** so relationship-aware advice can be shown. Thesis/stage/sector tags are unverified hints.

### C. AI and Gemini

**Q14. Prove you used only Gemini Flash.** The `llm_calls` ledger (every call recorded; DB constraint rejects non-`gemini-*` names), the compliance script (`scripts/check-compliance.mjs` fails on any Claude/Anthropic reference), and no Anthropic dependency in the lockfile.

**Q15. OpenRouter is not Google. Is that "Gemini Flash"?** *Simple:* The model is Google's Gemini Flash; OpenRouter is the delivery route, like using a different shop to buy the same product. *Technical:* Requests name `google/gemini-3.7-flash`; the response `provider` is Google. The direct Google SDK transport is implemented too and is used if only `GEMINI_API_KEY` is set. I chose OpenRouter because it was the key available and let me complete the build. Trade-off: no Google Search grounding.

**Q16. What if Gemini hallucinates?** Every quote must appear in the page text (V9); every date comes from the ladder, not the model; relevance can only be *downgraded* by keyword cross-check; invalid JSON gets one repair then rejection. Evals: 15 labelled cases, 40/40 checks, 14/14 quotes found, 0 false "reach out" on 9 negative cases.

**Q17. What about prompt injection?** Web text is untrusted data: wrapped, sanitised, no tools available in extraction, schema-only output, and an eval case with an injection canary which was rejected.

**Q18. Why not let Gemini score?** Not reproducible, not explainable, not testable. Code scoring matches 30 golden vectors from a reference implementation and every point is explained on screen.

**Q19. How do you control cost?** Cap of 200 calls per run, concurrency 3, extraction only on candidates that pass cheap validators, fallback models, and per-call ledger with token counts. A full 50-investor run uses on the order of 50 to 100 calls (139 across the first three runs together).

**Q20. What is "grounding" and why is it off?** Gemini's Google Search tool, used for channel D discovery. It is a Google API feature, unavailable through OpenRouter. It is off, so discovery relies on feeds and Google News.

### D. Scoring and actions

**Q21. Why these weights?** They encode a judgement: relevance matters most (30), then freshness and strength (20 each); fit, evidence and corroboration (10 each) refine. They are in a config file with a version, validated by golden tests, and now editable in Settings.

**Q22. Why can a high score still be "Monitor"?** Gates. Reach out needs: direct/adjacent relevance, verified quote, a stage the fund invests in, not a rumour, not synthetic, event within 21 days. If a gate fails the action is Monitor ("gate capped") and the UI names the failed gate.

**Q23. Why is the score empty for quiet investors?** A score of 0 or a fit-only score would look like a ranking. No signal means no score.

**Q24. How do you prove the engine is right?** 30 golden vectors generated from a Python reference engine; the TypeScript engine reproduces every one. Rounding is round-half-up per component.

**Q25. Explain "Follow up now" precisely.** Status waiting for response, 7 or more days since contact, top signal dated on/after the last contact, score at least 50, gates pass.

**Q26. What does "On hold" mean?** See 6.5. Four reasons: recent contact, awaiting response, reconnect date, active conversation.

**Q27. Why does an investor you "passed" never show Reach out?** `PASSED` means don't prioritise, unless a reconnect date has been reached and the signal is strong, in which case Monitor.

**Q28. Can the founder change the rules?** Yes, in Settings, within validation. It changes the numbers, not the logic, takes effect next run, and is versioned. Defaults and tests remain.

### E. Data protection

**Q29. How do you guarantee notes are never overwritten?** Four layers (Part 7). Strongest point: the app's database role has *no privilege* to write the table, so even a bug cannot.

**Q30. What if Vikram edits notes during a run?** Founder edits increment a counter. If the counter changed, the receipt says "not applicable" instead of claiming a violation.

**Q31. You removed the login. Isn't that unsafe?** *Simple:* The professor asked for no login. The most important safety (the database guard) does not depend on login. Origin checks and rate limits remain on editing routes. *Technical:* Without login, anyone with the URL can use Run now, edit notes and the rubric. For a graded demo that is acceptable; for production I would restore authentication (e.g., a passcode or SSO) and per-user rows. The guard still prevents the pipeline from touching founder data.

**Q32. Could anyone abuse Run now?** Cooldown of 30 minutes, one active run at a time, call cap per run, and rate limiting (per instance only: say that).

**Q33. What about secrets?** Server-side only, no `NEXT_PUBLIC_*` secrets, browser never talks to the database. `scan:secrets` scans the build output and tracked files for secret values; clean. The OpenRouter key was pasted in chat, so rotate it after grading.

### F. Security

**Q34. What is SSRF and how do you stop it?** *Simple:* A trick where a malicious link makes the server visit internal addresses. *Technical:* Our fetcher validates URL schemes, resolves DNS and blocks private/loopback/link-local addresses **on every redirect hop**, pins the resolved address (prevents DNS rebinding), and caps size (1.5 MB), time (8 s) and redirects (4).

**Q35. What about CSRF?** Mutating routes require an `Origin` header matching the app; browsers send it on cross-site posts.

**Q36. Content Security Policy?** Set in `next.config.ts` (security headers). Honest limit: it allows inline scripts that Next.js needs.

**Q37. Is the database reachable from the browser?** No. Only server code connects, as the restricted role.

### G. Engineering and quality

**Q38. How did you test?** 227 unit and integration tests (engine, golden vectors, sources, Gemini, pipeline, hardening, digest, guard routes), 30 SQL guard tests, 15 live AI evals, a compliance script, a secret scan, and CI running `npm run verify` on every push.

**Q39. What does `npm run verify` do?** typecheck + lint + tests + compliance script.

**Q40. How is the code organised?** `src/lib/engine` (pure scoring/validation), `sources` (feeds, fetcher), `gemini` (client, transports, prompts), `pipeline` (orchestrator, task), `db` (pipelineDb for system writes; founderDb for founder writes), `founder` (guards), `digest`. Pipeline code may import only `pipelineDb`; the compliance script enforces it.

**Q41. What was the hardest bug?** Candidates: app_service saw zero rows because BYPASSRLS is not inherited through role membership (fixed in migration 0003); Gemini returning HTTP 400 for certain schema keywords (found by bisecting live); shell scripts eating backslashes in regexes (fixed by writing files directly). Choose one and tell it as a story.

**Q42. What would you do with more time?** Licensed news API, restore Google grounding, authentication, add-investor form, a fixtures-based demo replay, portfolio-diff detection (new portfolio companies), per-user data, and a global rate limiter.

### H. Product and design

**Q43. Why this dashboard layout?** Hero first (how many investors are worth contacting), four colour-coded buckets in the order Vikram should act, "Contact these today" as the main card, "What changed" second, quiet and incomplete as information, the opportunity map last.

**Q44. Why different colours?** Orange = act now, indigo = follow up, blue = monitor, amber = on hold, rose = incomplete, grey = nothing. Brand green is only for the header and buttons, so green never means "good".

**Q45. What is the opportunity map?** Across: fund fit (0 to 10). Up: recent activity score (0 to 100). Top right = best bets. Investors with no score are not drawn (never plotted as 0).

**Q46. Why show the evidence first on the investor page?** The first question when opening an investor is "why was this suggested?". The evidence answers it; the score and history come after.

**Q47. What are the "AI" and "You" tags?** Violet AI tag marks AI-derived text; amber You tag marks founder-entered text. Scores and actions are not AI text (code).

**Q48. What is the "How we verify" page for?** Trust: where each part of the app comes from and how evidence is checked, so Vikram knows what to rely on before emailing an investor.

**Q49. Why the truck?** Brand: a logistics founder; the truck loader shows progress (a run in progress shows "x of 50") and loading.

**Q50. Accessibility?** Colour never carries meaning alone (labels and icons), keyboard focus outlines, a skip link, reduced-motion support, text alternatives for charts.

### I. Trade-off questions (prepare an opinion on each)

**Q51. Precision versus coverage?** I chose precision. A false "Reach out now" costs Vikram credibility; a missed signal costs one more week. So the validators reject aggressively and uncertain cases become Incomplete.

**Q52. Deterministic scoring versus AI scoring?** Deterministic: reproducible, testable, explainable, tunable by the founder.

**Q53. Feeds versus scraping?** Feeds and news RSS are legal, stable and cheap but incomplete; scraping gives more but breaks easily and risks terms-of-service violations.

**Q54. Single database versus separate services?** One Postgres keeps the integrity guard enforceable in one place.

**Q55. Why not a vector database / RAG?** The problem is about verified, dated signals per named investor, not open-ended question answering. Retrieval over a vector store would not improve verifiability; the evidence trail already is the source of truth. (A "chat with the sources" feature is a possible extension, not a requirement.)

### J. Curveballs

**Q56. Show me a case where the system said "don't prioritize" for a good reason.** Use the eval cases: an AI-chips article scores about 31 (irrelevant), an old article resurfaced with a recent "modified" stamp (rejected as old), an investment in an unrelated company (34).

**Q57. How do you know a source is "independent"?** Different publisher domains and not a syndicated copy (clustered by subject, date window and text similarity).

**Q58. Does it work for other founders?** The company profile is editable (name, product description, sector, keywords, region); scoring relevance uses it. The investor list is a seeded table; an add-investor form is a natural next step.

**Q59. What if Neon is asleep?** The free project scales to zero; the first request takes about a second. If the database is unreachable the pages show a clear message and change nothing.

**Q60. What did you personally decide versus what did the tool build?** Be honest: you made the product decisions (Neon, brand constant, relationship data labelling, removing login, colours, which features to skip) and used an AI coding assistant for implementation. Know every part well enough to explain it. This guide exists for that.

---

## PART 10. THE WEAK SPOTS, AND HOW TO ANSWER

| Weak spot | Honest statement | Calm answer |
|---|---|---|
| Cron not yet proven | First scheduled run is Thu 15 Oct; I tested the route by hand with the secret | "It is configured and protected. I can show Run now, which uses the same code path." |
| ~14 incomplete investors | Publishers block the reader | Q1 to Q7 |
| OpenRouter, no grounding | Gemini Flash through OpenRouter; Google search channel off | Q15, Q20 |
| Neon not Supabase | Same Postgres | Q12 |
| No login | Removed on request; guard remains | Q31 |
| Synthetic relationship data | Pre-filled starter data | Q13; "How we verify" page says so |
| Rate limiter per instance | In memory only | "Documented limitation; a shared store such as Redis would fix it." |
| Follow-up uses top signal only | Documented simplification | 6.7 |
| Incomplete GitHub backup claim in old docs | Not built | Do not claim it (2.2) |
| Unreviewed email | Digest sent once to my own address | Resend free plan can only email the account owner |

---

## PART 11. NUMBERS CHEAT SHEET

- Investors: **50**. Window: **30 days**. Cron: **Mon + Thu 03:00 UTC (08:30 IST)**.
- Score: **100 points** = 30 + 20 + 20 + 10 + 10 + 10. Reach out ≥ **60**, follow up ≥ **50**, monitor ≥ **35**. Waiting cooldown **7 days**; overdue **14 days**; reach-out signal age **≤ 21 days**.
- Validators **V1 to V15**. Date ladder **6 rungs**. Channels **A, B, C, D**. Sector feeds **9**.
- Tests **227** (17 files). Golden vectors **30**. DB guard checks **30**. Evals **15 cases, 40/40 checks, 14/14 quotes, 0 false reach-out**.
- Per run caps: **200 AI calls**, concurrency **3**, time budget **240 s** per invocation, manual cooldown **30 min**.
- Fetcher: **8 s** timeout, **1.5 MB**, **4** redirects, **12** pages per investor per run.
- Latest data snapshot (will change after later runs): reach out **2**, follow up **0**, monitor **2**, on hold **8**, quiet **7**, incomplete **14**; **445** evidence candidates from live fetches over the runs; 3 completed runs; `founder_data_intact = true` on all.

## PART 12. GLOSSARY (simple)

- **Signal:** a verified recent action by an investor (investment, post, interview...).
- **Candidate:** a link that might contain a signal; most get rejected.
- **Grounding:** letting Gemini use Google Search to find links.
- **Idempotent:** doing it twice has the same effect as once.
- **SSRF:** tricking a server into visiting internal addresses.
- **Syndicated:** the same article copied on many sites.
- **Golden vector:** a fixed input with a known correct output, used to test the scoring engine.
- **Receipt:** the before/after fingerprint proving founder data did not change.
- **Snapshot:** an unchangeable record of a run's decision for one investor.
- **RLS / BYPASSRLS:** Postgres row-level security; the app role bypasses it but has no write privileges on the investor table.
- **Chunking:** splitting a long job into short pieces that continue each other.

## PART 13. DEMO AND LIVE CHECKLIST FOR THE VIVA

1. Open https://raiseroute.vercel.app. Have the GitHub repo and the Components Map image ready.
2. Walk: dashboard → one suggestion → its evidence and quote link → score breakdown → notes history → pipeline filter → quiet and incomplete note → run page with integrity receipt and AI ledger → settings rubric → digests.
3. Be ready to open `db/migrations/0002_guards.sql` (the four layers) and `config/scoring.v1.json`.
4. Have the numbers in Part 11 in your head.
5. Say "not verified" if you do not know. The project rule is never to claim what you have not checked.
