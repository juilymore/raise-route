# EXAM BRIEF (authoritative — transcribed from Problem_Statement_10.pdf)

> MESA COHORT C4 · AI and its Applications — Section 1 Final Examination · PROBLEM STATEMENT BOOKLET

## Instructions to Students
1. Read your assigned problem statement carefully.
2. Your solution must use **live external data wherever possible**. The system must work with **some data at the time of submission**.
3. **All AI tasks must use Gemini Flash. Do not use Claude API.**
4. **Deploy your solution on Vercel.** Submit a **working public URL** along with your **GitHub repository link** and the **Components Map**.

## Problem 10 — High Difficulty
**VC Fundraising Pipeline Intelligence** · Startup Fundraising • Founder Tools • SaaS-able

Vikram is a first-time founder raising a Seed round for his B2B logistics SaaS. He has been at it for two months and has a list of fifty VCs he's tracking — name, firm, thesis, the last time they were in contact, and whether he is waiting for a response or yet to reach out. He maintains this in a spreadsheet, but it's manual and doesn't tell him the most important thing: who is worth reaching out to right now.

A VC who just published a blog post about supply chain tech, made a new portfolio investment in a logistics company, or spoke at an industry event last week is signal: they're actively thinking about this space, which means Vikram's message will land in a more receptive moment. A VC who has been quiet for three months is probably not the right one to chase this week.

What Vikram wants is straightforward: **twice a week**, before he starts working his pipeline, he wants to know **which VCs on his list are actually worth reaching out to this week, and why**. Not a hunch — an actual, **observable signal from the past thirty days**. Something they **wrote, said in an interview, invested in, or appeared at**. For the VCs who have been **quiet**, he wants to know that too, so he knows where not to spend energy right now. **Every time the system runs, his Supabase table should reflect the current state of each relationship** — so when he opens his pipeline, it is already up to date.

Critically, the system **must not overwrite Vikram's manual notes** in the Supabase table. It should update **only the signal-derived columns — last signal date, signal summary, follow-up score, and recommended action**. Vikram's **contact history and personal notes columns must remain untouched**.

**Build and deploy this VC pipeline intelligence system for Vikram.**

---

## Reading guide (added by the project team — not part of the exam text)

| # | Exam requirement (testable form) | Where it lives in this project |
|---|---|---|
| E1 | Live external data wherever possible | docs/05_SOURCES_AND_DISCOVERY.md |
| E2 | Works with some real data at submission time | Run the pipeline ≥ 3× before submitting (docs/09) |
| E3 | ALL AI = Gemini Flash; no Claude API | docs/04_GEMINI_CONTRACT.md · scripts/check-compliance.mjs · `llm_calls` ledger |
| E4 | Deployed on Vercel, public URL | docs/09_SUBMISSION_AND_DEMO.md |
| E5 | GitHub repo link | docs/09 |
| E6 | Components Map | docs/02_ARCHITECTURE_AND_COMPONENTS_MAP.md (+ in-app `/components-map`) |
| E7 | Runs **twice a week**, before Vikram starts work | vercel.json cron `0 3 * * 1,4` + GitHub backup |
| E8 | Which VCs to reach out to this week **and why** | Today's Actions + score breakdown |
| E9 | Evidence = observable signal from the **past 30 days** (wrote / said / invested / appeared) | signal types + 30-day window |
| E10 | **Quiet VCs** surfaced | Quiet Investors view |
| E11 | Supabase table reflects current state after every run | `vc_pipeline` table |
| E12 | Update ONLY: last signal date, signal summary, follow-up score, recommended action | `apply_assessment()` RPC |
| E13 | Contact history + personal notes NEVER touched | Integrity Guard (db/migrations/0002_guards.sql) |
