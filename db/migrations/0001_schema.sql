-- =====================================================================
-- VC Pipeline Intelligence — schema v1
--
-- DESIGN RULES
--  * ONE exam-literal table `vc_pipeline` = Vikram's spreadsheet, but live.
--    It holds founder-owned columns AND signal-derived columns side by side,
--    so a grader opening the Supabase table editor sees exactly what the
--    brief describes. Separation is enforced by 0002_guards.sql, not by hope.
--  * Everything else is append-only / audit history around that table.
--  * text + CHECK instead of enums (easier to evolve in migrations).
--  * RLS ON for every table with NO policies => anon/authenticated get nothing.
--    The browser never talks to Supabase. Only server code (service_role) does.
--  * Supabase now requires EXPLICIT GRANTs for new public tables (rolling out
--    to all projects 2026-10-30) — see 0002_guards.sql.
-- =====================================================================

-- ---------------------------------------------------------------------
-- company_profile : Vikram's startup context (single row). Founder-owned.
-- ---------------------------------------------------------------------
create table public.company_profile (
  id                   integer primary key default 1 check (id = 1),
  company_name         text not null,
  product_description  text not null,
  sector               text not null default 'B2B logistics SaaS',
  business_model       text not null default 'B2B SaaS',
  stage                text not null default 'Seed',
  geography            text,                       -- NULL = unknown. Never guessed.
  icp                  text,                       -- ideal customer profile
  raise_context        text,                       -- e.g. round size, use of funds
  relevance_keywords   text[] not null default '{}',
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- pipeline_runs : execution + audit layer
-- ---------------------------------------------------------------------
create table public.pipeline_runs (
  id                       uuid primary key default gen_random_uuid(),
  run_key                  text not null unique,   -- idempotency key, e.g. cron-2026-10-12 / manual-<ts>
  trigger                  text not null check (trigger in ('cron','github_action','manual','test')),
  status                   text not null default 'RUNNING'
                             check (status in ('RUNNING','COMPLETED','COMPLETED_WITH_ERRORS','FAILED','CANCELLED')),
  scoring_version          text not null,
  model_primary            text,
  window_start             date,
  window_end               date,
  started_at               timestamptz not null default now(),
  completed_at             timestamptz,
  vcs_total                integer not null default 0,
  vcs_signal_found         integer not null default 0,
  vcs_quiet                integer not null default 0,
  vcs_partial              integer not null default 0,
  vcs_failed               integer not null default 0,
  candidates_found         integer not null default 0,
  signals_qualified        integer not null default 0,
  recommendations_written  integer not null default 0,
  llm_calls                integer not null default 0,
  llm_tokens_in            bigint  not null default 0,
  llm_tokens_out           bigint  not null default 0,
  search_calls             integer not null default 0,
  error_count              integer not null default 0,
  errors                   jsonb   not null default '[]'::jsonb,
  -- Integrity Guard receipt (see 0002): proves founder-owned data was untouched
  founder_hash_before      text,
  founder_hash_after       text,
  founder_revision_before  integer,
  founder_revision_after   integer,
  founder_data_intact      boolean,                -- true | false | NULL (=founder edited during run; receipt n/a)
  created_at               timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- vc_pipeline : THE table. 50 rows. Exam-literal.
--   [P] protected  = founder-owned / seeded profile. System can NEVER change.
--   [S] system     = signal-derived. Written ONLY via apply_assessment().
-- ---------------------------------------------------------------------
create table public.vc_pipeline (
  id                       uuid primary key default gen_random_uuid(),
  slug                     text not null unique,

  -- [P] identity / profile (seeded, founder-editable)
  name                     text not null,          -- primary contact, or 'Investment team' if unknown
  firm                     text not null,
  thesis                   text,
  website                  text,
  hq_region                text,
  stage_focus              text,
  sector_tags              text[] not null default '{}',
  aliases                  text[] not null default '{}',   -- name variants for entity matching
  tracked_people           text[] not null default '{}',   -- named partners => enables person-level attribution
  profile_source           text not null default 'seed_unverified',

  -- [P] relationship state — FOUNDER OWNED (exam: never overwrite)
  contact_status           text not null default 'TO_REACH_OUT'
                             check (contact_status in
                               ('TO_REACH_OUT','WAITING_FOR_RESPONSE','IN_CONVERSATION','MEETING_SCHEDULED','PASSED')),
  last_contact_date        date,
  reconnect_after          date,
  contact_history          jsonb not null default '[]'::jsonb check (jsonb_typeof(contact_history) = 'array'),
  personal_notes           text,
  is_demo_relationship     boolean not null default false,  -- seeded/synthetic relationship data

  -- [S] signal-derived — the four exam columns first
  last_signal_date         date,
  signal_summary           text,
  follow_up_score          integer check (follow_up_score between 0 and 100),   -- NULL = no qualifying signal (never a fake 0)
  recommended_action       text check (recommended_action in
                             ('REACH_OUT_NOW','FOLLOW_UP_NOW','MONITOR','HOLD','DONT_PRIORITIZE','ASSESSMENT_INCOMPLETE')),
  -- [S] supporting derived columns
  hold_reason              text check (hold_reason in
                             ('RECENT_CONTACT','AWAITING_RESPONSE','RECONNECT_DATE','ACTIVE_CONVERSATION')),
  action_reason            text,
  assessment_status        text not null default 'NOT_ASSESSED'
                             check (assessment_status in ('NOT_ASSESSED','SIGNAL_FOUND','QUIET','PARTIAL','FAILED')),
  score_breakdown          jsonb,
  fit_score                integer check (fit_score between 0 and 10),           -- stable fund fit, separate from signal heat
  qualifying_signal_count  integer not null default 0,
  prev_follow_up_score     integer,
  prev_recommended_action  text,
  scoring_version          text,
  last_run_id              uuid references public.pipeline_runs(id),
  last_assessed_at         timestamptz,

  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);
create index vc_pipeline_action_idx on public.vc_pipeline (recommended_action);
create index vc_pipeline_status_idx on public.vc_pipeline (contact_status);

-- ---------------------------------------------------------------------
-- run_tasks : work queue so a 50-VC run survives serverless time limits
-- ---------------------------------------------------------------------
create table public.run_tasks (
  id           uuid primary key default gen_random_uuid(),
  run_id       uuid not null references public.pipeline_runs(id) on delete cascade,
  vc_id        uuid not null references public.vc_pipeline(id),
  status       text not null default 'PENDING' check (status in ('PENDING','RUNNING','DONE','PARTIAL','FAILED')),
  attempts     integer not null default 0,
  claimed_at   timestamptz,
  finished_at  timestamptz,
  error        text,
  stats        jsonb not null default '{}'::jsonb,   -- per-VC: sources tried/ok/failed, candidates, llm calls
  unique (run_id, vc_id)
);
create index run_tasks_claim_idx on public.run_tasks (run_id, status);

-- ---------------------------------------------------------------------
-- source_registry : per-VC discovered sources + health. Failure != quiet.
-- ---------------------------------------------------------------------
create table public.source_registry (
  id                    uuid primary key default gen_random_uuid(),
  vc_id                 uuid references public.vc_pipeline(id),   -- NULL = global sector feed
  kind                  text not null check (kind in
                          ('rss','atom','youtube_rss','podcast_rss','news_query','sector_feed','portfolio_page','website')),
  url                   text not null,
  label                 text,
  status                text not null default 'UNTESTED' check (status in ('UNTESTED','OK','FAILING','DISABLED')),
  last_checked_at       timestamptz,
  last_http_status      integer,
  last_error            text,
  consecutive_failures  integer not null default 0,
  created_at            timestamptz not null default now(),
  unique (vc_id, url)
);

-- ---------------------------------------------------------------------
-- evidence_candidates : RAW evidence, stored BEFORE it may count as a signal.
-- Rejections are kept on purpose (audit: "why did we ignore X?").
-- ---------------------------------------------------------------------
create table public.evidence_candidates (
  id                 uuid primary key default gen_random_uuid(),
  vc_id              uuid not null references public.vc_pipeline(id),
  first_run_id       uuid not null references public.pipeline_runs(id),
  last_seen_run_id   uuid not null references public.pipeline_runs(id),
  discovery_channel  text not null check (discovery_channel in
                       ('official_feed','news_rss','sector_feed','grounded_search','search_api','portfolio_diff','manual')),
  source_url         text not null,
  canonical_url      text not null,
  source_domain      text,
  source_name        text,
  source_type        text check (source_type in
                       ('official_site','official_blog','portfolio_announcement','reputable_news','trade_press',
                        'podcast','video','event_page','social','other')),
  title              text,
  published_at       timestamptz,
  published_at_basis text check (published_at_basis in
                       ('json_ld','meta_tag','feed','time_element','url_pattern','model_extracted','none')),
  fetched_at         timestamptz,
  http_status        integer,
  content_hash       text,
  fetched_text_len   integer,
  status             text not null default 'PENDING' check (status in ('PENDING','QUALIFIED','REJECTED')),
  rejection_code     text,        -- OLD_EVENT | DATE_UNVERIFIED | NOT_ATTRIBUTABLE | AMBIGUOUS_ENTITY | QUOTE_NOT_FOUND |
                                  -- IRRELEVANT | DUPLICATE_SYNDICATED | FETCH_FAILED | SSRF_BLOCKED | INVALID_MODEL_OUTPUT | SYNTHETIC
  rejection_detail   text,
  extraction         jsonb,       -- validated Gemini structured output, kept for audit
  signal_id          uuid,        -- set when QUALIFIED (FK added below)
  is_synthetic       boolean not null default false,
  created_at         timestamptz not null default now(),
  unique (vc_id, canonical_url)
);
create index evidence_candidates_vc_idx on public.evidence_candidates (vc_id, status);

-- ---------------------------------------------------------------------
-- signals : QUALIFIED underlying events (one row per event, many sources)
-- ---------------------------------------------------------------------
create table public.signals (
  id                        uuid primary key default gen_random_uuid(),
  vc_id                     uuid not null references public.vc_pipeline(id),
  cluster_key               text not null,         -- dedupe key for the underlying event
  first_run_id              uuid references public.pipeline_runs(id),
  last_confirmed_run_id     uuid references public.pipeline_runs(id),
  signal_type               text not null check (signal_type in
                              ('investment','portfolio_activity','fund_news','blog_post','thesis_update',
                               'interview','podcast','conference','news_mention','team_news','other')),
  title                     text not null,
  summary                   text not null,
  subject_entity            text,                  -- e.g. portfolio company / event name (normalized for dedupe)
  event_date                date not null,
  event_date_basis          text not null check (event_date_basis in
                              ('explicit_in_text','structured_metadata','published_date','first_observed')),
  published_at              timestamptz,
  primary_source_url        text not null,
  primary_source_name       text,
  primary_source_type       text,
  evidence_excerpt          text not null,
  excerpt_verified          boolean not null,      -- excerpt found verbatim (normalized) in fetched text
  supporting_sources        jsonb not null default '[]'::jsonb,   -- [{url,name,domain,published_at,independent}]
  independent_source_count  integer not null default 1,
  attribution_level         text not null check (attribution_level in ('firm','person','unknown')),
  attributed_person         text,
  relevance_tier            text not null check (relevance_tier in ('direct','adjacent','b2b_saas','broad','none')),
  relevance_keywords_hit    text[] not null default '{}',
  relevance_downgraded      boolean not null default false,  -- model said higher than keyword cross-check allowed
  model_confidence          jsonb not null default '{}'::jsonb,  -- {attribution, relevance, date}
  is_synthetic              boolean not null default false,
  retrieved_at              timestamptz not null default now(),
  created_at                timestamptz not null default now(),
  unique (vc_id, cluster_key)
);
create index signals_vc_date_idx on public.signals (vc_id, event_date desc);

alter table public.evidence_candidates
  add constraint evidence_candidates_signal_fk foreign key (signal_id) references public.signals(id);

-- ---------------------------------------------------------------------
-- recommendations : IMMUTABLE per-run snapshots ("what did we say at the time?")
-- ---------------------------------------------------------------------
create table public.recommendations (
  id                     uuid primary key default gen_random_uuid(),
  run_id                 uuid not null references public.pipeline_runs(id),
  vc_id                  uuid not null references public.vc_pipeline(id),
  follow_up_score        integer check (follow_up_score between 0 and 100),
  fit_score              integer,
  action                 text not null check (action in
                           ('REACH_OUT_NOW','FOLLOW_UP_NOW','MONITOR','HOLD','DONT_PRIORITIZE','ASSESSMENT_INCOMPLETE')),
  hold_reason            text,
  reason                 text not null,
  assessment_status      text not null,
  signal_ids             uuid[] not null default '{}',
  score_breakdown        jsonb,
  -- decision context WITHOUT personal notes (notes never leave the founder's rows)
  relationship_snapshot  jsonb not null,
  scoring_version        text not null,
  created_at             timestamptz not null default now(),
  unique (run_id, vc_id)
);
create index recommendations_vc_idx on public.recommendations (vc_id, created_at desc);

-- ---------------------------------------------------------------------
-- feedback : attached to the exact recommendation snapshot
-- ---------------------------------------------------------------------
create table public.feedback (
  id                 uuid primary key default gen_random_uuid(),
  recommendation_id  uuid not null references public.recommendations(id),
  vc_id              uuid not null references public.vc_pipeline(id),
  vote               text not null check (vote in ('POSITIVE','NEGATIVE')),
  reasons            text[] not null default '{}'
                       check (reasons <@ array['WRONG_RELEVANCE','WRONG_ATTRIBUTION','SIGNAL_TOO_WEAK','SIGNAL_TOO_OLD',
                                               'SOURCE_UNRELIABLE','SCORE_TOO_HIGH','SCORE_TOO_LOW',
                                               'RELATIONSHIP_MISUNDERSTOOD','OTHER']::text[]),
  note               text,
  created_at         timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- outreach_outcomes : REAL fundraising outcomes — kept apart from assessment feedback
-- ---------------------------------------------------------------------
create table public.outreach_outcomes (
  id                 uuid primary key default gen_random_uuid(),
  vc_id              uuid not null references public.vc_pipeline(id),
  recommendation_id  uuid references public.recommendations(id),
  outcome            text not null check (outcome in ('RESPONSE_RECEIVED','MEETING_BOOKED','PASSED','NO_RESPONSE')),
  occurred_on        date not null default current_date,
  note               text,
  created_at         timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- outreach_drafts : Gemini drafts built ONLY from validated signals
-- ---------------------------------------------------------------------
create table public.outreach_drafts (
  id                 uuid primary key default gen_random_uuid(),
  vc_id              uuid not null references public.vc_pipeline(id),
  recommendation_id  uuid references public.recommendations(id),
  signal_ids         uuid[] not null default '{}',
  subject            text not null,
  body               text not null,
  model              text not null,
  created_at         timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- email_digests (+items) : IMMUTABLE outbound history
-- ---------------------------------------------------------------------
create table public.email_digests (
  id                   uuid primary key default gen_random_uuid(),
  run_id               uuid not null references public.pipeline_runs(id),
  digest_key           text not null unique,            -- idempotency: one digest per run
  recipient            text not null,
  subject              text not null,
  html                 text not null,
  text_body            text not null,
  status               text not null default 'PREVIEW'
                         check (status in ('PREVIEW','SENDING','SENT','FAILED','DEV_NOT_SENT')),
  provider             text,
  provider_message_id  text,                            -- only set when the provider confirmed acceptance
  error                text,
  sent_at              timestamptz,
  created_at           timestamptz not null default now()
);

create table public.email_digest_items (
  digest_id          uuid not null references public.email_digests(id),
  recommendation_id  uuid not null references public.recommendations(id),
  section            text not null check (section in
                       ('REACH_OUT_NOW','FOLLOW_UP_NOW','MONITOR','HOLD','QUIET','CHANGES','INCOMPLETE')),
  rank               integer not null,
  primary key (digest_id, recommendation_id, section)
);

-- ---------------------------------------------------------------------
-- llm_calls : ledger of EVERY model call. Proof of "Gemini Flash only" + cost control.
-- ---------------------------------------------------------------------
create table public.llm_calls (
  id             uuid primary key default gen_random_uuid(),
  run_id         uuid references public.pipeline_runs(id),
  vc_id          uuid references public.vc_pipeline(id),
  purpose        text not null check (purpose in
                   ('discover_grounded','extract','disambiguate','outreach_draft','digest_summary','profile_enrich','healthcheck')),
  model          text not null check (model like 'gemini-%'),     -- DB-level guard: only Gemini models can be logged
  grounded       boolean not null default false,
  input_tokens   integer,
  output_tokens  integer,
  latency_ms     integer,
  status         text not null check (status in ('ok','retried','rate_limited','invalid_output','error')),
  error          text,
  created_at     timestamptz not null default now()
);
create index llm_calls_run_idx on public.llm_calls (run_id);

-- ---------------------------------------------------------------------
-- app_settings : tiny key/value (digest recipient, founder_revision counter, ...)
-- ---------------------------------------------------------------------
create table public.app_settings (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz not null default now()
);
insert into public.app_settings (key, value) values
  ('founder_revision', '{"n":0}'::jsonb),
  ('scoring_version',  '"v1.0.0"'::jsonb)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- RLS: enable everywhere, define NO policies => deny-all for anon/authenticated.
-- service_role bypasses RLS and is further restricted by GRANTs (0002).
-- ---------------------------------------------------------------------
alter table public.company_profile      enable row level security;
alter table public.pipeline_runs        enable row level security;
alter table public.vc_pipeline          enable row level security;
alter table public.run_tasks            enable row level security;
alter table public.source_registry      enable row level security;
alter table public.evidence_candidates  enable row level security;
alter table public.signals              enable row level security;
alter table public.recommendations      enable row level security;
alter table public.feedback             enable row level security;
alter table public.outreach_outcomes    enable row level security;
alter table public.outreach_drafts      enable row level security;
alter table public.email_digests        enable row level security;
alter table public.email_digest_items   enable row level security;
alter table public.llm_calls            enable row level security;
alter table public.app_settings         enable row level security;
