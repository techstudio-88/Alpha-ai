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
set search_path = ''
as $$
declare
  v_id uuid;
begin
  select j.id
    into v_id
  from public.processing_jobs j
  where (
    j.status = 'queued'
    or (
      j.status = 'processing'
      and coalesce(j.heartbeat_at, j.updated_at) < now() - interval '2 minutes'
    )
    or (
      j.status = 'transcribing'
      and coalesce(j.heartbeat_at, j.updated_at) < now() - interval '10 minutes'
    )
  )
  and (j.lease_until is null or j.lease_until < now())
  order by
    case
      when j.status = 'queued' then 0
      when j.status = 'processing' then 1
      else 2
    end,
    j.created_at asc
  for update skip locked
  limit 1;

  if v_id is null then
    return;
  end if;

  update public.processing_jobs j
  set
    status = 'processing',
    lease_token = gen_random_uuid(),
    lease_until = now() + interval '2 minutes',
    heartbeat_at = now(),
    updated_at = now(),
    attempt_count = coalesce(j.attempt_count, 0) + 1
  where j.id = v_id
  returning
    j.id,
    j.workspace_id,
    j.project_id,
    j.job_type,
    j.status,
    j.progress,
    j.payload,
    j.attempt_count,
    j.current_stage
  into id, workspace_id, project_id, job_type, status, progress, payload,
       attempt_count, current_stage;

  return next;
end
$$;

revoke all on function public.claim_processing_job(text) from public, anon, authenticated;
grant execute on function public.claim_processing_job(text) to service_role;
