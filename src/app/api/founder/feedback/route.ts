import { z } from "zod";
import { query } from "@/lib/db/client";
import { founderDb } from "@/lib/db/founderDb";
import { gateFounder, json } from "@/lib/founder/guard";

export const dynamic = "force-dynamic";

const REASONS = ["WRONG_RELEVANCE", "WRONG_ATTRIBUTION", "SIGNAL_TOO_WEAK", "SIGNAL_TOO_OLD", "SOURCE_UNRELIABLE", "SCORE_TOO_HIGH", "SCORE_TOO_LOW", "RELATIONSHIP_MISUNDERSTOOD", "OTHER"] as const;
const Body = z
  .object({
    recommendationId: z.string().uuid(),
    vote: z.enum(["POSITIVE", "NEGATIVE"]),
    reasons: z.array(z.enum(REASONS)).max(9).default([]),
    note: z.string().max(500).optional(),
  })
  .strict();

/**
 * 👍/👎 on a recommendation, bound to that exact recommendation snapshot. INSERT-only into `feedback`:
 * it never edits founder data and never changes scoring (the copy on /calibration says so).
 */
export async function POST(req: Request) {
  const denied = await gateFounder(req, { limitKey: "feedback" });
  if (denied) return denied;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: "invalid body" }, 400);
  const b = parsed.data;
  if (b.vote === "NEGATIVE" && b.reasons.length === 0) return json({ error: "pick at least one reason for a thumbs-down" }, 400);
  try {
    const [rec] = await query<{ vc_id: string }>("select vc_id from public.recommendations where id = $1", [b.recommendationId]);
    if (!rec) return json({ error: "unknown recommendation" }, 404);
    await founderDb.insert("feedback", { recommendation_id: b.recommendationId, vc_id: rec.vc_id, vote: b.vote, reasons: b.vote === "NEGATIVE" ? b.reasons : [], note: b.note ?? null });
    return json({ ok: true });
  } catch (e) {
    console.error("[feedback]", (e as Error).message);
    return json({ error: "could not save" }, 500);
  }
}
