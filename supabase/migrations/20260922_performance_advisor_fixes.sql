-- Performance corrections verified against Supabase advisors on 2026-09-22.
create index if not exists clip_delivery_bundles_clip_idx on public.clip_delivery_bundles(clip_id);
create index if not exists clip_delivery_bundles_project_idx on public.clip_delivery_bundles(project_id);
create index if not exists clip_schedules_clip_idx on public.clip_schedules(clip_id);
create index if not exists project_group_members_project_idx2 on public.project_group_members(project_id);
create index if not exists project_groups_created_by_idx on public.project_groups(created_by);
create index if not exists project_groups_workspace_idx2 on public.project_groups(workspace_id);
create index if not exists project_sources_project_idx on public.project_sources(project_id);

drop policy if exists notifications_recipient_select on public.notifications;
create policy notifications_recipient_select on public.notifications
for select to authenticated
using ((user_id = (select auth.uid())) or ((user_id is null) and is_workspace_member(workspace_id)));

drop policy if exists notifications_recipient_update on public.notifications;
create policy notifications_recipient_update on public.notifications
for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));
