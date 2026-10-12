import { NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { hasValidBearer } from "@/lib/pipeline/auth";
import { runChunkAndContinue } from "@/lib/pipeline/continue";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // Hobby limit per Vercel docs (verify at deploy; if rejected use 60 and lower PIPELINE_TIME_BUDGET_MS)

/**
 * External trigger (GitHub Actions or any scheduler): GET with `Authorization: Bearer $CRON_SECRET`.
 * run_key = cron-YYYY-MM-DD, so duplicate triggers on the same day collapse into ONE run (start_run is idempotent).
 * No scheduler is configured by default: the founder presses "Run now" instead.
 */
export async function GET(req: Request) {
  if (!hasValidBearer(req, getEnv().CRON_SECRET)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const source = new URL(req.url).searchParams.get("source") === "github" ? "github_action" : "cron";
  try {
    const r = await runChunkAndContinue({ trigger: source });
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    console.error("[cron/run]", (e as Error).message);
    return NextResponse.json({ ok: false, error: "run failed (see server logs)" }, { status: 500 });
  }
}
