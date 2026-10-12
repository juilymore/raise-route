import { waitUntil } from "@vercel/functions";
import { z } from "zod";
import { query } from "@/lib/db/client";
import { getEnv } from "@/lib/env";
import { gateFounder, json } from "@/lib/founder/guard";
import { runChunkAndContinue } from "@/lib/pipeline/continue";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const Body = z.object({ resume: z.boolean().optional() }).strict();

/**
 * "Run now" / "Resume" (founder only).
 *  - a run already RUNNING is resumed instead of starting a second one (DB-level: one active run at a time)
 *  - a new manual run respects MANUAL_RUN_COOLDOWN_MINUTES
 *  - run_key is minute-granular, so a double click collapses into one run (start_run is idempotent on run_key)
 * The work continues in the background (waitUntil) and chains itself in time-boxed chunks; the response returns immediately.
 */
export async function POST(req: Request) {
  const denied = await gateFounder(req, { limitKey: "run", max: 6 });
  if (denied) return denied;
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return json({ error: "invalid body" }, 400);
  const env = getEnv();
  try {
    const [active] = await query<{ id: string; run_key: string }>("select id, run_key from public.pipeline_runs where status = 'RUNNING' order by started_at desc limit 1");
    if (active) {
      waitUntil(runChunkAndContinue({ trigger: "manual", runId: active.id }).catch((e) => console.error("[founder run resume]", (e as Error).message)));
      return json({ ok: true, resumed: true, runId: active.id, runKey: active.run_key }, 202);
    }
    if (parsed.data.resume) return json({ ok: true, resumed: false, message: "no run to resume" });
    const [recent] = await query<{ mins: number }>(
      "select extract(epoch from (now() - max(started_at)))/60 as mins from public.pipeline_runs where trigger = 'manual'",
    );
    const waited = recent?.mins === null || recent?.mins === undefined ? Infinity : Number(recent.mins);
    if (waited < env.MANUAL_RUN_COOLDOWN_MINUTES) {
      return json({ error: `please wait ${Math.ceil(env.MANUAL_RUN_COOLDOWN_MINUTES - waited)} more minute(s) before starting another run` }, 429);
    }
    const runKey = `manual-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}`;
    waitUntil(runChunkAndContinue({ trigger: "manual", runKey }).catch((e) => console.error("[founder run]", (e as Error).message)));
    return json({ ok: true, started: true, runKey }, 202);
  } catch (e) {
    console.error("[founder run]", (e as Error).message);
    return json({ error: "could not start the run" }, 500);
  }
}
