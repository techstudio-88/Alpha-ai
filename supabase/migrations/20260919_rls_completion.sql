-- Alpha.ai RLS completion
-- Applied to the production Supabase project on 2026-09-19.
-- Keeps workspace-owned records isolated while allowing authenticated members
-- to manage content records that are safe for client-side CRUD.

do $$
declare t text;
begin
  foreach t in array array['brand_kits','caption_styles','social_accounts','scheduled_posts','posts','analytics','notifications','storage_objects','audit_logs'] loop
    execute format('drop policy if exists "%s_member_select" on public.%I', t, t);
    execute format('create policy "%s_member_select" on public.%I for select to authenticated using (is_workspace_member(workspace_id))', t, t);
    execute format('drop policy if exists "%s_member_insert" on public.%I', t, t);
    execute format('create policy "%s_member_insert" on public.%I for insert to authenticated with check (is_workspace_member(workspace_id))', t, t);
    execute format('drop policy if exists "%s_member_update" on public.%I', t, t);
    execute format('create policy "%s_member_update" on public.%I for update to authenticated using (is_workspace_member(workspace_id)) with check (is_workspace_member(workspace_id))', t, t);
    execute format('drop policy if exists "%s_member_delete" on public.%I', t, t);
    execute format('create policy "%s_member_delete" on public.%I for delete to authenticated using (is_workspace_member(workspace_id))', t, t);
  end loop;
end $$;

drop policy if exists "transcript_segments_member_all" on public.transcript_segments;
create policy "transcript_segments_member_all" on public.transcript_segments for all to authenticated
using (exists (select 1 from public.transcripts t join public.media_assets m on m.id=t.media_asset_id where t.id=transcript_segments.transcript_id and is_workspace_member(m.workspace_id)))
with check (exists (select 1 from public.transcripts t join public.media_assets m on m.id=t.media_asset_id where t.id=transcript_segments.transcript_id and is_workspace_member(m.workspace_id)));

drop policy if exists "speakers_member_all" on public.speakers;
create policy "speakers_member_all" on public.speakers for all to authenticated
using (exists (select 1 from public.transcripts t join public.media_assets m on m.id=t.media_asset_id where t.id=speakers.transcript_id and is_workspace_member(m.workspace_id)))
with check (exists (select 1 from public.transcripts t join public.media_assets m on m.id=t.media_asset_id where t.id=speakers.transcript_id and is_workspace_member(m.workspace_id)));

drop policy if exists "clip_scores_member_all" on public.clip_scores;
create policy "clip_scores_member_all" on public.clip_scores for all to authenticated
using (exists (select 1 from public.clips c join public.projects p on p.id=c.project_id where c.id=clip_scores.clip_id and is_workspace_member(p.workspace_id)))
with check (exists (select 1 from public.clips c join public.projects p on p.id=c.project_id where c.id=clip_scores.clip_id and is_workspace_member(p.workspace_id)));

drop policy if exists "clip_versions_member_all" on public.clip_versions;
create policy "clip_versions_member_all" on public.clip_versions for all to authenticated
using (exists (select 1 from public.clips c join public.projects p on p.id=c.project_id where c.id=clip_versions.clip_id and is_workspace_member(p.workspace_id)))
with check (exists (select 1 from public.clips c join public.projects p on p.id=c.project_id where c.id=clip_versions.clip_id and is_workspace_member(p.workspace_id)));

drop policy if exists "members update usage" on public.usage;
drop policy if exists "members insert usage" on public.usage;
drop policy if exists "members delete usage" on public.usage;

drop policy if exists "workspace ai providers insert" on public.ai_providers;
drop policy if exists "workspace ai providers update" on public.ai_providers;
drop policy if exists "workspace ai providers delete" on public.ai_providers;
create policy "workspace ai providers delete" on public.ai_providers for delete to authenticated
using ((workspace_id is null) or is_workspace_member(workspace_id));


-- Workspace bootstrap repair: existing users and new signups always get a workspace.
create or replace function public.ensure_my_workspace()
returns public.workspaces
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := (select auth.uid());
  wid uuid;
  result public.workspaces;
  display_name text;
begin
  if uid is null then raise exception 'Authentication required'; end if;
  select wm.workspace_id into wid from public.workspace_members wm where wm.user_id=uid order by wm.created_at asc limit 1;
  if wid is null then
    select w.id into wid from public.workspaces w where w.owner_id=uid order by w.created_at asc limit 1;
  end if;
  if wid is null then
    select coalesce(nullif(p.full_name,''),split_part(u.email,'@',1),'My Workspace') into display_name
    from auth.users u left join public.profiles p on p.id=u.id where u.id=uid;
    insert into public.profiles(id,full_name,avatar_url)
      select uid,raw_user_meta_data->>'full_name',raw_user_meta_data->>'avatar_url' from auth.users where id=uid
      on conflict(id) do nothing;
    insert into public.workspaces(name,owner_id) values(display_name||'''s Workspace',uid) returning id into wid;
    insert into public.workspace_members(workspace_id,user_id,role) values(wid,uid,'owner') on conflict(workspace_id,user_id) do nothing;
    insert into public.subscriptions(workspace_id,plan,status) values(wid,'free','active') on conflict(workspace_id) do nothing;
    insert into public.usage(workspace_id,period_start) values(wid,date_trunc('month',now())::date) on conflict do nothing;
  end if;
  select * into result from public.workspaces where id=wid;
  return result;
end;
$$;
revoke all on function public.ensure_my_workspace() from public;
grant execute on function public.ensure_my_workspace() to authenticated;

do $$
declare r record; wid uuid;
begin
  for r in
    select u.id,u.email,u.raw_user_meta_data,
      coalesce(nullif(p.full_name,''),split_part(u.email,'@',1),'My Workspace') as dn
    from auth.users u left join public.profiles p on p.id=u.id
    where not exists(select 1 from public.workspace_members wm where wm.user_id=u.id)
      and not exists(select 1 from public.workspaces w where w.owner_id=u.id)
  loop
    insert into public.profiles(id,full_name,avatar_url)
      values(r.id,r.raw_user_meta_data->>'full_name',r.raw_user_meta_data->>'avatar_url') on conflict(id) do nothing;
    insert into public.workspaces(name,owner_id) values(r.dn||'''s Workspace',r.id) returning id into wid;
    insert into public.workspace_members(workspace_id,user_id,role) values(wid,r.id,'owner') on conflict(workspace_id,user_id) do nothing;
    insert into public.subscriptions(workspace_id,plan,status) values(wid,'free','active') on conflict(workspace_id) do nothing;
    insert into public.usage(workspace_id,period_start) values(wid,date_trunc('month',now())::date) on conflict do nothing;
  end loop;
end $$;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path=public
as $$
declare wid uuid; display_name text;
begin
  display_name:=coalesce(nullif(new.raw_user_meta_data->>'full_name',''),split_part(new.email,'@',1),'My Workspace');
  insert into public.profiles(id,full_name,avatar_url)
    values(new.id,new.raw_user_meta_data->>'full_name',new.raw_user_meta_data->>'avatar_url')
    on conflict(id) do update set full_name=excluded.full_name,avatar_url=excluded.avatar_url;
  insert into public.workspaces(name,owner_id) values(display_name||'''s Workspace',new.id) returning id into wid;
  insert into public.workspace_members(workspace_id,user_id,role) values(wid,new.id,'owner') on conflict(workspace_id,user_id) do nothing;
  insert into public.subscriptions(workspace_id,plan,status) values(wid,'free','active') on conflict(workspace_id) do nothing;
  insert into public.usage(workspace_id,period_start) values(wid,date_trunc('month',now())::date) on conflict do nothing;
  return new;
end;
$$;
