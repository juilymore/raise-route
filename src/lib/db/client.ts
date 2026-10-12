import "server-only";
import { Pool } from "@neondatabase/serverless";
import { requireEnv } from "@/lib/env";

/**
 * One pooled Neon connection, opened as the role `app_service` (see db/migrations/0000_neon_roles.sql).
 * That role has NO write privilege on vc_pipeline, so the Integrity Guard applies to everything below.
 * Node >= 22 ships a global WebSocket, which the Neon driver uses; no extra setup.
 * Do not import this from pages/components: go through pipelineDb or founderDb.
 */
let pool: Pool | undefined;
export function getPool(): Pool {
  return (pool ??= new Pool({ connectionString: requireEnv("DATABASE_URL"), max: 5 }));
}

export async function query<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  const res = await getPool().query(text, params);
  return res.rows as T[];
}

/** Cheap liveness probe for /api/health. */
export async function ping(): Promise<{ ok: true; ms: number } | { ok: false; error: string }> {
  const t = Date.now();
  try {
    await query("select 1");
    return { ok: true, ms: Date.now() - t };
  } catch (e) {
    console.error("[db ping failed]", (e as Error).message);
    return { ok: false, error: "database unreachable" };
  }
}
