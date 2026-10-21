create table if not exists public.user_notification_preferences (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  job_completed_email boolean not null default true,
  job_failed_email boolean not null default true,
  billing_email boolean not null default true,
  product_updates_email boolean not null default false,
  updated_at timestamptz not null default now(),
  unique (workspace_id, user_id)
);
create index if not exists user_notification_preferences_user_idx
  on public.user_notification_preferences(user_id, workspace_id);
alter table public.user_notification_preferences enable row level security;
drop policy if exists notification_preferences_select_own on public.user_notification_preferences;
create policy notification_preferences_select_own on public.user_notification_preferences
  for select to authenticated using (auth.uid() = user_id and public.is_workspace_member(workspace_id));
drop policy if exists notification_preferences_insert_own on public.user_notification_preferences;
create policy notification_preferences_insert_own on public.user_notification_preferences
  for insert to authenticated with check (auth.uid() = user_id and public.is_workspace_member(workspace_id));
drop policy if exists notification_preferences_update_own on public.user_notification_preferences;
create policy notification_preferences_update_own on public.user_notification_preferences
  for update to authenticated using (auth.uid() = user_id and public.is_workspace_member(workspace_id))
  with check (auth.uid() = user_id and public.is_workspace_member(workspace_id));