# RaiseRoute build progress (resume notes)

ALL PHASES P00-P13 DONE (P12 partial: Opportunity Matrix + as-of time travel; demo replay and portfolio-diff not built).
Live: https://raiseroute.vercel.app (Vercel project raiseroute, cron Mon+Thu 03:00 UTC). Final audit: docs/AUDIT_RESULT.md. Submission notes: docs/SUBMISSION.md.

Open items for the owner:
1. Create the PUBLIC GitHub repo (blocked for me by the permission classifier): in D:\Claude\raiseroute run
   gh repo create raiseroute --public --source=. --remote=origin --push   then put the URL in docs/SUBMISSION.md.
2. Paste the founder passcode (FOUNDER_ACCESS_CODE in .env.local) into docs/SUBMISSION.md before submitting.
3. Decide whether to send the first digest email (a PREVIEW digest exists; nothing has been sent). DIGEST_AUTO_SEND is false on Vercel.
4. After the first scheduled run (Thu 15 Oct 2026, 03:00-03:59 UTC) screenshot Vercel > Cron Jobs for E7.

Commands: npm run verify | db:test | db:migrate | db:app-role | pipeline:run | evals | scan:secrets | dev. Redeploy: npx vercel deploy --prod --yes.
Tip: bash heredocs/node -e strip backslashes in regexes in this environment; use the Write/Edit tools for regex-heavy code.
