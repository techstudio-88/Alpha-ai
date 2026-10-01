-- Phase 7 performance hardening: FK indexes + RLS init-plan optimization
create index if not exists idx_api_webhooks_user_id on public.api_webhooks(user_id);
create index if not exists idx_experiment_results_variant_id on public.experiment_results(variant_id);
create index if not exists idx_experiment_results_workspace_id on public.experiment_results(workspace_id);
create index if not exists idx_experiment_variants_workspace_id on public.experiment_variants(workspace_id);
create index if not exists idx_experiments_clip_id on public.experiments(clip_id);
create index if not exists idx_experiments_user_id on public.experiments(user_id);
create index if not exists idx_translation_jobs_media_asset_id on public.translation_jobs(media_asset_id);
create index if not exists idx_translation_jobs_output_transcript_id on public.translation_jobs(output_transcript_id);
create index if not exists idx_translation_jobs_transcript_id on public.translation_jobs(transcript_id);
create index if not exists idx_translation_jobs_user_id on public.translation_jobs(user_id);

drop policy if exists api_webhooks_delete on public.api_webhooks;
create policy api_webhooks_delete on public.api_webhooks for delete using (exists (select 1 from public.workspace_members m where m.workspace_id=api_webhooks.workspace_id and m.user_id=(select auth.uid())));
drop policy if exists api_webhooks_insert on public.api_webhooks;
create policy api_webhooks_insert on public.api_webhooks for insert with check (exists (select 1 from public.workspace_members m where m.workspace_id=api_webhooks.workspace_id and m.user_id=(select auth.uid())));
drop policy if exists api_webhooks_select on public.api_webhooks;
create policy api_webhooks_select on public.api_webhooks for select using (exists (select 1 from public.workspace_members m where m.workspace_id=api_webhooks.workspace_id and m.user_id=(select auth.uid())));
drop policy if exists api_webhooks_update on public.api_webhooks;
create policy api_webhooks_update on public.api_webhooks for update using (exists (select 1 from public.workspace_members m where m.workspace_id=api_webhooks.workspace_id and m.user_id=(select auth.uid())));

drop policy if exists experiment_results_insert on public.experiment_results;
create policy experiment_results_insert on public.experiment_results for insert with check (exists (select 1 from public.workspace_members m where m.workspace_id=experiment_results.workspace_id and m.user_id=(select auth.uid())));
drop policy if exists experiment_results_select on public.experiment_results;
create policy experiment_results_select on public.experiment_results for select using (exists (select 1 from public.workspace_members m where m.workspace_id=experiment_results.workspace_id and m.user_id=(select auth.uid())));
drop policy if exists experiment_results_update on public.experiment_results;
create policy experiment_results_update on public.experiment_results for update using (exists (select 1 from public.workspace_members m where m.workspace_id=experiment_results.workspace_id and m.user_id=(select auth.uid())));

drop policy if exists experiment_variants_insert on public.experiment_variants;
create policy experiment_variants_insert on public.experiment_variants for insert with check (exists (select 1 from public.workspace_members m where m.workspace_id=experiment_variants.workspace_id and m.user_id=(select auth.uid())));
drop policy if exists experiment_variants_select on public.experiment_variants;
create policy experiment_variants_select on public.experiment_variants for select using (exists (select 1 from public.workspace_members m where m.workspace_id=experiment_variants.workspace_id and m.user_id=(select auth.uid())));
drop policy if exists experiment_variants_update on public.experiment_variants;
create policy experiment_variants_update on public.experiment_variants for update using (exists (select 1 from public.workspace_members m where m.workspace_id=experiment_variants.workspace_id and m.user_id=(select auth.uid())));

drop policy if exists experiments_insert on public.experiments;
create policy experiments_insert on public.experiments for insert with check (exists (select 1 from public.workspace_members m where m.workspace_id=experiments.workspace_id and m.user_id=(select auth.uid())));
drop policy if exists experiments_select on public.experiments;
create policy experiments_select on public.experiments for select using (exists (select 1 from public.workspace_members m where m.workspace_id=experiments.workspace_id and m.user_id=(select auth.uid())));
drop policy if exists experiments_update on public.experiments;
create policy experiments_update on public.experiments for update using (exists (select 1 from public.workspace_members m where m.workspace_id=experiments.workspace_id and m.user_id=(select auth.uid())));

drop policy if exists translation_jobs_insert on public.translation_jobs;
create policy translation_jobs_insert on public.translation_jobs for insert with check (exists (select 1 from public.workspace_members m where m.workspace_id=translation_jobs.workspace_id and m.user_id=(select auth.uid())));
drop policy if exists translation_jobs_select on public.translation_jobs;
create policy translation_jobs_select on public.translation_jobs for select using (exists (select 1 from public.workspace_members m where m.workspace_id=translation_jobs.workspace_id and m.user_id=(select auth.uid())));
drop policy if exists translation_jobs_update on public.translation_jobs;
create policy translation_jobs_update on public.translation_jobs for update using (exists (select 1 from public.workspace_members m where m.workspace_id=translation_jobs.workspace_id and m.user_id=(select auth.uid())));

drop policy if exists trend_signals_insert on public.trend_signals;
create policy trend_signals_insert on public.trend_signals for insert with check (exists (select 1 from public.workspace_members m where m.workspace_id=trend_signals.workspace_id and m.user_id=(select auth.uid())));
drop policy if exists trend_signals_select on public.trend_signals;
create policy trend_signals_select on public.trend_signals for select using (exists (select 1 from public.workspace_members m where m.workspace_id=trend_signals.workspace_id and m.user_id=(select auth.uid())));
