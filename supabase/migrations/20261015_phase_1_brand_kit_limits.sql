create or replace function public.enforce_workspace_brand_kit_limit()
returns trigger language plpgsql security definer set search_path=''
as $$
declare
  v_limit integer;
  v_count integer;
begin
  if new.workspace_id is null then
    raise exception using errcode='23502',message='Brand kit workspace is required';
  end if;
  select coalesce(e.brand_kit_limit,1) into v_limit
    from public.workspace_entitlements e
    where e.workspace_id=new.workspace_id
    for update;
  if not found then
    raise exception using errcode='23503',message='Workspace entitlement not found';
  end if;
  select
    (select count(*) from public.brand_kits b where b.workspace_id=new.workspace_id and (tg_table_name<>'brand_kits' or b.id is distinct from new.id))+
    (select count(*) from public.brand_kit_profiles p where p.workspace_id=new.workspace_id and (tg_table_name<>'brand_kit_profiles' or p.id is distinct from new.id))
    into v_count;
  if v_count>=v_limit then
    raise exception using errcode='P0001',message='BRAND_KIT_LIMIT_REACHED';
  end if;
  return new;
end
$$;
revoke all on function public.enforce_workspace_brand_kit_limit() from public,anon,authenticated;
drop trigger if exists brand_kits_entitlement_limit on public.brand_kits;
create trigger brand_kits_entitlement_limit before insert on public.brand_kits
  for each row execute function public.enforce_workspace_brand_kit_limit();
drop trigger if exists brand_kit_profiles_entitlement_limit on public.brand_kit_profiles;
create trigger brand_kit_profiles_entitlement_limit before insert on public.brand_kit_profiles
  for each row execute function public.enforce_workspace_brand_kit_limit();
