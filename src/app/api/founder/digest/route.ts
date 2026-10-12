import { z } from "zod";
import { query } from "@/lib/db/client";
import { pipelineDb } from "@/lib/db/pipelineDb";
import { createAndMaybeSendDigest } from "@/lib/digest/send";
import { gateFounder, json } from "@/lib/founder/guard";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const Body = z.object({ runId: z.string().uuid().optional(), send: z.boolean().default(false) }).strict();

/**
 * Founder-only: build the digest for a run (default: the latest finished run) and optionally send it to DIGEST_RECIPIENT.
 * Always idempotent (one digest per run). Never sends to any address except the configured recipient.
 */
export async function POST(req: Request) {
  const denied = await gateFounder(req, { limitKey: "digest", max: 6 });
  if (denied) return denied;
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return json({ error: "invalid body" }, 400);
  try {
    let runId = parsed.data.runId;
    if (!runId) {
      const [last] = await query<{ id: string }>("select id from public.pipeline_runs where status in ('COMPLETED','COMPLETED_WITH_ERRORS') order by started_at desc limit 1");
      if (!last) return json({ error: "no finished run to build a digest from" }, 404);
      runId = last.id;
    }
    const r = await createAndMaybeSendDigest(pipelineDb, { runId, send: parsed.data.send });
    return json({ ok: true, ...r });
  } catch (e) {
    console.error("[digest]", (e as Error).message);
    return json({ error: "could not build the digest" }, 500);
  }
}
