-- Address advisor findings without opening service-only tables to client roles.
create index if not exists idx_billing_coupon_redemptions_workspace_id on public.billing_coupon_redemptions(workspace_id);
create index if not exists idx_credit_ledger_job_id on public.credit_ledger(job_id);
create index if not exists idx_export_archives_project_id on public.export_archives(project_id);
create index if not exists idx_export_archives_user_id on public.export_archives(user_id);
create index if not exists idx_referral_codes_workspace_id on public.referral_codes(workspace_id);
create index if not exists idx_storage_deletion_logs_project_id on public.storage_deletion_logs(project_id);
create index if not exists idx_subscriptions_user_id on public.subscriptions(user_id);
create index if not exists idx_upi_payment_orders_workspace_id on public.upi_payment_orders(workspace_id);

alter policy "referral_codes_own_read" on public.referral_codes
  using (user_id = (select auth.uid()));
alter policy "referrals_select_own" on public.referrals
  using ((user_id = (select auth.uid())) or (referred_user_id = (select auth.uid())));

-- Keep the scoped private helper policy and remove the duplicate public SELECT policy.
drop policy if exists "subscriptions_member_read" on public.subscriptions;

create index if not exists idx_announcements_created_by on public.announcements(created_by);
create index if not exists idx_feature_flags_updated_by on public.feature_flags(updated_by);
