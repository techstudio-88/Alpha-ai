-- Durable chat submission/result transactions. Only authenticated server routes and
-- the existing service-role media worker may call these functions.
create or replace function public.submit_ai_chat_job(
  p_id uuid, p_session uuid, p_workspace uuid, p_user uuid, p_project uuid,
  p_asset uuid, p_prompt text, p_payload jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_session public.ai_chat_sessions; v_job public.processing_jobs;
begin
  if not exists(select 1 from public.workspace_members where workspace_id=p_workspace and user_id=p_user)
    or not exists(select 1 from public.projects where id=p_project and workspace_id=p_workspace)
    or (p_asset is not null and not exists(select 1 from public.media_assets where id=p_asset and project_id=p_project))
  then raise exception 'Video workspace context mismatch'; end if;
  insert into public.ai_chat_sessions(id,workspace_id,user_id,title,project_id,media_asset_id)
    values(p_session,p_workspace,p_user,left(p_prompt,80),p_project,p_asset) on conflict(id) do nothing;
  select * into v_session from public.ai_chat_sessions where id=p_session for update;
  if v_session.workspace_id<>p_workspace or v_session.user_id<>p_user then raise exception 'Chat access denied'; end if;
  select * into v_job from public.processing_jobs where id=p_id;
  if found then
    if v_job.workspace_id<>p_workspace or v_job.payload->>'sessionId'<>p_session::text then raise exception 'Request conflict'; end if;
    return to_jsonb(v_job);
  end if;
  if exists(select 1 from public.processing_jobs where workspace_id=p_workspace
    and payload->>'sessionId'=p_session::text and status in ('queued','processing','awaiting_transcription','transcribing'))
  then raise exception 'This chat already has an active job. Wait for it to finish.'; end if;
  insert into public.ai_chat_messages(id,session_id,workspace_id,user_id,role,content,metadata)
    values(p_id,p_session,p_workspace,p_user,'user',p_prompt,jsonb_build_object('jobId',p_id,'clipId',p_payload->>'clipId','mediaAssetId',p_asset));
  insert into public.processing_jobs(id,workspace_id,project_id,job_type,status,progress,payload)
    values(p_id,p_workspace,p_project,'process_media','queued',0,p_payload) returning * into v_job;
  update public.ai_chat_sessions set project_id=p_project,media_asset_id=p_asset,updated_at=now() where id=p_session;
  return to_jsonb(v_job);
end $$;

create or replace function public.complete_ai_chat_plan(p_job uuid,p_plan jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare j public.processing_jobs; item jsonb; c public.clips; child uuid; ids jsonb := '[]'; jobs jsonb := '[]'; spec jsonb;
begin
  select * into j from public.processing_jobs where id=p_job for update;
  if not found then raise exception 'Job not found'; end if;
  if j.payload ? 'resultMessageId' then return j.payload; end if;
  for item in select value from jsonb_array_elements(p_plan->'clips') loop
    spec := item;
    if nullif(j.payload->>'clipId','') is not null then
      select * into c from public.clips where id=(j.payload->>'clipId')::uuid and project_id=j.project_id
        and media_asset_id=(j.payload->>'mediaAssetId')::uuid for update;
      if not found then raise exception 'Clip context mismatch'; end if;
    else
      insert into public.clips(project_id,media_asset_id,title,start_seconds,end_seconds,score,status,ai_spec,caption_config,reframe_config)
        values(j.project_id,(j.payload->>'mediaAssetId')::uuid,item->>'title',(item->>'startSeconds')::numeric,
        (item->>'endSeconds')::numeric,(item->>'score')::numeric,'planned',spec,
        jsonb_build_object('style',item->>'captionStyle','color',item->>'captionColor'),jsonb_build_object('aspect',item->>'aspect')) returning * into c;
    end if;
    child := gen_random_uuid();
    insert into public.processing_jobs(id,workspace_id,project_id,job_type,status,progress,payload)
      values(child,j.workspace_id,j.project_id,'render_edit','queued',0,
        spec || jsonb_build_object('operation','render_edit','workspaceId',j.workspace_id,'projectId',j.project_id,
        'mediaAssetId',c.media_asset_id,'clipId',c.id,'sessionId',j.payload->>'sessionId','requestedBy',j.payload->>'requestedBy',
        'parentJobId',j.id,'aiPrompt','','instruction',j.payload->>'prompt','reframe',false));
    ids := ids || to_jsonb(c.id); jobs := jobs || to_jsonb(child);
  end loop;
  child := gen_random_uuid();
  insert into public.ai_chat_messages(id,session_id,workspace_id,user_id,role,content,metadata)
    values(child,(j.payload->>'sessionId')::uuid,j.workspace_id,(j.payload->>'requestedBy')::uuid,'assistant',
      coalesce(nullif(p_plan->>'summary',''),'Plan saved. Rendering is queued.'),
      jsonb_build_object('clipIds',ids,'jobIds',jobs,'planJobId',p_job,'plan',p_plan));
  update public.processing_jobs set payload=payload || jsonb_build_object('resultMessageId',child,'clipIds',ids,'renderJobIds',jobs),
    status='completed',progress=100,current_stage='plan_saved',error=null where id=p_job returning * into j;
  update public.ai_chat_sessions set media_asset_id=(j.payload->>'mediaAssetId')::uuid,updated_at=now() where id=(j.payload->>'sessionId')::uuid;
  return j.payload;
end $$;
revoke all on function public.submit_ai_chat_job(uuid,uuid,uuid,uuid,uuid,uuid,text,jsonb) from public,anon,authenticated;
revoke all on function public.complete_ai_chat_plan(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.submit_ai_chat_job(uuid,uuid,uuid,uuid,uuid,uuid,text,jsonb) to service_role;
grant execute on function public.complete_ai_chat_plan(uuid,jsonb) to service_role;

-- A message must reference a session in the same workspace, even for direct RLS writes.
create or replace function public.check_ai_chat_context() returns trigger
language plpgsql set search_path = '' as $$
begin
  if not exists(select 1 from public.ai_chat_sessions s where s.id=new.session_id and s.workspace_id=new.workspace_id)
  then raise exception 'Chat message workspace mismatch'; end if;
  return new;
end $$;
drop trigger if exists check_ai_chat_context on public.ai_chat_messages;
create trigger check_ai_chat_context before insert or update on public.ai_chat_messages for each row execute function public.check_ai_chat_context();
create index if not exists processing_jobs_chat_session_idx on public.processing_jobs((payload->>'sessionId'),created_at);

-- Existing uploads insert their ingest job before TUS finishes. Do not lease
-- those jobs until the source has actually reached Storage.
create or replace function public.claim_processing_job(p_worker text default 'media-worker')
returns table(id uuid,workspace_id uuid,project_id uuid,job_type text,status text,progress integer,payload jsonb,attempt_count integer,current_stage text)
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  select j.id into v_id from public.processing_jobs j
  where (j.status='queued'
    or (j.status='processing' and coalesce(j.heartbeat_at,j.updated_at)<now()-interval '2 minutes')
    or (j.status='transcribing' and coalesce(j.heartbeat_at,j.updated_at)<now()-interval '10 minutes'))
    and (j.lease_until is null or j.lease_until<now())
    and not exists(select 1 from public.media_assets m
      where m.id::text=coalesce(j.payload->>'mediaAssetId',j.payload->>'media_asset_id') and m.status='uploading')
  order by case when j.status='queued' then 0 when j.status='processing' then 1 else 2 end,j.created_at
  for update skip locked limit 1;
  if v_id is null then return; end if;
  update public.processing_jobs j set status='processing',lease_token=gen_random_uuid(),lease_until=now()+interval '2 minutes',
    heartbeat_at=now(),updated_at=now(),attempt_count=coalesce(j.attempt_count,0)+1
  where j.id=v_id returning j.id,j.workspace_id,j.project_id,j.job_type,j.status,j.progress,j.payload,j.attempt_count,j.current_stage
  into id,workspace_id,project_id,job_type,status,progress,payload,attempt_count,current_stage;
  return next;
end $$;
revoke all on function public.claim_processing_job(text) from public,anon,authenticated;
grant execute on function public.claim_processing_job(text) to service_role;
