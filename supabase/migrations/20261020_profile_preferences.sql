alter table public.profiles add column if not exists preferences jsonb not null default '{}'::jsonb;
comment on column public.profiles.preferences is 'Per-user studio language, timezone, and notification preferences.';
