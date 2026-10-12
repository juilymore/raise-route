import { z } from "zod";
import { query } from "@/lib/db/client";
import { founderDb } from "@/lib/db/founderDb";
import { gateFounder, json } from "@/lib/founder/guard";

export const dynamic = "force-dynamic";

const Patch = z
  .object({
    company_name: z.string().min(1).max(120),
    product_description: z.string().min(10).max(3000),
    sector: z.string().min(1).max(120),
    business_model: z.string().max(300),
    stage: z.string().min(1).max(60),
    geography: z.string().max(200).nullable(),
    icp: z.string().max(600).nullable(),
    raise_context: z.string().max(600).nullable(),
    relevance_keywords: z.array(z.string().min(1).max(60)).max(60),
  })
  .partial()
  .strict();

/** Edit the company profile in Settings. Saving it also clears the "sample" flag. */
export async function PATCH(req: Request) {
  const denied = await gateFounder(req, { limitKey: "company" });
  if (denied) return denied;
  const parsed = Patch.safeParse(await req.json().catch(() => null));
  if (!parsed.success || Object.keys(parsed.data).length === 0) return json({ error: "invalid body" }, 400);
  try {
    await founderDb.updateCompanyProfile(parsed.data);
    await query("insert into public.app_settings (key, value) values ('company_profile_is_sample', '{\"value\": false}'::jsonb) on conflict (key) do update set value = excluded.value, updated_at = now()");
    return json({ ok: true });
  } catch (e) {
    console.error("[founder company]", (e as Error).message);
    return json({ error: "could not save" }, 500);
  }
}
