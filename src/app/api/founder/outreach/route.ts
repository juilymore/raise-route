import { z } from "zod";
import { query } from "@/lib/db/client";
import { pipelineDb } from "@/lib/db/pipelineDb";
import { gateFounder, json } from "@/lib/founder/guard";
import { createGeminiFromEnv } from "@/lib/gemini";
import { generateOutreach, type DraftSignal } from "@/lib/gemini/outreach";
import { getConfig } from "@/lib/config";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const Body = z.object({ vcId: z.string().uuid() }).strict();
const STATUS_LABEL: Record<string, string> = {
  TO_REACH_OUT: "not contacted yet", WAITING_FOR_RESPONSE: "waiting for a response", IN_CONVERSATION: "in conversation", MEETING_SCHEDULED: "meeting scheduled", PASSED: "passed earlier",
};

/**
 * Draft a first-contact email with Gemini from VALIDATED signals only. It is stored and returned for the founder to copy; it is NEVER sent.
 * The model sees the company profile, the investor's firm name, the signal facts and a status label. It never sees the founder's notes or history.
 */
export async function POST(req: Request) {
  const denied = await gateFounder(req, { limitKey: "outreach", max: 10 });
  if (denied) return denied;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: "invalid body" }, 400);
  try {
    const vcs = await pipelineDb.listVcs(); // explicit column list: no notes, no history
    const vc = vcs.find((v) => String(v.id) === parsed.data.vcId);
    if (!vc) return json({ error: "unknown investor" }, 404);
    const profile = await pipelineDb.getCompanyProfile();
    if (!profile) return json({ error: "company profile missing" }, 500);
    const cfg = getConfig().scoring;
    const rows = await pipelineDb.signalsInWindow(String(vc.id), new Date().toISOString().slice(0, 10), cfg.window_days, cfg.future_date_tolerance_days);
    const signals: DraftSignal[] = rows
      .filter((s) => s.excerpt_verified === true && !s.is_synthetic)
      .slice(0, 4)
      .map((s) => ({
        id: String(s.id), title: String(s.title), event_date: String(s.event_date), excerpt: String(s.evidence_excerpt), source_url: String(s.primary_source_url),
        attribution_level: s.attribution_level as DraftSignal["attribution_level"], attributed_person: (s.attributed_person as string | null) ?? null,
      }));
    const gemini = await createGeminiFromEnv();
    const result = await generateOutreach(
      gemini,
      {
        company: { company_name: String(profile.company_name), product_description: String(profile.product_description), icp: (profile.icp as string | null) ?? null },
        investor: { firm: String(vc.firm), aliases: (vc.aliases as string[]) ?? [] },
        signals,
        contactStatusLabel: STATUS_LABEL[String(vc.contact_status)] ?? "unknown",
      },
      { vcId: String(vc.id) },
    );
    if (!result.ok) return json({ ok: false, reason: result.reason, detail: result.detail }, result.reason === "NO_SIGNALS" ? 200 : 502);
    const [rec] = await query<{ id: string }>("select id from public.recommendations where vc_id = $1 order by created_at desc limit 1", [vc.id]);
    const saved = await pipelineDb.insert("outreach_drafts", {
      vc_id: vc.id, recommendation_id: rec?.id ?? null, signal_ids: [result.hook.id], subject: result.draft.subject, body: result.draft.body, model: result.model,
    });
    return json({
      ok: true, id: saved?.id, subject: result.draft.subject, body: result.draft.body, placeholders: result.draft.placeholders, model: result.model,
      basedOn: { title: result.hook.title, date: result.hook.event_date, url: result.hook.source_url }, sent: false,
    });
  } catch (e) {
    console.error("[outreach]", (e as Error).message);
    return json({ error: "could not draft right now" }, 500);
  }
}
