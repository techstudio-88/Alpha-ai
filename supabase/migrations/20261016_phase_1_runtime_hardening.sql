-- Phase 1 runtime hardening: atomic API throttling and FK indexes.
-- This migration is additive and safe to apply after the deployed Phase 1 foundation.

create index if not exists credit_ledger_user_id_phase1_idx
  on public.credit_ledger(user_id);
create index if not exists pending_processing_parts_job_id_phase1_idx
  on public.pending_processing_parts(job_id);
create index if not exists pending_processing_parts_media_asset_id_phase1_idx
  on public.pending_processing_parts(media_asset_id);
create index if not exists pending_processing_parts_project_id_phase1_idx
  on public.pending_processing_parts(project_id);
create index if not exists pending_processing_parts_user_id_phase1_idx
  on public.pending_processing_parts(user_id);
create index if not exists pending_processing_parts_workspace_id_phase1_idx
  on public.pending_processing_parts(workspace_id);
create index if not exists video_usage_daily_user_id_phase1_idx
  on public.video_usage_daily(user_id);
create index if not exists workspace_feature_usage_user_id_phase1_idx
  on public.workspace_feature_usage(user_id);

create or replace function public.consume_api_rate_limit(
  p_key_hash text,
  p_route text,
  p_limit integer default 120,
  p_window_seconds integer default 60
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_window_start timestamptz;
  v_count integer;
  v_retry_after integer;
begin
  if coalesce(p_key_hash, '') !~ '^[a-f0-9]{64}$'
     or coalesce(length(trim(p_route)), 0) not between 1 and 200
     or p_limit not between 1 and 1000
     or p_window_seconds not between 1 and 3600 then
    raise exception using errcode = '22023', message = 'Invalid API rate-limit request';
  end if;

  v_window_start := to_timestamp(
    floor(extract(epoch from clock_timestamp()) / p_window_seconds) * p_window_seconds
  );

  insert into public.api_rate_limits(key_hash, route, window_start, request_count)
  values (p_key_hash, p_route, v_window_start, 1)
  on conflict (key_hash, route, window_start)
  do update set request_count = public.api_rate_limits.request_count + 1
  returning request_count into v_count;

  v_retry_after := greatest(1, ceil(extract(epoch from (
    v_window_start + make_interval(secs => p_window_seconds) - clock_timestamp()
  )))::integer);

  if v_count = 1 and mod(abs(hashtext(p_key_hash || p_route)::bigint),100)=0 then
    delete from public.api_rate_limits where window_start < clock_timestamp() - interval '24 hours';
  end if;

  return jsonb_build_object(
    'allowed', v_count <= p_limit,
    'count', v_count,
    'limit', p_limit,
    'retryAfter', v_retry_after
  );
end;
$function$;

revoke all on function public.consume_api_rate_limit(text, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.consume_api_rate_limit(text, text, integer, integer)
  to service_role;

-- Failed and explicitly cancelled jobs may return a prior reservation once only.
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
as $function$
declare
  v_job public.processing_jobs;
  v_reservation public.credit_ledger;
  v_balance public.usage_credits;
  v_entry public.credit_ledger;
begin
  if p_workspace_id is null or p_job_id is null or p_user_id is null
     or coalesce(length(trim(p_idempotency_key)),0)<8 then
    raise exception using errcode='22023', message='Invalid credit refund request';
  end if;

  select * into v_entry from public.credit_ledger where idempotency_key=p_idempotency_key;
  if found then
    if v_entry.workspace_id<>p_workspace_id or v_entry.user_id<>p_user_id
       or v_entry.job_id<>p_job_id or v_entry.transaction_type<>'refund' then
      raise exception using errcode='23505', message='Credit refund idempotency key conflict';
    end if;
    return v_entry;
  end if;

  select * into v_job from public.processing_jobs
    where id=p_job_id and workspace_id=p_workspace_id for update;
  if not found then raise exception using errcode='23503', message='Job not found'; end if;
  if v_job.status not in ('failed','dead_letter','cancelled') then
    raise exception using errcode='23514', message='Only failed or cancelled jobs can be refunded';
  end if;

  select * into v_reservation from public.credit_ledger
    where job_id=p_job_id and workspace_id=p_workspace_id and user_id=p_user_id and transaction_type='reserve'
    for update;
  if not found then return null; end if;

  select * into v_entry from public.credit_ledger
    where job_id=p_job_id and workspace_id=p_workspace_id and user_id=p_user_id and transaction_type='refund';
  if found then return v_entry; end if;

  select * into v_balance from public.usage_credits
    where workspace_id=p_workspace_id and user_id=p_user_id for update;
  if not found then raise exception using errcode='23503', message='Credit balance not found'; end if;

  update public.usage_credits set credits=credits+abs(v_reservation.amount),updated_at=now()
    where id=v_balance.id;
  insert into public.credit_ledger(workspace_id,user_id,job_id,amount,transaction_type,reason,idempotency_key)
    values(p_workspace_id,p_user_id,p_job_id,abs(v_reservation.amount),'refund',
      coalesce(nullif(trim(p_reason),''),'Automatic refund for failed or cancelled job'),p_idempotency_key)
    returning * into v_entry;
  update public.processing_jobs set reserved_credits=0 where id=p_job_id and workspace_id=p_workspace_id;
  return v_entry;
end
$function$;

revoke all on function public.refund_failed_job_credits(uuid, uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.refund_failed_job_credits(uuid, uuid, uuid, text, text)
  to service_role;



create or replace function public.release_job_credits_for_provider_pause(
  p_workspace_id uuid,p_job_id uuid,p_user_id uuid,p_reason text,p_idempotency_key text
) returns public.credit_ledger
language plpgsql security definer set search_path to ''
as $function$
declare
  v_job public.processing_jobs;
  v_reservation public.credit_ledger;
  v_balance public.usage_credits;
  v_entry public.credit_ledger;
begin
  if p_workspace_id is null or p_job_id is null or p_user_id is null
     or length(trim(coalesce(p_idempotency_key,'')))<8 then
    raise exception using errcode='22023',message='Invalid provider-pause credit release request';
  end if;
  select * into v_entry from public.credit_ledger where idempotency_key=p_idempotency_key;
  if found then return v_entry; end if;
  select * into v_job from public.processing_jobs where id=p_job_id and workspace_id=p_workspace_id for update;
  if not found then raise exception using errcode='23503',message='Job not found'; end if;
  if v_job.status not in ('queued','processing') then
    raise exception using errcode='23514',message='Only active jobs can release credits during provider pause';
  end if;
  if coalesce(v_job.reserved_credits,0)<=0 then return null; end if;
  select * into v_reservation from public.credit_ledger
    where job_id=p_job_id and user_id=p_user_id and transaction_type='reserve'
    order by created_at desc limit 1;
  if not found then raise exception using errcode='23503',message='Credit reservation not found'; end if;
  select * into v_balance from public.usage_credits
    where workspace_id=p_workspace_id and user_id=p_user_id for update;
  if not found then raise exception using errcode='23503',message='Credit balance not found'; end if;
  update public.usage_credits set credits=credits+abs(v_reservation.amount),updated_at=now() where id=v_balance.id;
  insert into public.credit_ledger(workspace_id,user_id,job_id,amount,transaction_type,reason,idempotency_key)
    values(p_workspace_id,p_user_id,p_job_id,abs(v_reservation.amount),'refund',
      coalesce(nullif(trim(p_reason),''),'Temporary credit release during AI provider outage'),p_idempotency_key)
    returning * into v_entry;
  update public.processing_jobs set reserved_credits=0 where id=p_job_id and workspace_id=p_workspace_id;
  return v_entry;
end
$function$;

revoke all on function public.release_job_credits_for_provider_pause(uuid,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.release_job_credits_for_provider_pause(uuid,uuid,uuid,text,text) to service_role;

-- Enforce brand-kit caps and scheduling/publishing entitlements at the database boundary.
create or replace function public.enforce_brand_kit_limit()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_limit integer;
  v_count integer;
  v_check boolean := false;
begin
  if tg_op = 'INSERT' then
    v_check := true;
  else
    v_check := new.workspace_id is distinct from old.workspace_id;
  end if;
  if not v_check then return new; end if;

  select e.brand_kit_limit into v_limit
    from public.workspace_entitlements e
    where e.workspace_id = new.workspace_id
    for update;
  if not found then
    raise exception using errcode='23503', message='WORKSPACE_ENTITLEMENT_NOT_FOUND';
  end if;

  if tg_table_name = 'brand_kits' then
    select count(*) into v_count from public.brand_kits b
      where b.workspace_id = new.workspace_id and b.id <> new.id;
  else
    select count(*) into v_count from public.brand_kit_profiles b
      where b.workspace_id = new.workspace_id and b.id <> new.id;
  end if;

  if v_count >= greatest(1,coalesce(v_limit,1)) then
    raise exception using errcode='P0001', message='BRAND_KIT_LIMIT_REACHED';
  end if;
  return new;
end
$function$;

drop trigger if exists enforce_brand_kit_limit on public.brand_kits;
create trigger enforce_brand_kit_limit before insert or update of workspace_id on public.brand_kits
for each row execute function public.enforce_brand_kit_limit();
drop trigger if exists enforce_brand_kit_profile_limit on public.brand_kit_profiles;
create trigger enforce_brand_kit_profile_limit before insert or update of workspace_id on public.brand_kit_profiles
for each row execute function public.enforce_brand_kit_limit();

create or replace function public.enforce_scheduling_entitlement()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare v_enabled boolean;
begin
  if new.workspace_id is null or new.scheduled_for is null or new.scheduled_for <= now() + interval '60 seconds' then
    return new;
  end if;
  select e.scheduling_enabled into v_enabled
    from public.workspace_entitlements e
    where e.workspace_id = new.workspace_id
    for update;
  if not found then
    raise exception using errcode='23503', message='WORKSPACE_ENTITLEMENT_NOT_FOUND';
  end if;
  if not coalesce(v_enabled,false) then
    raise exception using errcode='P0001', message='SCHEDULING_NOT_INCLUDED_IN_PLAN';
  end if;
  return new;
end
$function$;

drop trigger if exists enforce_clip_schedule_entitlement on public.clip_schedules;
create trigger enforce_clip_schedule_entitlement before insert or update of workspace_id,scheduled_for on public.clip_schedules
for each row execute function public.enforce_scheduling_entitlement();
drop trigger if exists enforce_scheduled_post_entitlement on public.scheduled_posts;
create trigger enforce_scheduled_post_entitlement before insert or update of workspace_id,scheduled_for on public.scheduled_posts
for each row execute function public.enforce_scheduling_entitlement();
drop trigger if exists enforce_content_plan_schedule_entitlement on public.content_plans;
create trigger enforce_content_plan_schedule_entitlement before insert or update of workspace_id,scheduled_for on public.content_plans
for each row execute function public.enforce_scheduling_entitlement();

create or replace function public.enforce_publish_entitlements()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare v_scheduling boolean; v_auto_publish boolean;
begin
  select e.scheduling_enabled,e.auto_publish into v_scheduling,v_auto_publish
    from public.workspace_entitlements e
    where e.workspace_id = new.workspace_id
    for update;
  if not found then
    raise exception using errcode='23503', message='WORKSPACE_ENTITLEMENT_NOT_FOUND';
  end if;
  if new.scheduled_for > now() + interval '60 seconds' and not coalesce(v_scheduling,false) then
    raise exception using errcode='P0001', message='SCHEDULING_NOT_INCLUDED_IN_PLAN';
  end if;
  if coalesce((new.metadata->>'auto_publish')::boolean,false) and not coalesce(v_auto_publish,false) then
    raise exception using errcode='P0001', message='AUTO_PUBLISH_NOT_INCLUDED_IN_PLAN';
  end if;
  return new;
end
$function$;

drop trigger if exists enforce_publish_entitlements on public.publish_jobs;
create trigger enforce_publish_entitlements before insert or update of workspace_id,scheduled_for,metadata on public.publish_jobs
for each row execute function public.enforce_publish_entitlements();

revoke all on function public.enforce_brand_kit_limit() from public,anon,authenticated;
revoke all on function public.enforce_scheduling_entitlement() from public,anon,authenticated;
revoke all on function public.enforce_publish_entitlements() from public,anon,authenticated;
grant execute on function public.enforce_brand_kit_limit() to service_role;
grant execute on function public.enforce_scheduling_entitlement() to service_role;
grant execute on function public.enforce_publish_entitlements() to service_role;
