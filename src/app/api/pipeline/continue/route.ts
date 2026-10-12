import { NextResponse } from "next/server";
import { z } from "zod";
import { getEnv } from "@/lib/env";
import { hasValidBearer } from "@/lib/pipeline/auth";
import { runChunkAndContinue } from "@/lib/pipeline/continue";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const Body = z.object({ runId: z.string().uuid() });

/** Self-continuation of a chunked run. Bearer CRON_SECRET only. */
export async function POST(req: Request) {
  if (!hasValidBearer(req, getEnv().CRON_SECRET)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });
  try {
    const r = await runChunkAndContinue({ trigger: "manual", runId: parsed.data.runId });
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    console.error("[pipeline/continue]", (e as Error).message);
    return NextResponse.json({ ok: false, error: "continue failed (see server logs)" }, { status: 500 });
  }
}
