-- Alpha.ai RLS completion
-- Applied to the production Supabase project on 2026-09-19.
-- Keeps workspace-owned records isolated while allowing authenticated members
-- to manage content records that are safe for client-side CRUD.

do $$
declare t text;
begin
  foreach t in array array['brand_kits','caption_styles','social_accounts','scheduled_posts','posts','analytics','notifications','storage_objects','audit_logs'] loop
    execute format('drop policy if exists "%s_member_select" on public.%I', t, t);
    execute format('create policy "%s_member_select" on public.%I for select to authenticated using (is_workspace_member(workspace_id))', t, t);
    execute format('drop policy if exists "%s_member_insert" on public.%I', t, t);
    execute format('create policy "%s_member_insert" on public.%I for insert to authenticated with check (is_workspace_member(workspace_id))', t, t);
    execute format('drop policy if exists "%s_member_update" on public.%I', t, t);
    execute format('create policy "%s_member_update" on public.%I for update to authenticated using (is_workspace_member(workspace_id)) with check (is_workspace_member(workspace_id))', t, t);
    execute format('drop policy if exists "%s_member_delete" on public.%I', t, t);
    execute format('create policy "%s_member_delete" on public.%I for delete to authenticated using (is_workspace_member(workspace_id))', t, t);
  end loop;
end $$;

drop policy if exists "transcript_segments_member_all" on public.transcript_segments;
create policy "transcript_segments_member_all" on public.transcript_segments for all to authenticated
using (exists (select 1 from public.transcripts t join public.media_assets m on m.id=t.media_asset_id where t.id=transcript_segments.transcript_id and is_workspace_member(m.workspace_id)))
with check (exists (select 1 from public.transcripts t join public.media_assets m on m.id=t.media_asset_id where t.id=transcript_segments.transcript_id and is_workspace_member(m.workspace_id)));

drop policy if exists "speakers_member_all" on public.speakers;
create policy "speakers_member_all" on public.speakers for all to authenticated
using (exists (select 1 from public.transcripts t join public.media_assets m on m.id=t.media_asset_id where t.id=speakers.transcript_id and is_workspace_member(m.workspace_id)))
with check (exists (select 1 from public.transcripts t join public.media_assets m on m.id=t.media_asset_id where t.id=speakers.transcript_id and is_workspace_member(m.workspace_id)));

drop policy if exists "clip_scores_member_all" on public.clip_scores;
create policy "clip_scores_member_all" on public.clip_scores for all to authenticated
using (exists (select 1 from public.clips c join public.projects p on p.id=c.project_id where c.id=clip_scores.clip_id and is_workspace_member(p.workspace_id)))
with check (exists (select 1 from public.clips c join public.projects p on p.id=c.project_id where c.id=clip_scores.clip_id and is_workspace_member(p.workspace_id)));

drop policy if exists "clip_versions_member_all" on public.clip_versions;
create policy "clip_versions_member_all" on public.clip_versions for all to authenticated
using (exists (select 1 from public.clips c join public.projects p on p.id=c.project_id where c.id=clip_versions.clip_id and is_workspace_member(p.workspace_id)))
with check (exists (select 1 from public.clips c join public.projects p on p.id=c.project_id where c.id=clip_versions.clip_id and is_workspace_member(p.workspace_id)));

drop policy if exists "members update usage" on public.usage;
drop policy if exists "members insert usage" on public.usage;
drop policy if exists "members delete usage" on public.usage;

drop policy if exists "workspace ai providers insert" on public.ai_providers;
drop policy if exists "workspace ai providers update" on public.ai_providers;
drop policy if exists "workspace ai providers delete" on public.ai_providers;
create policy "workspace ai providers delete" on public.ai_providers for delete to authenticated
using ((workspace_id is null) or is_workspace_member(workspace_id));
