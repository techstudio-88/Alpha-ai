-- Phase 1 follow-up: atomically reserve daily video minutes and plan long-video parts.
alter table public.processing_jobs
  add column if not exists video_usage_date date;

create or replace function public.plan_video_processing_parts(
  p_workspace_id uuid,
  p_project_id uuid,
  p_user_id uuid,
  p_job_id uuid,
  p_media_asset_id uuid,
  p_duration_seconds numeric,
  p_timezone text default 'Asia/Kolkata',
  p_silence_boundaries jsonb default '[]'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path=''
as $$
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
$$;
revoke all on function public.plan_video_processing_parts(uuid,uuid,uuid,uuid,uuid,numeric,text,jsonb) from public,anon,authenticated;
grant execute on function public.plan_video_processing_parts(uuid,uuid,uuid,uuid,uuid,numeric,text,jsonb) to service_role;

-- Claim an approved pending part atomically, reserving that day's minutes before queueing it.
create or replace function public.claim_due_pending_part(p_part_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
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
  ) on conflict(workspace_id,idempotency_key) do nothing returning * into v_job;
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
$$;
revoke all on function public.claim_due_pending_part(uuid) from public,anon,authenticated;
grant execute on function public.claim_due_pending_part(uuid) to service_role;

-- Move a reservation to completed usage on success, or release it on terminal failure/cancellation.
create or replace function public.finish_video_usage_for_job(p_job_id uuid,p_succeeded boolean default false)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_job public.processing_jobs;
  v_usage public.video_usage_daily;
  v_minutes numeric;
begin
  select * into v_job from public.processing_jobs j where j.id=p_job_id for update;
  if not found then return jsonb_build_object('updated',false,'reason','job_not_found'); end if;
  v_minutes:=greatest(0,coalesce(v_job.video_minutes_reserved,0));
  if v_minutes<=0 or v_job.video_usage_date is null then
    return jsonb_build_object('updated',false,'reason','no_reservation');
  end if;
  select * into v_usage from public.video_usage_daily u
    where u.workspace_id=v_job.workspace_id and u.user_id=coalesce(nullif(v_job.payload->>'requestedBy','')::uuid, null)
      and u.usage_date=v_job.video_usage_date for update;
  if not found then
    update public.processing_jobs set video_minutes_reserved=0 where id=p_job_id;
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
$$;
revoke all on function public.finish_video_usage_for_job(uuid,boolean) from public,anon,authenticated;
grant execute on function public.finish_video_usage_for_job(uuid,boolean) to service_role;
