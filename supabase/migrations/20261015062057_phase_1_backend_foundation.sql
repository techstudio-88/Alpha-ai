-- Phase 1 backend foundation, reconstructed from the live schema on 2026-10-16.
-- This file restores the missing source migration; it is additive/idempotent.
-- Credit allocations remain admin-controlled; video-minute quota is a separate entitlement.

alter table public.processing_jobs
  add column if not exists "current_stage" text,
  add column if not exists "attempt_count" integer default 0 not null,
  add column if not exists "heartbeat_at" timestamptz,
  add column if not exists "lease_token" uuid,
  add column if not exists "lease_until" timestamptz,
  add column if not exists "error_id" text,
  add column if not exists "failure_type" text,
  add column if not exists "idempotency_key" text,
  add column if not exists "max_attempts" integer default 5 not null,
  add column if not exists "next_retry_at" timestamptz,
  add column if not exists "dead_lettered_at" timestamptz,
  add column if not exists "cancel_requested_at" timestamptz,
  add column if not exists "output_locations" jsonb default '{}'::jsonb not null,
  add column if not exists "reserved_credits" integer default 0 not null,
  add column if not exists "video_minutes_reserved" numeric default 0 not null,
  add column if not exists "video_usage_date" date;

create table if not exists public.usage_credits (
  "id" uuid default gen_random_uuid() not null,
  "workspace_id" uuid not null,
  "user_id" uuid not null,
  "credits" integer default 0 not null,
  "updated_at" timestamptz default now() not null,
  constraint "usage_credits_pkey" PRIMARY KEY (id),
  constraint "usage_credits_workspace_id_user_id_key" UNIQUE (workspace_id, user_id)
);

create table if not exists public.credit_ledger (
  "id" uuid default gen_random_uuid() not null,
  "workspace_id" uuid not null,
  "user_id" uuid not null,
  "job_id" uuid not null,
  "amount" integer not null,
  "transaction_type" text not null,
  "reason" text not null,
  "idempotency_key" text not null,
  "metadata" jsonb default '{}'::jsonb not null,
  "created_at" timestamptz default now() not null,
  constraint "credit_ledger_amount_check" CHECK ((amount <> 0)),
  constraint "credit_ledger_idempotency_key_check" CHECK (((length(TRIM(BOTH FROM idempotency_key)) >= 8) AND (length(TRIM(BOTH FROM idempotency_key)) <= 200))),
  constraint "credit_ledger_idempotency_key_key" UNIQUE (idempotency_key),
  constraint "credit_ledger_job_id_fkey" FOREIGN KEY (job_id) REFERENCES processing_jobs(id) ON DELETE RESTRICT,
  constraint "credit_ledger_pkey" PRIMARY KEY (id),
  constraint "credit_ledger_reason_check" CHECK (((length(TRIM(BOTH FROM reason)) >= 1) AND (length(TRIM(BOTH FROM reason)) <= 500))),
  constraint "credit_ledger_transaction_type_check" CHECK ((transaction_type = ANY (ARRAY['reserve'::text, 'refund'::text, 'adjustment'::text]))),
  constraint "credit_ledger_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint "credit_ledger_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

create table if not exists public.pending_processing_parts (
  "id" uuid default gen_random_uuid() not null,
  "workspace_id" uuid not null,
  "project_id" uuid not null,
  "user_id" uuid not null,
  "media_asset_id" uuid not null,
  "parent_job_id" uuid,
  "part_number" integer not null,
  "start_seconds" numeric not null,
  "end_seconds" numeric not null,
  "usage_date" date not null,
  "timezone" text default 'Asia/Kolkata'::text not null,
  "scheduled_for" timestamptz not null,
  "status" text default 'pending'::text not null,
  "job_id" uuid,
  "expires_at" timestamptz default (now() + '48:00:00'::interval) not null,
  "decided_at" timestamptz,
  "created_at" timestamptz default now() not null,
  "updated_at" timestamptz default now() not null,
  constraint "pending_processing_parts_check" CHECK ((end_seconds > start_seconds)),
  constraint "pending_processing_parts_job_id_fkey" FOREIGN KEY (job_id) REFERENCES processing_jobs(id) ON DELETE SET NULL,
  constraint "pending_processing_parts_media_asset_id_fkey" FOREIGN KEY (media_asset_id) REFERENCES media_assets(id) ON DELETE CASCADE,
  constraint "pending_processing_parts_parent_job_id_fkey" FOREIGN KEY (parent_job_id) REFERENCES processing_jobs(id) ON DELETE SET NULL,
  constraint "pending_processing_parts_parent_job_id_part_number_key" UNIQUE (parent_job_id, part_number),
  constraint "pending_processing_parts_part_number_check" CHECK ((part_number >= 1)),
  constraint "pending_processing_parts_pkey" PRIMARY KEY (id),
  constraint "pending_processing_parts_project_id_fkey" FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  constraint "pending_processing_parts_start_seconds_check" CHECK ((start_seconds >= (0)::numeric)),
  constraint "pending_processing_parts_status_check" CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'declined'::text, 'queued'::text, 'processing'::text, 'completed'::text, 'failed'::text, 'expired'::text, 'cancelled'::text]))),
  constraint "pending_processing_parts_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint "pending_processing_parts_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

create table if not exists public.video_usage_daily (
  "id" uuid default gen_random_uuid() not null,
  "workspace_id" uuid not null,
  "user_id" uuid not null,
  "usage_date" date not null,
  "timezone" text default 'Asia/Kolkata'::text not null,
  "minutes_reserved" numeric default 0 not null,
  "minutes_completed" numeric default 0 not null,
  "updated_at" timestamptz default now() not null,
  constraint "video_usage_daily_minutes_completed_check" CHECK ((minutes_completed >= (0)::numeric)),
  constraint "video_usage_daily_minutes_reserved_check" CHECK ((minutes_reserved >= (0)::numeric)),
  constraint "video_usage_daily_pkey" PRIMARY KEY (id),
  constraint "video_usage_daily_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint "video_usage_daily_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  constraint "video_usage_daily_workspace_id_user_id_usage_date_key" UNIQUE (workspace_id, user_id, usage_date)
);

create table if not exists public.workspace_entitlements (
  "workspace_id" uuid not null,
  "plan" text default 'free'::text not null,
  "daily_video_minutes" numeric default 20 not null,
  "max_resolution" integer default 720 not null,
  "watermark_text" text default '[APP NAME]'::text not null,
  "title_regenerations" integer default 3 not null,
  "cover_rotations" integer default 1 not null,
  "auto_publish" boolean default false not null,
  "scheduling_enabled" boolean default false not null,
  "brand_kit_limit" integer default 1 not null,
  "priority_queue" boolean default false not null,
  "fair_use_unlimited" boolean default false not null,
  "updated_at" timestamptz default now() not null,
  constraint "workspace_entitlements_brand_kit_limit_check" CHECK ((brand_kit_limit >= 1)),
  constraint "workspace_entitlements_cover_rotations_check" CHECK ((cover_rotations >= 0)),
  constraint "workspace_entitlements_daily_video_minutes_check" CHECK ((daily_video_minutes >= (0)::numeric)),
  constraint "workspace_entitlements_max_resolution_check" CHECK ((max_resolution = ANY (ARRAY[720, 1080, 2160, 3840]))),
  constraint "workspace_entitlements_pkey" PRIMARY KEY (workspace_id),
  constraint "workspace_entitlements_plan_check" CHECK ((plan = ANY (ARRAY['free'::text, 'pro'::text, 'studio'::text]))),
  constraint "workspace_entitlements_title_regenerations_check" CHECK ((title_regenerations >= 0)),
  constraint "workspace_entitlements_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

create table if not exists public.workspace_feature_usage (
  "id" uuid default gen_random_uuid() not null,
  "workspace_id" uuid not null,
  "user_id" uuid not null,
  "usage_date" date not null,
  "timezone" text default 'Asia/Kolkata'::text not null,
  "feature_key" text not null,
  "request_id" text not null,
  "status" text default 'reserved'::text not null,
  "created_at" timestamptz default now() not null,
  "updated_at" timestamptz default now() not null,
  constraint "workspace_feature_usage_feature_key_check" CHECK ((feature_key = ANY (ARRAY['title_regeneration'::text, 'cover_rotation'::text]))),
  constraint "workspace_feature_usage_pkey" PRIMARY KEY (id),
  constraint "workspace_feature_usage_status_check" CHECK ((status = ANY (ARRAY['reserved'::text, 'completed'::text, 'refunded'::text]))),
  constraint "workspace_feature_usage_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint "workspace_feature_usage_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  constraint "workspace_feature_usage_workspace_id_user_id_request_id_key" UNIQUE (workspace_id, user_id, request_id)
);

create table if not exists public.gemini_key_health (
  "key_label" text not null,
  "is_available" boolean default true not null,
  "cooldown_until" timestamptz,
  "last_status" text,
  "last_error_id" text,
  "success_count" bigint default 0 not null,
  "failure_count" bigint default 0 not null,
  "rate_limit_count" bigint default 0 not null,
  "last_used_at" timestamptz,
  "updated_at" timestamptz default now() not null,
  constraint "gemini_key_health_failure_count_check" CHECK ((failure_count >= 0)),
  constraint "gemini_key_health_key_label_check" CHECK (((length(TRIM(BOTH FROM key_label)) >= 1) AND (length(TRIM(BOTH FROM key_label)) <= 80))),
  constraint "gemini_key_health_pkey" PRIMARY KEY (key_label),
  constraint "gemini_key_health_rate_limit_count_check" CHECK ((rate_limit_count >= 0)),
  constraint "gemini_key_health_success_count_check" CHECK ((success_count >= 0))
);

create table if not exists public.api_rate_limits (
  "id" uuid default gen_random_uuid() not null,
  "key_hash" text not null,
  "route" text not null,
  "window_start" timestamptz not null,
  "request_count" integer default 0 not null,
  constraint "api_rate_limits_key_hash_route_window_start_key" UNIQUE (key_hash, route, window_start),
  constraint "api_rate_limits_pkey" PRIMARY KEY (id)
);

-- Supporting indexes, including indexes already present on the live schema.
CREATE UNIQUE INDEX IF NOT EXISTS api_rate_limits_key_hash_route_window_start_key ON public.api_rate_limits USING btree (key_hash, route, window_start);
CREATE UNIQUE INDEX IF NOT EXISTS api_rate_limits_pkey ON public.api_rate_limits USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS credit_ledger_idempotency_key_key ON public.credit_ledger USING btree (idempotency_key);
CREATE UNIQUE INDEX IF NOT EXISTS credit_ledger_one_reservation_per_job_uidx ON public.credit_ledger USING btree (job_id) WHERE ((job_id IS NOT NULL) AND (transaction_type = 'reserve'::text));
CREATE UNIQUE INDEX IF NOT EXISTS credit_ledger_pkey ON public.credit_ledger USING btree (id);
CREATE INDEX IF NOT EXISTS credit_ledger_user_history_idx ON public.credit_ledger USING btree (workspace_id, user_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS gemini_key_health_pkey ON public.gemini_key_health USING btree (key_label);
CREATE INDEX IF NOT EXISTS pending_parts_due_idx ON public.pending_processing_parts USING btree (status, scheduled_for) WHERE (status = ANY (ARRAY['approved'::text, 'queued'::text]));
CREATE INDEX IF NOT EXISTS pending_parts_expiry_idx ON public.pending_processing_parts USING btree (expires_at) WHERE (status = 'pending'::text);
CREATE UNIQUE INDEX IF NOT EXISTS pending_processing_parts_parent_job_id_part_number_key ON public.pending_processing_parts USING btree (parent_job_id, part_number);
CREATE UNIQUE INDEX IF NOT EXISTS pending_processing_parts_pkey ON public.pending_processing_parts USING btree (id);
CREATE INDEX IF NOT EXISTS idx_processing_jobs_project_id ON public.processing_jobs USING btree (project_id);
CREATE INDEX IF NOT EXISTS idx_processing_jobs_workspace_id ON public.processing_jobs USING btree (workspace_id);
CREATE INDEX IF NOT EXISTS processing_jobs_dead_letter_idx ON public.processing_jobs USING btree (dead_lettered_at DESC) WHERE (dead_lettered_at IS NOT NULL);
CREATE INDEX IF NOT EXISTS processing_jobs_lease_idx ON public.processing_jobs USING btree (lease_until) WHERE (lease_until IS NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS processing_jobs_pkey ON public.processing_jobs USING btree (id);
CREATE INDEX IF NOT EXISTS processing_jobs_queue_idx ON public.processing_jobs USING btree (status, updated_at, created_at);
CREATE INDEX IF NOT EXISTS processing_jobs_retry_due_idx ON public.processing_jobs USING btree (status, next_retry_at, created_at) WHERE (status = ANY (ARRAY['queued'::text, 'failed'::text]));
CREATE UNIQUE INDEX IF NOT EXISTS processing_jobs_workspace_idempotency_uidx ON public.processing_jobs USING btree (workspace_id, idempotency_key) WHERE (idempotency_key IS NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS usage_credits_pkey ON public.usage_credits USING btree (id);
CREATE INDEX IF NOT EXISTS usage_credits_user_idx ON public.usage_credits USING btree (user_id);
CREATE UNIQUE INDEX IF NOT EXISTS usage_credits_workspace_id_user_id_key ON public.usage_credits USING btree (workspace_id, user_id);
CREATE UNIQUE INDEX IF NOT EXISTS video_usage_daily_pkey ON public.video_usage_daily USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS video_usage_daily_workspace_id_user_id_usage_date_key ON public.video_usage_daily USING btree (workspace_id, user_id, usage_date);
CREATE UNIQUE INDEX IF NOT EXISTS workspace_entitlements_pkey ON public.workspace_entitlements USING btree (workspace_id);
CREATE INDEX IF NOT EXISTS workspace_feature_usage_daily_idx ON public.workspace_feature_usage USING btree (workspace_id, user_id, usage_date, feature_key, status);
CREATE UNIQUE INDEX IF NOT EXISTS workspace_feature_usage_pkey ON public.workspace_feature_usage USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS workspace_feature_usage_workspace_id_user_id_request_id_key ON public.workspace_feature_usage USING btree (workspace_id, user_id, request_id);

-- Row-level security: user-readable records are scoped to the authenticated workspace member.
alter table public.usage_credits enable row level security;
alter table public.credit_ledger enable row level security;
alter table public.pending_processing_parts enable row level security;
alter table public.video_usage_daily enable row level security;
alter table public.workspace_entitlements enable row level security;
alter table public.workspace_feature_usage enable row level security;
alter table public.gemini_key_health enable row level security;
alter table public.api_rate_limits enable row level security;

drop policy if exists "credit_ledger_member_read" on public.credit_ledger;
create policy "credit_ledger_member_read" on public.credit_ledger for select to authenticated using (((user_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM workspace_members m
  WHERE ((m.workspace_id = credit_ledger.workspace_id) AND (m.user_id = ( SELECT auth.uid() AS uid)))))));
drop policy if exists "pending_parts_member_read" on public.pending_processing_parts;
create policy "pending_parts_member_read" on public.pending_processing_parts for select to authenticated using (((user_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM workspace_members m
  WHERE ((m.workspace_id = pending_processing_parts.workspace_id) AND (m.user_id = ( SELECT auth.uid() AS uid)))))));
drop policy if exists "usage_credits_member_select" on public.usage_credits;
create policy "usage_credits_member_select" on public.usage_credits for select to authenticated using ((EXISTS ( SELECT 1
   FROM workspace_members wm
  WHERE ((wm.workspace_id = usage_credits.workspace_id) AND (wm.user_id = ( SELECT auth.uid() AS uid))))));
drop policy if exists "video_usage_daily_member_read" on public.video_usage_daily;
create policy "video_usage_daily_member_read" on public.video_usage_daily for select to authenticated using (((user_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM workspace_members m
  WHERE ((m.workspace_id = video_usage_daily.workspace_id) AND (m.user_id = ( SELECT auth.uid() AS uid)))))));
drop policy if exists "workspace_entitlements_member_read" on public.workspace_entitlements;
create policy "workspace_entitlements_member_read" on public.workspace_entitlements for select to authenticated using ((EXISTS ( SELECT 1
   FROM workspace_members m
  WHERE ((m.workspace_id = workspace_entitlements.workspace_id) AND (m.user_id = ( SELECT auth.uid() AS uid))))));
drop policy if exists "workspace_feature_usage_member_read" on public.workspace_feature_usage;
create policy "workspace_feature_usage_member_read" on public.workspace_feature_usage for select to authenticated using (((user_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM workspace_members m
  WHERE ((m.workspace_id = workspace_feature_usage.workspace_id) AND (m.user_id = ( SELECT auth.uid() AS uid)))))));

grant select on public.usage_credits,public.credit_ledger,public.pending_processing_parts,public.video_usage_daily,public.workspace_entitlements,public.workspace_feature_usage to authenticated;
grant all on public.usage_credits,public.credit_ledger,public.pending_processing_parts,public.video_usage_daily,public.workspace_entitlements,public.workspace_feature_usage,public.gemini_key_health,public.api_rate_limits to service_role;

-- Functions are sourced from the current live definitions so clean installs reproduce behavior.
CREATE OR REPLACE FUNCTION public.reserve_job_credits(p_workspace_id uuid, p_job_id uuid, p_user_id uuid, p_amount integer, p_reason text, p_idempotency_key text)
 RETURNS credit_ledger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.refund_failed_job_credits(p_workspace_id uuid, p_job_id uuid, p_user_id uuid, p_reason text, p_idempotency_key text)
 RETURNS credit_ledger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.plan_video_processing_parts(p_workspace_id uuid, p_project_id uuid, p_user_id uuid, p_job_id uuid, p_media_asset_id uuid, p_duration_seconds numeric, p_timezone text DEFAULT 'Asia/Kolkata'::text, p_silence_boundaries jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_job public.processing_jobs;
  v_plan jsonb;
  v_timezone text;
  v_local_date date;
  v_allowance numeric := 20;
  v_unlimited boolean := false;
  v_used numeric := 0;
  v_remaining numeric := 0;
  v_first_capacity numeric;
  v_cursor numeric := 0;
  v_target numeric;
  v_cut numeric;
  v_part integer := 1;
  v_segments jsonb := '[]'::jsonb;
  v_segment_start numeric;
  v_segment_end numeric;
  v_segment_minutes numeric;
  v_schedule_date date;
  v_schedule_at timestamptz;
  v_deferred boolean := false;
  v_next_start numeric := 0;
  v_next_end numeric := 0;
  v_next_retry timestamptz;
  v_ent public.workspace_entitlements;
  v_usage public.video_usage_daily;
  v_boundary numeric;
begin
  if p_workspace_id is null or p_project_id is null or p_user_id is null or p_job_id is null
     or p_media_asset_id is null or p_duration_seconds is null
     or p_duration_seconds <= 0 or p_duration_seconds > 3600 then
    raise exception using errcode='22023',message='Invalid video quota planning request';
  end if;
  if not exists(select 1 from public.workspace_members m where m.workspace_id=p_workspace_id and m.user_id=p_user_id)
     or not exists(select 1 from public.projects p where p.id=p_project_id and p.workspace_id=p_workspace_id)
     or not exists(select 1 from public.media_assets a where a.id=p_media_asset_id and a.project_id=p_project_id and a.workspace_id=p_workspace_id) then
    raise exception using errcode='42501',message='Video workspace context mismatch';
  end if;
  select * into v_job from public.processing_jobs j
    where j.id=p_job_id and j.workspace_id=p_workspace_id and j.project_id=p_project_id for update;
  if not found or v_job.status not in ('processing','queued') then
    raise exception using errcode='23503',message='Accepted video job not found';
  end if;
  if coalesce(v_job.payload->>'videoQuotaPlanned','false')='true' then
    return coalesce(v_job.payload->'videoQuotaPlan','{}'::jsonb);
  end if;

  v_timezone := case when exists(select 1 from pg_timezone_names z where z.name=p_timezone) then p_timezone else 'Asia/Kolkata' end;
  v_local_date := (now() at time zone v_timezone)::date;
  select * into v_ent from public.workspace_entitlements e where e.workspace_id=p_workspace_id;
  if found then
    v_allowance:=greatest(0,coalesce(v_ent.daily_video_minutes,20));
    v_unlimited:=coalesce(v_ent.fair_use_unlimited,false);
  end if;

  insert into public.video_usage_daily(workspace_id,user_id,usage_date,timezone)
    values(p_workspace_id,p_user_id,v_local_date,v_timezone)
    on conflict(workspace_id,user_id,usage_date) do nothing;
  select * into v_usage from public.video_usage_daily u
    where u.workspace_id=p_workspace_id and u.user_id=p_user_id and u.usage_date=v_local_date for update;
  v_used:=coalesce(v_usage.minutes_reserved,0)+coalesce(v_usage.minutes_completed,0);
  v_remaining:=case when v_unlimited then p_duration_seconds/60 else greatest(0,v_allowance-v_used) end;

  if v_unlimited or p_duration_seconds/60 <= v_remaining then
    v_segment_minutes:=p_duration_seconds/60;
    update public.video_usage_daily set minutes_reserved=minutes_reserved+v_segment_minutes,updated_at=now()
      where id=v_usage.id;
    v_plan:=jsonb_build_object('split',false,'deferCurrent',false,'partNumber',1,
      'partStartSeconds',0,'partEndSeconds',p_duration_seconds,'sourceDurationSeconds',p_duration_seconds,
      'timezone',v_timezone,'usageDate',v_local_date,'reservedMinutes',v_segment_minutes,'pendingParts',0);
    update public.processing_jobs set video_minutes_reserved=v_segment_minutes,video_usage_date=v_local_date,
      payload=coalesce(payload,'{}'::jsonb)||jsonb_build_object('videoQuotaPlanned',true,'videoQuotaPlan',v_plan),
      updated_at=now()
      where id=p_job_id;
    return v_plan;
  end if;

  if v_allowance <= 0 then
    raise exception using errcode='P0001',message='DAILY_VIDEO_LIMIT_REACHED';
  end if;

  v_deferred := v_remaining < 0.01;
  v_first_capacity := case when v_deferred then v_allowance*60 else v_remaining*60 end;
  v_cursor:=0;
  v_part:=1;
  while v_cursor < p_duration_seconds - 0.01 loop
    v_segment_start:=v_cursor;
    if v_part=1 then
      v_target:=least(p_duration_seconds,v_cursor+v_first_capacity);
    else
      v_target:=least(p_duration_seconds,v_cursor+v_allowance*60);
    end if;
    v_cut:=v_target;
    select b::numeric into v_boundary
      from jsonb_array_elements_text(coalesce(p_silence_boundaries,'[]'::jsonb)) x(b)
      where b ~ '^\d+(\.\d+)?$'
        and b::numeric > v_cursor+10
        and b::numeric <= v_target
        and b::numeric >= v_target-90
      order by abs(v_target-b::numeric)
      limit 1;
    if found then v_cut:=v_boundary; end if;
    if v_cut<=v_cursor then v_cut:=v_target; end if;
    v_segments:=v_segments||jsonb_build_array(jsonb_build_object(
      'partNumber',v_part,'startSeconds',round(v_segment_start,3),'endSeconds',round(v_cut,3)));
    if v_part=1 then v_next_start:=v_segment_start;v_next_end:=v_cut; end if;
    v_cursor:=v_cut;
    v_part:=v_part+1;
    if v_part>100 then raise exception using errcode='22023',message='Video produced too many daily parts'; end if;
  end loop;

  v_segment_minutes:=(v_next_end-v_next_start)/60;
  if not v_deferred then
    update public.video_usage_daily set minutes_reserved=minutes_reserved+v_segment_minutes,updated_at=now()
      where id=v_usage.id;
    v_schedule_date:=v_local_date;
  else
    v_schedule_date:=v_local_date+1;
    v_schedule_at:=((v_schedule_date::text||' 09:00:00')::timestamp at time zone v_timezone);
    insert into public.video_usage_daily(workspace_id,user_id,usage_date,timezone,minutes_reserved)
      values(p_workspace_id,p_user_id,v_schedule_date,v_timezone,v_segment_minutes)
      on conflict(workspace_id,user_id,usage_date) do update
      set minutes_reserved=public.video_usage_daily.minutes_reserved+excluded.minutes_reserved,updated_at=now();
  end if;

  for v_part in 2..jsonb_array_length(v_segments) loop
    v_segment_start:=(v_segments->(v_part-1)->>'startSeconds')::numeric;
    v_segment_end:=(v_segments->(v_part-1)->>'endSeconds')::numeric;
    v_schedule_date:=v_local_date+v_part-1+case when v_deferred then 1 else 0 end;
    v_schedule_at:=((v_schedule_date::text||' 09:00:00')::timestamp at time zone v_timezone);
    insert into public.pending_processing_parts(
      workspace_id,project_id,user_id,media_asset_id,parent_job_id,part_number,
      start_seconds,end_seconds,usage_date,timezone,scheduled_for,status,expires_at
    ) values(
      p_workspace_id,p_project_id,p_user_id,p_media_asset_id,p_job_id,v_part,
      v_segment_start,v_segment_end,v_schedule_date,v_timezone,v_schedule_at,'pending',now()+interval '48 hours'
    ) on conflict(parent_job_id,part_number) do nothing;
  end loop;

  if v_deferred then
    v_next_retry:=(((v_local_date+1)::text||' 09:00:00')::timestamp at time zone v_timezone);
    v_plan:=jsonb_build_object('split',true,'deferCurrent',true,'partNumber',1,
      'partStartSeconds',v_next_start,'partEndSeconds',v_next_end,'sourceDurationSeconds',p_duration_seconds,
      'timezone',v_timezone,'usageDate',v_local_date+1,'scheduledFor',v_next_retry,
      'reservedMinutes',v_segment_minutes,'pendingParts',jsonb_array_length(v_segments)-1);
    update public.processing_jobs set status='queued',next_retry_at=v_next_retry,lease_token=null,lease_until=null,
      video_minutes_reserved=v_segment_minutes,video_usage_date=v_local_date+1,
      payload=coalesce(payload,'{}'::jsonb)||jsonb_build_object('videoQuotaPlanned',true,'videoQuotaPlan',v_plan,
        'partStartSeconds',v_next_start,'partEndSeconds',v_next_end,'partNumber',1,'sourceDurationSeconds',p_duration_seconds),
      updated_at=now()
      where id=p_job_id;
  else
    v_plan:=jsonb_build_object('split',true,'deferCurrent',false,'partNumber',1,
      'partStartSeconds',v_next_start,'partEndSeconds',v_next_end,'sourceDurationSeconds',p_duration_seconds,
      'timezone',v_timezone,'usageDate',v_local_date,'reservedMinutes',v_segment_minutes,
      'pendingParts',jsonb_array_length(v_segments)-1);
    update public.processing_jobs set video_minutes_reserved=v_segment_minutes,video_usage_date=v_local_date,
      payload=coalesce(payload,'{}'::jsonb)||jsonb_build_object('videoQuotaPlanned',true,'videoQuotaPlan',v_plan,
        'partStartSeconds',v_next_start,'partEndSeconds',v_next_end,'partNumber',1,'sourceDurationSeconds',p_duration_seconds),
      updated_at=now()
      where id=p_job_id;
  end if;
  return v_plan;
end
$function$;

CREATE OR REPLACE FUNCTION public.claim_due_pending_part(p_part_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_part public.pending_processing_parts;
  v_job public.processing_jobs;
  v_ent public.workspace_entitlements;
  v_usage public.video_usage_daily;
  v_today date;
  v_timezone text;
  v_allowance numeric:=20;
  v_unlimited boolean:=false;
  v_used numeric:=0;
  v_minutes numeric;
  v_next_date date;
  v_next_time timestamptz;
  v_job_id uuid:=gen_random_uuid();
  v_key text;
begin
  select * into v_part from public.pending_processing_parts p where p.id=p_part_id for update;
  if not found or v_part.status<>'approved' or v_part.scheduled_for>now() then
    return jsonb_build_object('queued',false,'reason','not_due');
  end if;
  v_timezone:=case when exists(select 1 from pg_timezone_names z where z.name=v_part.timezone) then v_part.timezone else 'Asia/Kolkata' end;
  v_today:=(now() at time zone v_timezone)::date;
  v_minutes:=(v_part.end_seconds-v_part.start_seconds)/60;
  select * into v_ent from public.workspace_entitlements e where e.workspace_id=v_part.workspace_id;
  if found then v_allowance:=greatest(0,coalesce(v_ent.daily_video_minutes,20));v_unlimited:=coalesce(v_ent.fair_use_unlimited,false); end if;

  insert into public.video_usage_daily(workspace_id,user_id,usage_date,timezone)
    values(v_part.workspace_id,v_part.user_id,v_today,v_timezone)
    on conflict(workspace_id,user_id,usage_date) do nothing;
  select * into v_usage from public.video_usage_daily u
    where u.workspace_id=v_part.workspace_id and u.user_id=v_part.user_id and u.usage_date=v_today for update;
  v_used:=coalesce(v_usage.minutes_reserved,0)+coalesce(v_usage.minutes_completed,0);
  if not v_unlimited and v_used+v_minutes>v_allowance+0.001 then
    v_next_date:=v_today+1;
    v_next_time:=((v_next_date::text||' 09:00:00')::timestamp at time zone v_timezone);
    update public.pending_processing_parts set scheduled_for=v_next_time,usage_date=v_next_date,updated_at=now()
      where id=v_part.id;
    return jsonb_build_object('queued',false,'rescheduledFor',v_next_time);
  end if;

  update public.video_usage_daily set minutes_reserved=minutes_reserved+v_minutes,updated_at=now()
    where id=v_usage.id;
  v_key:='pending-part:'||v_part.id::text;
  insert into public.processing_jobs(
    id,workspace_id,project_id,job_type,status,progress,idempotency_key,video_minutes_reserved,video_usage_date,payload
  ) values(
    v_job_id,v_part.workspace_id,v_part.project_id,'process_media','queued',0,v_key,v_minutes,v_today,
    jsonb_build_object('workspaceId',v_part.workspace_id,'projectId',v_part.project_id,'requestedBy',v_part.user_id,
      'mediaAssetId',v_part.media_asset_id,'sourceType','upload','operation','process_video_part',
      'partNumber',v_part.part_number,'parentJobId',v_part.parent_job_id,
      'partStartSeconds',v_part.start_seconds,'partEndSeconds',v_part.end_seconds,'scheduledPartId',v_part.id,
      'videoQuotaPlanned',true)
  ) on conflict(workspace_id,idempotency_key) where idempotency_key is not null do nothing returning * into v_job;
  if v_job.id is null then
    select * into v_job from public.processing_jobs j where j.workspace_id=v_part.workspace_id and j.idempotency_key=v_key;
    update public.video_usage_daily set minutes_reserved=greatest(0,minutes_reserved-v_minutes),updated_at=now() where id=v_usage.id;
    if v_job.video_minutes_reserved<=0 then
      return jsonb_build_object('queued',false,'reason','job_exists_without_quota');
    end if;
  end if;
  update public.pending_processing_parts set status='queued',job_id=v_job.id,updated_at=now() where id=v_part.id;
  return jsonb_build_object('queued',true,'jobId',v_job.id,'partId',v_part.id);
end
$function$;

CREATE OR REPLACE FUNCTION public.finish_video_usage_for_job(p_job_id uuid, p_succeeded boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_job public.processing_jobs;
  v_usage public.video_usage_daily;
  v_minutes numeric;
  v_user_id uuid;
begin
  select * into v_job from public.processing_jobs j where j.id=p_job_id for update;
  if not found then return jsonb_build_object('updated',false,'reason','job_not_found'); end if;
  v_minutes:=greatest(0,coalesce(v_job.video_minutes_reserved,0));
  if v_minutes<=0 or v_job.video_usage_date is null then
    return jsonb_build_object('updated',false,'reason','no_reservation');
  end if;
  if coalesce(v_job.payload->>'requestedBy','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    return jsonb_build_object('updated',false,'reason','job_user_missing');
  end if;
  v_user_id:=(v_job.payload->>'requestedBy')::uuid;
  select * into v_usage from public.video_usage_daily u
    where u.workspace_id=v_job.workspace_id and u.user_id=v_user_id
      and u.usage_date=v_job.video_usage_date for update;
  if not found then
    return jsonb_build_object('updated',false,'reason','usage_row_missing');
  end if;
  update public.video_usage_daily set
    minutes_reserved=greatest(0,minutes_reserved-v_minutes),
    minutes_completed=minutes_completed+case when p_succeeded then v_minutes else 0 end,
    updated_at=now()
    where id=v_usage.id;
  update public.processing_jobs set video_minutes_reserved=0 where id=p_job_id;
  return jsonb_build_object('updated',true,'minutes',v_minutes,'completed',p_succeeded);
end
$function$;

CREATE OR REPLACE FUNCTION public.reserve_workspace_feature_usage(p_workspace_id uuid, p_user_id uuid, p_feature_key text, p_timezone text, p_request_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_ent public.workspace_entitlements;
  v_usage public.workspace_feature_usage;
  v_limit integer;
  v_used integer;
  v_timezone text;
  v_date date;
begin
  if p_workspace_id is null or p_user_id is null or p_feature_key not in ('title_regeneration','cover_rotation')
     or coalesce(length(p_request_id),0)<1 or length(p_request_id)>200 then
    raise exception using errcode='22023',message='Invalid feature usage reservation';
  end if;
  if not exists(select 1 from public.workspace_members m where m.workspace_id=p_workspace_id and m.user_id=p_user_id) then
    raise exception using errcode='42501',message='Feature usage workspace mismatch';
  end if;
  select * into v_ent from public.workspace_entitlements e where e.workspace_id=p_workspace_id for update;
  if not found then raise exception using errcode='23503',message='Workspace entitlement not found'; end if;
  v_limit:=case when p_feature_key='title_regeneration' then v_ent.title_regenerations else v_ent.cover_rotations end;
  v_timezone:=case when exists(select 1 from pg_timezone_names z where z.name=p_timezone) then p_timezone else 'Asia/Kolkata' end;
  v_date:=(now() at time zone v_timezone)::date;
  select * into v_usage from public.workspace_feature_usage u
    where u.workspace_id=p_workspace_id and u.user_id=p_user_id and u.request_id=p_request_id for update;
  if found then
    if v_usage.feature_key<>p_feature_key then
      raise exception using errcode='23505',message='Idempotency key already used for another feature';
    end if;
    if v_usage.status in ('reserved','completed') then
      return jsonb_build_object('allowed',true,'duplicate',true,'usageId',v_usage.id,'status',v_usage.status,
        'used',(select count(*) from public.workspace_feature_usage u where u.workspace_id=p_workspace_id and u.user_id=p_user_id
          and u.usage_date=v_date and u.feature_key=p_feature_key and u.status in ('reserved','completed')),'limit',v_limit);
    end if;
  end if;
  select count(*) into v_used from public.workspace_feature_usage u
    where u.workspace_id=p_workspace_id and u.user_id=p_user_id and u.usage_date=v_date
      and u.feature_key=p_feature_key and u.status in ('reserved','completed');
  if v_used>=v_limit then
    return jsonb_build_object('allowed',false,'duplicate',false,'used',v_used,'limit',v_limit,'feature',p_feature_key);
  end if;
  if v_usage.id is not null then
    update public.workspace_feature_usage set usage_date=v_date,timezone=v_timezone,status='reserved',updated_at=now()
      where id=v_usage.id returning * into v_usage;
  else
    insert into public.workspace_feature_usage(workspace_id,user_id,usage_date,timezone,feature_key,request_id,status)
      values(p_workspace_id,p_user_id,v_date,v_timezone,p_feature_key,p_request_id,'reserved')
      returning * into v_usage;
  end if;
  return jsonb_build_object('allowed',true,'duplicate',false,'usageId',v_usage.id,'status','reserved','used',v_used+1,'limit',v_limit);
end
$function$;

CREATE OR REPLACE FUNCTION public.finish_workspace_feature_usage(p_usage_id uuid, p_succeeded boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_usage public.workspace_feature_usage;
begin
  select * into v_usage from public.workspace_feature_usage u where u.id=p_usage_id for update;
  if not found then return jsonb_build_object('updated',false,'reason','usage_not_found'); end if;
  if v_usage.status='refunded' then return jsonb_build_object('updated',false,'reason','already_refunded'); end if;
  if v_usage.status='completed' then return jsonb_build_object('updated',true,'duplicate',true); end if;
  update public.workspace_feature_usage set status=case when p_succeeded then 'completed' else 'refunded' end,updated_at=now()
    where id=p_usage_id and status='reserved';
  return jsonb_build_object('updated',true,'completed',p_succeeded);
end
$function$;

CREATE OR REPLACE FUNCTION public.apply_standard_workspace_entitlements()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.seed_workspace_entitlements()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  insert into public.workspace_entitlements(workspace_id) values(new.id)
    on conflict(workspace_id) do nothing;
  return new;
end
$function$;

CREATE OR REPLACE FUNCTION public.admin_adjust_credits(p_workspace_id uuid, p_target_user_id uuid, p_actor_user_id uuid, p_amount integer, p_reason text, p_idempotency_key text)
 RETURNS credit_ledger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.submit_ai_chat_job(p_id uuid, p_session uuid, p_workspace uuid, p_user uuid, p_project uuid, p_asset uuid, p_prompt text, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.claim_processing_job(p_worker text DEFAULT 'media-worker'::text)
 RETURNS TABLE(id uuid, workspace_id uuid, project_id uuid, job_type text, status text, progress integer, payload jsonb, attempt_count integer, current_stage text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_id uuid;
  v_row public.processing_jobs;
  v_user uuid;
begin
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
      exception when others then null;
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
  order by
    case when exists(select 1 from public.workspace_entitlements e where e.workspace_id=j.workspace_id and e.priority_queue) then 0 else 1 end,
    case when j.status='queued' then 0 else 1 end,
    j.created_at asc
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
$function$;

CREATE OR REPLACE FUNCTION public.issue_processing_ticket(p_workspace_id uuid, p_project_id uuid, p_source_id uuid, p_job_id uuid, p_media_asset_id uuid)
 RETURNS TABLE(ticket text, expires_at timestamp with time zone)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$ select * from private.issue_processing_ticket(p_workspace_id,p_project_id,p_source_id,p_job_id,p_media_asset_id); $function$;

CREATE OR REPLACE FUNCTION public.validate_processing_ticket(p_ticket text)
 RETURNS TABLE(job_id uuid, workspace_id uuid, project_id uuid, source_id uuid, media_asset_id uuid, user_id uuid)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select j.id,j.workspace_id,j.project_id,
    nullif(j.payload->>'processing_ticket_source_id','')::uuid,
    nullif(j.payload->>'processing_ticket_media_asset_id','')::uuid,
    nullif(j.payload->>'processing_ticket_user_id','')::uuid
  from public.processing_jobs j
  where j.payload->>'processing_ticket'=p_ticket
    and coalesce((j.payload->>'processing_ticket_expires_at')::timestamptz,'epoch'::timestamptz)>now()
  limit 1;
$function$;


-- Harden SECURITY DEFINER wrappers: all referenced relations/functions are schema-qualified.
alter function public.issue_processing_ticket(uuid,uuid,uuid,uuid,uuid) set search_path = '';
alter function public.validate_processing_ticket(text) set search_path = '';

-- Workspace entitlement defaults are created automatically for new workspaces.
drop trigger if exists seed_workspace_entitlements_after_workspace_insert on public.workspaces;
create trigger seed_workspace_entitlements_after_workspace_insert after insert on public.workspaces
for each row execute function public.seed_workspace_entitlements();
drop trigger if exists apply_standard_workspace_entitlements_before_write on public.workspace_entitlements;
create trigger apply_standard_workspace_entitlements_before_write before insert or update of plan on public.workspace_entitlements
for each row execute function public.apply_standard_workspace_entitlements();

-- Only ticket issuance is callable by authenticated users; all accounting/scheduler functions are server-side.
revoke all on function public.admin_adjust_credits(uuid, uuid, uuid, integer, text, text) from public, anon, authenticated;
grant execute on function public.admin_adjust_credits(uuid, uuid, uuid, integer, text, text) to service_role;
revoke all on function public.apply_standard_workspace_entitlements() from public, anon, authenticated;
grant execute on function public.apply_standard_workspace_entitlements() to service_role;
revoke all on function public.claim_due_pending_part(uuid) from public, anon, authenticated;
grant execute on function public.claim_due_pending_part(uuid) to service_role;
revoke all on function public.claim_processing_job(text) from public, anon, authenticated;
grant execute on function public.claim_processing_job(text) to service_role;
revoke all on function public.finish_video_usage_for_job(uuid, boolean) from public, anon, authenticated;
grant execute on function public.finish_video_usage_for_job(uuid, boolean) to service_role;
revoke all on function public.finish_workspace_feature_usage(uuid, boolean) from public, anon, authenticated;
grant execute on function public.finish_workspace_feature_usage(uuid, boolean) to service_role;
revoke all on function public.issue_processing_ticket(uuid, uuid, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.issue_processing_ticket(uuid, uuid, uuid, uuid, uuid) to authenticated, service_role;
revoke all on function public.plan_video_processing_parts(uuid, uuid, uuid, uuid, uuid, numeric, text, jsonb) from public, anon, authenticated;
grant execute on function public.plan_video_processing_parts(uuid, uuid, uuid, uuid, uuid, numeric, text, jsonb) to service_role;
revoke all on function public.refund_failed_job_credits(uuid, uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.refund_failed_job_credits(uuid, uuid, uuid, text, text) to service_role;
revoke all on function public.reserve_job_credits(uuid, uuid, uuid, integer, text, text) from public, anon, authenticated;
grant execute on function public.reserve_job_credits(uuid, uuid, uuid, integer, text, text) to service_role;
revoke all on function public.reserve_workspace_feature_usage(uuid, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.reserve_workspace_feature_usage(uuid, uuid, text, text, text) to service_role;
revoke all on function public.seed_workspace_entitlements() from public, anon, authenticated;
grant execute on function public.seed_workspace_entitlements() to service_role;
revoke all on function public.submit_ai_chat_job(uuid, uuid, uuid, uuid, uuid, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.submit_ai_chat_job(uuid, uuid, uuid, uuid, uuid, uuid, text, jsonb) to service_role;
revoke all on function public.validate_processing_ticket(text) from public, anon, authenticated;
grant execute on function public.validate_processing_ticket(text) to service_role;

