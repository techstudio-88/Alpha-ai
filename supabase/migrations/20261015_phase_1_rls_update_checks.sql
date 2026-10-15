-- Tighten legacy UPDATE policies so a member cannot move a row into another workspace.
drop policy if exists api_webhooks_update on public.api_webhooks;
create policy api_webhooks_update on public.api_webhooks
  for update to public
  using (exists(select 1 from public.workspace_members m where m.workspace_id=api_webhooks.workspace_id and m.user_id=(select auth.uid())))
  with check (exists(select 1 from public.workspace_members m where m.workspace_id=api_webhooks.workspace_id and m.user_id=(select auth.uid())));

drop policy if exists experiment_results_update on public.experiment_results;
create policy experiment_results_update on public.experiment_results
  for update to public
  using (exists(select 1 from public.workspace_members m where m.workspace_id=experiment_results.workspace_id and m.user_id=(select auth.uid())))
  with check (exists(select 1 from public.workspace_members m where m.workspace_id=experiment_results.workspace_id and m.user_id=(select auth.uid())));

drop policy if exists experiment_variants_update on public.experiment_variants;
create policy experiment_variants_update on public.experiment_variants
  for update to public
  using (exists(select 1 from public.workspace_members m where m.workspace_id=experiment_variants.workspace_id and m.user_id=(select auth.uid())))
  with check (exists(select 1 from public.workspace_members m where m.workspace_id=experiment_variants.workspace_id and m.user_id=(select auth.uid())));

drop policy if exists experiments_update on public.experiments;
create policy experiments_update on public.experiments
  for update to public
  using (exists(select 1 from public.workspace_members m where m.workspace_id=experiments.workspace_id and m.user_id=(select auth.uid())))
  with check (exists(select 1 from public.workspace_members m where m.workspace_id=experiments.workspace_id and m.user_id=(select auth.uid())));

drop policy if exists translation_jobs_update on public.translation_jobs;
create policy translation_jobs_update on public.translation_jobs
  for update to public
  using (exists(select 1 from public.workspace_members m where m.workspace_id=translation_jobs.workspace_id and m.user_id=(select auth.uid())))
  with check (exists(select 1 from public.workspace_members m where m.workspace_id=translation_jobs.workspace_id and m.user_id=(select auth.uid())));
