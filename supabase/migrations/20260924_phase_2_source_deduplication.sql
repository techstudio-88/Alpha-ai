alter table public.media_assets add column if not exists content_fingerprint text;
create unique index if not exists media_assets_workspace_fingerprint_uidx on public.media_assets(workspace_id, content_fingerprint) where content_fingerprint is not null;
create index if not exists project_sources_workspace_url_idx on public.project_sources(workspace_id, source_url) where source_url is not null;
