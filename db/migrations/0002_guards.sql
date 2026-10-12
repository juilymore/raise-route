-- =====================================================================
-- 0002_guards.sql — THE INTEGRITY GUARD
--
-- Exam rule: "must not overwrite Vikram's manual notes ... update only the
-- signal-derived columns ... contact history and personal notes must remain
-- untouched."  We enforce this FOUR independent ways, so it holds even if the
-- pipeline code (or an AI-generated patch) is buggy:
--
--   Layer 1  PRIVILEGES   service_role has NO insert/update/delete on vc_pipeline.
--   Layer 2  CHOKE POINT  the only write path for signal columns is
--                         apply_assessment(), whose UPDATE names columns explicitly.
--   Layer 3  TRIGGER      even a superuser-level UPDATE that changes a non-system
--                         column is rejected unless app.actor = 'founder'.
--   Layer 4  RECEIPT      every run stores a SHA-256 fingerprint of all founder-owned
--                         data before/after (+ a founder-edit counter so legitimate
--                         edits mid-run are not misreported as violations).
-- =====================================================================

-- ---------------------------------------------------------------------
-- Single source of truth: which vc_pipeline columns are SYSTEM-owned.
-- Everything NOT in this list is protected.
-- ---------------------------------------------------------------------
create or replace function public.vc_system_columns() returns text[]
language sql immutable as $$
  select array[
    'last_signal_date','signal_summary','follow_up_score','recommended_action',
    'hold_reason','action_reason','assessment_status','score_breakdown','fit_score',
    'qualifying_signal_count','prev_follow_up_score','prev_recommended_action',
    'scoring_version','last_run_id','last_assessed_at','updated_at'
  ]::text[];
$$;

create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

create trigger trg_touch_vc_pipeline     before update on public.vc_pipeline     for each row execute function public.touch_updated_at();
create trigger trg_touch_company_profile before update on public.company_profile for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------
-- Layer 3: trigger guard (name sorts BEFORE trg_touch_* on purpose)
-- ---------------------------------------------------------------------
create or replace function public.guard_vc_pipeline() returns trigger
language plpgsql as $$
declare
  actor text := coalesce(current_setting('app.actor', true), '');
begin
  if tg_op = 'DELETE' then
    if actor = 'founder' then return old; end if;
    raise exception 'FOUNDER_DATA_GUARD: deleting vc_pipeline rows is not allowed (actor=%)', nullif(actor,'')
      using errcode = '42501';
  end if;

  if actor = 'founder' then return new; end if;

  if (to_jsonb(new) - public.vc_system_columns()) is distinct from (to_jsonb(old) - public.vc_system_columns()) then
    raise exception 'FOUNDER_DATA_GUARD: refusing to change founder-owned columns of vc_pipeline (actor=%)', nullif(actor,'')
      using errcode = '42501';
  end if;
  return new;
end $$;

create trigger trg_guard_vc_pipeline        before update on public.vc_pipeline for each row execute function public.guard_vc_pipeline();
create trigger trg_guard_vc_pipeline_delete before delete on public.vc_pipeline for each row execute function public.guard_vc_pipeline();

-- ---------------------------------------------------------------------
-- Immutable history: recommendations + digest items can never change.
-- ---------------------------------------------------------------------
create or replace function public.forbid_mutation() returns trigger
language plpgsql as $$
begin
  raise exception 'IMMUTABLE_HISTORY: % on % is not allowed', tg_op, tg_table_name using errcode = '42501';
end $$;

create trigger trg_recommendations_immutable  before update or delete on public.recommendations  for each row execute function public.forbid_mutation();
create trigger trg_digest_items_immutable     before update or delete on public.email_digest_items for each row execute function public.forbid_mutation();

-- Digest CONTENT is frozen at creation; only delivery-status fields may change.
create or replace function public.guard_email_digest() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'IMMUTABLE_HISTORY: email_digests rows cannot be deleted' using errcode = '42501';
  end if;
  if new.run_id     is distinct from old.run_id
  or new.digest_key is distinct from old.digest_key
  or new.recipient  is distinct from old.recipient
  or new.subject    is distinct from old.subject
  or new.html       is distinct from old.html
  or new.text_body  is distinct from old.text_body
  or new.created_at is distinct from old.created_at then
    raise exception 'IMMUTABLE_HISTORY: digest content is frozen once created' using errcode = '42501';
  end if;
  if old.status = 'SENT' and new.status <> 'SENT' then
    raise exception 'IMMUTABLE_HISTORY: a SENT digest cannot change status' using errcode = '42501';
  end if;
  return new;
end $$;

create trigger trg_email_digests_guard before update or delete on public.email_digests for each row execute function public.guard_email_digest();

-- Truthful status: "SENT" is only allowed with a provider-confirmed message id.
alter table public.email_digests
  add constraint email_sent_requires_confirmation
  check (status <> 'SENT' or (provider_message_id is not null and sent_at is not null));

-- ---------------------------------------------------------------------
-- Layer 4: fingerprint + founder revision counter
-- ---------------------------------------------------------------------
create or replace function public.founder_data_fingerprint() returns text
language sql stable as $$
  select encode(
    sha256(convert_to(
      coalesce(string_agg((to_jsonb(v) - public.vc_system_columns())::text, '|' order by v.id), ''),
      'UTF8')),
    'hex')
  from public.vc_pipeline v;
$$;

create or replace function public.bump_founder_revision() returns void
language sql security definer set search_path = public, pg_temp as $$
  update public.app_settings
     set value = jsonb_build_object('n', coalesce((value->>'n')::int, 0) + 1), updated_at = now()
   where key = 'founder_revision';
$$;

-- ---------------------------------------------------------------------
-- Run lifecycle (receipts are computed INSIDE the database, not by app code)
-- ---------------------------------------------------------------------
create or replace function public.start_run(
  p_run_key text, p_trigger text, p_scoring_version text, p_model text,
  p_window_start date, p_window_end date
) returns public.pipeline_runs
language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.pipeline_runs;
begin
  insert into public.pipeline_runs
    (run_key, trigger, scoring_version, model_primary, window_start, window_end,
     founder_hash_before, founder_revision_before)
  values
    (p_run_key, p_trigger, p_scoring_version, p_model, p_window_start, p_window_end,
     public.founder_data_fingerprint(),
     (select (value->>'n')::int from public.app_settings where key = 'founder_revision'))
  on conflict (run_key) do nothing;           -- idempotent: same key => same run

  select * into r from public.pipeline_runs where run_key = p_run_key;
  return r;
end $$;

create or replace function public.finalize_run(p_run_id uuid, p_status text, p_stats jsonb default '{}'::jsonb)
returns public.pipeline_runs
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_hash text := public.founder_data_fingerprint();
  v_rev  integer := (select (value->>'n')::int from public.app_settings where key = 'founder_revision');
  r public.pipeline_runs;
begin
  update public.pipeline_runs p set
    status                  = p_status,
    completed_at            = now(),
    founder_hash_after      = v_hash,
    founder_revision_after  = v_rev,
    founder_data_intact     = case when v_rev is distinct from p.founder_revision_before then null
                                   else v_hash = p.founder_hash_before end,
    vcs_total               = coalesce((p_stats->>'vcs_total')::int,               p.vcs_total),
    vcs_signal_found        = coalesce((p_stats->>'vcs_signal_found')::int,        p.vcs_signal_found),
    vcs_quiet               = coalesce((p_stats->>'vcs_quiet')::int,               p.vcs_quiet),
    vcs_partial             = coalesce((p_stats->>'vcs_partial')::int,             p.vcs_partial),
    vcs_failed              = coalesce((p_stats->>'vcs_failed')::int,              p.vcs_failed),
    candidates_found        = coalesce((p_stats->>'candidates_found')::int,        p.candidates_found),
    signals_qualified       = coalesce((p_stats->>'signals_qualified')::int,       p.signals_qualified),
    recommendations_written = coalesce((p_stats->>'recommendations_written')::int, p.recommendations_written),
    llm_calls               = coalesce((p_stats->>'llm_calls')::int,               p.llm_calls),
    llm_tokens_in           = coalesce((p_stats->>'llm_tokens_in')::bigint,        p.llm_tokens_in),
    llm_tokens_out          = coalesce((p_stats->>'llm_tokens_out')::bigint,       p.llm_tokens_out),
    search_calls            = coalesce((p_stats->>'search_calls')::int,            p.search_calls),
    error_count             = coalesce((p_stats->>'error_count')::int,             p.error_count),
    errors                  = coalesce(p_stats->'errors',                          p.errors)
  where p.id = p_run_id
  returning * into r;
  if not found then raise exception 'unknown run %', p_run_id; end if;
  return r;
end $$;

-- Work queue claim (concurrency-safe, retries stale RUNNING tasks, max 3 attempts)
create or replace function public.claim_run_tasks(p_run_id uuid, p_limit integer default 3, p_stale_seconds integer default 300)
returns setof public.run_tasks
language plpgsql as $$
begin
  return query
  update public.run_tasks t
     set status = 'RUNNING', claimed_at = now(), attempts = t.attempts + 1
   where t.id in (
     select s.id from public.run_tasks s
      where s.run_id = p_run_id
        and s.attempts < 3
        and (s.status = 'PENDING'
             or (s.status = 'RUNNING' and s.claimed_at < now() - make_interval(secs => p_stale_seconds)))
      order by s.id
      for update skip locked
      limit p_limit)
  returning t.*;
end $$;

-- ---------------------------------------------------------------------
-- Layer 2: THE ONLY write path for signal-derived columns.
-- Extra keys in p_a are IGNORED (columns are named explicitly below).
-- ---------------------------------------------------------------------
create or replace function public.apply_assessment(p_vc_id uuid, p_run_id uuid, p_a jsonb)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_a->>'recommended_action' is null then
    raise exception 'apply_assessment: recommended_action is required';
  end if;
  perform set_config('app.actor', 'pipeline', true);

  update public.vc_pipeline v set
    -- roll "previous" values forward only once per run (retry-safe / idempotent)
    prev_follow_up_score    = case when v.last_run_id is distinct from p_run_id then v.follow_up_score    else v.prev_follow_up_score    end,
    prev_recommended_action = case when v.last_run_id is distinct from p_run_id then v.recommended_action else v.prev_recommended_action end,
    last_signal_date        = nullif(p_a->>'last_signal_date', '')::date,
    signal_summary          = p_a->>'signal_summary',
    follow_up_score         = nullif(p_a->>'follow_up_score', '')::int,
    recommended_action      = p_a->>'recommended_action',
    hold_reason             = nullif(p_a->>'hold_reason', ''),
    action_reason           = p_a->>'action_reason',
    assessment_status       = coalesce(p_a->>'assessment_status', 'NOT_ASSESSED'),
    score_breakdown         = p_a->'score_breakdown',
    fit_score               = nullif(p_a->>'fit_score', '')::int,
    qualifying_signal_count = coalesce((p_a->>'qualifying_signal_count')::int, 0),
    scoring_version         = p_a->>'scoring_version',
    last_run_id             = p_run_id,
    last_assessed_at        = now()
  where v.id = p_vc_id;

  if not found then raise exception 'apply_assessment: unknown vc %', p_vc_id; end if;
  perform set_config('app.actor', '', true);   -- never leak an actor into the rest of the transaction
end $$;

-- ---------------------------------------------------------------------
-- Founder write path (UI/API only). Allow-listed keys; unknown keys rejected.
-- ---------------------------------------------------------------------
create or replace function public.founder_update_vc(p_vc_id uuid, p_patch jsonb)
returns public.vc_pipeline
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  allowed text[] := array['name','firm','thesis','website','hq_region','stage_focus','sector_tags',
                          'aliases','tracked_people','contact_status','last_contact_date',
                          'reconnect_after','personal_notes'];
  bad text;
  r public.vc_pipeline;
begin
  select k into bad from jsonb_object_keys(p_patch) k where k <> all (allowed) limit 1;
  if bad is not null then
    raise exception 'FOUNDER_PATCH: field "%" is not editable', bad using errcode = '22023';
  end if;

  perform set_config('app.actor', 'founder', true);

  update public.vc_pipeline v set
    name              = case when p_patch ? 'name'              then p_patch->>'name'              else v.name end,
    firm              = case when p_patch ? 'firm'              then p_patch->>'firm'              else v.firm end,
    thesis            = case when p_patch ? 'thesis'            then p_patch->>'thesis'            else v.thesis end,
    website           = case when p_patch ? 'website'           then p_patch->>'website'           else v.website end,
    hq_region         = case when p_patch ? 'hq_region'         then p_patch->>'hq_region'         else v.hq_region end,
    stage_focus       = case when p_patch ? 'stage_focus'       then p_patch->>'stage_focus'       else v.stage_focus end,
    sector_tags       = case when p_patch ? 'sector_tags'       then coalesce(array(select jsonb_array_elements_text(p_patch->'sector_tags')), '{}') else v.sector_tags end,
    aliases           = case when p_patch ? 'aliases'           then coalesce(array(select jsonb_array_elements_text(p_patch->'aliases')), '{}')     else v.aliases end,
    tracked_people    = case when p_patch ? 'tracked_people'    then coalesce(array(select jsonb_array_elements_text(p_patch->'tracked_people')), '{}') else v.tracked_people end,
    contact_status    = case when p_patch ? 'contact_status'    then p_patch->>'contact_status'    else v.contact_status end,
    last_contact_date = case when p_patch ? 'last_contact_date' then nullif(p_patch->>'last_contact_date','')::date else v.last_contact_date end,
    reconnect_after   = case when p_patch ? 'reconnect_after'   then nullif(p_patch->>'reconnect_after','')::date   else v.reconnect_after end,
    personal_notes    = case when p_patch ? 'personal_notes'    then p_patch->>'personal_notes'    else v.personal_notes end
  where v.id = p_vc_id
  returning * into r;

  if not found then raise exception 'founder_update_vc: unknown vc %', p_vc_id; end if;
  perform public.bump_founder_revision();
  perform set_config('app.actor', '', true);   -- never leak an actor into the rest of the transaction
  return r;
end $$;

create or replace function public.founder_append_contact_event(p_vc_id uuid, p_event jsonb)
returns public.vc_pipeline
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r public.vc_pipeline;
  v_at date;
begin
  if jsonb_typeof(p_event) <> 'object' or not (p_event ?& array['at','type','summary']) then
    raise exception 'FOUNDER_PATCH: contact event needs at, type, summary' using errcode = '22023';
  end if;
  v_at := (p_event->>'at')::date;

  perform set_config('app.actor', 'founder', true);

  update public.vc_pipeline v set
    contact_history   = v.contact_history || jsonb_build_array(p_event),
    last_contact_date = case when p_event->>'type' in ('email_sent','follow_up_sent','dm_sent','call','meeting')
                             then greatest(coalesce(v.last_contact_date, v_at), v_at)
                             else v.last_contact_date end
  where v.id = p_vc_id
  returning * into r;

  if not found then raise exception 'founder_append_contact_event: unknown vc %', p_vc_id; end if;
  perform public.bump_founder_revision();
  perform set_config('app.actor', '', true);   -- never leak an actor into the rest of the transaction
  return r;
end $$;

-- ---------------------------------------------------------------------
-- Views (security_invoker so RLS/grants of the caller apply)
-- ---------------------------------------------------------------------
create or replace view public.v_pipeline_overview with (security_invoker = true) as
select
  count(*)                                                              as total,
  count(*) filter (where recommended_action = 'REACH_OUT_NOW')          as reach_out_now,
  count(*) filter (where recommended_action = 'FOLLOW_UP_NOW')          as follow_up_now,
  count(*) filter (where recommended_action = 'MONITOR')                as monitor,
  count(*) filter (where recommended_action = 'HOLD')                   as hold,
  count(*) filter (where recommended_action = 'DONT_PRIORITIZE')        as dont_prioritize,
  count(*) filter (where recommended_action = 'ASSESSMENT_INCOMPLETE')  as assessment_incomplete,
  count(*) filter (where recommended_action is null)                    as not_assessed,
  count(*) filter (where assessment_status = 'QUIET')                   as quiet
from public.vc_pipeline;

-- Priority changes between the two most recent snapshots per VC
create or replace view public.v_priority_changes with (security_invoker = true) as
with ranked as (
  select r.*, row_number() over (partition by r.vc_id order by r.created_at desc) as rn
  from public.recommendations r
)
select cur.vc_id, cur.run_id,
       cur.action          as action_now,   prev.action          as action_before,
       cur.follow_up_score as score_now,    prev.follow_up_score as score_before,
       cur.created_at
from ranked cur
left join ranked prev on prev.vc_id = cur.vc_id and prev.rn = 2
where cur.rn = 1
  and (prev.id is null
       or cur.action is distinct from prev.action
       or abs(coalesce(cur.follow_up_score, 0) - coalesce(prev.follow_up_score, 0)) >= 10);

-- ---------------------------------------------------------------------
-- Layer 1: EXPLICIT GRANTS (Supabase no longer auto-exposes public tables)
-- Start from nothing, then grant the minimum.
-- ---------------------------------------------------------------------
grant usage on schema public to service_role;

revoke all on all tables    in schema public from anon, authenticated, service_role;
revoke all on all sequences in schema public from anon, authenticated, service_role;
revoke execute on all functions in schema public from public, anon, authenticated, service_role;

grant select on all tables in schema public to service_role;        -- includes the two views

-- vc_pipeline: READ ONLY. All writes go through the SECURITY DEFINER functions above.
-- (no insert/update/delete grant => Layer 1)

grant insert, update on public.company_profile      to service_role;  -- founder-edited in Settings
grant insert, update on public.app_settings         to service_role;
grant insert, update on public.run_tasks            to service_role;
grant insert, update on public.source_registry      to service_role;
grant insert, update on public.evidence_candidates  to service_role;
grant insert, update on public.signals              to service_role;
grant insert         on public.llm_calls            to service_role;
grant insert         on public.recommendations      to service_role;  -- immutable after insert (trigger)
grant insert         on public.feedback             to service_role;
grant insert         on public.outreach_outcomes    to service_role;
grant insert         on public.outreach_drafts      to service_role;
grant insert         on public.email_digests        to service_role;
grant insert         on public.email_digest_items   to service_role;

-- Run counters: column-level update. founder_* receipt columns are NOT updatable by app code.
grant update (status, completed_at, vcs_total, vcs_signal_found, vcs_quiet, vcs_partial, vcs_failed,
              candidates_found, signals_qualified, recommendations_written, llm_calls, llm_tokens_in,
              llm_tokens_out, search_calls, error_count, errors)
  on public.pipeline_runs to service_role;

-- Digest delivery status only (content frozen by trigger as well)
grant update (status, provider, provider_message_id, error, sent_at) on public.email_digests to service_role;

grant execute on function
  public.vc_system_columns(),
  public.founder_data_fingerprint(),
  public.start_run(text, text, text, text, date, date),
  public.finalize_run(uuid, text, jsonb),
  public.claim_run_tasks(uuid, integer, integer),
  public.apply_assessment(uuid, uuid, jsonb),
  public.founder_update_vc(uuid, jsonb),
  public.founder_append_contact_event(uuid, jsonb)
to service_role;
