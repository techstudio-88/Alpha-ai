create or replace function public.reserve_job_credits(
  p_workspace_id uuid, p_job_id uuid, p_user_id uuid, p_amount integer, p_reason text, p_idempotency_key text
)
returns public.credit_ledger
language plpgsql
security definer
set search_path to ''
as $function$
declare v_job public.processing_jobs; v_balance public.usage_credits; v_entry public.credit_ledger;
begin
  if p_amount<=0 or p_workspace_id is null or p_job_id is null or p_user_id is null
     or length(trim(coalesce(p_reason,'')))=0 or length(trim(coalesce(p_idempotency_key,'')))<8 then
    raise exception using errcode='22023',message='Invalid credit reservation request';
  end if;
  select * into v_entry from public.credit_ledger where idempotency_key=p_idempotency_key for update;
  if found then
    if v_entry.workspace_id<>p_workspace_id or v_entry.user_id<>p_user_id or v_entry.job_id<>p_job_id
       or v_entry.amount<>-p_amount or v_entry.transaction_type<>'reserve' then
      raise exception using errcode='23505',message='Credit idempotency key conflict';
    end if;
    return v_entry;
  end if;
  select * into v_job from public.processing_jobs where id=p_job_id and workspace_id=p_workspace_id for update;
  if not found then raise exception using errcode='23503',message='Accepted job not found'; end if;
  if v_job.status not in ('reserving','queued','processing') then
    raise exception using errcode='23514',message='Job is not accepted for processing';
  end if;
  if v_job.project_id is not null and not exists(select 1 from public.projects p where p.id=v_job.project_id and p.workspace_id=p_workspace_id) then
    raise exception using errcode='23514',message='Job project workspace mismatch';
  end if;
  if not exists(select 1 from public.workspace_members m where m.workspace_id=p_workspace_id and m.user_id=p_user_id) then
    raise exception using errcode='42501',message='Workspace access denied';
  end if;
  if coalesce(v_job.reserved_credits,0)>0 then
    select * into v_entry from public.credit_ledger where job_id=p_job_id and workspace_id=p_workspace_id and user_id=p_user_id and transaction_type='reserve' order by created_at desc limit 1;
    if found and abs(v_entry.amount)=p_amount then return v_entry; end if;
    raise exception using errcode='23514',message='Job already has an active credit reservation';
  end if;
  select * into v_balance from public.usage_credits where workspace_id=p_workspace_id and user_id=p_user_id for update;
  if not found or v_balance.credits<p_amount then raise exception using errcode='P0001',message='INSUFFICIENT_CREDITS'; end if;
  update public.usage_credits set credits=credits-p_amount,updated_at=now() where id=v_balance.id;
  insert into public.credit_ledger(workspace_id,user_id,job_id,amount,transaction_type,reason,idempotency_key)
    values(p_workspace_id,p_user_id,p_job_id,-p_amount,'reserve',p_reason,p_idempotency_key) returning * into v_entry;
  update public.processing_jobs set reserved_credits=p_amount where id=p_job_id and workspace_id=p_workspace_id;
  return v_entry;
end
$function$;