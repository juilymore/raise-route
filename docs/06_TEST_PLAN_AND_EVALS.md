# 06 · Test Plan & Evals

**Rule:** a phase is DONE only when `npm run verify` is green **and** you can show evidence for that phase's acceptance criteria. Test behaviour, not compilation.

## Test layers
| Layer | Tool | Scope | Where |
|---|---|---|---|
| SQL guard tests | `psql -f` (31 checks, already green) | 4-layer Integrity Guard, immutability, receipts, ledger, queue | `db/tests/guard_test.sql` (`npm run db:test`) |
| Golden engine tests | Vitest | TS scoring+actions == `config/golden_vectors.json` (30 vectors, exact) | `tests/golden/engine.test.ts` |
| Unit | Vitest | validators V1–V15, date ladder, SSRF guard, alias/collision matcher, dedupe/shingles, taxonomy downgrade, digest builder, zod schemas | `tests/unit/*` |
| Integration (fixtures) | Vitest + recorded HTTP/Gemini fixtures | one VC end-to-end: fixtures → candidates → extraction → signals → recommendation → RPC; failure injection | `tests/integration/*`, `fixtures/*` |
| Evals (real Gemini) | `npm run evals` | extraction quality on ≤25 labelled cases, prompt-injection canary | `tests/evals/*` |
| Compliance gate | `node scripts/check-compliance.mjs` | no Claude API, pipeline can't touch founder data, no client secrets | part of `verify` |
| Live smoke | manual + script | deployed URL: pages load, `/api/health`, one real run | docs/09 checklist |

## Behaviour checklist (each item must map to a named test)
**Data** — 50 VCs load · company profile loads · relationship state loads · **run → founder fingerprint unchanged** (pipeline integration test compares `founder_data_fingerprint()` before/after) · Settings edit changes receipt to NULL not ❌.
**Signals** — valid recent accepted · 31-day-old rejected `OLD_EVENT` · +3-day future rejected · no date ⇒ `DATE_UNVERIFIED` · resurfaced old article rejected · wrong-VC (collision) rejected · mentioned-only rejected · quote not in text rejected · duplicate merged · syndicated copy not independent · two independent sources preserved · synthetic never counted as live.
**Scoring/actions** — all 30 golden vectors · deterministic (run twice = same) · version recorded · relevance ≠ recency (V09/V28) · rumor/aging/stage/synthetic/unverified gates · waiting ⇒ HOLD · future reconnect ⇒ HOLD · **failed retrieval ⇒ INCOMPLETE not quiet** · no signal ⇒ score NULL and never REACH_OUT_NOW.
**Pipeline** — idempotent `run_key` (cron + GitHub same day = 1 run) · chunking resumes after simulated timeout · one VC failing doesn't stop the run · Gemini 429/timeout/malformed/404-model paths · quota cap ⇒ PARTIAL · repeat run doesn't duplicate signals/snapshots (unique constraints) · `prev_*` rolls once per run.
**UI** — counts match `v_pipeline_overview` · filters/search · quiet copy exact · drill-downs · source links open · AI vs Founder labelling · mobile layout · public visitor can't write.
**Feedback** — attaches to the right `recommendation_id` · doesn't mutate relationship data · stats show n.
**Email** — digest built from snapshots · later score change doesn't alter an old digest · `SENT` only with provider id · missing key ⇒ `DEV_NOT_SENT` shown honestly · idempotent per run.
**Security** — cron route rejects missing/wrong bearer · POST without founder cookie ⇒ 401 · SSRF payloads blocked (`http://169.254.169.254`, `http://localhost`, redirect-to-private, decimal/hex IPs) · no secrets in client bundle (grep build output) · notes never in any Gemini request (test asserts prompt builders can't receive them).

## Evidence format for the final audit
`Requirement | Test name / command | Result (observed this session) | PASS/FAIL/PARTIAL` — filled by the **exam-auditor** subagent (`/exam-audit`), saved to `docs/AUDIT_RESULT.md`.
