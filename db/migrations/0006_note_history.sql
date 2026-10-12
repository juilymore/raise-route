-- Note history: every change to Vikram's personal_notes keeps the old and the new text with a timestamp.
-- Founder-owned data is still written only through founder_update_vc(); this trigger only COPIES what changed into a log table.
create table if not exists public.vc_note_history (
  id         uuid primary key default gen_random_uuid(),
  vc_id      uuid not null references public.vc_pipeline(id) on delete cascade,
  old_note   text,
  new_note   text,
  changed_at timestamptz not null default now()
);
create index if not exists vc_note_history_vc_idx on public.vc_note_history (vc_id, changed_at desc);
alter table public.vc_note_history enable row level security;

create or replace function public.log_note_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.personal_notes is distinct from old.personal_notes then
    insert into public.vc_note_history (vc_id, old_note, new_note) values (new.id, old.personal_notes, new.personal_notes);
  end if;
  return new;
end $$;

drop trigger if exists trg_log_note_change on public.vc_pipeline;
create trigger trg_log_note_change after update of personal_notes on public.vc_pipeline
  for each row execute function public.log_note_change();

grant select on public.vc_note_history to service_role;
