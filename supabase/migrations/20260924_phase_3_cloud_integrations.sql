create unique index if not exists project_sources_workspace_external_uidx on public.project_sources(workspace_id, source_type, external_id) where external_id is not null;
