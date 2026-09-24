alter table public.processing_jobs add column if not exists lease_token uuid;
alter table public.processing_jobs add column if not exists lease_until timestamptz;
create index if not exists processing_jobs_queue_idx on public.processing_jobs(status,updated_at,created_at);
create index if not exists processing_jobs_lease_idx on public.processing_jobs(lease_until) where lease_until is not null;
create or replace function public.claim_processing_job(p_worker text default 'media-worker') returns table(id uuid,workspace_id uuid,project_id uuid,job_type text,status text,progress integer,payload jsonb,attempt_count integer,current_stage text) language plpgsql security definer set search_path=public as $$
declare v_id uuid;
begin
 select j.id into v_id from public.processing_jobs j
 where (j.status='queued' or (j.status='processing' and coalesce(j.heartbeat_at,j.updated_at)<now()-interval '2 minutes'))
 and (j.lease_until is null or j.lease_until<now())
 order by case when j.status='queued' then 0 else 1 end,j.created_at asc
 for update skip locked limit 1;
 if v_id is null then return; end if;
 update public.processing_jobs j set status='processing',lease_token=gen_random_uuid(),lease_until=now()+interval '2 minutes',heartbeat_at=now(),updated_at=now()
 where j.id=v_id
 returning j.id,j.workspace_id,j.project_id,j.job_type,j.status,j.progress,j.payload,j.attempt_count,j.current_stage into id,workspace_id,project_id,job_type,status,progress,payload,attempt_count,current_stage;
 return next;
end $$;
revoke all on function public.claim_processing_job(text) from public,anon,authenticated;
grant execute on function public.claim_processing_job(text) to service_role;
