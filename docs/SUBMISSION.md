# Submission: RaiseRoute (MESA C4, Problem 10: VC Fundraising Pipeline Intelligence)

| | |
|---|---|
| **Public URL** | https://raiseroute.vercel.app (opens without login; everything is available directly) |
| **GitHub repository** | `https://github.com/juilymore/raiseroute` *(to be created public by the owner: `gh repo create raiseroute --public --source=. --remote=origin --push`)* |
| **Components Map** | https://raiseroute.vercel.app/components-map and [`docs/02_ARCHITECTURE_AND_COMPONENTS_MAP.md`](02_ARCHITECTURE_AND_COMPONENTS_MAP.md) |
| **Login** | none: Run now, editing and drafts are available directly |
| **AI used** | Gemini Flash only (`gemini-3.8-flash`, fallbacks `gemini-3.6-flash`, `gemini-3.7-flash`). No Claude API in the product: see the AI ledger on any run page (`/runs/<id>`), the database check that rejects non-`gemini-*` model names, and `node scripts/check-compliance.mjs`. |

**One-line summary:** twice a week RaiseRoute checks 50 investors against live public sources for the last 30 days, tells the founder who is worth contacting and why with a dated, linked, verified source, keeps quiet investors visible, and never touches his notes or contact history (enforced by the database and proven by a per-run receipt).

## How it meets the brief
* **Live data:** official feeds, Google News, nine sector feeds, optional grounded search. Every signal has an event date within 30 days, a source link and a quote verified word for word in the fetched page.
* **Twice a week:** Vercel cron `0 3 * * 1,4` calls `/api/cron/run` (bearer secret), plus a founder "Run now" button. Runs are idempotent and chunked (they continue themselves across serverless time limits).
* **Table stays current:** each run updates `vc_pipeline` signal columns (last signal date, signal summary, follow-up score, recommended action) for all 50 investors through one database function.
* **Notes untouched:** four-layer Integrity Guard (privileges, single write function, trigger, SHA-256 receipt). `npm run db:test`: 30 checks pass.
* **Quiet vs incomplete:** a failed source makes an investor *Incomplete*, never *Quiet*.

## Evidence collected (see docs/AUDIT_RESULT.md)
Three real runs exist (5 investors, 50 investors, and one 50-investor run executed on Vercel through the cron route), all with `founder_data_intact = true`. One email digest exists as an archived preview.

## Known limitations (honest list)
* No LinkedIn/X and no paid data vendors. Many news sites block automated readers, so some investors show **Incomplete** instead of Quiet. This is deliberate.
* Investor contact status, dates, history and notes are **synthetic demo data**; the company profile ("FreightLoop") is a **sample**; thesis/stage/sector tags are unverified starter hints. All are labelled in the app and on `/data-honesty`.
* Gemini output is not perfectly repeatable; the validators, not the model, make the output trustworthy. Evals: 15 labelled cases, 40/40 checks and 14/14 quotes on the latest run (11/12 quotes on an earlier run; a miss is rejected, never used).
* Google News links are decoded through an undocumented Google endpoint that may change; failure is reported, never treated as "nothing found".
* The in-memory rate limiter protects one serverless instance only. The CSP allows inline scripts that Next.js needs.
* Email: the digest is built and archived; it is sent only on request or after a cron run when `DIGEST_AUTO_SEND=true`. Resend's free sender can only email the account owner.
* Not built: fixtures-based demo replay and the portfolio-diff detector (optional "wow" items).
