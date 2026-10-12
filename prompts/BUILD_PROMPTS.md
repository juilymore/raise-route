# BUILD PROMPTS — paste ONE per Claude Code session, in order

**How to use**
1. Put this whole pack in the root of a new git repo (`CLAUDE.md` at the root, `docs/`, `db/`, `config/`, `scripts/`, `.claude/`, `.github/`, `vercel.json`, `.env.example`). `git init && git add -A && git commit -m "pack"`.
2. `cd` into it, run `claude`. CLAUDE.md loads automatically.
3. For each phase: `/clear` → paste the block → let it work → read its report → run the human steps listed under **YOU** → `git commit`. Don't start the next phase until acceptance passes.
4. Use **plan mode** (Shift+Tab until "plan mode") for P00, P06, P09.
5. At the end of P06, P09, P13 run **`/exam-audit`**.

**Milestones:** M1 exam-pass = P00–P09 · M2 full marks = P10–P11 · M3 wow = P12 · final = P13. *If time is short, stop after P09, then do P13's checklist.*

---

## P00 — Orientation & plan (plan mode, NO code)
```
Read CLAUDE.md, docs/00_EXAM_BRIEF.md, docs/01_PRODUCT_SPEC.md, docs/02, 03, 04, 05, 07, config/*.json and db/migrations/*.sql.
Then report (max 40 lines): (1) your understanding of the exam rules that can fail the project, (2) the architecture in 10 lines, (3) risks/ambiguities you see (especially Vercel Hobby time limits, Gemini free-tier limits, SSRF, date correctness), (4) the exact order you'll build P01..P13 and the first 3 things you'd verify live. Do not write code. Do not ask questions whose answers are in the docs.
```
**YOU:** skim the report; correct any misunderstanding before moving on.

## P01 — Foundation
```
Phase P01. Scaffold the app per CLAUDE.md "Stack" (Next.js App Router, TypeScript strict, Tailwind, shadcn/ui, Vitest, Zod). Create:
- src/lib/config: typed zod loaders for config/scoring.v1.json, taxonomy.json, sources.json (fail fast if invalid)
- src/lib/env.ts: zod-validated server env (see .env.example); no NEXT_PUBLIC secrets
- src/lib/db: two thin server-only clients: pipelineDb (exposes ONLY: startRun, finalizeRun, claimRunTasks, applyAssessment, inserts into signals/evidence_candidates/recommendations/llm_calls/run_tasks/source_registry/email_digests) and founderDb (founder_update_vc, founder_append_contact_event, company_profile, feedback, outcomes). Pipeline code may import pipelineDb only.
- npm scripts: dev, typecheck, lint, test, verify (= typecheck+lint+test+node scripts/check-compliance.mjs), db:test (psql -f db/tests/guard_test.sql)
- GET /api/health: reports DB reachable (select 1 via service client), env presence booleans (never values), configured model ids, scoring version
- GitHub Actions CI running `npm run verify`
Acceptance: `npm run verify` green; `npm run dev` serves /api/health JSON. Report what you verified by running it.
```

## P02 — Database live + read-only list
```
Phase P02. I have created a Neon project and put DATABASE_URL (the app_service pooled connection string) and DATABASE_URL_UNPOOLED (owner, for migrations) in .env.local, and I have run db/migrations/0000_neon_roles.sql, 0001_schema.sql, 0002_guards.sql and db/seed.sql in the Neon SQL editor.
1) Verify via the app's server client that: 50 rows in vc_pipeline, company_profile id=1, v_pipeline_overview works.
2) Run `npm run db:test` against DATABASE_URL and show the PASS lines (must be all green).
3) Generate TS types for the tables you use (hand-written zod row schemas).
4) Build a minimal read-only /pipeline page listing the 50 VCs (firm, thesis, contact status, last contact, notes) with a visible "DEMO relationship data" chip.
Acceptance: page shows 50 rows from the real DB; guard tests green. If an explicit-GRANT error (42501) appears, fix the migration by ADDING 0003_*.sql, not by editing 0001/0002 blindly.
```
**YOU:** create the Neon project (Mumbai), run the 3 SQL files in order in the SQL editor, fill `.env.local`.

## P03 — Pure engine (no network, no LLM)
```
Phase P03. Implement src/lib/engine as PURE functions with exhaustive unit tests:
- scoring.ts + actions.ts: port scripts/reference_engine.py exactly (round-half-up). A vitest test (tests/golden/engine.test.ts) loads config/golden_vectors.json and must pass ALL 30 vectors with exact equality. All numbers come from config/scoring.v1.json.
- taxonomy.ts: relevance cross-check that can only DOWNGRADE tiers, honours ambiguous_phrases_not_logistics.
- validators.ts: V1–V15 from docs/01 §3, each returning {ok, code, detail}.
- dates.ts: date resolution ladder (docs/05 §3) incl. JSON-LD / meta / time / URL parsing helpers, window check with future tolerance.
- entities.ts: alias index, whole-word matching, collision list with context words, firm vs person attribution rule.
- dedupe.ts: cluster_key, normalised subject entity, shingle similarity, syndicator & independence rules.
- ssrf.ts: URL/IP guard (pure parts: IP range checks, decimal/hex/IPv6-mapped forms, scheme check).
Acceptance: `npm test` green incl. 30/30 golden vectors; include tests for: 31-day-old, +3-day-future, dateModified-only, 'Accel' vs 'accelerate', mentioned_only, quote-not-in-text, syndicated copy not independent, 169.254.169.254 & 0x7f000001 blocked.
```

## P04 — Live sources + fetcher
```
Phase P04. Implement src/lib/sources per docs/05: SSRF-safe fetcher (timeouts, size cap, redirect re-check, robots.txt, per-domain delay, UA from config), RSS/Atom parser (fast-xml-parser), article text extractor (cheerio), Google News RSS channel with redirect resolution, official-feed auto-discovery + source_registry health updates, sector-feed push channel with alias matching, and optional Tavily/Exa adapters (raw results only, include_answer=false; skipped if no key).
Write scripts/smoke-sources.ts that tests EVERY source in config/sources.json against the real internet and prints a table (HTTP status, parses?, #items, newest item date). DISABLE (set status DISABLED / remove) failing ones rather than shipping them. Then for 5 sample VCs print the candidate URLs per channel with dates — before any Gemini call.
Record real responses as fixtures under fixtures/ (small, redacted) for tests.
Acceptance: smoke table printed with real results; ≥2 per-VC channels work for most VCs; unit tests for fetcher guard + parsers with fixtures green. Be honest about which sources failed.
```

## P05 — Gemini layer
```
Phase P05. Implement src/lib/gemini per docs/04: callGemini wrapper (concurrency cap, LLM_MAX_CALLS_PER_RUN, retry/backoff honouring retryDelay, model fallback chain from env, 404 immediate fallback, zod validation + one repair retry, llm_calls ledger row for EVERY call), extract (structured, no tools, thinkingLevel low for Gemini 3.x, default temperature), discover_grounded (googleSearch tool → harvest grounding URLs → resolve redirects), disambiguate, and prompt builders that structurally cannot accept founder notes. Verify the current @google/genai parameter names from the official docs before coding and note the verification date in a comment.
Add tests/evals with 12+ labelled cases from docs/04 §7 including the prompt-injection canary and run `npm run evals` for real; print sample sizes.
Acceptance: ledger rows appear in Neon for real calls; evals report quote-found rate 100% and 0 false REACH_OUT on the labelled set; compliance script green (no non-Gemini LLM). If the free tier cannot ground on Gemini 3.x, say so and implement the documented fallback (2.5 Flash for grounding or skip channel D) instead of pretending.
```
**YOU:** put `GEMINI_API_KEY` in `.env.local` (enable billing + budget alert if you want grounding on 3.x).

## P06 — Orchestrator & first real run (plan mode first)
```
Phase P06 (use plan mode first). Implement src/lib/pipeline + API routes per docs/01 §2:
- /api/cron/run (GET; Authorization: Bearer CRON_SECRET, constant-time compare; ?source=github|vercel): run_key = cron-YYYY-MM-DD; startRun (idempotent); create 50 run_tasks; process slices within PIPELINE_TIME_BUDGET_MS with concurrency LLM_MAX_CONCURRENCY; when time is up and tasks remain, trigger POST /api/pipeline/continue via waitUntil; export const maxDuration per CLAUDE.md facts.
- Per-VC task: channels → candidates (stored in evidence_candidates BEFORE interpretation) → fetch → entity pre-check → Gemini extract → validators → dedupe → signals → assessment status (QUIET only with adequate coverage; failures ⇒ PARTIAL/FAILED) → score/action (engine) → insert recommendation snapshot (relationship snapshot WITHOUT notes) → applyAssessment RPC.
- finalizeRun when no tasks remain; record llm/search counts and errors.
Tests: idempotent run_key; resume after simulated timeout; one VC failing doesn't stop others; Gemini 429/malformed/404; quota cap ⇒ PARTIAL; repeat run creates no duplicate signals/snapshots; fingerprint before/after a full fixture run is identical.
Then run it LIVE: first on 5 VCs, show me results, then all 50.
Acceptance: pipeline_runs row COMPLETED(_WITH_ERRORS) with founder_data_intact = true; vc_pipeline.last_run_id set for all 50; every signal has event_date ≤30d, source URL, verified excerpt. Then run /exam-audit.
```

## P07 — Dashboard (M1)
```
Phase P07. Build the UI per docs/01 §6 (M1 subset): Command Centre (/) with KPI strip from v_pipeline_overview, Today's Actions cards (score, one-sentence why-now, evidence chip with event date + link, next step), Quiet Investors (exact sentence + sources checked), /pipeline (search, filters, sort, CSV export), /vc/[slug] (Why-this-score factor bars with points/max + reasons, Evidence list with event vs published date + verified-quote badge + attribution, Relationship panel, History), /runs and /runs/[id] (status, per-VC tasks, rejected evidence with reason codes, source health, LLM ledger, Integrity receipt).
Design: use the frontend-design skill if available; mobile-first; AI-derived vs Founder-entered labels; action chip colours from the spec; skeleton/empty/error states; no stack traces to users.
Acceptance: all pages render real data; counts match the DB; screenshots (desktop+mobile) saved to docs/screenshots/.
```

## P08 — Founder auth & write path
```
Phase P08. Implement founder access: POST /api/founder/auth (FOUNDER_ACCESS_CODE → jose-signed HttpOnly SameSite=Lax cookie), middleware protecting all mutating routes (zod validation + Origin check + rate limit). Founder editing of notes/status/dates/contact events in /vc/[slug] ONLY via founderDb RPCs. "Run now" button (founder only) with MANUAL_RUN_COOLDOWN_MINUTES and a DB lock; "Resume" button for stuck runs. Public visitors are strictly read-only. Security headers (CSP, X-Frame-Options, Referrer-Policy).
Tests: unauthenticated POST ⇒ 401; wrong cron bearer ⇒ 401; editing notes during a run yields receipt NULL (not ❌); pipeline code cannot import founderDb (compliance script).
Acceptance: show curl transcripts for the 401/200 cases and a screenshot of the receipt states.
```

## P09 — Deploy (M1 complete) (plan mode first)
```
Phase P09. Deploy to Vercel (Hobby): link the GitHub repo, set every env var from .env.example (Production), region bom1 via vercel.json, confirm the cron entry deploys. If Vercel rejects maxDuration=300 on this plan, set 60 and lower PIPELINE_TIME_BUDGET_MS, re-verify chunking. Add GitHub repo secrets APP_BASE_URL and CRON_SECRET for .github/workflows/pipeline-backup.yml and trigger it once via workflow_dispatch.
Verify LIVE and show evidence: curl -I on the public URL, /api/health, the cron route with the bearer secret producing a real run in production, pages load in the deployed app, Neon shows the run. State clearly anything you could NOT verify.
Acceptance: public URL works in incognito; a production run COMPLETED; M1 is submittable. Then run /exam-audit.
```
**YOU:** connect Vercel ↔ GitHub, paste env vars, add GitHub secrets, press deploy. Share the URL with Claude Code only if asked.

## P10 — Full-marks features (M2 part 1)
```
Phase P10. Implement: feedback (👍/👎 + reasons + note, bound to recommendation_id, never mutates founder data), outcomes log, /calibration (counts by reason WITH n; <20 ⇒ "too few to conclude"; never claim the model learns), outreach drafter (docs/04 §5; draft only; never sends; no notes in prompt), "What changed since last run" + priority changes (v_priority_changes), richer Quiet view, source health panel, rejected-evidence explorer, as-of badge on snapshots.
Tests for each. Acceptance: demo each feature on real data; feedback row linked to correct recommendation; outreach draft cites a real signal date and contains placeholders instead of invented facts.
```

## P11 — Email digest (M2 part 2)
```
Phase P11. Implement src/lib/digest per docs/01 §8: build from THIS run's recommendation snapshots, sections in order, immutable email_digests + items rows, Resend sender (status SENT only with provider message id; no key ⇒ DEV_NOT_SENT with honest UI), idempotent digest_key, auto-send only for cron/github runs when DIGEST_AUTO_SEND=true, manual "Send digest" button for founders. /digests and /digests/[id] archive showing the exact HTML sent.
Tests: later score change doesn't alter an old digest; failed send ⇒ FAILED + error; repeat call doesn't resend.
Acceptance: show the archived digest page and (if RESEND_API_KEY set) the delivery confirmation id.
```

## P12 — Wow layer (OPTIONAL, only if M1+M2 deployed and green)
```
Phase P12. Pick in this order and stop when time runs out: (1) Opportunity Matrix (fit vs score scatter with action colours, click-through) (2) as-of time travel across runs (3) fixtures-based demo replay endpoint so demos work offline (4) portfolio-diff detector for 5 funds with stable portfolio pages (event_date_basis=first_observed, lower evidence points). Each must keep `npm run verify` green and not change the exam-literal behaviour.
```

## P13 — Hardening, docs, audit, submission pack
```
Phase P13. (1) Write tests for every row of the failure matrix in docs/01 §10 not yet covered. (2) Security pass: SSRF payload tests, secrets grep of the build output, auth tests. (3) Build /components-map (render docs/02) and /data-honesty pages. (4) Write README.md per docs/09 §B (screenshot, architecture, setup, env vars, Integrity Guard explanation, tests, costs, LIMITATIONS, data honesty). (5) Run `npm run verify`, `npm run db:test`, and /exam-audit; save the table to docs/AUDIT_RESULT.md; fix every ❌. (6) Ensure ≥3 real production runs exist and a digest exists. (7) Produce docs/SUBMISSION.md with: public URL, repo URL, Components Map link, founder passcode placeholder, one-line summary, limitations. Never claim anything you didn't verify.
```
