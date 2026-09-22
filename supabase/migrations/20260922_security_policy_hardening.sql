-- Security and RLS policy hardening applied 2026-09-22.
-- Keep SECURITY DEFINER functions required by the authenticated application,
-- but restrict anonymous execution and use a controlled search_path.

alter function public.ensure_my_workspace() set search_path = public, pg_temp;
alter function public.is_workspace_member(uuid) set search_path = public, pg_temp;
alter function public.issue_processing_ticket(uuid,uuid,uuid,uuid,uuid) set search_path = public, pg_temp;

revoke execute on function public.ensure_my_workspace() from anon;
revoke execute on function public.is_workspace_member(uuid) from anon;
revoke execute on function public.issue_processing_ticket(uuid,uuid,uuid,uuid,uuid) from anon;
grant execute on function public.ensure_my_workspace() to authenticated;
grant execute on function public.is_workspace_member(uuid) to authenticated;
grant execute on function public.issue_processing_ticket(uuid,uuid,uuid,uuid,uuid) to authenticated;

-- Remove duplicate permissive SELECT policies; the member policies already
-- enforce the same workspace membership predicate.
drop policy if exists analytics_select on public.analytics;
drop policy if exists audit_logs_select on public.audit_logs;
drop policy if exists brand_kits_select on public.brand_kits;
drop policy if exists caption_styles_select on public.caption_styles;
drop policy if exists clip_scores_select on public.clip_scores;
drop policy if exists clip_versions_select on public.clip_versions;
drop policy if exists posts_select on public.posts;
drop policy if exists scheduled_posts_select on public.scheduled_posts;
drop policy if exists social_accounts_select on public.social_accounts;
drop policy if exists speakers_select on public.speakers;
drop policy if exists storage_objects_select on public.storage_objects;
drop policy if exists transcript_segments_select on public.transcript_segments;

-- scheduled_posts_member_all was public while its predicate ultimately required
-- an authenticated user. The table already has explicit authenticated CRUD
-- member policies, so remove the redundant public ALL policy.
drop policy if exists scheduled_posts_member_all on public.scheduled_posts;