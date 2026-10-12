import "server-only";
import { query } from "./client";
import { buildInsert } from "./sql";

/**
 * The ONLY database surface pipeline code may import (src/lib/pipeline, engine, gemini, sources, pipeline routes).
 * It exposes: run lifecycle RPCs, apply_assessment, and inserts into system tables.
 * No vc_pipeline writes, no founder RPCs. scripts/check-compliance.mjs enforces that pipeline code never imports founderDb.
 */
export const PIPELINE_INSERT_TABLES = [
  "signals", "evidence_candidates", "recommendations", "llm_calls", "run_tasks",
  "source_registry", "email_digests", "email_digest_items", "outreach_drafts",
] as const;
export type PipelineInsertTable = (typeof PIPELINE_INSERT_TABLES)[number];

type Row = Record<string, unknown>;

export const pipelineDb = {
  async startRun(a: { runKey: string; trigger: string; scoringVersion: string; model: string; windowStart: string; windowEnd: string }) {
    const [r] = await query<Row>("select * from public.start_run($1,$2,$3,$4,$5::date,$6::date)", [
      a.runKey, a.trigger, a.scoringVersion, a.model, a.windowStart, a.windowEnd,
    ]);
    return r;
  },
  async finalizeRun(runId: string, status: string, stats: Row = {}) {
    const [r] = await query<Row>("select * from public.finalize_run($1::uuid,$2,$3::jsonb)", [runId, status, JSON.stringify(stats)]);
    return r;
  },
  claimRunTasks(runId: string, limit = 3, staleSeconds = 300) {
    return query<Row>("select * from public.claim_run_tasks($1::uuid,$2,$3)", [runId, limit, staleSeconds]);
  },
  /** The single write path to vc_pipeline's signal columns. */
  async applyAssessment(vcId: string, runId: string, assessment: Row) {
    await query("select public.apply_assessment($1::uuid,$2::uuid,$3::jsonb)", [vcId, runId, JSON.stringify(assessment)]);
  },
  /** Record the outcome of checking one source. consecutive_failures resets on success and grows on failure. */
  async recordSourceHealth(a: {
    vcId: string | null;
    kind: "rss" | "atom" | "youtube_rss" | "podcast_rss" | "news_query" | "sector_feed" | "portfolio_page" | "website";
    url: string;
    label?: string;
    ok: boolean;
    httpStatus?: number;
    error?: string;
  }) {
    if (a.vcId === null) {
      // UNIQUE (vc_id, url) never conflicts when vc_id is NULL (global sector feeds), so update-then-insert by hand.
      const upd = await query(
        `update public.source_registry set status = case when status = 'DISABLED' then 'DISABLED' else $2 end,
           last_checked_at = now(), last_http_status = $3, last_error = $4,
           consecutive_failures = case when $5 then 0 else consecutive_failures + 1 end
         where vc_id is null and url = $1 returning id`,
        [a.url, a.ok ? "OK" : "FAILING", a.httpStatus ?? null, a.error ?? null, a.ok],
      );
      if (upd.length > 0) return;
    }
    await query(
      `insert into public.source_registry (vc_id, kind, url, label, status, last_checked_at, last_http_status, last_error, consecutive_failures)
       values ($1, $2, $3, $4, $5, now(), $6, $7, $8)
       on conflict (vc_id, url) do update set
         status = case when public.source_registry.status = 'DISABLED' then 'DISABLED' else excluded.status end,
         last_checked_at = now(), last_http_status = excluded.last_http_status, last_error = excluded.last_error,
         consecutive_failures = case when $9 then 0 else public.source_registry.consecutive_failures + 1 end`,
      [a.vcId, a.kind, a.url, a.label ?? null, a.ok ? "OK" : "FAILING", a.httpStatus ?? null, a.error ?? null, a.ok ? 0 : 1, a.ok],
    );
  },
  async insert(table: PipelineInsertTable, row: Row) {
    const { text, values } = buildInsert(PIPELINE_INSERT_TABLES, table, row);
    const [r] = await query<Row>(text, values);
    return r;
  },
};
