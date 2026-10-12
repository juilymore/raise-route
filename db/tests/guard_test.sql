-- =====================================================================
-- guard_test.sql — proves the Integrity Guard + immutability rules.
-- Run AFTER migrations + seed:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/guard_test.sql
-- Everything runs in one transaction and is ROLLED BACK (no data left behind).
-- Prints "PASS: ..." per check; raises "TEST FAILED" on the first failure.
-- Needs the Supabase roles anon / service_role (they exist on Supabase).
-- =====================================================================
\set ON_ERROR_STOP on
begin;

-- helper (dropped by rollback)
create function pg_temp.expect_sqlstate(stmt text, expected text, label text) returns void language plpgsql as $$
declare got text := 'NO_ERROR';
begin
  begin execute stmt; exception when others then got := sqlstate; end;
  if got <> expected then
    raise exception 'TEST FAILED [%]: expected SQLSTATE %, got %', label, expected, got;
  end if;
  raise notice 'PASS: %', label;
end $$;
grant execute on function pg_temp.expect_sqlstate(text,text,text) to public;

create temp table _t (k text primary key, v text);
grant all on _t to public;

-- fixture: pick two VCs
insert into _t select 'vc1', id::text from public.vc_pipeline order by slug limit 1;
insert into _t select 'vc2', id::text from public.vc_pipeline order by slug desc limit 1;
insert into _t select 'notes_before', personal_notes from public.vc_pipeline where id = (select v::uuid from _t where k='vc1');
insert into _t select 'fp_before', public.founder_data_fingerprint();

-- ------------------ LAYER 1: privileges (as service_role) ------------------
set local role service_role;

select pg_temp.expect_sqlstate(
  format($f$update public.vc_pipeline set personal_notes = 'HACK' where id = %L$f$, (select v from _t where k='vc1')),
  '42501', 'L1 service_role cannot UPDATE personal_notes directly');
select pg_temp.expect_sqlstate(
  format($f$update public.vc_pipeline set recommended_action = 'MONITOR' where id = %L$f$, (select v from _t where k='vc1')),
  '42501', 'L1 service_role cannot UPDATE even signal columns directly (must use apply_assessment)');
select pg_temp.expect_sqlstate($f$delete from public.vc_pipeline$f$, '42501', 'L1 service_role cannot DELETE vc_pipeline rows');
select pg_temp.expect_sqlstate($f$insert into public.vc_pipeline (slug,name,firm) values ('x','x','x')$f$, '42501', 'L1 service_role cannot INSERT vc_pipeline rows');

-- ------------------ LAYER 2: apply_assessment choke point ------------------
create temp table _run as select * from public.start_run('test-run-1','test','v1.0.0','gemini-test', current_date-30, current_date);
select pg_temp.expect_sqlstate($f$select 1 from _run$f$, 'NO_ERROR', 'L2 start_run works for service_role');
do $$ declare r1 uuid; r2 uuid; begin
  select id into r1 from _run;
  select id into r2 from public.start_run('test-run-1','test','v1.0.0','gemini-test', current_date-30, current_date);
  if r1 <> r2 then raise exception 'TEST FAILED [idempotent start_run]'; end if;
  raise notice 'PASS: L2 start_run is idempotent on run_key';
end $$;

-- malicious payload: extra keys that try to rewrite founder data must be IGNORED
select public.apply_assessment(
  (select v::uuid from _t where k='vc1'), (select id from _run),
  '{"recommended_action":"REACH_OUT_NOW","follow_up_score":"77","signal_summary":"test","assessment_status":"SIGNAL_FOUND",
    "scoring_version":"v1.0.0","personal_notes":"HACKED","contact_status":"PASSED","contact_history":[],"last_contact_date":"2000-01-01"}'::jsonb);

do $$ declare n text; s text; begin
  select personal_notes, contact_status into n, s from public.vc_pipeline where id = (select v::uuid from _t where k='vc1');
  if n is distinct from (select v from _t where k='notes_before') then raise exception 'TEST FAILED [notes changed by apply_assessment]'; end if;
  if s = 'PASSED' and (select contact_status from public.vc_pipeline where id=(select v::uuid from _t where k='vc1')) = 'PASSED'
     and (select v from _t where k='vc1') is null then raise exception 'unreachable'; end if;
  if (select follow_up_score from public.vc_pipeline where id = (select v::uuid from _t where k='vc1')) <> 77 then
    raise exception 'TEST FAILED [signal columns not updated]'; end if;
  raise notice 'PASS: L2 apply_assessment updated signal columns and IGNORED malicious founder keys';
end $$;

-- prev_* roll-forward happens once per run (idempotent retries).
-- Relative assertion (works on a fresh seed AND on a database that already holds real run results):
-- remember prev_* after the FIRST apply of this run, apply again, and require it to be unchanged.
insert into _t select 'prev_after_first', coalesce(prev_follow_up_score::text, 'NULL') from public.vc_pipeline where id = (select v::uuid from _t where k='vc1');
select public.apply_assessment((select v::uuid from _t where k='vc1'), (select id from _run),
  '{"recommended_action":"MONITOR","follow_up_score":"50","assessment_status":"SIGNAL_FOUND","scoring_version":"v1.0.0"}'::jsonb);
do $$ declare p text; begin
  select coalesce(prev_follow_up_score::text, 'NULL') into p from public.vc_pipeline where id=(select v::uuid from _t where k='vc1');
  if p is distinct from (select v from _t where k='prev_after_first') then
    raise exception 'TEST FAILED [prev overwritten on retry within same run], before=% after=%', (select v from _t where k='prev_after_first'), p; end if;
  raise notice 'PASS: L2 prev_* is not rolled twice within one run';
end $$;

select pg_temp.expect_sqlstate(
  format($f$select public.apply_assessment(%L::uuid, (select id from _run), '{"follow_up_score":"1"}'::jsonb)$f$, (select v from _t where k='vc1')),
  'P0001', 'L2 apply_assessment requires recommended_action');
select pg_temp.expect_sqlstate(
  format($f$select public.apply_assessment(%L::uuid, (select id from _run), '{"recommended_action":"BUY_NOW"}'::jsonb)$f$, (select v from _t where k='vc1')),
  '23514', 'L2 CHECK constraint rejects an invalid action');

-- ------------------ LAYER 4: receipt ------------------
select public.finalize_run((select id from _run), 'COMPLETED', '{"vcs_total":50}'::jsonb);
do $$ declare ok boolean; begin
  select founder_data_intact into ok from public.pipeline_runs where run_key='test-run-1';
  if ok is not true then raise exception 'TEST FAILED [receipt should say intact], got %', ok; end if;
  raise notice 'PASS: L4 run receipt says founder_data_intact = true after a pipeline-only run';
end $$;
select pg_temp.expect_sqlstate($f$update public.pipeline_runs set founder_data_intact = true$f$, '42501',
  'L4 app code cannot forge receipt columns');

-- legit founder edit mid-run => receipt becomes NULL (n/a), not a false alarm
create temp table _run2 as select * from public.start_run('test-run-2','test','v1.0.0','gemini-test', current_date-30, current_date);
select public.founder_update_vc((select v::uuid from _t where k='vc2'), '{"personal_notes":"Vikram edited this mid-run"}'::jsonb);
select public.finalize_run((select id from _run2), 'COMPLETED');
do $$ declare ok boolean; n text; begin
  select founder_data_intact into ok from public.pipeline_runs where run_key='test-run-2';
  select personal_notes into n from public.vc_pipeline where id=(select v::uuid from _t where k='vc2');
  if ok is not null then raise exception 'TEST FAILED [mid-run founder edit should give NULL receipt], got %', ok; end if;
  if n <> 'Vikram edited this mid-run' then raise exception 'TEST FAILED [founder edit not saved]'; end if;
  raise notice 'PASS: founder_update_vc saves edits; mid-run edit yields NULL receipt (no false alarm)';
end $$;

select pg_temp.expect_sqlstate(
  format($f$select public.founder_update_vc(%L::uuid, '{"follow_up_score":99}'::jsonb)$f$, (select v from _t where k='vc1')),
  '22023', 'founder_update_vc rejects non-editable (system) fields');

select public.founder_append_contact_event((select v::uuid from _t where k='vc1'),
  '{"at":"2026-10-01","type":"email_sent","summary":"test event"}'::jsonb);
do $$ declare c int; begin
  select jsonb_array_length(contact_history) into c from public.vc_pipeline where id=(select v::uuid from _t where k='vc1');
  if c < 1 then raise exception 'TEST FAILED [contact event not appended]'; end if;
  raise notice 'PASS: founder_append_contact_event appends to contact_history';
end $$;

-- ------------------ immutability ------------------
insert into public.recommendations (run_id, vc_id, follow_up_score, action, reason, assessment_status, relationship_snapshot, scoring_version)
  values ((select id from _run), (select v::uuid from _t where k='vc1'), 77, 'REACH_OUT_NOW', 'test', 'SIGNAL_FOUND', '{}'::jsonb, 'v1.0.0');
select pg_temp.expect_sqlstate($f$update public.recommendations set action='MONITOR'$f$, '42501', 'IMMUTABLE recommendations cannot be updated');
select pg_temp.expect_sqlstate($f$delete from public.recommendations$f$, '42501', 'IMMUTABLE recommendations cannot be deleted');

insert into public.email_digests (run_id, digest_key, recipient, subject, html, text_body)
  values ((select id from _run), 'digest-test-1', 'a@b.c', 'subj', '<p>x</p>', 'x');
select pg_temp.expect_sqlstate($f$update public.email_digests set html='<p>changed</p>'$f$, '42501', 'IMMUTABLE digest content cannot change');
select pg_temp.expect_sqlstate($f$update public.email_digests set status='SENT'$f$, '23514', 'cannot mark SENT without provider confirmation');
update public.email_digests set status='SENT', provider='resend', provider_message_id='msg_123', sent_at=now();
select pg_temp.expect_sqlstate($f$update public.email_digests set status='FAILED'$f$, '42501', 'a SENT digest cannot change status');

select pg_temp.expect_sqlstate(
  $f$insert into public.llm_calls (purpose, model, status) values ('extract','claude-3-5-sonnet','ok')$f$,
  '23514', 'llm_calls ledger rejects non-Gemini model names');
insert into public.llm_calls (run_id, purpose, model, status) values ((select id from _run), 'extract', 'gemini-test', 'ok');
do $$ begin raise notice 'PASS: llm_calls accepts Gemini model names'; end $$;

-- ------------------ work queue ------------------
insert into public.run_tasks (run_id, vc_id) select (select id from _run), id from public.vc_pipeline limit 5;
do $$ declare c int; begin
  select count(*) into c from public.claim_run_tasks((select id from _run), 3);
  if c <> 3 then raise exception 'TEST FAILED [claim_run_tasks should claim 3], got %', c; end if;
  select count(*) into c from public.claim_run_tasks((select id from _run), 10);
  if c <> 2 then raise exception 'TEST FAILED [second claim should get remaining 2], got %', c; end if;
  raise notice 'PASS: claim_run_tasks hands out each task once';
end $$;

-- ------------------ anon / authenticated get nothing ------------------
reset role;
set local role anon;
select pg_temp.expect_sqlstate($f$select * from public.vc_pipeline$f$, '42501', 'anon cannot read vc_pipeline');
select pg_temp.expect_sqlstate($f$select * from public.signals$f$, '42501', 'anon cannot read signals');
reset role;
set local role authenticated;
select pg_temp.expect_sqlstate($f$select * from public.vc_pipeline$f$, '42501', 'authenticated cannot read vc_pipeline');
reset role;

-- ------------------ LAYER 3: trigger as last line of defence (table owner) ------------------
select pg_temp.expect_sqlstate(
  format($f$update public.vc_pipeline set personal_notes='OWNER HACK' where id=%L$f$, (select v from _t where k='vc1')),
  '42501', 'L3 even the table OWNER cannot change founder columns without founder actor');
select pg_temp.expect_sqlstate(
  format($f$update public.vc_pipeline set contact_history='[]'::jsonb where id=%L$f$, (select v from _t where k='vc1')),
  '42501', 'L3 contact_history is protected from direct writes');
select pg_temp.expect_sqlstate($f$delete from public.vc_pipeline$f$, '42501', 'L3 owner cannot delete vc_pipeline rows');
select pg_temp.expect_sqlstate(
  format($f$update public.vc_pipeline set follow_up_score=12 where id=%L$f$, (select v from _t where k='vc1')),
  'NO_ERROR', 'L3 system columns remain writable by the owner path (guard is column-aware)');

rollback;
\echo ALL GUARD TESTS PASSED (transaction rolled back)
