-- Migration: 20261019_phase_2_studio_seo_publish_retention.sql
-- Phase 2: Storage retention, deletion logs, export archives, and SEO/publish schema

create table if not exists public.storage_deletion_logs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces(id) on delete set null,
  file_path text not null,
  entity_type text not null, -- 'upload', 'clip', 'thumbnail', 'zip', 'media_asset'
  bytes_freed bigint not null default 0,
  reason text not null default 'retention_policy',
  deleted_at timestamptz not null default now()
);

create index if not exists idx_storage_deletion_logs_workspace_id on public.storage_deletion_logs(workspace_id);
create index if not exists idx_storage_deletion_logs_deleted_at on public.storage_deletion_logs(deleted_at desc);

create table if not exists public.export_archives (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  storage_path text not null,
  filename text not null,
  file_size_bytes bigint not null default 0,
  clip_count integer not null default 0,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  download_count integer not null default 0,
  last_downloaded_at timestamptz
);

create index if not exists idx_export_archives_workspace_id on public.export_archives(workspace_id);
create index if not exists idx_export_archives_project_id on public.export_archives(project_id);
create index if not exists idx_export_archives_expires_at on public.export_archives(expires_at);

-- Add retention tracking columns to media assets and clips if missing
do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='media_assets' and column_name='expires_at') then
    alter table public.media_assets add column expires_at timestamptz default (now() + interval '7 days');
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='media_assets' and column_name='deletion_warning_sent_at') then
    alter table public.media_assets add column deletion_warning_sent_at timestamptz;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='clip_versions' and column_name='expires_at') then
    alter table public.clip_versions add column expires_at timestamptz default (now() + interval '7 days');
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='clip_versions' and column_name='deletion_warning_sent_at') then
    alter table public.clip_versions add column deletion_warning_sent_at timestamptz;
  end if;
end $$;

-- Calculate retention expiry based on workspace plan: Free: 7 days, Pro: 30 days, Studio: 90 days
create or replace function public.calculate_retention_expiry(p_workspace_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_plan text := 'free';
begin
  select coalesce(plan, 'free') into v_plan from public.workspace_entitlements where workspace_id = p_workspace_id;
  if v_plan = 'studio' then
    return now() + interval '90 days';
  elsif v_plan = 'pro' then
    return now() + interval '30 days';
  else
    return now() + interval '7 days';
  end if;
end;
$$;

-- RLS
alter table public.storage_deletion_logs enable row level security;
alter table public.export_archives enable row level security;

drop policy if exists "storage_deletion_logs_member_select" on public.storage_deletion_logs;
create policy "storage_deletion_logs_member_select" on public.storage_deletion_logs
  for select to authenticated
  using (
    exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = storage_deletion_logs.workspace_id
        and wm.user_id = auth.uid()
    )
  );

drop policy if exists "export_archives_member_select" on public.export_archives;
create policy "export_archives_member_select" on public.export_archives
  for select to authenticated
  using (
    exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = export_archives.workspace_id
        and wm.user_id = auth.uid()
    )
  );

grant select on public.storage_deletion_logs, public.export_archives to authenticated;
grant all on public.storage_deletion_logs, public.export_archives to service_role;
