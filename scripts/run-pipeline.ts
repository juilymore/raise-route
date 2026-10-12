/**
 * npm run pipeline:run [-- --only=slug1,slug2] [-- --run-key=...]
 * Runs the real pipeline from the command line (no web server needed). Same code path as the API routes.
 *   --only=a,b  only create tasks for these VC slugs (first live trial). Without it, all VCs are processed.
 */
// @ts-expect-error plain JS helper
import { loadEnv } from "./_db.mjs";
import { runPipeline } from "../src/lib/pipeline/orchestrator";

loadEnv();
async function main() {
  const onlyArg = process.argv.find((a) => a.startsWith("--only="));
  const onlySlugs = onlyArg ? onlyArg.slice(7).split(",") : undefined;
  const keyArg = process.argv.find((a) => a.startsWith("--run-key="));
  const runKey = keyArg?.slice(10) ?? `manual-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const t = Date.now();
  let result = await runPipeline({
    trigger: "manual",
    runKey,
    budgetMs: Number(process.env.PIPELINE_TIME_BUDGET_MS ?? 240000),
    onlySlugs,
  });
  console.log(`chunk 1: processed ${result.processed}, remaining ${result.remaining}, status ${result.status}`);
  let chunk = 1;
  while (!result.done && chunk < 40) {
    chunk++;
    result = await runPipeline({ trigger: "manual", runId: result.runId, budgetMs: Number(process.env.PIPELINE_TIME_BUDGET_MS ?? 240000), onlySlugs });
    console.log(`chunk ${chunk}: processed ${result.processed}, remaining ${result.remaining}, status ${result.status}`);
  }
  console.log(`\nrun ${result.runKey} (${result.runId}) -> ${result.status} in ${((Date.now() - t) / 1000).toFixed(0)}s`);
  process.exit(result.done ? 0 : 1);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
