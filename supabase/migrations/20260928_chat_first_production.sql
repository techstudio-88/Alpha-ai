create table if not exists public.ai_chat_sessions (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 title text not null default 'New chat',
 project_id uuid references public.projects(id) on delete set null,
 media_asset_id uuid references public.media_assets(id) on delete set null,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create table if not exists public.ai_chat_messages (
 id uuid primary key default gen_random_uuid(),
 session_id uuid not null references public.ai_chat_sessions(id) on delete cascade,
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 role text not null check (role in ('user','assistant','system')),
 content text not null,
 metadata jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now()
);
create table if not exists public.broll_requests (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 clip_id uuid references public.clips(id) on delete cascade,
 query text not null,
 provider text not null default 'pexels',
 status text not null default 'planned',
 result jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now()
);
alter table public.ai_chat_sessions enable row level security;
alter table public.ai_chat_messages enable row level security;
alter table public.broll_requests enable row level security;
drop policy if exists ai_chat_sessions_member on public.ai_chat_sessions;
create policy ai_chat_sessions_member on public.ai_chat_sessions for all to authenticated using (private.is_workspace_member(workspace_id)) with check (private.is_workspace_member(workspace_id));
drop policy if exists ai_chat_messages_member on public.ai_chat_messages;
create policy ai_chat_messages_member on public.ai_chat_messages for all to authenticated using (private.is_workspace_member(workspace_id)) with check (private.is_workspace_member(workspace_id));
drop policy if exists broll_requests_member on public.broll_requests;
create policy broll_requests_member on public.broll_requests for all to authenticated using (private.is_workspace_member(workspace_id)) with check (private.is_workspace_member(workspace_id));
alter table public.clips add column if not exists ai_spec jsonb not null default '{}'::jsonb;
alter table public.clips add column if not exists render_path text;
alter table public.clips add column if not exists source_version integer not null default 1;
alter table public.clips add column if not exists reframe_config jsonb not null default '{}'::jsonb;
alter table public.clips add column if not exists caption_config jsonb not null default '{}'::jsonb;
alter table public.clips add column if not exists broll_config jsonb not null default '[]'::jsonb;
alter table public.clips add column if not exists updated_at timestamptz not null default now();
create index if not exists ai_chat_sessions_workspace_updated_idx on public.ai_chat_sessions(workspace_id,updated_at desc);
create index if not exists ai_chat_sessions_user_idx on public.ai_chat_sessions(user_id);
create index if not exists ai_chat_sessions_project_idx on public.ai_chat_sessions(project_id);
create index if not exists ai_chat_sessions_asset_idx on public.ai_chat_sessions(media_asset_id);
create index if not exists ai_chat_messages_session_created_idx on public.ai_chat_messages(session_id,created_at);
create index if not exists ai_chat_messages_user_idx on public.ai_chat_messages(user_id);
create index if not exists ai_chat_messages_workspace_idx on public.ai_chat_messages(workspace_id);
create index if not exists broll_requests_clip_idx on public.broll_requests(clip_id);
create index if not exists broll_requests_workspace_idx on public.broll_requests(workspace_id);