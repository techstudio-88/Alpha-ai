create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 160),
  body text not null check (char_length(body) between 1 and 3000),
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.announcements enable row level security;
drop policy if exists announcements_active_read on public.announcements;
create policy announcements_active_read on public.announcements for select to authenticated using (active = true);
grant select on public.announcements to authenticated;

create table if not exists public.feature_flags (
  key text primary key check (key ~ '^[a-z][a-z0-9_.-]{1,80}$'),
  enabled boolean not null default false,
  note text not null default '',
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);
alter table public.feature_flags enable row level security;
drop policy if exists feature_flags_authenticated_read on public.feature_flags;
create policy feature_flags_authenticated_read on public.feature_flags for select to authenticated using (true);
grant select on public.feature_flags to authenticated;
