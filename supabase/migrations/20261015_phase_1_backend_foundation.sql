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

alter table public.publish_jobs
  add column if not exists error_id text,
  add column if not exists failure_type text,
  add column if not exists next_retry_at timestamptz,
  add column if not exists max_attempts integer not null default 5,
  add column if not exists idempotency_key text;
create unique index if not exists publish_jobs_idempotency_uidx
  on public.publish_jobs(idempotency_key) where idempotency_key is not null;

create index if not exists publish_jobs_retry_due_idx
  on public.publish_jobs(status,next_retry_at,scheduled_for)
  where status in ('queued','processing');

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

-- Enforce tenant ownership at the database boundary, not only in API handlers.
create or replace function public.enforce_processing_job_workspace_integrity()
returns trigger
language plpgsql
security definer
set search_path=''
as $
declare
  v_project_workspace uuid;
  v_asset_workspace uuid;
  v_asset_project uuid;
  v_asset_text text;
  v_asset_id uuid;
begin
  if new.project_id is not null then
    select p.workspace_id into v_project_workspace
      from public.projects p where p.id=new.project_id;
    if not found or v_project_workspace is distinct from new.workspace_id then
      raise exception using errcode='23503',message='Processing job project/workspace mismatch';
    end if;
  end if;
  v_asset_text:=coalesce(new.payload->>'mediaAssetId',new.payload->>'media_asset_id','');
  if v_asset_text<>'' then
    if v_asset_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}
alter table public.notifications
  add column if not exists event_type text,
  add column if not exists dedupe_key text;
create unique index if not exists notifications_dedupe_key_uidx
  on public.notifications(dedupe_key) where dedupe_key is not null;

-- AI credits are separate from video-minute allowances and the existing token_ledger.
create table if not exists public.credit_ledger (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  job_id uuid not null references public.processing_jobs(id) on delete restrict,
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
  update public.processing_jobs set reserved_credits=0 where id=p_job_id and workspace_id=p_workspace_id;
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


-- Recovery claims respect backoff and move exhausted jobs to a dead-letter state.
create or replace function public.claim_processing_job(p_worker text default 'media-worker')
returns table(
  id uuid,
  workspace_id uuid,
  project_id uuid,
  job_type text,
  status text,
  progress integer,
  payload jsonb,
  attempt_count integer,
  current_stage text
)
language plpgsql
security definer
set search_path=''
as $$
declare
  v_id uuid;
  v_row public.processing_jobs;
  v_user uuid;
begin
  -- Dead-letter exhausted due jobs without leaking provider/DB details to clients.
  for v_row in
    select j.* from public.processing_jobs j
    where j.status='queued'
      and coalesce(j.next_retry_at,'-infinity'::timestamptz)<=now()
      and coalesce(j.attempt_count,0)>=coalesce(j.max_attempts,5)
    for update skip locked
  loop
    update public.processing_jobs j
      set status='dead_letter',dead_lettered_at=now(),next_retry_at=null,
          error_id=gen_random_uuid()::text,failure_type=coalesce(j.failure_type,'internal'),
          error='Automatic recovery stopped after the retry limit.',updated_at=now()
      where j.id=v_row.id
      returning * into v_row;
    if coalesce(v_row.payload->>'requestedBy','') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      v_user := (v_row.payload->>'requestedBy')::uuid;
      begin
        perform public.refund_failed_job_credits(
          v_row.workspace_id,v_row.id,v_user,'Automatic refund after job exhausted retries',
          'job:'||v_row.id::text||':refund'
        );
      exception when others then
        -- Keep the dead-lettered job inspectable; an admin can reconcile a refund.
        null;
      end;
    end if;
  end loop;

  select j.id into v_id
  from public.processing_jobs j
  where (
      (j.status='queued' and coalesce(j.next_retry_at,'-infinity'::timestamptz)<=now()
        and coalesce(j.attempt_count,0)<coalesce(j.max_attempts,5))
      or (j.status in ('processing','transcribing')
        and coalesce(j.heartbeat_at,j.updated_at)<now()-interval '2 minutes')
    )
    and (j.lease_until is null or j.lease_until<now())
  order by case when j.status='queued' then 0 else 1 end,j.created_at asc
  for update skip locked
  limit 1;

  if v_id is null then return; end if;

  update public.processing_jobs j
    set status='processing',lease_token=gen_random_uuid(),
        lease_until=now()+interval '2 minutes',heartbeat_at=now(),
        updated_at=now(),attempt_count=coalesce(j.attempt_count,0)+1,next_retry_at=null
    where j.id=v_id
  returning j.id,j.workspace_id,j.project_id,j.job_type,j.status,j.progress,j.payload,
    j.attempt_count,j.current_stage
  into id,workspace_id,project_id,job_type,status,progress,payload,attempt_count,current_stage;

  return next;
end
$$;
revoke all on function public.claim_processing_job(text) from public,anon,authenticated;
grant execute on function public.claim_processing_job(text) to service_role;


-- Server-owned entitlement records. The absence of a row means Free, never elevated access.
create table if not exists public.workspace_entitlements (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  plan text not null default 'free' check (plan in ('free','pro','studio')),
  daily_video_minutes numeric(12,2) not null default 20 check (daily_video_minutes >= 0),
  max_resolution integer not null default 720 check (max_resolution in (720,1080,2160,3840)),
  watermark_text text not null default '[APP NAME]',
  title_regenerations integer not null default 3 check (title_regenerations >= 0),
  cover_rotations integer not null default 1 check (cover_rotations >= 0),
  auto_publish boolean not null default false,
  scheduling_enabled boolean not null default false,
  brand_kit_limit integer not null default 1 check (brand_kit_limit >= 1),
  priority_queue boolean not null default false,
  fair_use_unlimited boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.workspace_entitlements enable row level security;
drop policy if exists workspace_entitlements_member_read on public.workspace_entitlements;
create policy workspace_entitlements_member_read on public.workspace_entitlements
  for select to authenticated using (exists (
    select 1 from public.workspace_members m
    where m.workspace_id=workspace_entitlements.workspace_id and m.user_id=(select auth.uid())
  ));
revoke insert, update, delete on public.workspace_entitlements from anon, authenticated;
grant select on public.workspace_entitlements to authenticated;
grant select, insert, update, delete on public.workspace_entitlements to service_role;
insert into public.workspace_entitlements(workspace_id)
  select w.id from public.workspaces w
  on conflict(workspace_id) do nothing;

create or replace function public.seed_workspace_entitlements()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
  insert into public.workspace_entitlements(workspace_id) values(new.id)
    on conflict(workspace_id) do nothing;
  return new;
end
$$;
revoke all on function public.seed_workspace_entitlements() from public,anon,authenticated;
drop trigger if exists seed_workspace_entitlements_after_workspace_insert on public.workspaces;
create trigger seed_workspace_entitlements_after_workspace_insert
  after insert on public.workspaces
  for each row execute function public.seed_workspace_entitlements();


-- Keep AI chat submission and credit reservation in the same database transaction.
-- A failed balance check rolls back the job and user message, so no uncharged work is queued.
create or replace function public.submit_ai_chat_job(
  p_id uuid, p_session uuid, p_workspace uuid, p_user uuid, p_project uuid,
  p_asset uuid, p_prompt text, p_payload jsonb
) returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_session public.ai_chat_sessions;
  v_job public.processing_jobs;
  v_cost integer := greatest(1,least(100,coalesce(nullif(p_payload->>'creditCost','')::integer,1)));
begin
  if not exists(select 1 from public.workspace_members where workspace_id=p_workspace and user_id=p_user)
    or not exists(select 1 from public.projects where id=p_project and workspace_id=p_workspace)
    or (p_asset is not null and not exists(select 1 from public.media_assets where id=p_asset and project_id=p_project and workspace_id=p_workspace))
  then raise exception using errcode='42501',message='Video workspace context mismatch'; end if;

  insert into public.ai_chat_sessions(id,workspace_id,user_id,title,project_id,media_asset_id)
    values(p_session,p_workspace,p_user,left(p_prompt,80),p_project,p_asset) on conflict(id) do nothing;
  select * into v_session from public.ai_chat_sessions where id=p_session for update;
  if v_session.workspace_id<>p_workspace or v_session.user_id<>p_user then
    raise exception using errcode='42501',message='Chat access denied';
  end if;

  select * into v_job from public.processing_jobs where id=p_id for update;
  if found then
    if v_job.workspace_id<>p_workspace or v_job.payload->>'sessionId'<>p_session::text then
      raise exception using errcode='23505',message='Request conflict';
    end if;
    if v_job.status in ('queued','processing') then
      perform public.reserve_job_credits(p_workspace,p_id,p_user,v_cost,'AI chat job accepted','job:'||p_id::text||':reserve');
      select * into v_job from public.processing_jobs where id=p_id;
    end if;
    return to_jsonb(v_job);
  end if;

  if exists(select 1 from public.processing_jobs where workspace_id=p_workspace
    and payload->>'sessionId'=p_session::text
    and status in ('queued','processing','awaiting_transcription','transcribing'))
  then raise exception using errcode='23505',message='This chat already has an active job. Wait for it to finish.'; end if;

  insert into public.ai_chat_messages(id,session_id,workspace_id,user_id,role,content,metadata)
    values(p_id,p_session,p_workspace,p_user,'user',p_prompt,
      jsonb_build_object('jobId',p_id,'clipId',p_payload->>'clipId','mediaAssetId',p_asset));
  insert into public.processing_jobs(id,workspace_id,project_id,job_type,status,progress,payload)
    values(p_id,p_workspace,p_project,'process_media','queued',0,
      p_payload||jsonb_build_object('creditCost',v_cost,'idempotencyKey','job:'||p_id::text))
    returning * into v_job;

  perform public.reserve_job_credits(p_workspace,p_id,p_user,v_cost,'AI chat job accepted','job:'||p_id::text||':reserve');
  select * into v_job from public.processing_jobs where id=p_id;

  update public.ai_chat_sessions set project_id=p_project,media_asset_id=p_asset,updated_at=now()
    where id=p_session;
  return to_jsonb(v_job);
end
$$;
revoke all on function public.submit_ai_chat_job(uuid,uuid,uuid,uuid,uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.submit_ai_chat_job(uuid,uuid,uuid,uuid,uuid,uuid,text,jsonb) to service_role;


-- Admin-only manual adjustment RPC. The API must authenticate the actor against
-- control_center_members before calling; the RPC also checks active membership.
create or replace function public.admin_adjust_credits(
  p_workspace_id uuid,
  p_target_user_id uuid,
  p_actor_user_id uuid,
  p_amount integer,
  p_reason text,
  p_idempotency_key text
) returns public.credit_ledger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_actor_email text;
  v_balance public.usage_credits;
  v_entry public.credit_ledger;
  v_adjustment_job_id uuid := gen_random_uuid();
begin
  if p_amount=0 or length(trim(coalesce(p_reason,''))) not between 1 and 500
    or length(trim(coalesce(p_idempotency_key,'')))<8 then
    raise exception using errcode='22023',message='Invalid credit adjustment';
  end if;
  select lower(email) into v_actor_email from auth.users where id=p_actor_user_id;
  if v_actor_email is null or not exists(
    select 1 from public.control_center_members a where lower(a.email)=v_actor_email and a.active=true
  ) then raise exception using errcode='42501',message='Admin access denied'; end if;
  select * into v_entry from public.credit_ledger where idempotency_key=p_idempotency_key;
  if found then
    if v_entry.user_id<>p_target_user_id or v_entry.workspace_id<>p_workspace_id
      or v_entry.amount<>p_amount or v_entry.transaction_type<>'adjustment' then
      raise exception using errcode='23505',message='Credit idempotency key conflict';
    end if;
    return v_entry;
  end if;
  if not exists(select 1 from public.workspace_members m where m.workspace_id=p_workspace_id and m.user_id=p_target_user_id)
    then raise exception using errcode='42501',message='Target workspace access denied'; end if;
  select * into v_balance from public.usage_credits
    where workspace_id=p_workspace_id and user_id=p_target_user_id for update;
  if not found then
    if p_amount<0 then raise exception using errcode='P0001',message='INSUFFICIENT_CREDITS'; end if;
    insert into public.usage_credits(workspace_id,user_id,credits,updated_at)
      values(p_workspace_id,p_target_user_id,p_amount,now());
  else
    if v_balance.credits+p_amount<0 then
      raise exception using errcode='P0001',message='INSUFFICIENT_CREDITS';
    end if;
    update public.usage_credits set credits=credits+p_amount,updated_at=now()
      where id=v_balance.id;
  end if;
  insert into public.processing_jobs(id,workspace_id,job_type,status,progress,payload)
    values(v_adjustment_job_id,p_workspace_id,'credit_adjustment','completed',100,
      jsonb_build_object('requestedBy',p_actor_user_id,'targetUserId',p_target_user_id,'reason',trim(p_reason)))
    on conflict(id) do nothing;
  insert into public.credit_ledger(workspace_id,user_id,job_id,amount,transaction_type,reason,idempotency_key,metadata)
    values(p_workspace_id,p_target_user_id,v_adjustment_job_id,p_amount,'adjustment',trim(p_reason),p_idempotency_key,
      jsonb_build_object('actorUserId',p_actor_user_id))
    returning * into v_entry;
  return v_entry;
end
$$;
revoke all on function public.admin_adjust_credits(uuid,uuid,uuid,integer,text,text) from public,anon,authenticated;
grant execute on function public.admin_adjust_credits(uuid,uuid,uuid,integer,text,text) to service_role;


-- Derive the standard entitlements from the server-owned plan field; clients cannot
-- update this table. Pro's initial allowance is 180 video minutes/day pending product confirmation.
create or replace function public.apply_standard_workspace_entitlements()
returns trigger language plpgsql set search_path=''
as $$
begin
  if new.plan='free' then
    new.daily_video_minutes:=20;new.max_resolution:=720;new.watermark_text:='[APP NAME]';
    new.title_regenerations:=3;new.cover_rotations:=1;new.auto_publish:=false;
    new.scheduling_enabled:=false;new.brand_kit_limit:=1;new.priority_queue:=false;new.fair_use_unlimited:=false;
  elsif new.plan='pro' then
    new.daily_video_minutes:=180;new.max_resolution:=1080;new.watermark_text:='';
    new.title_regenerations:=30;new.cover_rotations:=10;new.auto_publish:=true;
    new.scheduling_enabled:=false;new.brand_kit_limit:=1;new.priority_queue:=false;new.fair_use_unlimited:=false;
  elsif new.plan='studio' then
    new.daily_video_minutes:=999999;new.max_resolution:=3840;new.watermark_text:='';
    new.title_regenerations:=999999;new.cover_rotations:=999999;new.auto_publish:=true;
    new.scheduling_enabled:=true;new.brand_kit_limit:=10;new.priority_queue:=true;new.fair_use_unlimited:=true;
  end if;
  new.updated_at:=now();
  return new;
end
$$;
revoke all on function public.apply_standard_workspace_entitlements() from public,anon,authenticated;
drop trigger if exists apply_standard_workspace_entitlements_before_write on public.workspace_entitlements;
create trigger apply_standard_workspace_entitlements_before_write
  before insert or update of plan on public.workspace_entitlements
  for each row execute function public.apply_standard_workspace_entitlements();
 then
      raise exception using errcode='23514',message='Processing job media asset ID is invalid';
    end if;
    v_asset_id:=v_asset_text::uuid;
    select a.workspace_id,a.project_id into v_asset_workspace,v_asset_project
      from public.media_assets a where a.id=v_asset_id;
    if not found or v_asset_workspace is distinct from new.workspace_id
       or (new.project_id is not null and v_asset_project is distinct from new.project_id) then
      raise exception using errcode='23503',message='Processing job media asset/workspace mismatch';
    end if;
  end if;
  return new;
end
$;
revoke all on function public.enforce_processing_job_workspace_integrity() from public,anon,authenticated;
drop trigger if exists processing_job_workspace_integrity on public.processing_jobs;
create trigger processing_job_workspace_integrity
  before insert or update of workspace_id,project_id,payload on public.processing_jobs
  for each row execute function public.enforce_processing_job_workspace_integrity();

-- Idempotent in-app notifications for durable job and pending-part lifecycle events.
alter table public.notifications
  add column if not exists event_type text,
  add column if not exists dedupe_key text;
create unique index if not exists notifications_dedupe_key_uidx
  on public.notifications(dedupe_key) where dedupe_key is not null;

-- AI credits are separate from video-minute allowances and the existing token_ledger.
create table if not exists public.credit_ledger (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  job_id uuid not null references public.processing_jobs(id) on delete restrict,
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
  update public.processing_jobs set reserved_credits=0 where id=p_job_id and workspace_id=p_workspace_id;
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


-- Recovery claims respect backoff and move exhausted jobs to a dead-letter state.
create or replace function public.claim_processing_job(p_worker text default 'media-worker')
returns table(
  id uuid,
  workspace_id uuid,
  project_id uuid,
  job_type text,
  status text,
  progress integer,
  payload jsonb,
  attempt_count integer,
  current_stage text
)
language plpgsql
security definer
set search_path=''
as $$
declare
  v_id uuid;
  v_row public.processing_jobs;
  v_user uuid;
begin
  -- Dead-letter exhausted due jobs without leaking provider/DB details to clients.
  for v_row in
    select j.* from public.processing_jobs j
    where j.status='queued'
      and coalesce(j.next_retry_at,'-infinity'::timestamptz)<=now()
      and coalesce(j.attempt_count,0)>=coalesce(j.max_attempts,5)
    for update skip locked
  loop
    update public.processing_jobs j
      set status='dead_letter',dead_lettered_at=now(),next_retry_at=null,
          error_id=gen_random_uuid()::text,failure_type=coalesce(j.failure_type,'internal'),
          error='Automatic recovery stopped after the retry limit.',updated_at=now()
      where j.id=v_row.id
      returning * into v_row;
    if coalesce(v_row.payload->>'requestedBy','') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      v_user := (v_row.payload->>'requestedBy')::uuid;
      begin
        perform public.refund_failed_job_credits(
          v_row.workspace_id,v_row.id,v_user,'Automatic refund after job exhausted retries',
          'job:'||v_row.id::text||':refund'
        );
      exception when others then
        -- Keep the dead-lettered job inspectable; an admin can reconcile a refund.
        null;
      end;
    end if;
  end loop;

  select j.id into v_id
  from public.processing_jobs j
  where (
      (j.status='queued' and coalesce(j.next_retry_at,'-infinity'::timestamptz)<=now()
        and coalesce(j.attempt_count,0)<coalesce(j.max_attempts,5))
      or (j.status in ('processing','transcribing')
        and coalesce(j.heartbeat_at,j.updated_at)<now()-interval '2 minutes')
    )
    and (j.lease_until is null or j.lease_until<now())
  order by case when j.status='queued' then 0 else 1 end,j.created_at asc
  for update skip locked
  limit 1;

  if v_id is null then return; end if;

  update public.processing_jobs j
    set status='processing',lease_token=gen_random_uuid(),
        lease_until=now()+interval '2 minutes',heartbeat_at=now(),
        updated_at=now(),attempt_count=coalesce(j.attempt_count,0)+1,next_retry_at=null
    where j.id=v_id
  returning j.id,j.workspace_id,j.project_id,j.job_type,j.status,j.progress,j.payload,
    j.attempt_count,j.current_stage
  into id,workspace_id,project_id,job_type,status,progress,payload,attempt_count,current_stage;

  return next;
end
$$;
revoke all on function public.claim_processing_job(text) from public,anon,authenticated;
grant execute on function public.claim_processing_job(text) to service_role;


-- Server-owned entitlement records. The absence of a row means Free, never elevated access.
create table if not exists public.workspace_entitlements (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  plan text not null default 'free' check (plan in ('free','pro','studio')),
  daily_video_minutes numeric(12,2) not null default 20 check (daily_video_minutes >= 0),
  max_resolution integer not null default 720 check (max_resolution in (720,1080,2160,3840)),
  watermark_text text not null default '[APP NAME]',
  title_regenerations integer not null default 3 check (title_regenerations >= 0),
  cover_rotations integer not null default 1 check (cover_rotations >= 0),
  auto_publish boolean not null default false,
  scheduling_enabled boolean not null default false,
  brand_kit_limit integer not null default 1 check (brand_kit_limit >= 1),
  priority_queue boolean not null default false,
  fair_use_unlimited boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.workspace_entitlements enable row level security;
drop policy if exists workspace_entitlements_member_read on public.workspace_entitlements;
create policy workspace_entitlements_member_read on public.workspace_entitlements
  for select to authenticated using (exists (
    select 1 from public.workspace_members m
    where m.workspace_id=workspace_entitlements.workspace_id and m.user_id=(select auth.uid())
  ));
revoke insert, update, delete on public.workspace_entitlements from anon, authenticated;
grant select on public.workspace_entitlements to authenticated;
grant select, insert, update, delete on public.workspace_entitlements to service_role;
insert into public.workspace_entitlements(workspace_id)
  select w.id from public.workspaces w
  on conflict(workspace_id) do nothing;

create or replace function public.seed_workspace_entitlements()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
  insert into public.workspace_entitlements(workspace_id) values(new.id)
    on conflict(workspace_id) do nothing;
  return new;
end
$$;
revoke all on function public.seed_workspace_entitlements() from public,anon,authenticated;
drop trigger if exists seed_workspace_entitlements_after_workspace_insert on public.workspaces;
create trigger seed_workspace_entitlements_after_workspace_insert
  after insert on public.workspaces
  for each row execute function public.seed_workspace_entitlements();


-- Keep AI chat submission and credit reservation in the same database transaction.
-- A failed balance check rolls back the job and user message, so no uncharged work is queued.
create or replace function public.submit_ai_chat_job(
  p_id uuid, p_session uuid, p_workspace uuid, p_user uuid, p_project uuid,
  p_asset uuid, p_prompt text, p_payload jsonb
) returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_session public.ai_chat_sessions;
  v_job public.processing_jobs;
  v_cost integer := greatest(1,least(100,coalesce(nullif(p_payload->>'creditCost','')::integer,1)));
begin
  if not exists(select 1 from public.workspace_members where workspace_id=p_workspace and user_id=p_user)
    or not exists(select 1 from public.projects where id=p_project and workspace_id=p_workspace)
    or (p_asset is not null and not exists(select 1 from public.media_assets where id=p_asset and project_id=p_project and workspace_id=p_workspace))
  then raise exception using errcode='42501',message='Video workspace context mismatch'; end if;

  insert into public.ai_chat_sessions(id,workspace_id,user_id,title,project_id,media_asset_id)
    values(p_session,p_workspace,p_user,left(p_prompt,80),p_project,p_asset) on conflict(id) do nothing;
  select * into v_session from public.ai_chat_sessions where id=p_session for update;
  if v_session.workspace_id<>p_workspace or v_session.user_id<>p_user then
    raise exception using errcode='42501',message='Chat access denied';
  end if;

  select * into v_job from public.processing_jobs where id=p_id for update;
  if found then
    if v_job.workspace_id<>p_workspace or v_job.payload->>'sessionId'<>p_session::text then
      raise exception using errcode='23505',message='Request conflict';
    end if;
    if v_job.status in ('queued','processing') then
      perform public.reserve_job_credits(p_workspace,p_id,p_user,v_cost,'AI chat job accepted','job:'||p_id::text||':reserve');
      select * into v_job from public.processing_jobs where id=p_id;
    end if;
    return to_jsonb(v_job);
  end if;

  if exists(select 1 from public.processing_jobs where workspace_id=p_workspace
    and payload->>'sessionId'=p_session::text
    and status in ('queued','processing','awaiting_transcription','transcribing'))
  then raise exception using errcode='23505',message='This chat already has an active job. Wait for it to finish.'; end if;

  insert into public.ai_chat_messages(id,session_id,workspace_id,user_id,role,content,metadata)
    values(p_id,p_session,p_workspace,p_user,'user',p_prompt,
      jsonb_build_object('jobId',p_id,'clipId',p_payload->>'clipId','mediaAssetId',p_asset));
  insert into public.processing_jobs(id,workspace_id,project_id,job_type,status,progress,payload)
    values(p_id,p_workspace,p_project,'process_media','queued',0,
      p_payload||jsonb_build_object('creditCost',v_cost,'idempotencyKey','job:'||p_id::text))
    returning * into v_job;

  perform public.reserve_job_credits(p_workspace,p_id,p_user,v_cost,'AI chat job accepted','job:'||p_id::text||':reserve');
  select * into v_job from public.processing_jobs where id=p_id;

  update public.ai_chat_sessions set project_id=p_project,media_asset_id=p_asset,updated_at=now()
    where id=p_session;
  return to_jsonb(v_job);
end
$$;
revoke all on function public.submit_ai_chat_job(uuid,uuid,uuid,uuid,uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.submit_ai_chat_job(uuid,uuid,uuid,uuid,uuid,uuid,text,jsonb) to service_role;


-- Admin-only manual adjustment RPC. The API must authenticate the actor against
-- control_center_members before calling; the RPC also checks active membership.
create or replace function public.admin_adjust_credits(
  p_workspace_id uuid,
  p_target_user_id uuid,
  p_actor_user_id uuid,
  p_amount integer,
  p_reason text,
  p_idempotency_key text
) returns public.credit_ledger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_actor_email text;
  v_balance public.usage_credits;
  v_entry public.credit_ledger;
  v_adjustment_job_id uuid := gen_random_uuid();
begin
  if p_amount=0 or length(trim(coalesce(p_reason,''))) not between 1 and 500
    or length(trim(coalesce(p_idempotency_key,'')))<8 then
    raise exception using errcode='22023',message='Invalid credit adjustment';
  end if;
  select lower(email) into v_actor_email from auth.users where id=p_actor_user_id;
  if v_actor_email is null or not exists(
    select 1 from public.control_center_members a where lower(a.email)=v_actor_email and a.active=true
  ) then raise exception using errcode='42501',message='Admin access denied'; end if;
  select * into v_entry from public.credit_ledger where idempotency_key=p_idempotency_key;
  if found then
    if v_entry.user_id<>p_target_user_id or v_entry.workspace_id<>p_workspace_id
      or v_entry.amount<>p_amount or v_entry.transaction_type<>'adjustment' then
      raise exception using errcode='23505',message='Credit idempotency key conflict';
    end if;
    return v_entry;
  end if;
  if not exists(select 1 from public.workspace_members m where m.workspace_id=p_workspace_id and m.user_id=p_target_user_id)
    then raise exception using errcode='42501',message='Target workspace access denied'; end if;
  select * into v_balance from public.usage_credits
    where workspace_id=p_workspace_id and user_id=p_target_user_id for update;
  if not found then
    if p_amount<0 then raise exception using errcode='P0001',message='INSUFFICIENT_CREDITS'; end if;
    insert into public.usage_credits(workspace_id,user_id,credits,updated_at)
      values(p_workspace_id,p_target_user_id,p_amount,now());
  else
    if v_balance.credits+p_amount<0 then
      raise exception using errcode='P0001',message='INSUFFICIENT_CREDITS';
    end if;
    update public.usage_credits set credits=credits+p_amount,updated_at=now()
      where id=v_balance.id;
  end if;
  insert into public.processing_jobs(id,workspace_id,job_type,status,progress,payload)
    values(v_adjustment_job_id,p_workspace_id,'credit_adjustment','completed',100,
      jsonb_build_object('requestedBy',p_actor_user_id,'targetUserId',p_target_user_id,'reason',trim(p_reason)))
    on conflict(id) do nothing;
  insert into public.credit_ledger(workspace_id,user_id,job_id,amount,transaction_type,reason,idempotency_key,metadata)
    values(p_workspace_id,p_target_user_id,v_adjustment_job_id,p_amount,'adjustment',trim(p_reason),p_idempotency_key,
      jsonb_build_object('actorUserId',p_actor_user_id))
    returning * into v_entry;
  return v_entry;
end
$$;
revoke all on function public.admin_adjust_credits(uuid,uuid,uuid,integer,text,text) from public,anon,authenticated;
grant execute on function public.admin_adjust_credits(uuid,uuid,uuid,integer,text,text) to service_role;


-- Derive the standard entitlements from the server-owned plan field; clients cannot
-- update this table. Pro's initial allowance is 180 video minutes/day pending product confirmation.
create or replace function public.apply_standard_workspace_entitlements()
returns trigger language plpgsql set search_path=''
as $$
begin
  if new.plan='free' then
    new.daily_video_minutes:=20;new.max_resolution:=720;new.watermark_text:='[APP NAME]';
    new.title_regenerations:=3;new.cover_rotations:=1;new.auto_publish:=false;
    new.scheduling_enabled:=false;new.brand_kit_limit:=1;new.priority_queue:=false;new.fair_use_unlimited:=false;
  elsif new.plan='pro' then
    new.daily_video_minutes:=180;new.max_resolution:=1080;new.watermark_text:='';
    new.title_regenerations:=30;new.cover_rotations:=10;new.auto_publish:=true;
    new.scheduling_enabled:=false;new.brand_kit_limit:=1;new.priority_queue:=false;new.fair_use_unlimited:=false;
  elsif new.plan='studio' then
    new.daily_video_minutes:=999999;new.max_resolution:=3840;new.watermark_text:='';
    new.title_regenerations:=999999;new.cover_rotations:=999999;new.auto_publish:=true;
    new.scheduling_enabled:=true;new.brand_kit_limit:=10;new.priority_queue:=true;new.fair_use_unlimited:=true;
  end if;
  new.updated_at:=now();
  return new;
end
$$;
revoke all on function public.apply_standard_workspace_entitlements() from public,anon,authenticated;
drop trigger if exists apply_standard_workspace_entitlements_before_write on public.workspace_entitlements;
create trigger apply_standard_workspace_entitlements_before_write
  before insert or update of plan on public.workspace_entitlements
  for each row execute function public.apply_standard_workspace_entitlements();
