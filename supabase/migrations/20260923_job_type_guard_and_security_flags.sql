alter table public.processing_jobs alter column job_type set default 'process_media';

create or replace function public.normalize_processing_job_type()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  if new.job_type is null or btrim(new.job_type)='' then
    new.job_type := case
      when coalesce(new.payload->>'operation','')='render_edit' then 'render_edit'
      when coalesce(new.payload->>'sourceType','')<>'' or coalesce(new.payload->>'source_type','')<>'' then 'import_media'
      else 'process_media'
    end;
  end if;
  return new;
end;
$$;

drop trigger if exists normalize_processing_job_type on public.processing_jobs;
create trigger normalize_processing_job_type
before insert on public.processing_jobs
for each row execute function public.normalize_processing_job_type();

create table if not exists public.security_flags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  workspace_id uuid references public.workspaces(id) on delete set null,
  severity text not null default 'medium',
  signal text not null,
  reason text not null,
  evidence jsonb not null default '{}'::jsonb,
  status text not null default 'open',
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id) on delete set null
);

alter table public.security_flags enable row level security;

create index if not exists security_flags_created_idx on public.security_flags(created_at desc);
create index if not exists security_flags_user_idx on public.security_flags(user_id,created_at desc);
create index if not exists security_flags_status_idx on public.security_flags(status,created_at desc);
create index if not exists security_flags_workspace_idx on public.security_flags(workspace_id,created_at desc);
create unique index if not exists security_flags_dedupe_idx on public.security_flags(user_id,workspace_id,signal,status,created_at);

create index if not exists user_activity_events_user_created_idx on public.user_activity_events(user_id,created_at desc);
create index if not exists user_activity_events_ip_created_idx on public.user_activity_events(ip_hash,created_at desc) where ip_hash is not null;