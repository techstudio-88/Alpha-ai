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
language plpgsql security definer set search_path=''
as $$
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
$$;
revoke all on function public.claim_processing_job(text) from public,anon,authenticated;
grant execute on function public.claim_processing_job(text) to service_role;
