# Audit result (independent exam-auditor, observed 2026-10-12)

Method: the `exam-auditor` subagent re-ran commands and queried the live database and site; it did not trust claims. Source: final audit of the deployed build at https://raiseroute.vercel.app (commit 6bcf7fe), plus earlier per-phase audits (P01 to P09).

## Commands
| Command | Result |
|---|---|
| `npm run verify` | PASS: typecheck, lint, 229 tests (15 files), compliance script |
| `npm run db:test` | PASS: ALL GUARD TESTS PASSED (30 checks, rolled back) |
| `npm run scan:secrets` | PASS: 955 files scanned, no secret value in the build output or tracked files |
| `npm run evals` (real Gemini) | latest run 40/40 checks, 14/14 quotes, 0 false REACH_OUT on 15 cases (an earlier run had 11/12 quotes; the miss was rejected by validator V9) |

## Compliance matrix
| ID | Status | Evidence |
|---|---|---|
| E1 live data | PASS | 445 `evidence_candidates` from live fetches (news_rss 378, grounded_search 35, official_feed 31, sector_feed 1), all with `fetched_at`; no synthetic rows; no fixtures imported by the app |
| E2 data at submission | PASS | 3 completed runs (5 investors, 50 investors, 50 investors via the cron route on Vercel); 52 signals across 27 investors |
| E3a Gemini only | PASS | `llm_calls`: gemini-3.8-flash 117, gemini-3.6-flash 11, gemini-2.5-flash 11 (all Gemini; the 2.5 rows are attempts logged before that retired model was removed from the fallback list); DB constraint rejects non-`gemini-*` |
| E3b no Claude API | PASS | compliance script passes; no dependency or import matches |
| E4 Vercel + URL | PASS | `curl -I` 200; /api/health shows database reachable and Gemini primary model |
| E5 GitHub repo | PENDING | public repository not created yet (owner action) |
| E6 Components Map | PASS | delivered as the image `docs/components-map.png` and `docs/02` (removed from the live app on request) |
| E7 twice a week | PARTIAL, honest note | `vercel.json` has `0 3 * * 1,4`; the cron route is bearer-protected (401 without/with wrong bearer). The one `trigger='cron'` run was a manual, bearer-authenticated call of the cron route made to test that path; a Vercel-**scheduled** run happens at 03:00-03:59 UTC on the next Monday/Thursday (first: Thu 15 Oct 2026). Hobby cron fires within the scheduled hour. |
| E8 who to contact and why | PASS | live Command Centre shows ranked cards with why-now sentence, dated source and verified-quote mark |
| E9 30-day observable signals | PASS | 52 signals: 0 unverified quotes, 0 synthetic, 0 older than 30 days, 0 non-http sources; rejections recorded (OLD_EVENT 11, QUOTE_NOT_FOUND 1, SSRF_BLOCKED 1, NOT_ATTRIBUTABLE 88, AMBIGUOUS_ENTITY 60, IRRELEVANT 28, DUPLICATE_SYNDICATED 11, FETCH_FAILED 194); database now also enforces verified quote, http(s) source and no future dates (migration 0005) |
| E10 quiet VCs | PASS | quiet investors listed with the exact copy and sources checked; incomplete investors shown separately and never as quiet (QUIET 7, SIGNAL_FOUND 27, PARTIAL 16 in the latest run) |
| E11 table current | PASS | 50/50 `vc_pipeline.last_run_id` equal the latest run; `last_assessed_at` fresh |
| E12 only 4 columns change | PARTIAL | evidenced by `db:test` (apply_assessment ignores founder keys; column-aware guard) and by the single RPC write path; no live before/after table diff was captured |
| E13 notes untouched | PASS | all 3 completed runs: `founder_data_intact = true`, hash before = hash after; `db:test` L1-L4; unauthenticated POST/PATCH to every founder route returns 401 |

## Findings and what was done
* **db:test red (fixture assumption)** (earlier audit): fixed; the check is now relative and passes on real data.
* **/components-map 404** (earlier audit): built; live.
* **Model-supplied date on ladder rung 6** accepted without checking the page: fixed. The date must now appear in the page text or the candidate is rejected `DATE_UNVERIFIED`.
* **DB-level evidence rules**: added constraints for verified quote, http(s) source, no future event (0005).
* **Quiet investor shown in "What changed" as "– → –"**: the row now shows the action change (for example Incomplete → Don't prioritize) instead of dashes.
* **Public pages show the demo notes**: by design and labelled "Demo data / synthetic" everywhere; stated on `/data-honesty` and in the README.
* **Run-to-run variation** (50-investor local run: 16 quiet / 7 partial; production run: 7 quiet / 16 partial): the production run skipped grounded search for more investors and some publishers blocked it, so more investors were honestly marked Incomplete. Quiet requires enough sources; the numbers are expected to move between runs.
* **Open items for the owner**: create the public repo; screenshot the Vercel Cron Jobs page after the first scheduled run; keep `DIGEST_AUTO_SEND=false` unless the first digest has been reviewed.
