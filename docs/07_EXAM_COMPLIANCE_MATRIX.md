# 07 · Exam Compliance Matrix  (the auditor fills the last two columns with *observed* evidence)

Legend: ⬜ not yet verified · ✅ PASS (evidence observed) · ⚠ PARTIAL · ❌ FAIL

| ID | Exam requirement (docs/00) | Implementation | Evidence to collect | Status |
|---|---|---|---|---|
| E1 | Uses **live** external data wherever possible | Channels A–E (docs/05); real fetches at run time | `/runs/<id>` shows real candidate URLs, fetched_at timestamps; fixtures NOT used in prod path | ⬜ |
| E2 | Works with **some data at submission** | ≥3 real runs executed before submission; seeded `vc_pipeline` | Neon Postgres table screenshot: signal columns populated for many VCs; `pipeline_runs` ≥3 rows | ⬜ |
| E3a | **Gemini Flash** for all AI | `src/lib/gemini/*` only; model ids `gemini-3.8-flash` (+fallbacks) | `llm_calls` table: all rows `gemini-*`; DB check constraint; UI `/runs/<id>` ledger | ⬜ |
| E3b | **No Claude API** | none in deps/code | `node scripts/check-compliance.mjs` ✓; `grep -ri anthropic package.json package-lock.json src` empty | ⬜ |
| E4 | Deployed on **Vercel**, working public URL | Vercel project, env vars set | `curl -I <url>` 200; `/api/health` JSON; open in incognito | ⬜ |
| E5 | **GitHub repo** link | public repo | link opens; README explains setup | ⬜ |
| E6 | **Components Map** | docs/02 + `/components-map` page | page loads with diagram + table | ⬜ |
| E7 | Runs **twice a week**, ready before Vikram starts work | `vercel.json` cron `0 3 * * 1,4` + GH backup | Vercel dashboard → Cron Jobs shows schedule; `pipeline_runs.trigger='cron'` rows after a real Mon/Thu (or manual trigger of the cron route with the bearer secret as a demo) | ⬜ |
| E8 | Which VCs are worth contacting **this week and why** | Today's Actions cards + score breakdown + evidence | screenshot: ranked list with why-now + source link | ⬜ |
| E9 | Evidence = **observable signal, past 30 days** (wrote/said/invested/appeared) | signal types; validators V3–V6; date ladder | rejected-evidence table shows OLD_EVENT/DATE_UNVERIFIED rejections; every shown signal has event date ≤30d + source URL + verified excerpt | ⬜ |
| E10 | **Quiet VCs** identified | Quiet Investors view; assessment status semantics | view lists quiet VCs with exact sentence + sources checked; failed-source VC shows INCOMPLETE not quiet | ⬜ |
| E11 | Neon Postgres table reflects **current state after every run** | `apply_assessment()` for all 50 VCs each run | `vc_pipeline.last_run_id` = latest run for all rows; `last_assessed_at` fresh | ⬜ |
| E12 | Updates **only** last signal date, signal summary, follow-up score, recommended action | RPC updates only system columns (+ derived helper columns) | diff of `vc_pipeline` before/after a run: only system columns changed | ⬜ |
| E13 | **Contact history & personal notes untouched** | 4-layer Integrity Guard | `db/tests/guard_test.sql` all PASS; run receipt `founder_data_intact = true`; attempt direct UPDATE as service role ⇒ permission denied | ⬜ |

## Above-baseline capabilities (list in the submission; each has evidence)
Explainable 100-pt score · relationship-aware actions (incl. FOLLOW_UP_NOW hook logic) · immutable recommendation history · rejected-evidence audit log · quote verification · source health + honest INCOMPLETE state · Integrity receipts · LLM ledger · feedback per snapshot · immutable email archive · idempotent runs + chunked execution · golden-vector tested engine · prompt-injection canary.

## Known limitations (be upfront in the README — graders reward honesty)
List anything not done (e.g., no LinkedIn/X; portfolio-diff stretch not built; free-tier Gemini cannot ground on 3.x; Hobby cron ±59 min; seed VC thesis hints unverified; relationship data synthetic).
