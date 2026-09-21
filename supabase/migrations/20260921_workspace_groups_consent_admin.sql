create table if not exists public.project_groups (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create table if not exists public.project_group_members (
  group_id uuid not null references public.project_groups(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  primary key(group_id,project_id)
);
alter table public.project_groups enable row level security;
alter table public.project_group_members enable row level security;
drop policy if exists "project_groups_member" on public.project_groups;
create policy "project_groups_member" on public.project_groups for all to authenticated using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));
drop policy if exists "project_group_members_member" on public.project_group_members;
create policy "project_group_members_member" on public.project_group_members for all to authenticated using (exists(select 1 from public.project_groups g where g.id=group_id and public.is_workspace_member(g.workspace_id))) with check (exists(select 1 from public.project_groups g where g.id=group_id and public.is_workspace_member(g.workspace_id)));
create index if not exists project_groups_workspace_idx on public.project_groups(workspace_id);
create index if not exists project_group_members_project_idx on public.project_group_members(project_id);

create table if not exists public.user_consent_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  consent_type text not null check (consent_type in ('terms','privacy','cookies','marketing')),
  version text not null,
  granted boolean not null,
  created_at timestamptz not null default now()
);
alter table public.user_consent_events enable row level security;
drop policy if exists "user_consent_insert" on public.user_consent_events;
create policy "user_consent_insert" on public.user_consent_events for insert to authenticated with check (auth.uid()=user_id);
drop policy if exists "user_consent_read_own" on public.user_consent_events;
create policy "user_consent_read_own" on public.user_consent_events for select to authenticated using (auth.uid()=user_id);
create index if not exists user_consent_events_user_idx on public.user_consent_events(user_id,created_at desc);

create table if not exists public.admin_access_grants (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  email text not null,
  role text not null default 'viewer' check(role in ('viewer','operator','admin')),
  granted_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(workspace_id,email)
);
alter table public.admin_access_grants enable row level security;
create index if not exists admin_access_grants_email_idx on public.admin_access_grants(lower(email));
