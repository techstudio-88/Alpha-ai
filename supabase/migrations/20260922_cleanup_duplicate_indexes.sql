-- Remove four duplicate indexes reported by Supabase performance advisors on 2026-09-22.
-- The retained indexes are the corresponding idx_* variants with identical definitions.
drop index if exists public.clips_project_idx;
drop index if exists public.assets_workspace_idx;
drop index if exists public.projects_workspace_idx;
drop index if exists public.workspace_members_user_idx;
