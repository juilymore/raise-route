-- =====================================================================
-- 0000_neon_roles.sql — Neon adaptation (project decision: Neon, not Supabase)
--
-- 0001/0002 and tests were written for Supabase, which ships the roles
-- anon / authenticated / service_role. Neon does not, so we create them here
-- and leave 0001/0002 untouched.
--
--   anon, authenticated : NOLOGIN, get nothing (0002 revokes everything).
--   service_role        : NOLOGIN, BYPASSRLS; 0002 grants it the minimum.
--   app_service         : the ONLY role the running app connects as. It is a
--                         member of service_role and nothing else, so the
--                         Integrity Guard's privilege layer applies to it.
--
-- Run as the Neon project owner. Then set the password OUTSIDE git:
--   ALTER ROLE app_service WITH PASSWORD '<long random>';
-- and put that in DATABASE_URL. Idempotent.
-- =====================================================================
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon')          then create role anon          nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role')  then create role service_role  nologin bypassrls; end if;
  if not exists (select 1 from pg_roles where rolname = 'app_service')   then create role app_service   login; end if;
end $$;

grant service_role to app_service;
-- The owner must be able to `set role service_role` for db/tests/guard_test.sql.
do $$ begin execute format('grant service_role, anon, authenticated to %I', current_user); exception when others then null; end $$;
