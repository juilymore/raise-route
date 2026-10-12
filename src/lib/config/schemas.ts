import { z } from "zod";

const tier = z.enum(["direct", "adjacent", "b2b_saas", "broad", "none"]);
const num = z.number();

/** Mirrors config/scoring.v1.json. Loose objects: extra keys are allowed, the ones the engine reads are required. */
export const scoringSchema = z.looseObject({
  version: z.string().min(1),
  window_days: z.number().int().positive(),
  future_date_tolerance_days: z.number().int().nonnegative(),
  max_points: z.looseObject({
    relevance: num, recency: num, strength: num, corroboration: num, evidence_quality: num, fund_fit: num,
  }),
  relevance_tier_weight: z.record(tier, num),
  recency: z.looseObject({ mode: z.string(), min_points_if_in_window: num }),
  strength: z.looseObject({
    base_by_signal_type: z.record(z.string(), num),
    multiplier_by_relevance_tier: z.record(tier, num),
    commitment_types: z.array(z.string()),
    commitment_multiplier: z.record(z.string(), num),
  }),
  corroboration: z.looseObject({
    counts_tiers: z.array(tier),
    per_additional_independent_event: num,
    max_from_events: num,
    bonus_if_top_event_has_2plus_independent_sources: num,
  }),
  evidence_quality: z.looseObject({
    source_type_points: z.record(z.string(), num),
    date_basis_points: z.record(z.string(), num),
    excerpt_verified_points: num,
    url_ok_points: num,
    synthetic_cap: num,
  }),
  fund_fit: z.looseObject({
    stage_points: z.record(z.string(), num),
    sector_points: z.record(z.string(), num),
    sector_unknown_points: num,
    geo_points: z.looseObject({ match_or_global: num, company_unknown: num, mismatch: num }),
  }),
  actions: z.looseObject({
    reach_out_now_min_score: num,
    follow_up_now_min_score: num,
    monitor_min_score: num,
    waiting_cooldown_days: num,
    overdue_follow_up_days: num,
    gate_tiers: z.array(tier),
    gate_min_stage_points: num,
    gate_require_excerpt_verified: z.boolean(),
    synthetic_signals_cap_action_at: z.string(),
    monitor_requires_tiers: z.array(tier),
    gate_disallow_commitments: z.array(z.string()),
    reach_out_max_signal_age_days: num,
  }),
  language: z.looseObject({ quiet: z.string().min(1), incomplete: z.string().min(1) }),
  relevance_damping: z.looseObject({ applies_to: z.array(z.string()), by_tier: z.record(tier, num) }),
});
export type ScoringConfig = z.infer<typeof scoringSchema>;

const keywordList = z.array(z.string().min(1));
export const taxonomySchema = z.looseObject({
  direct: keywordList,
  adjacent: keywordList,
  b2b_saas: keywordList,
  broad: keywordList,
  ambiguous_phrases_not_logistics: keywordList,
});
export type TaxonomyConfig = z.infer<typeof taxonomySchema>;

export const sourcesSchema = z.looseObject({
  fetch: z.looseObject({
    user_agent: z.string().min(1),
    timeout_ms: z.number().int().positive(),
    max_bytes: z.number().int().positive(),
    max_redirects: z.number().int().nonnegative(),
    respect_robots_txt: z.boolean(),
    per_domain_delay_ms: z.number().int().nonnegative(),
    allowed_schemes: z.array(z.enum(["http", "https"])),
    block_private_and_link_local_ips: z.literal(true),
    max_pages_per_vc_per_run: z.number().int().positive(),
  }),
  google_news_rss: z.looseObject({
    url_template: z.string().includes("{query}"),
    query_templates: z.array(z.string().includes("{firm}")).min(1),
    person_query_template: z.string(),
  }),
  official_feed_discovery: z.looseObject({
    link_rel_alternate_types: z.array(z.string()),
    probe_paths: z.array(z.string().startsWith("/")),
  }),
  sector_feeds_push_model: z.array(
    z.looseObject({ name: z.string(), url: z.string().url(), region: z.string(), verify: z.boolean() }),
  ),
  domain_classes: z.looseObject({
    reputable_news: z.array(z.string()),
    trade_press: z.array(z.string()),
    wire_and_pr_syndicators: z.array(z.string()),
    never_fetch: z.array(z.string()),
  }),
});
export type SourcesConfig = z.infer<typeof sourcesSchema>;
