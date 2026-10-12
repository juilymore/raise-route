import { z } from "zod";
import { query } from "@/lib/db/client";
import { applyOverrides, parseStored } from "@/lib/config/effective";
import { gateFounder, json } from "@/lib/founder/guard";

export const dynamic = "force-dynamic";

const Body = z.object({ values: z.record(z.string().max(120), z.number()).refine((v) => Object.keys(v).length <= 200) }).strict();

/** Save the edited scoring numbers (Settings). Validated by the same rules as a run; the next run uses them. Defaults stay in config/scoring.v1.json. */
export async function PATCH(req: Request) {
  const denied = await gateFounder(req, { limitKey: "scoring", max: 20 });
  if (denied) return denied;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: "invalid body" }, 400);
  try {
    const [row] = await query<{ value: unknown }>("select value from public.app_settings where key = 'scoring_overrides'");
    const revision = (parseStored(row?.value)?.revision ?? 0) + 1;
    const stored = { values: parsed.data.values, revision };
    const applied = applyOverrides(stored);
    if (!applied.ok) return json({ error: applied.error }, 400);
    await query(
      "insert into public.app_settings (key, value) values ('scoring_overrides', $1::jsonb) on conflict (key) do update set value = excluded.value, updated_at = now()",
      [JSON.stringify(stored)],
    );
    return json({ ok: true, version: applied.scoring.version });
  } catch (e) {
    console.error("[founder scoring]", (e as Error).message);
    return json({ error: "could not save" }, 500);
  }
}

/** Back to the defaults in config/scoring.v1.json. */
export async function DELETE(req: Request) {
  const denied = await gateFounder(req, { limitKey: "scoring", max: 20 });
  if (denied) return denied;
  try {
    // The service role may insert/update (not delete) app_settings, so "reset" stores an empty override set.
    await query(
      "insert into public.app_settings (key, value) values ('scoring_overrides', '{\"values\": {}, \"revision\": 0}'::jsonb) on conflict (key) do update set value = excluded.value, updated_at = now()",
    );
    return json({ ok: true });
  } catch (e) {
    console.error("[founder scoring reset]", (e as Error).message);
    return json({ error: "could not reset" }, 500);
  }
}
