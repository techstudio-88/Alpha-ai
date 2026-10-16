create table if not exists public.workspace_feature_usage (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  usage_date date not null,
  timezone text not null default 'Asia/Kolkata',
  feature_key text not null check(feature_key in ('title_regeneration','cover_rotation')),
  request_id text not null,
  status text not null default 'reserved' check(status in ('reserved','completed','refunded')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(workspace_id,user_id,request_id)
);
create index if not exists workspace_feature_usage_daily_idx
  on public.workspace_feature_usage(workspace_id,user_id,usage_date,feature_key,status);
alter table public.workspace_feature_usage enable row level security;
drop policy if exists workspace_feature_usage_member_read on public.workspace_feature_usage;
create policy workspace_feature_usage_member_read on public.workspace_feature_usage
  for select to authenticated using(user_id=(select auth.uid()) and exists(
    select 1 from public.workspace_members m where m.workspace_id=workspace_feature_usage.workspace_id and m.user_id=(select auth.uid())
  ));
revoke insert,update,delete on public.workspace_feature_usage from anon,authenticated;
grant select on public.workspace_feature_usage to authenticated;
grant select,insert,update,delete on public.workspace_feature_usage to service_role;

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
  if found and v_usage.status<>'refunded' then
    return jsonb_build_object('allowed',true,'duplicate',true,'usageId',v_usage.id,'used',(
      select count(*) from public.workspace_feature_usage u where u.workspace_id=p_workspace_id and u.user_id=p_user_id
      and u.usage_date=v_date and u.feature_key=p_feature_key and u.status in ('reserved','completed')),'limit',v_limit);
  end if;
  select count(*) into v_used from public.workspace_feature_usage u
    where u.workspace_id=p_workspace_id and u.user_id=p_user_id and u.usage_date=v_date
      and u.feature_key=p_feature_key and u.status in ('reserved','completed');
  if v_used>=v_limit then
    return jsonb_build_object('allowed',false,'duplicate',false,'used',v_used,'limit',v_limit,'feature',p_feature_key);
  end if;
  insert into public.workspace_feature_usage(workspace_id,user_id,usage_date,timezone,feature_key,request_id,status)
    values(p_workspace_id,p_user_id,v_date,v_timezone,p_feature_key,p_request_id,'reserved')
    returning * into v_usage;
  return jsonb_build_object('allowed',true,'duplicate',false,'usageId',v_usage.id,'used',v_used+1,'limit',v_limit);
end
$$;
revoke all on function public.reserve_workspace_feature_usage(uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.reserve_workspace_feature_usage(uuid,uuid,text,text,text) to service_role;

create or replace function public.finish_workspace_feature_usage(p_usage_id uuid,p_succeeded boolean)
returns jsonb
language plpgsql security definer set search_path=''
as $$
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
$$;
revoke all on function public.finish_workspace_feature_usage(uuid,boolean) from public,anon,authenticated;
grant execute on function public.finish_workspace_feature_usage(uuid,boolean) to service_role;
