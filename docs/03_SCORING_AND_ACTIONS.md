# 03 · Scoring & Action Rules (v1.0.0)

**Source of truth:** `config/scoring.v1.json` (numbers) · `scripts/reference_engine.py` (logic) · `config/golden_vectors.json` (30 input→output vectors).
The TypeScript engine in `src/lib/engine/` **must reproduce every golden vector exactly** (a vitest test loads the JSON). Rounding is **round-half-up** per component (`Math.floor(x + 0.5)`), *not* banker's rounding.

## 1. Design decisions (and why they differ from the first-draft plan)
1. **Score = how strong the moment is. Action = what Vikram should do.** Relationship state is **not** in the score (the draft had a 10-pt "relationship readiness" *and* relationship overrides → double counting). Relationship acts only in the action engine; stable fund fit (10 pts) replaces it.
2. **No qualifying signal ⇒ `follow_up_score = NULL`** (never 0, never a "fit-only" score that looks like an opportunity). `fit_score` is stored separately.
3. **Relevance damps the relevance-blind components.** Recency and evidence quality are multiplied by a tier factor (direct/adjacent 1.0 · b2b_saas 0.75 · broad 0.35). Without this, a fresh, well-sourced post about AI chips scored 49 and landed on MONITOR — the golden vectors V09/V28 now prove it can't.
4. **Gates, not just thresholds.** High score alone never yields REACH_OUT_NOW/FOLLOW_UP_NOW; evidence, stage, relevance, commitment and freshness gates must pass.
5. **Per-signal points + set-level corroboration.** The *top* signal supplies relevance/recency/strength/evidence; corroboration (independent events, independent sources) and fund fit are added at VC level.

## 2. The 100 points
| Factor | Max | Rule |
|---|---|---|
| **Relevance** | 30 | `round(30 × tier_weight)` — direct 1.0 · adjacent 0.6 · b2b_saas 0.4 · broad 0.15 · none 0 (not a signal). Tier = Gemini's tier **downgraded** by keyword cross-check (`config/taxonomy.json`). |
| **Recency** | 20 | `max(1, round(20 × (1 − age/30) × damping))`, `age = run_date − event_date` (event date, never retrieval date). Out of window (>30d, or >1 day in the future) ⇒ not a signal. |
| **Strength** | 20 | `round(base[signal_type] × tier_multiplier × commitment_multiplier)`; investment 20 · portfolio 18 · thesis 15 · fund_news 14 · blog 13 · interview/podcast/conference 12 · team/news mention 8 · other 5. Commitment (investment & portfolio only): confirmed 1.0 · reported 0.8 · **rumor 0.4**. |
| **Corroboration** | 10 | Over qualifying *direct/adjacent* events: `min(8, 4 × (n − 1))` + **2** if the top event has ≥2 *independent* sources. Syndicated copies are not independent. |
| **Evidence quality** | 10 | source type (4 official/portfolio · 3 reputable news/event/podcast/video · 2 trade press · 1 social/other) + date basis (3 structured · 2 published/explicit · 1 first-observed) + 2 if excerpt verified + 1 if URL ok; then × damping; **synthetic capped at 3**. |
| **Fund fit** | 10 | stage (0–4; PRESEED_SEED/SEED_EARLY 4, MULTI_STAGE 3, ACCELERATOR 2, EARLY_GROWTH 1, GROWTH 0, UNKNOWN **2 neutral**) + sector (0–4 best tag; logistics/supply_chain 4, industrial/mobility/proptech/b2b_saas/enterprise 3, …, unknown 2) + geography (match/global 2, company geography unknown **1 neutral**, mismatch 0). Unknown stays unknown — never invented. |

**Top signal** = highest (relevance+recency+strength+evidence); tie → newer event, then more independent sources. **Score** = top.sum + corroboration + fund_fit (≤100).

## 3. Action engine — first matching rule wins
Inputs: score result, `contact_status`, `last_contact_date`, `reconnect_after`, `assessment_status`, today.
`strong_ok` (gate) = qualifying signal ∧ top tier ∈ {direct, adjacent} ∧ excerpt verified ∧ fund stage points ≥ 1 ∧ not synthetic ∧ commitment ≠ rumor ∧ event age ≤ 21 days.
`monitor_ok` = qualifying signal ∧ top tier ∈ {direct, adjacent, b2b_saas}.

| # | Condition | Action (hold reason) | Reason code |
|---|---|---|---|
| 0 | assessment FAILED, or PARTIAL with no signal | **ASSESSMENT_INCOMPLETE** | INCOMPLETE |
| 1 | `PASSED` and reconnect date reached and score ≥60 and `strong_ok` | **MONITOR** | REOPEN_WINDOW |
| 1b | `PASSED` otherwise | **DONT_PRIORITIZE** | PASSED |
| 2 | `reconnect_after` in the future | **HOLD** (RECONNECT_DATE) | RECONNECT_DATE |
| 3 | `IN_CONVERSATION` / `MEETING_SCHEDULED` | **HOLD** (ACTIVE_CONVERSATION) — mention signal as a *conversation hook* if score ≥50 ∧ `strong_ok` | ACTIVE_CONVERSATION[_WITH_HOOK] |
| 4a | `WAITING_FOR_RESPONSE`, unknown contact date | **HOLD** (AWAITING_RESPONSE) | AWAITING_RESPONSE |
| 4b | waiting, `<7` days since contact | **HOLD** (RECENT_CONTACT) | RECENT_CONTACT |
| 4c | waiting ≥7d ∧ top signal **post-dates last contact** ∧ score ≥50 ∧ `strong_ok` | **FOLLOW_UP_NOW** | NEW_HOOK_SINCE_CONTACT |
| 4d | waiting ≥7d ∧ `monitor_ok` ∧ score ≥35 | **MONITOR** | WAITING_NO_STRONG_HOOK |
| 4e | otherwise | **DONT_PRIORITIZE** | NO_HOOK / OVERDUE_NO_HOOK (≥14d) |
| 5a | `TO_REACH_OUT`, no qualifying signal | **DONT_PRIORITIZE** (quiet) | QUIET |
| 5b | `strong_ok` ∧ score ≥60 | **REACH_OUT_NOW** | STRONG_RELEVANT_SIGNAL |
| 5c | `monitor_ok` ∧ score ≥35 | **MONITOR** | MODERATE_SIGNAL / GATE_CAPPED |
| 5d | signal but not `monitor_ok` (generic activity) | **DONT_PRIORITIZE** | GENERIC_ACTIVITY_NOT_RELEVANT |
| 5e | else | **DONT_PRIORITIZE** | WEAK_SIGNAL |

*Known simplification (documented, intentional):* the FOLLOW_UP "hook" test uses the **top** signal only; if the best signal pre-dates the last contact but a weaker newer one exists, result is MONITOR.
`MONITOR` for `GATE_CAPPED` means "good score but a gate failed" — the UI must name the failed gate (stage mismatch, rumor, aging, unverified, synthetic).

## 4. Worked examples (all reproduced by the reference engine)
**V02 — strong, fresh, relevant.** Direct investment 5 days ago, official portfolio announcement, JSON-LD date, quote verified, seed-focused logistics fund, company geography unknown, VC `TO_REACH_OUT`:
relevance 30 + recency 17 (20×25/30=16.7) + strength 20 + corroboration 0 + evidence 10 (4+3+2+1) + fit 9 (4+4+1) = **86 → REACH_OUT_NOW**.
Same signal but Vikram emailed 3 days ago → **HOLD (RECENT_CONTACT)** (V03). Emailed 18 days ago and the signal is newer than that email → **FOLLOW_UP_NOW** (V04). Passed → **DONT_PRIORITIZE** (V07). Growth-stage fund → score 79 but **MONITOR / GATE_CAPPED** (V08).

**V09 — fresh but irrelevant (the "AI chips" case).** Broad-tier blog post 2 days ago, official blog:
5 + 7 (18.7×0.35) + 7 (13×0.5) + 0 + 4 (10×0.35) + 8 = **31 → DONT_PRIORITIZE (GENERIC_ACTIVITY_NOT_RELEVANT)**. Even an *investment* in an unrelated company 1 day ago only reaches 34 (V28).

**V13 — corroboration.** Direct investment 6d (two independent sources) + direct blog 14d: top = 30+16+20+10 = 76, corroboration 4+2 = 6, fit 9 → **91**.

**V16 — rumor.** Investment "reported as rumor" 3 days ago: strength 20×0.4 = 8 → score 73 but **MONITOR** (rumor gate).

**V27 — aging.** Direct podcast 25 days ago scores 61 but **MONITOR** (freshness gate: >21 days).

## 5. Language rules (exact strings in `config.language`)
Quiet: *"No qualifying signal found in the sources checked in the past 30 days."* · Incomplete: *"Assessment incomplete: one or more sources could not be checked. This is not evidence of inactivity."* Never write "not interested", "uninterested", or "inactive" about a VC.

## 6. Changing a rule
Edit the Python reference → `python3 scripts/reference_engine.py` (regenerates vectors) → bump `version` in `config/scoring.v1.json` → port to TS → `npm test`. Old recommendation snapshots keep their own `scoring_version`.
