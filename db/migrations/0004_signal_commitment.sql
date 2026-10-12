-- 0004: the scoring/action engine needs the commitment level of an investment signal (confirmed / reported / rumor / discussion).
-- It was not stored on signals, so a rumoured deal could not be recognised when a signal is re-scored on a later run.
alter table public.signals
  add column if not exists commitment text not null default 'not_applicable'
  check (commitment in ('confirmed','reported','rumor','discussion','not_applicable'));
