# RaiseRoute build progress (resume notes)

Rules from the user: Neon (not Supabase); app name only in src/config/brand.ts; no cron (manual "Run now"); do not wait for
approval between phases, only ask when something is overcomplicated; P10-P13 are done at the very end. Gemini only for AI.

| Phase | State |
|---|---|
| P00 plan | done |
| P01 foundation | done, audited |
| P02 Neon + seed + /pipeline | done, audited (db:test 30/30) |
| P03 pure engine | done, 30/30 golden vectors; audit fixes applied (108 tests green) |
| P04 sources + fetcher | IN PROGRESS: src/lib/sources/{types,fetcher,extract}.ts written; still to do: feeds, googleNews (decoder verified live), discovery, sectorFeeds, searchApis, candidates, scripts/smoke-sources.ts, fixtures, tests |
| P05..P09 | not started |

To resume: tell Claude "resume from PROGRESS.md". Run `npm run verify` first.
