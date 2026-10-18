-- Migration: 20261019_phase_2_studio_seo_publish_retention.sql
-- Phase 2: Storage Retention Policy, SEO Counters, Stuff/Export History & Instagram Connector Support

-- 1. Storage retention & expiry tracking
alter table public.media_assets
  add column if not exists expires_at timestamptz default (now() + interval '7 days'),
  add column if not exists deletion_warned_at timestamptz;

alter table public.clip_versions
  add column if not exists expires_at timestamptz default (now() + interval '7 days');

create table if not exists public.export_archives (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  filename text not null,
  storage_path text not null,
  size_bytes bigint not null default 0,
  clip_count integer not null default 0,
  plan_snapshot text not null default 'free',
  status text not null default 'ready' check (status in ('building','ready','expired','failed')),
  expires_at timestamptz not null default (now() + interval '7 days'),
  created_at timestamptz not null default now()
);

create index if not exists export_archives_workspace_idx on public.export_archives(workspace_id, created_at desc);
alter table public.export_archives enable row level security;

drop policy if exists export_archives_member_all on public.export_archives;
create policy export_archives_member_all on public.export_archives
  for all to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

create table if not exists public.storage_deletion_logs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces(id) on delete set null,
  project_id uuid references public.projects(id) on delete set null,
  entity_type text not null check (entity_type in ('media_asset','clip_version','thumbnail','export_zip')),
  entity_id uuid,
  storage_path text not null,
  reason text not null default 'retention_expired',
  deleted_at timestamptz not null default now()
);

create index if not exists storage_deletion_logs_workspace_idx on public.storage_deletion_logs(workspace_id, deleted_at desc);
alter table public.storage_deletion_logs enable row level security;

-- 2. SEO Regeneration & Cover Rotation Server-Enforced Counters
alter table public.clip_repurpose_assets
  add column if not exists regeneration_count integer not null default 0,
  add column if not exists max_regenerations integer not null default 3,
  add column if not exists cover_rotation_count integer not null default 0,
  add column if not exists max_cover_rotations integer not null default 1,
  add column if not exists youtube_tags text[] not null default '{}',
  add column if not exists keyword_suggestions text[] not null default '{}',
  add column if not exists variations jsonb not null default '[]'::jsonb;

-- 3. Score Breakdown (Hook, Flow, Emotion, Length) & Target Language
alter table public.clip_scores
  add column if not exists flow_score numeric default 80,
  add column if not exists length_score numeric default 85;

alter table public.transcripts
  add column if not exists detected_language text default 'en',
  add column if not exists target_caption_language text default 'en';

-- 4. Publish Jobs status expansion (draft, scheduled, publishing, published, failed)
alter table public.publish_jobs
  drop constraint if exists publish_jobs_status_check;

alter table public.publish_jobs
  add constraint publish_jobs_status_check
  check (status in ('draft','queued','scheduled','processing','publishing','published','failed','cancelled'));

-- 5. Calculate retention expiry based on workspace plan: Free: 7 days, Pro: 30 days, Studio: 90 days
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
