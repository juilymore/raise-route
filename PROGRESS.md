# RaiseRoute build progress (resume notes)

Rules from the user: Neon (not Supabase); app name only in src/config/brand.ts; Mon+Thu cron + Run now; do not wait for approval between
phases, ask only when something is overcomplicated; P10-P13 are done at the very end; P12 optional. Gemini only for AI.

| Phase | State |
|---|---|
| P00-P05 | done and audited (engine 30/30 golden, sources, Gemini layer, evals 40/40 checks, 15 cases) |
| P06 pipeline | done: live 5-VC and full 50-VC runs COMPLETED, receipt founder_data_intact=true |
| P07 dashboard | done: /, /pipeline, /vc/[slug], /runs, /runs/[id], /settings; screenshots in docs/screenshots |
| P08 founder auth | done: signed cookie, guarded routes, Run now/Resume, headers; curl 401/403/200 transcript verified |
| P09 deploy | DEPLOYED: https://raiseroute.vercel.app (Vercel project raiseroute, env vars set, cron Mon+Thu). Production run via /api/cron/run was started; check it finished. |
| GitHub public repo | BLOCKED by permission classifier (creating a public repo); needs the user to allow or create it. Code is committed locally. |
| P10-P13 | not started (user wants these last): feedback/calibration/outreach, digest email, optional wow, hardening + /components-map + /data-honesty + AUDIT_RESULT.md + SUBMISSION.md |

To resume: tell Claude "resume from PROGRESS.md". Run `npm run verify` first. Local dev: `npm run dev`. Run pipeline locally: `npm run pipeline:run`.
