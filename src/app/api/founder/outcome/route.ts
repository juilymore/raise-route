import { z } from "zod";
import { query } from "@/lib/db/client";
import { founderDb } from "@/lib/db/founderDb";
import { gateFounder, json } from "@/lib/founder/guard";

export const dynamic = "force-dynamic";

const Body = z
  .object({
    vcId: z.string().uuid(),
    recommendationId: z.string().uuid().optional(),
    outcome: z.enum(["RESPONSE_RECEIVED", "MEETING_BOOKED", "PASSED", "NO_RESPONSE"]),
    occurredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    note: z.string().max(500).optional(),
  })
  .strict();

/** Real-world outcome of a reach-out (kept separate from feedback on the recommendation). INSERT-only. */
export async function POST(req: Request) {
  const denied = await gateFounder(req, { limitKey: "outcome" });
  if (denied) return denied;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: "invalid body" }, 400);
  const b = parsed.data;
  try {
    const [vc] = await query("select 1 from public.vc_pipeline where id = $1", [b.vcId]);
    if (!vc) return json({ error: "unknown investor" }, 404);
    await founderDb.insert("outreach_outcomes", { vc_id: b.vcId, recommendation_id: b.recommendationId ?? null, outcome: b.outcome, occurred_on: b.occurredOn ?? new Date().toISOString().slice(0, 10), note: b.note ?? null });
    return json({ ok: true });
  } catch (e) {
    console.error("[outcome]", (e as Error).message);
    return json({ error: "could not save" }, 500);
  }
}
