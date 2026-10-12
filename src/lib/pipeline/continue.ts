import { waitUntil } from "@vercel/functions";
import { getEnv } from "@/lib/env";
import { runPipeline, type RunResult } from "./orchestrator";

/**
 * Run one time-boxed chunk; if tasks remain, fire the next chunk (POST /api/pipeline/continue) in the background so the run
 * keeps going without anyone waiting. Never assume one invocation fits 50 VCs.
 */
export async function runChunkAndContinue(opts: { trigger: "manual" | "cron" | "github_action"; runId?: string; runKey?: string }): Promise<RunResult> {
  const env = getEnv();
  const result = await runPipeline({ trigger: opts.trigger, runId: opts.runId, runKey: opts.runKey, budgetMs: env.PIPELINE_TIME_BUDGET_MS });
  if (!result.done && env.CRON_SECRET) {
    const next = fetch(`${env.APP_BASE_URL}/api/pipeline/continue`, {
      method: "POST",
      headers: { authorization: `Bearer ${env.CRON_SECRET}`, "content-type": "application/json" },
      body: JSON.stringify({ runId: result.runId }),
    }).catch((e) => console.error("[pipeline] could not trigger the next chunk:", (e as Error).message));
    waitUntil(next);
  }
  return result;
}
