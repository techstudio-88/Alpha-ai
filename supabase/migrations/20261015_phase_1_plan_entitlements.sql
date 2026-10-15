create or replace function public.apply_workspace_entitlement_defaults()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  if new.plan='free' then
    new.daily_video_minutes:=20;
    new.max_resolution:=720;
    new.watermark_text:='[APP NAME]';
    new.title_regenerations:=3;
    new.cover_rotations:=1;
    new.auto_publish:=false;
    new.scheduling_enabled:=false;
    new.brand_kit_limit:=1;
    new.priority_queue:=false;
    new.fair_use_unlimited:=false;
  elsif new.plan='pro' then
    new.daily_video_minutes:=180;
    new.max_resolution:=1080;
    new.watermark_text:='';
    new.title_regenerations:=30;
    new.cover_rotations:=10;
    new.auto_publish:=true;
    new.scheduling_enabled:=true;
    new.brand_kit_limit:=1;
    new.priority_queue:=false;
    new.fair_use_unlimited:=false;
  else
    new.daily_video_minutes:=999999;
    new.max_resolution:=3840;
    new.watermark_text:='';
    new.title_regenerations:=999999;
    new.cover_rotations:=999999;
    new.auto_publish:=true;
    new.scheduling_enabled:=true;
    new.brand_kit_limit:=10;
    new.priority_queue:=true;
    new.fair_use_unlimited:=true;
  end if;
  new.updated_at:=now();
  return new;
end
$$;
revoke all on function public.apply_workspace_entitlement_defaults() from public,anon,authenticated;
drop trigger if exists workspace_entitlements_defaults_insert on public.workspace_entitlements;
drop trigger if exists workspace_entitlements_defaults_plan_update on public.workspace_entitlements;
create trigger workspace_entitlements_defaults_insert
  before insert on public.workspace_entitlements
  for each row execute function public.apply_workspace_entitlement_defaults();
create trigger workspace_entitlements_defaults_plan_update
  before update of plan on public.workspace_entitlements
  for each row execute function public.apply_workspace_entitlement_defaults();
-- Backfill current records to the approved plan defaults; later non-plan customizations remain editable.
update public.workspace_entitlements set plan=plan;
