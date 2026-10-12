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
  async insert(table: PipelineInsertTable, row: Row) {
    const { text, values } = buildInsert(PIPELINE_INSERT_TABLES, table, row);
    const [r] = await query<Row>(text, values);
    return r;
  },
};
