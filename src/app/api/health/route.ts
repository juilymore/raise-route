import { NextResponse } from "next/server";
import { BRAND } from "@/config/brand";
import { loadScoring } from "@/lib/config";
import { envPresence, getEnv } from "@/lib/env";
import { ping } from "@/lib/db/client";

export const dynamic = "force-dynamic";

/** Reports status only. Env values and secrets are never returned: presence booleans only. */
export async function GET() {
  try {
    const env = getEnv();
    const scoring = loadScoring();
    const database = env.DATABASE_URL ? await ping() : { ok: false, configured: false };
    return NextResponse.json({
      app: BRAND.name,
      ok: true,
      database,
      env: envPresence(env),
      models: { primary: env.GEMINI_MODEL_PRIMARY, fallbacks: env.GEMINI_MODEL_FALLBACKS, grounding: env.GEMINI_ENABLE_GROUNDING },
      scoringVersion: scoring.version,
      checkedAt: new Date().toISOString(),
    });
  } catch (e) {
    return NextResponse.json(
      { app: BRAND.name, ok: false, error: "Configuration problem", detail: (e as Error).message.slice(0, 300) },
      { status: 500 },
    );
  }
}
