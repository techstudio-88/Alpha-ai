create or replace function public.reserve_workspace_feature_usage(
  p_workspace_id uuid,p_user_id uuid,p_feature_key text,p_timezone text,p_request_id text
) returns jsonb
language plpgsql security definer set search_path=''
as $$
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
$$;
revoke all on function public.reserve_workspace_feature_usage(uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.reserve_workspace_feature_usage(uuid,uuid,text,text,text) to service_role;
