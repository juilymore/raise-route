-- 0005: back the evidence rules with the database, not only application code (audit finding).
--  * a stored signal must have a verified quote
--  * its event date can never be more than 1 day after the day it was stored (no future-dated events)
--  * it must have a source URL that is http(s)
alter table public.signals
  add constraint signals_quote_must_be_verified check (excerpt_verified is true),
  add constraint signals_event_not_in_future check (event_date <= ((created_at at time zone 'utc')::date + 1)),
  add constraint signals_source_url_http check (primary_source_url ~* '^https?://');
