import { connectOwner } from "./_db.mjs";
const c = await connectOwner();
const r = await c.query("select status,count(*)::int n from public.run_tasks where run_id=(select id from public.pipeline_runs order by started_at desc limit 1) group by 1 order by 1");
console.log(r.rows.map((x) => `${x.status}=${x.n}`).join(" "));
await c.end();
