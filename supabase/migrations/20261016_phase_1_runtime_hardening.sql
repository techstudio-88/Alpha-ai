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
