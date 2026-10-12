# 09 · Submission, Demo & Viva

## A. What you submit (exam instruction #4)
1. **Working public URL** (Vercel) — opens without login; read-only for visitors.
2. **GitHub repository link** (public).
3. **Components Map** — `docs/02_ARCHITECTURE_AND_COMPONENTS_MAP.md` + live `/components-map`.
Put in the submission note: founder passcode (for graders to click *Run now*), one-line summary, known limitations, and the line **"All AI tasks use Gemini Flash; no Claude API in the product — see `/runs/<id>` LLM ledger."**

## B. Pre-flight (do 24 h before the deadline, not 1 h)
- [ ] `npm run verify` green · `npm run db:test` green (31/31) · `/exam-audit` table has no ❌ and every ⚠ is explained.
- [ ] Vercel production deploy succeeded; `curl -I <url>` = 200; `/api/health` shows Gemini model reachable, DB reachable, cron secret configured.
- [ ] Vercel → Project → Cron Jobs shows `0 3 * * 1,4` (if the deploy rejected it, you're not on a plan that accepts it — see CLAUDE.md facts).
- [ ] **≥3 real pipeline runs completed** (so "changes since last run", priority changes and history have content). At least one triggered through `/api/cron/run` with the bearer secret (proves the cron path).
- [ ] Neon SQL editor: `vc_pipeline` signal columns populated; `personal_notes`/`contact_history` identical to seed (run receipt ✅).
- [ ] One digest exists (`SENT` if Resend configured, otherwise clearly `DEV_NOT_SENT`).
- [ ] Open the URL on your **phone** and in an **incognito** window. Check no secrets in page source / network tab.
- [ ] README has: what it does · screenshot · architecture/Components Map link · setup & env vars · how the Integrity Guard works · how to run tests · cost/limits · **known limitations** · data-honesty note (VC profiles = hints; relationship data = synthetic demo).
- [ ] Neon project is *active* (free projects pause after 7 idle days — run once the day before).
- [ ] Gemini billing cap/budget alert set; Resend/Gemini/Neon keys NOT in the repo (`git log -p | grep -i key` sanity check).

## C. 5-minute demo script
| Min | Show | Say |
|---|---|---|
| 0:00 | Command Centre | "Vikram opens this twice a week. Top: last run time, status, and the **Integrity badge** — founder data intact." |
| 0:45 | Today's Actions → open #1 | "Reach out now: a real, dated, linked signal. Score 86/100 — here's the breakdown: relevance, recency, strength, corroboration, evidence quality, fund fit. Source link opens the actual article; the quote is verified to exist in the page." |
| 1:45 | A HOLD and a FOLLOW-UP VC | "Same strong signal, but Vikram emailed 3 days ago ⇒ HOLD. Another: he emailed 18 days ago and this signal is *newer* than his email ⇒ FOLLOW UP NOW — a natural hook." |
| 2:30 | Quiet Investors | "Quiet isn't 'uninterested'. Exact wording, plus which sources we checked. A VC whose source failed shows **Incomplete**, never quiet." |
| 3:00 | Run audit → Rejected evidence | "Here's what we ignored and why: old article resurfaced, no verifiable date, wrong 'Accel', syndicated copy. Auditability builds trust." |
| 3:45 | Neon SQL editor + `guard_test` | "Only 4 columns change per run. Even the table owner can't alter notes without the founder path. 31 SQL tests prove it; every run stores a SHA-256 receipt." |
| 4:30 | LLM ledger + Components Map | "Every model call is logged; the DB rejects non-Gemini model names. Cron: Mon+Thu, with a GitHub backup; idempotent." |
| 5:00 | (if time) Press **Run now** | "Chunked queue; resumes if Vercel times out." |

## D. Viva cheat-sheet (likely questions → crisp answers)
1. **How do you guarantee notes aren't overwritten?** Four layers: app role has no table privileges; the only write path is `apply_assessment()` naming columns explicitly; a trigger rejects any protected-column change even by the table owner; each run stores before/after SHA-256 of all founder data. 31 SQL tests, incl. a malicious payload that tries to set `personal_notes`.
2. **How do you know a signal is from the last 30 days?** A date-resolution ladder (JSON-LD → meta → feed → `<time>` → URL → explicit text); never retrieval time or `dateModified`; resurfaced old articles rejected; unknown date ⇒ not a signal.
3. **How do you stop the LLM hallucinating?** It only extracts; evidence excerpt must exist verbatim in the fetched page (quote verification); schema validation; scores/actions are deterministic code; injected instructions have no channel to influence them.
4. **Quiet vs. search failed?** Assessment status: QUIET needs adequate source coverage; otherwise PARTIAL/FAILED ⇒ ASSESSMENT_INCOMPLETE.
5. **Why can a high score still be HOLD?** Score = strength of the moment; action also depends on Vikram's relationship (waiting/recent contact/reconnect date/passed).
6. **Why is the score NULL for quiet VCs?** A fake 0 or fit-only number would imply an opportunity signal; fit is shown separately.
7. **How is "Gemini only" enforced?** One wrapper; `llm_calls` ledger with a DB CHECK that the model starts with `gemini-`; CI script fails on any Anthropic/other-LLM dependency; Tavily/Exa used raw-results-only.
8. **Twice a week on Vercel Hobby?** Cron `0 3 * * 1,4` (Hobby allows once/day max; fires within the hour, UTC) + GitHub Actions backup; `run_key` makes duplicates collapse.
9. **50 VCs vs serverless time limits?** Work queue (`claim_run_tasks`, skip-locked, retries) + time-budgeted slices that continue themselves; Resume button.
10. **Wrong VC (e.g., "Accel" vs "accelerate")?** Alias index with whole-word matching, collision list needing VC-context words, optional Gemini disambiguation, else reject.
11. **Firm vs partner attribution?** Firm-level by default; person-level only for tracked people named in the excerpt with an explicit role.
12. **What data goes to Gemini?** Public web text + company profile only. Never notes/contact history (free-tier data can be used by Google).
13. **Limitations?** No LinkedIn/X; seed thesis tags are unverified hints; relationship data is synthetic; Hobby cron ±59 min; free-tier Gemini can't ground on 3.x.
14. **Cost?** ≈ $1 per full run on paid Gemini (estimate), everything else free tier.
15. **What next?** Outcome-based calibration with enough samples, portfolio-diff, more verified sources, multi-user.
