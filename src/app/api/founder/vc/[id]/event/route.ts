import { z } from "zod";
import { founderDb } from "@/lib/db/founderDb";
import { gateFounder, json } from "@/lib/founder/guard";

export const dynamic = "force-dynamic";

const Event = z
  .object({
    at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    type: z.enum(["email_sent", "follow_up_sent", "dm_sent", "call", "meeting", "email_received", "note"]),
    summary: z.string().min(1).max(500),
  })
  .strict();

/** Append one entry to the contact history (append-only) via founder_append_contact_event. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = await gateFounder(req, { limitKey: "vc-event" });
  if (denied) return denied;
  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) return json({ error: "invalid id" }, 400);
  const parsed = Event.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: "invalid body" }, 400);
  try {
    await founderDb.appendContactEvent(id, parsed.data);
    return json({ ok: true });
  } catch (e) {
    console.error("[founder vc event]", (e as Error).message);
    return json({ error: "could not save" }, 500);
  }
}
