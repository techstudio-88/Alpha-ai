-- Alpha.ai Phase 1 backend foundation (additive; do not drop legacy accounting).
-- Apply after reviewing against the current production schema. Secrets never belong here.
-- The app must call reserve_job_credits only after the job row is accepted into the durable queue.

alter table public.processing_jobs
  add column if not exists error_id text,
  add column if not exists failure_type text,
  add column if not exists idempotency_key text,
  add column if not exists max_attempts integer not null default 5,
  add column if not exists next_retry_at timestamptz,
  add column if not exists dead_lettered_at timestamptz,
  add column if not exists cancel_requested_at timestamptz,
  add column if not exists output_locations jsonb not null default '{}'::jsonb,
  add column if not exists reserved_credits integer not null default 0,
  add column if not exists video_minutes_reserved numeric(12,2) not null default 0;

alter table public.processing_jobs
  drop constraint if exists processing_jobs_max_attempts_check,
  add constraint processing_jobs_max_attempts_check check (max_attempts between 1 and 20) not valid,
  drop constraint if exists processing_jobs_reserved_credits_check,
  add constraint processing_jobs_reserved_credits_check check (reserved_credits >= 0) not valid,
  drop constraint if exists processing_jobs_video_minutes_reserved_check,
  add constraint processing_jobs_video_minutes_reserved_check check (video_minutes_reserved >= 0) not valid;

create unique index if not exists processing_jobs_workspace_idempotency_uidx
  on public.processing_jobs(workspace_id, idempotency_key)
  where idempotency_key is not null;
create index if not exists processing_jobs_retry_due_idx
  on public.processing_jobs(status, next_retry_at, created_at)
  where status in ('queued','failed');
create index if not exists processing_jobs_dead_letter_idx
  on public.processing_jobs(dead_lettered_at desc)
  where dead_lettered_at is not null;

-- AI credits are separate from video-minute allowances and the existing token_ledger.
create table if not exists public.credit_ledger (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  job_id uuid references public.processing_jobs(id) on delete set null,
  amount integer not null check (amount <> 0),
  transaction_type text not null check (transaction_type in ('reserve','refund','adjustment')),
  reason text not null check (length(trim(reason)) between 1 and 500),
  idempotency_key text not null unique check (length(trim(idempotency_key)) between 8 and 200),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create unique index if not exists credit_ledger_one_reservation_per_job_uidx
  on public.credit_ledger(job_id)
  where job_id is not null and transaction_type='reserve';
create index if not exists credit_ledger_user_history_idx
  on public.credit_ledger(workspace_id,user_id,created_at desc);
alter table public.credit_ledger enable row level security;
drop policy if exists credit_ledger_member_read on public.credit_ledger;
create policy credit_ledger_member_read on public.credit_ledger
  for select to authenticated
  using (user_id=(select auth.uid()) and exists (
    select 1 from public.workspace_members m
    where m.workspace_id=credit_ledger.workspace_id and m.user_id=(select auth.uid())
  ));
revoke insert, update, delete on public.credit_ledger from anon, authenticated;
grant select on public.credit_ledger to authenticated;
grant select, insert, update, delete on public.credit_ledger to service_role;

-- This RPC is service-role-only. It reserves credits atomically at acceptance time,
-- never on page load, refresh, upload start, or a client-side retry.
create or replace function public.reserve_job_credits(
  p_workspace_id uuid,
  p_job_id uuid,
  p_user_id uuid,
  p_amount integer,
  p_reason text,
  p_idempotency_key text
) returns public.credit_ledger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.processing_jobs;
  v_balance public.usage_credits;
  v_entry public.credit_ledger;
begin
  if p_amount <= 0 or p_workspace_id is null or p_job_id is null or p_user_id is null
     or length(trim(coalesce(p_reason,'')))=0 or length(trim(coalesce(p_idempotency_key,'')))<8 then
    raise exception using errcode='22023', message='Invalid credit reservation request';
  end if;

  select * into v_entry from public.credit_ledger
    where idempotency_key=p_idempotency_key for update;
  if found then
    if v_entry.workspace_id<>p_workspace_id or v_entry.user_id<>p_user_id
       or v_entry.job_id<>p_job_id or v_entry.amount<>-p_amount
       or v_entry.transaction_type<>'reserve' then
      raise exception using errcode='23505', message='Credit idempotency key conflict';
    end if;
    return v_entry;
  end if;

  select * into v_job from public.processing_jobs
    where id=p_job_id and workspace_id=p_workspace_id for update;
  if not found then raise exception using errcode='23503', message='Accepted job not found'; end if;
  if v_job.status not in ('queued','processing') then
    raise exception using errcode='23514', message='Job is not accepted for processing';
  end if;
  if v_job.project_id is not null and not exists (
    select 1 from public.projects p
    where p.id=v_job.project_id and p.workspace_id=p_workspace_id
  ) then raise exception using errcode='23514', message='Job project workspace mismatch'; end if;
  if not exists (
    select 1 from public.workspace_members m
    where m.workspace_id=p_workspace_id and m.user_id=p_user_id
  ) then raise exception using errcode='42501', message='Workspace access denied'; end if;

  select * into v_balance from public.usage_credits
    where workspace_id=p_workspace_id and user_id=p_user_id for update;
  if not found or v_balance.credits < p_amount then
    raise exception using errcode='P0001', message='INSUFFICIENT_CREDITS';
  end if;

  update public.usage_credits set credits=credits-p_amount, updated_at=now()
    where id=v_balance.id;
  insert into public.credit_ledger(workspace_id,user_id,job_id,amount,transaction_type,reason,idempotency_key)
    values(p_workspace_id,p_user_id,p_job_id,-p_amount,'reserve',p_reason,p_idempotency_key)
    returning * into v_entry;
  update public.processing_jobs set reserved_credits=p_amount
    where id=p_job_id and workspace_id=p_workspace_id;
  return v_entry;
end
$$;
revoke all on function public.reserve_job_credits(uuid,uuid,uuid,integer,text,text) from public, anon, authenticated;
grant execute on function public.reserve_job_credits(uuid,uuid,uuid,integer,text,text) to service_role;

-- Only a terminal failed job can be refunded. Unique idempotency keys make recovery safe.
create or replace function public.refund_failed_job_credits(
  p_workspace_id uuid,
  p_job_id uuid,
  p_user_id uuid,
  p_reason text,
  p_idempotency_key text
) returns public.credit_ledger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.processing_jobs;
  v_reservation public.credit_ledger;
  v_balance public.usage_credits;
  v_entry public.credit_ledger;
begin
  select * into v_entry from public.credit_ledger where idempotency_key=p_idempotency_key;
  if found then return v_entry; end if;

  select * into v_job from public.processing_jobs
    where id=p_job_id and workspace_id=p_workspace_id for update;
  if not found then raise exception using errcode='23503', message='Job not found'; end if;
  if v_job.status not in ('failed','dead_letter') then
    raise exception using errcode='23514', message='Only failed jobs can be refunded';
  end if;

  select * into v_reservation from public.credit_ledger
    where job_id=p_job_id and user_id=p_user_id and transaction_type='reserve';
  if not found then return null; end if;

  select * into v_balance from public.usage_credits
    where workspace_id=p_workspace_id and user_id=p_user_id for update;
  if not found then raise exception using errcode='23503', message='Credit balance not found'; end if;

  update public.usage_credits set credits=credits+abs(v_reservation.amount), updated_at=now()
    where id=v_balance.id;
  insert into public.credit_ledger(workspace_id,user_id,job_id,amount,transaction_type,reason,idempotency_key)
    values(p_workspace_id,p_user_id,p_job_id,abs(v_reservation.amount),'refund',
      coalesce(nullif(trim(p_reason),''),'Automatic refund for failed job'),p_idempotency_key)
    returning * into v_entry;
  return v_entry;
end
$$;
revoke all on function public.refund_failed_job_credits(uuid,uuid,uuid,text,text) from public, anon, authenticated;
grant execute on function public.refund_failed_job_credits(uuid,uuid,uuid,text,text) to service_role;

-- Daily video minutes use the user's local calendar date; timezone defaults to India.
create table if not exists public.video_usage_daily (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  usage_date date not null,
  timezone text not null default 'Asia/Kolkata',
  minutes_reserved numeric(12,2) not null default 0 check (minutes_reserved >= 0),
  minutes_completed numeric(12,2) not null default 0 check (minutes_completed >= 0),
  updated_at timestamptz not null default now(),
  unique(workspace_id,user_id,usage_date)
);
alter table public.video_usage_daily enable row level security;
drop policy if exists video_usage_daily_member_read on public.video_usage_daily;
create policy video_usage_daily_member_read on public.video_usage_daily
  for select to authenticated
  using (user_id=(select auth.uid()) and exists (
    select 1 from public.workspace_members m
    where m.workspace_id=video_usage_daily.workspace_id and m.user_id=(select auth.uid())
  ));
revoke insert, update, delete on public.video_usage_daily from anon, authenticated;
grant select on public.video_usage_daily to authenticated;
grant select, insert, update, delete on public.video_usage_daily to service_role;

-- Parts beyond today's quota remain pending until explicitly approved.
create table if not exists public.pending_processing_parts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  media_asset_id uuid not null references public.media_assets(id) on delete cascade,
  parent_job_id uuid references public.processing_jobs(id) on delete set null,
  part_number integer not null check (part_number >= 1),
  start_seconds numeric(12,3) not null check (start_seconds >= 0),
  end_seconds numeric(12,3) not null check (end_seconds > start_seconds),
  usage_date date not null,
  timezone text not null default 'Asia/Kolkata',
  scheduled_for timestamptz not null,
  status text not null default 'pending'
    check (status in ('pending','approved','declined','queued','processing','completed','failed','expired','cancelled')),
  job_id uuid references public.processing_jobs(id) on delete set null,
  expires_at timestamptz not null default now()+interval '48 hours',
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(parent_job_id,part_number)
);
create index if not exists pending_parts_due_idx
  on public.pending_processing_parts(status,scheduled_for)
  where status in ('approved','queued');
create index if not exists pending_parts_expiry_idx
  on public.pending_processing_parts(expires_at)
  where status='pending';
alter table public.pending_processing_parts enable row level security;
drop policy if exists pending_parts_member_read on public.pending_processing_parts;
create policy pending_parts_member_read on public.pending_processing_parts
  for select to authenticated
  using (user_id=(select auth.uid()) and exists (
    select 1 from public.workspace_members m
    where m.workspace_id=pending_processing_parts.workspace_id and m.user_id=(select auth.uid())
  ));
revoke insert, update, delete on public.pending_processing_parts from anon, authenticated;
grant select on public.pending_processing_parts to authenticated;
grant select, insert, update, delete on public.pending_processing_parts to service_role;

-- Store key labels/health only. Never store provider keys in the database.
create table if not exists public.gemini_key_health (
  key_label text primary key check (length(trim(key_label)) between 1 and 80),
  is_available boolean not null default true,
  cooldown_until timestamptz,
  last_status text,
  last_error_id text,
  success_count bigint not null default 0 check (success_count >= 0),
  failure_count bigint not null default 0 check (failure_count >= 0),
  rate_limit_count bigint not null default 0 check (rate_limit_count >= 0),
  last_used_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.gemini_key_health enable row level security;
revoke all on public.gemini_key_health from public, anon, authenticated;
grant select, insert, update, delete on public.gemini_key_health to service_role;

-- Per-job diagnostic metadata is safe for the UI; raw provider/database errors remain server logs only.
comment on column public.processing_jobs.error_id is 'Opaque error identifier shown to the user; never include provider keys or raw database messages.';
comment on column public.processing_jobs.failure_type is 'Normalized failure category: download, unsupported_format, network, ai, quota, internal.';
