import "server-only";
import { query } from "./client";
import { companyProfileSchema, overviewSchema, vcRowSchema } from "./rows";

/** Read-only queries for pages. Rows are validated with zod where the shape matters so schema drift fails loudly. */
type Row = Record<string, unknown>;
const D = (v: unknown): string | null => (v instanceof Date ? v.toISOString().slice(0, 10) : v == null ? null : String(v).slice(0, 10));
const T = (v: unknown): string | null => (v instanceof Date ? v.toISOString() : v == null ? null : String(v));

export async function listVcs() {
  const rows = await query("select * from public.vc_pipeline order by firm");
  return rows.map((r) => vcRowSchema.parse(r));
}

export async function getOverview() {
  const [row] = await query("select * from public.v_pipeline_overview");
  return overviewSchema.parse(row);
}

export async function getCompanyProfile() {
  const [row] = await query("select * from public.company_profile where id = 1");
  const profile = companyProfileSchema.parse(row);
  const [flag] = await query<{ value: { value?: boolean } }>("select value from public.app_settings where key = 'company_profile_is_sample'");
  return { profile, isSample: flag?.value?.value === true };
}

export interface RunSummary {
  id: string;
  run_key: string;
  trigger: string;
  status: string;
  started_at: string | null;
  completed_at: string | null;
  vcs_total: number;
  vcs_signal_found: number;
  vcs_quiet: number;
  vcs_partial: number;
  vcs_failed: number;
  candidates_found: number;
  signals_qualified: number;
  llm_calls: number;
  llm_tokens_in: number;
  llm_tokens_out: number;
  search_calls: number;
  error_count: number;
  founder_data_intact: boolean | null;
  founder_hash_before: string | null;
  founder_hash_after: string | null;
  scoring_version: string;
  model_primary: string | null;
  window_start: string | null;
  window_end: string | null;
}

const toRun = (r: Row): RunSummary => ({
  id: String(r.id), run_key: String(r.run_key), trigger: String(r.trigger), status: String(r.status), started_at: T(r.started_at), completed_at: T(r.completed_at),
  vcs_total: Number(r.vcs_total), vcs_signal_found: Number(r.vcs_signal_found), vcs_quiet: Number(r.vcs_quiet), vcs_partial: Number(r.vcs_partial), vcs_failed: Number(r.vcs_failed),
  candidates_found: Number(r.candidates_found), signals_qualified: Number(r.signals_qualified), llm_calls: Number(r.llm_calls), llm_tokens_in: Number(r.llm_tokens_in),
  llm_tokens_out: Number(r.llm_tokens_out), search_calls: Number(r.search_calls), error_count: Number(r.error_count),
  founder_data_intact: r.founder_data_intact === null || r.founder_data_intact === undefined ? null : Boolean(r.founder_data_intact),
  founder_hash_before: (r.founder_hash_before as string | null) ?? null, founder_hash_after: (r.founder_hash_after as string | null) ?? null,
  scoring_version: String(r.scoring_version), model_primary: (r.model_primary as string | null) ?? null, window_start: D(r.window_start), window_end: D(r.window_end),
});

export async function listRuns(limit = 20): Promise<RunSummary[]> {
  return (await query("select * from public.pipeline_runs order by started_at desc limit $1", [limit])).map(toRun);
}

export async function getLastRun(): Promise<RunSummary | null> {
  const r = await listRuns(1);
  return r[0] ?? null;
}

export async function getRun(id: string): Promise<RunSummary | null> {
  const [r] = await query("select * from public.pipeline_runs where id = $1", [id]);
  return r ? toRun(r) : null;
}

export interface ActionCardData {
  slug: string;
  firm: string;
  name: string;
  action: string;
  score: number | null;
  whyNow: string | null;
  lastSignalDate: string | null;
  evidenceUrl: string | null;
  evidenceDomain: string | null;
  evidenceVerified: boolean;
  contactStatus: string;
  holdReason: string | null;
  actionReason: string | null;
  prevAction: string | null;
  prevScore: number | null;
  fitScore: number | null;
  assessmentStatus: string;
  recommendationId: string | null;
}

const CARD_SQL = `
  select v.slug, v.firm, v.name, v.recommended_action, v.follow_up_score, v.signal_summary, v.last_signal_date, v.contact_status, v.hold_reason,
         v.action_reason, v.prev_recommended_action, v.prev_follow_up_score, v.fit_score, v.assessment_status,
         s.primary_source_url, s.excerpt_verified, rec.id as recommendation_id
    from public.vc_pipeline v
    left join lateral (select id from public.recommendations x where x.vc_id = v.id order by x.created_at desc limit 1) rec on true
    left join lateral (select primary_source_url, excerpt_verified from public.signals x where x.vc_id = v.id order by x.event_date desc, x.created_at desc limit 1) s on true`;

const toCard = (r: Row): ActionCardData => {
  const url = (r.primary_source_url as string | null) ?? null;
  let domain: string | null = null;
  try {
    domain = url ? new URL(url).hostname.replace(/^www\./, "") : null;
  } catch {
    domain = null;
  }
  return {
    slug: String(r.slug), firm: String(r.firm), name: String(r.name), action: String(r.recommended_action ?? "NOT_ASSESSED"),
    score: r.follow_up_score === null || r.follow_up_score === undefined ? null : Number(r.follow_up_score),
    whyNow: (r.signal_summary as string | null) ?? null, lastSignalDate: D(r.last_signal_date), evidenceUrl: url, evidenceDomain: domain,
    evidenceVerified: Boolean(r.excerpt_verified), contactStatus: String(r.contact_status), holdReason: (r.hold_reason as string | null) ?? null,
    actionReason: (r.action_reason as string | null) ?? null, prevAction: (r.prev_recommended_action as string | null) ?? null,
    prevScore: r.prev_follow_up_score === null || r.prev_follow_up_score === undefined ? null : Number(r.prev_follow_up_score),
    fitScore: r.fit_score === null || r.fit_score === undefined ? null : Number(r.fit_score), assessmentStatus: String(r.assessment_status),
    recommendationId: (r.recommendation_id as string | null) ?? null,
  };
};

export async function listTodaysActions(limit = 12): Promise<ActionCardData[]> {
  const rows = await query(
    `${CARD_SQL} where v.recommended_action in ('REACH_OUT_NOW','FOLLOW_UP_NOW')
      order by (v.recommended_action = 'REACH_OUT_NOW') desc, v.follow_up_score desc nulls last, v.firm limit $1`,
    [limit],
  );
  return rows.map(toCard);
}

export async function listAllCards(): Promise<ActionCardData[]> {
  return (await query(`${CARD_SQL} order by v.firm`)).map(toCard);
}

export interface ChangeRow {
  firm: string;
  slug: string;
  actionNow: string;
  actionBefore: string | null;
  scoreNow: number | null;
  scoreBefore: number | null;
}

export async function listChanges(limit = 5): Promise<ChangeRow[]> {
  const rows = await query(
    `select v.firm, v.slug, c.action_now, c.action_before, c.score_now, c.score_before
       from public.v_priority_changes c join public.vc_pipeline v on v.id = c.vc_id
      where c.action_before is not null
      order by abs(coalesce(c.score_now,0) - coalesce(c.score_before,0)) desc limit $1`,
    [limit],
  );
  return rows.map((r) => ({
    firm: String(r.firm), slug: String(r.slug), actionNow: String(r.action_now), actionBefore: (r.action_before as string | null) ?? null,
    scoreNow: r.score_now === null ? null : Number(r.score_now), scoreBefore: r.score_before === null ? null : Number(r.score_before),
  }));
}

export interface QuietRow {
  slug: string;
  firm: string;
  daysSinceSignal: number | null;
  channels: Record<string, string> | null;
}

export async function listQuiet(limit = 50): Promise<QuietRow[]> {
  const rows = await query(
    `select v.slug, v.firm,
            (select (now()::date - max(s.event_date)) from public.signals s where s.vc_id = v.id) as days_since,
            (select t.stats->'channels' from public.run_tasks t where t.run_id = v.last_run_id and t.vc_id = v.id limit 1) as channels
       from public.vc_pipeline v where v.assessment_status = 'QUIET' order by v.firm limit $1`,
    [limit],
  );
  return rows.map((r) => ({ slug: String(r.slug), firm: String(r.firm), daysSinceSignal: r.days_since === null ? null : Number(r.days_since), channels: (r.channels as Record<string, string> | null) ?? null }));
}

export async function listIncomplete(limit = 50): Promise<Array<{ slug: string; firm: string }>> {
  const rows = await query("select slug, firm from public.vc_pipeline where recommended_action = 'ASSESSMENT_INCOMPLETE' order by firm limit $1", [limit]);
  return rows.map((r) => ({ slug: String(r.slug), firm: String(r.firm) }));
}

export interface SignalRow {
  id: string;
  signal_type: string;
  title: string;
  summary: string;
  subject_entity: string | null;
  event_date: string;
  event_date_basis: string;
  published_at: string | null;
  primary_source_url: string;
  primary_source_name: string | null;
  primary_source_type: string | null;
  evidence_excerpt: string;
  excerpt_verified: boolean;
  supporting_sources: Array<{ url: string; name?: string | null; domain?: string; independent?: boolean }>;
  independent_source_count: number;
  attribution_level: string;
  attributed_person: string | null;
  relevance_tier: string;
  commitment: string;
}

export async function getVcDetail(slug: string) {
  const [vc] = await query("select * from public.vc_pipeline where slug = $1", [slug]);
  if (!vc) return null;
  const signals = (
    await query("select * from public.signals where vc_id = $1 order by event_date desc, created_at desc limit 30", [vc.id])
  ).map((s): SignalRow => ({
    id: String(s.id), signal_type: String(s.signal_type), title: String(s.title), summary: String(s.summary), subject_entity: (s.subject_entity as string | null) ?? null,
    event_date: D(s.event_date)!, event_date_basis: String(s.event_date_basis), published_at: D(s.published_at), primary_source_url: String(s.primary_source_url),
    primary_source_name: (s.primary_source_name as string | null) ?? null, primary_source_type: (s.primary_source_type as string | null) ?? null,
    evidence_excerpt: String(s.evidence_excerpt), excerpt_verified: Boolean(s.excerpt_verified), supporting_sources: (s.supporting_sources as SignalRow["supporting_sources"]) ?? [],
    independent_source_count: Number(s.independent_source_count), attribution_level: String(s.attribution_level), attributed_person: (s.attributed_person as string | null) ?? null,
    relevance_tier: String(s.relevance_tier), commitment: String(s.commitment ?? "not_applicable"),
  }));
  const history = (
    await query(
      "select r.id, r.created_at, r.action, r.follow_up_score, r.reason, r.assessment_status, r.scoring_version, p.run_key from public.recommendations r join public.pipeline_runs p on p.id = r.run_id where r.vc_id = $1 order by r.created_at desc limit 20",
      [vc.id],
    )
  ).map((h) => ({ id: String(h.id), at: T(h.created_at)!, action: String(h.action), score: h.follow_up_score === null ? null : Number(h.follow_up_score), reason: String(h.reason), status: String(h.assessment_status), version: String(h.scoring_version), runKey: String(h.run_key) }));
  const [task] = await query("select stats from public.run_tasks where run_id = $1 and vc_id = $2 limit 1", [vc.last_run_id, vc.id]);
  const parsed = vcRowSchema.parse(vc);
  return {
    vc: {
      ...parsed,
      contact_history: (vc.contact_history as Array<{ at?: string; type?: string; summary?: string }>) ?? [],
      score_breakdown: (vc.score_breakdown as Record<string, number> | null) ?? null,
      action_reason: (vc.action_reason as string | null) ?? null,
      hold_reason: (vc.hold_reason as string | null) ?? null,
      fit_score: vc.fit_score === null ? null : Number(vc.fit_score),
      scoring_version: (vc.scoring_version as string | null) ?? null,
      last_assessed_at: T(vc.last_assessed_at),
      prev_recommended_action: (vc.prev_recommended_action as string | null) ?? null,
      prev_follow_up_score: vc.prev_follow_up_score === null ? null : Number(vc.prev_follow_up_score),
      qualifying_signal_count: Number(vc.qualifying_signal_count ?? 0),
    },
    signals,
    history,
    taskStats: (task?.stats as Record<string, unknown> | undefined) ?? null,
  };
}

export async function getRunDetail(id: string) {
  const run = await getRun(id);
  if (!run) return null;
  const tasks = (
    await query("select t.status, t.stats, t.error, v.firm, v.slug from public.run_tasks t join public.vc_pipeline v on v.id = t.vc_id where t.run_id = $1 order by v.firm", [id])
  ).map((t) => ({ status: String(t.status), stats: (t.stats as Record<string, unknown>) ?? {}, error: (t.error as string | null) ?? null, firm: String(t.firm), slug: String(t.slug) }));
  const rejected = (
    await query(
      `select c.source_url, c.source_domain, c.rejection_code, c.rejection_detail, c.title, c.discovery_channel, v.firm
         from public.evidence_candidates c join public.vc_pipeline v on v.id = c.vc_id
        where c.last_seen_run_id = $1 and c.status = 'REJECTED' order by c.rejection_code, v.firm limit 200`,
      [id],
    )
  ).map((c) => ({ url: String(c.source_url), domain: (c.source_domain as string | null) ?? null, code: String(c.rejection_code), detail: (c.rejection_detail as string | null) ?? null, title: (c.title as string | null) ?? null, channel: String(c.discovery_channel), firm: String(c.firm) }));
  const llm = await query(
    "select model, purpose, status, count(*)::int as calls, coalesce(sum(input_tokens),0)::int as tin, coalesce(sum(output_tokens),0)::int as tout from public.llm_calls where run_id = $1 group by 1,2,3 order by 1,2,3",
    [id],
  );
  const sources = (
    await query("select kind, url, label, status, last_http_status, last_error, consecutive_failures, last_checked_at from public.source_registry where vc_id is null order by label")
  ).map((s) => ({ kind: String(s.kind), url: String(s.url), label: (s.label as string | null) ?? null, status: String(s.status), http: s.last_http_status === null ? null : Number(s.last_http_status), error: (s.last_error as string | null) ?? null, failures: Number(s.consecutive_failures), checked: T(s.last_checked_at) }));
  return { run, tasks, rejected, llm: llm as Array<{ model: string; purpose: string; status: string; calls: number; tin: number; tout: number }>, sources };
}

export async function getCalibrationData() {
  const feedback = (await query("select vote, reasons from public.feedback")).map((f) => ({ vote: f.vote as "POSITIVE" | "NEGATIVE", reasons: (f.reasons as string[]) ?? [] }));
  const outcomes = (await query("select outcome from public.outreach_outcomes")).map((o) => ({ outcome: o.outcome as "RESPONSE_RECEIVED" | "MEETING_BOOKED" | "PASSED" | "NO_RESPONSE" }));
  const drafts = await query<{ n: number }>("select count(*)::int as n from public.outreach_drafts");
  return { feedback, outcomes, drafts: Number(drafts[0]?.n ?? 0) };
}

export async function listDrafts(vcId: string, limit = 3) {
  const rows = await query("select id, subject, body, model, created_at from public.outreach_drafts where vc_id = $1 order by created_at desc limit $2", [vcId, limit]);
  return rows.map((d) => ({ id: String(d.id), subject: String(d.subject), body: String(d.body), model: String(d.model), createdAt: T(d.created_at)! }));
}

export async function getLatestRecommendationId(vcId: string): Promise<string | null> {
  const [r] = await query<{ id: string }>("select id from public.recommendations where vc_id = $1 order by created_at desc limit 1", [vcId]);
  return r?.id ?? null;
}

export interface DigestRow {
  id: string;
  run_id: string;
  run_key: string | null;
  subject: string;
  recipient: string;
  status: string;
  provider_message_id: string | null;
  error: string | null;
  sent_at: string | null;
  created_at: string;
}
const toDigest = (d: Row): DigestRow => ({
  id: String(d.id), run_id: String(d.run_id), run_key: (d.run_key as string | null) ?? null, subject: String(d.subject), recipient: String(d.recipient), status: String(d.status),
  provider_message_id: (d.provider_message_id as string | null) ?? null, error: (d.error as string | null) ?? null, sent_at: T(d.sent_at), created_at: T(d.created_at)!,
});

export async function listDigests(limit = 30): Promise<DigestRow[]> {
  return (await query("select d.id, d.run_id, p.run_key, d.subject, d.recipient, d.status, d.provider_message_id, d.error, d.sent_at, d.created_at from public.email_digests d join public.pipeline_runs p on p.id = d.run_id order by d.created_at desc limit $1", [limit])).map(toDigest);
}

export async function getDigest(id: string) {
  const [d] = await query("select d.*, p.run_key from public.email_digests d join public.pipeline_runs p on p.id = d.run_id where d.id = $1", [id]);
  if (!d) return null;
  const items = await query(
    "select i.section, i.rank, v.firm, v.slug from public.email_digest_items i join public.recommendations r on r.id = i.recommendation_id join public.vc_pipeline v on v.id = r.vc_id where i.digest_id = $1 order by array_position(array['REACH_OUT_NOW','FOLLOW_UP_NOW','MONITOR','HOLD','QUIET','CHANGES','INCOMPLETE'], i.section), i.rank",
    [id],
  );
  return { digest: toDigest(d), html: String(d.html), text: String(d.text_body), items: items.map((i) => ({ section: String(i.section), rank: Number(i.rank), firm: String(i.firm), slug: String(i.slug) })) };
}

/** Time travel: the pipeline exactly as a past run assessed it (from the immutable recommendation snapshots). */
export async function listSnapshotRows(runId: string) {
  const rows = await query(
    `select v.slug, v.firm, v.name, v.hq_region, v.contact_status, v.last_contact_date, r.action, r.hold_reason, r.follow_up_score, r.assessment_status,
            s.title as signal_title, s.event_date as signal_date
       from public.recommendations r
       join public.vc_pipeline v on v.id = r.vc_id
       left join lateral (select x.title, x.event_date from public.signals x where x.id = any(r.signal_ids) order by x.event_date desc limit 1) s on true
      where r.run_id = $1 order by v.firm`,
    [runId],
  );
  return rows.map((x) => ({
    slug: String(x.slug), firm: String(x.firm), name: String(x.name), action: String(x.action), holdReason: (x.hold_reason as string | null) ?? null,
    score: x.follow_up_score === null ? null : Number(x.follow_up_score), lastSignalDate: D(x.signal_date), whyNow: (x.signal_title as string | null) ?? null,
    contactStatus: String(x.contact_status), lastContactDate: D(x.last_contact_date), region: (x.hq_region as string | null) ?? null, assessmentStatus: String(x.assessment_status),
  }));
}
