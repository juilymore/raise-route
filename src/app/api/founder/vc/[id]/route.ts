import { z } from "zod";
import { founderDb } from "@/lib/db/founderDb";
import { gateFounder, json } from "@/lib/founder/guard";

export const dynamic = "force-dynamic";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((s) => !Number.isNaN(Date.parse(s)), "invalid date");
const Patch = z
  .object({
    personal_notes: z.string().max(5000).nullable().optional(),
    contact_status: z.enum(["TO_REACH_OUT", "WAITING_FOR_RESPONSE", "IN_CONVERSATION", "MEETING_SCHEDULED", "PASSED"]).optional(),
    last_contact_date: isoDate.nullable().optional(),
    reconnect_after: isoDate.nullable().optional(),
  })
  .strict();

/** Founder edits their own relationship data. ONLY through the founder_update_vc RPC (the DB guard rejects anything else). */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = await gateFounder(req, { limitKey: "vc-edit" });
  if (denied) return denied;
  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) return json({ error: "invalid id" }, 400);
  const parsed = Patch.safeParse(await req.json().catch(() => null));
  if (!parsed.success || Object.keys(parsed.data).length === 0) return json({ error: "invalid body" }, 400);
  try {
    // "" / null clears a date or note
    const patch = Object.fromEntries(Object.entries(parsed.data).map(([k, v]) => [k, v ?? ""]));
    await founderDb.updateVc(id, patch);
    return json({ ok: true });
  } catch (e) {
    console.error("[founder vc patch]", (e as Error).message);
    return json({ error: "could not save" }, 500);
  }
}
