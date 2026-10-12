// npm run inspect:run [-- <run_key>]  - prints what the latest (or given) run found, straight from the database. Read-only.
import { connectOwner } from "./_db.mjs";

const c = await connectOwner();
const key = process.argv[2];
const run = (await c.query(key ? "select * from public.pipeline_runs where run_key = $1" : "select * from public.pipeline_runs order by started_at desc limit 1", key ? [key] : [])).rows[0];
if (!run) {
  console.log("no run found");
  process.exit(1);
}
console.log(`RUN ${run.run_key}  status=${run.status}  receipt founder_data_intact=${run.founder_data_intact}  vcs=${run.vcs_total} signal=${run.vcs_signal_found} quiet=${run.vcs_quiet} partial=${run.vcs_partial} failed=${run.vcs_failed}`);
console.log(`     candidates=${run.candidates_found} signals_qualified=${run.signals_qualified} llm_calls=${run.llm_calls} tokens=${run.llm_tokens_in}/${run.llm_tokens_out} errors=${run.error_count}`);
const vcs = (await c.query("select id, firm, recommended_action, follow_up_score, assessment_status, last_signal_date, signal_summary, action_reason, last_run_id from public.vc_pipeline where last_run_id = $1 order by firm", [run.id])).rows;
for (const v of vcs) {
  console.log(`\n${v.firm}: ${v.recommended_action} score=${v.follow_up_score ?? "null"} status=${v.assessment_status} last_signal=${v.last_signal_date?.toISOString?.().slice(0, 10) ?? "none"}`);
  if (v.signal_summary) console.log(`   why: ${v.signal_summary}`);
  const t = (await c.query("select stats from public.run_tasks where run_id=$1 and vc_id=$2", [run.id, v.id])).rows[0];
  if (t) console.log(`   channels=${JSON.stringify(t.stats.channels)} cands=${JSON.stringify(t.stats.candidates)} rejected=${JSON.stringify(t.stats.rejected)}`);
  const sg = (await c.query("select signal_type, relevance_tier, event_date, primary_source_url, excerpt_verified, title from public.signals where vc_id=$1 order by event_date desc limit 4", [v.id])).rows;
  for (const s of sg) console.log(`   signal ${s.event_date.toISOString().slice(0, 10)} ${s.signal_type}/${s.relevance_tier} verified=${s.excerpt_verified} ${s.title.slice(0, 70)}\n      ${s.primary_source_url}`);
}
const rej = (await c.query("select rejection_code, count(*)::int n from public.evidence_candidates where last_seen_run_id=$1 and status='REJECTED' group by 1 order by 2 desc", [run.id])).rows;
console.log("\nrejected evidence by reason:", rej.map((r) => `${r.rejection_code}=${r.n}`).join("  ") || "none");
const llm = (await c.query("select model, purpose, status, count(*)::int n from public.llm_calls where run_id=$1 group by 1,2,3 order by 1,2,3", [run.id])).rows;
console.log("llm ledger:", llm.map((r) => `${r.model}/${r.purpose}/${r.status}=${r.n}`).join("  "));
await c.end();
