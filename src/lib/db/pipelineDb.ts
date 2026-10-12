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

/** jsonb columns (arrays of objects must be JSON-encoded, not sent as Postgres arrays). */
const JSON_COLUMNS = new Set(["supporting_sources", "model_confidence", "score_breakdown", "relationship_snapshot", "extraction", "stats"]);

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
  // ---------------------------------------------------------------------------------------------
  // Reads for the pipeline. The founder's notes and contact history are NEVER selected here:
  // the column list is explicit, so they cannot reach pipeline code or a model prompt.
  // ---------------------------------------------------------------------------------------------
  async listVcs() {
    return query<Row>(
      `select id, slug, name, firm, thesis, website, hq_region, stage_focus, sector_tags, aliases, tracked_people,
              contact_status, last_contact_date::text as last_contact_date, reconnect_after::text as reconnect_after, is_demo_relationship
         from public.vc_pipeline order by firm`,
    );
  },
  async getCompanyProfile() {
    const [r] = await query<Row>(
      "select company_name, product_description, sector, stage, geography, icp, relevance_keywords from public.company_profile where id = 1",
    );
    return r;
  },
  async getRun(runId: string) {
    const [r] = await query<Row>("select * from public.pipeline_runs where id = $1", [runId]);
    return r;
  },
  async ensureTasks(runId: string, onlyVcIds?: string[]) {
    await query(
      "insert into public.run_tasks (run_id, vc_id) select $1::uuid, id from public.vc_pipeline where ($2::uuid[] is null or id = any($2::uuid[])) on conflict (run_id, vc_id) do nothing",
      [runId, onlyVcIds ?? null],
    );
  },
  async taskCounts(runId: string) {
    return query<{ status: string; n: number }>("select status, count(*)::int as n from public.run_tasks where run_id = $1 group by status", [runId]);
  },
  async taskStats(runId: string) {
    return query<{ status: string; stats: Row }>("select status, stats from public.run_tasks where run_id = $1", [runId]);
  },
  async finishTask(taskId: string, status: "DONE" | "PARTIAL" | "FAILED", stats: Row, error?: string) {
    await query("update public.run_tasks set status = $2, finished_at = now(), stats = $3::jsonb, error = $4 where id = $1", [
      taskId, status, JSON.stringify(stats), error ?? null,
    ]);
  },
  /** Candidates already interpreted for this VC (qualified or rejected): not fetched or sent to Gemini again. PENDING and transient FETCH_FAILED are retried. */
  async knownCandidateUrls(vcId: string) {
    const rows = await query<{ canonical_url: string }>(
      "select canonical_url from public.evidence_candidates where vc_id = $1 and status <> 'PENDING' and coalesce(rejection_code, '') <> 'FETCH_FAILED'",
      [vcId],
    );
    return new Set(rows.map((r) => r.canonical_url));
  },
  /** Store a raw candidate BEFORE it is interpreted. Re-seen candidates only bump last_seen_run_id. */
  async upsertCandidate(c: {
    vcId: string; runId: string; channel: string; url: string; canonicalUrl: string; domain: string; sourceName?: string | null;
    sourceType?: string | null; title?: string | null; publishedAt?: string | null; publishedBasis?: string | null;
  }) {
    const [r] = await query<{ id: string }>(
      `insert into public.evidence_candidates
         (vc_id, first_run_id, last_seen_run_id, discovery_channel, source_url, canonical_url, source_domain, source_name, source_type, title, published_at, published_at_basis)
       values ($1,$2,$2,$3,$4,$5,$6,$7,$8,$9,$10::timestamptz,$11)
       on conflict (vc_id, canonical_url) do update set last_seen_run_id = excluded.last_seen_run_id
       returning id`,
      [c.vcId, c.runId, c.channel, c.url, c.canonicalUrl, c.domain, c.sourceName ?? null, c.sourceType ?? null, c.title ?? null, c.publishedAt ?? null, c.publishedBasis ?? null],
    );
    return r!.id;
  },
  async updateCandidate(id: string, p: {
    status?: "PENDING" | "QUALIFIED" | "REJECTED"; rejectionCode?: string | null; rejectionDetail?: string | null; httpStatus?: number | null;
    fetchedTextLen?: number | null; contentHash?: string | null; publishedAt?: string | null; publishedBasis?: string | null;
    extraction?: unknown; signalId?: string | null; sourceType?: string | null; title?: string | null;
  }) {
    await query(
      `update public.evidence_candidates set
         status = coalesce($2, status), rejection_code = $3, rejection_detail = $4, http_status = coalesce($5, http_status),
         fetched_text_len = coalesce($6, fetched_text_len), content_hash = coalesce($7, content_hash), fetched_at = now(),
         published_at = coalesce($8::timestamptz, published_at), published_at_basis = coalesce($9, published_at_basis),
         extraction = coalesce($10::jsonb, extraction), signal_id = coalesce($11::uuid, signal_id),
         source_type = coalesce($12, source_type), title = coalesce($13, title)
       where id = $1`,
      [
        id, p.status ?? null, p.rejectionCode ?? null, p.rejectionDetail ? p.rejectionDetail.slice(0, 500) : null, p.httpStatus ?? null,
        p.fetchedTextLen ?? null, p.contentHash ?? null, p.publishedAt ?? null, p.publishedBasis ?? null,
        p.extraction === undefined ? null : JSON.stringify(p.extraction), p.signalId ?? null, p.sourceType ?? null, p.title ?? null,
      ],
    );
  },
  /** Create or re-confirm a qualified signal. unique (vc_id, cluster_key): one event = one signal. */
  async upsertSignal(s: Row & { vc_id: string; cluster_key: string; run_id: string }) {
    const { run_id, ...row } = s;
    const cols = Object.keys(row);
    const vals = cols.map((c) => {
      const v = row[c];
      return v !== null && typeof v === "object" && !(v instanceof Date) && (JSON_COLUMNS.has(c) || !Array.isArray(v)) ? JSON.stringify(v) : v;
    });
    const text = `insert into public.signals (${cols.join(", ")}, first_run_id, last_confirmed_run_id)
      values (${cols.map((_, i) => `$${i + 1}`).join(", ")}, $${cols.length + 1}, $${cols.length + 1})
      on conflict (vc_id, cluster_key) do update set last_confirmed_run_id = excluded.last_confirmed_run_id,
        supporting_sources = excluded.supporting_sources, independent_source_count = excluded.independent_source_count
      returning id`;
    const [r] = await query<{ id: string }>(text, [...vals, run_id]);
    return r!.id;
  },
  /** Qualified signals for a VC whose event is still inside the window as of `today` (stored ones age in/out each run). */
  async signalsInWindow(vcId: string, today: string, windowDays: number, futureToleranceDays: number) {
    return query<Row>(
      `select id, signal_type, title, summary, subject_entity, event_date::text as event_date, event_date_basis, primary_source_url,
              primary_source_name, primary_source_type, evidence_excerpt, excerpt_verified, independent_source_count, attribution_level,
              attributed_person, relevance_tier, is_synthetic, commitment, cluster_key, supporting_sources
         from public.signals
        where vc_id = $1 and event_date <= ($2::date + $4::int) and event_date >= ($2::date - $3::int)
        order by event_date desc`,
      [vcId, today, windowDays, futureToleranceDays],
    );
  },
  async insertRecommendation(r: Row) {
    const cols = Object.keys(r);
    const vals = cols.map((c) => {
      const v = r[c];
      return v !== null && typeof v === "object" && !(v instanceof Date) && (JSON_COLUMNS.has(c) || !Array.isArray(v)) ? JSON.stringify(v) : v;
    });
    await query(
      `insert into public.recommendations (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")}) on conflict (run_id, vc_id) do nothing`,
      vals,
    );
  },
  /** Totals straight from the ledger: correct across chunked invocations. */
  async llmTotals(runId: string) {
    const [r] = await query<{ calls: number; tin: number; tout: number; searches: number }>(
      "select count(*)::int as calls, coalesce(sum(input_tokens),0)::bigint as tin, coalesce(sum(output_tokens),0)::bigint as tout, count(*) filter (where grounded)::int as searches from public.llm_calls where run_id = $1",
      [runId],
    );
    return { calls: Number(r?.calls ?? 0), tokensIn: Number(r?.tin ?? 0), tokensOut: Number(r?.tout ?? 0), searchCalls: Number(r?.searches ?? 0) };
  },
  /** Tasks that used all 3 attempts and are stuck (process died): mark FAILED so the run can finish. Returns their VC ids. */
  async failExhaustedTasks(runId: string) {
    const rows = await query<{ vc_id: string }>(
      `update public.run_tasks set status = 'FAILED', finished_at = now(), error = 'gave up after 3 attempts'
        where run_id = $1 and attempts >= 3 and status in ('PENDING','RUNNING') and (claimed_at is null or claimed_at < now() - interval '300 seconds')
        returning vc_id`,
      [runId],
    );
    return rows.map((r) => r.vc_id);
  },
  async findRunningRun() {
    const [r] = await query<Row>("select id, run_key, started_at from public.pipeline_runs where status = 'RUNNING' order by started_at desc limit 1");
    return r;
  },
  async insert(table: PipelineInsertTable, row: Row) {
    const { text, values } = buildInsert(PIPELINE_INSERT_TABLES, table, row);
    const [r] = await query<Row>(text, values);
    return r;
  },
};
