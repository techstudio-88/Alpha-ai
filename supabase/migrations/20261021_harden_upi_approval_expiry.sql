create or replace function public.approve_upi_order(p_order uuid, p_admin text, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  o public.upi_payment_orders;
  v_end timestamptz;
begin
  select * into o from public.upi_payment_orders where id = p_order for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if o.status = 'approved' then return jsonb_build_object('ok', true, 'already', true); end if;
  if o.status <> 'submitted' or o.utr is null then
    return jsonb_build_object('ok', false, 'error', 'not_submitted');
  end if;
  if o.expires_at <= now() or o.created_at <= now() - interval '24 hours' then
    update public.upi_payment_orders set status = 'expired', reviewed_at = now(),
      reviewed_by = p_admin, review_note = coalesce(p_note, 'Order expired before approval.')
    where id = o.id and status = 'submitted';
    return jsonb_build_object('ok', false, 'error', 'expired');
  end if;
  v_end := now() + case when o.billing_interval = 'yearly' then interval '1 year' else interval '1 month' end;
  update public.subscriptions
    set plan=o.plan, status='active', provider='upi', billing_interval=o.billing_interval,
      current_period_start=now(), current_period_end=v_end, grace_until=null,
      failed_payment_count=0, user_id=o.user_id, updated_at=now()
    where workspace_id = o.workspace_id;
  if not found then
    insert into public.subscriptions(workspace_id, user_id, plan, status, provider, billing_interval, current_period_start, current_period_end)
    values (o.workspace_id, o.user_id, o.plan, 'active', 'upi', o.billing_interval, now(), v_end);
  end if;
  update public.workspace_entitlements set plan = o.plan, updated_at = now() where workspace_id = o.workspace_id;
  insert into public.billing_invoices(workspace_id, provider_payment_id, plan, amount_paise, currency, status, description)
    values (o.workspace_id, 'upi:' || o.utr, o.plan, o.amount_paise, 'INR', 'paid',
      initcap(o.plan) || ' plan (' || o.billing_interval || ', UPI)')
    on conflict (provider_payment_id) do nothing;
  update public.upi_payment_orders set status='approved', reviewed_at=now(), reviewed_by=p_admin, review_note=p_note
    where id = o.id and status = 'submitted';
  if not found then return jsonb_build_object('ok', false, 'error', 'not_submitted'); end if;
  insert into public.notifications(workspace_id, user_id, title, message, event_type, dedupe_key)
    values (o.workspace_id, o.user_id, 'Payment confirmed',
      'Your ' || initcap(o.plan) || ' plan is now active until ' || to_char(v_end, 'DD Mon YYYY') || '.',
      'billing', 'upi-approved:' || o.id)
    on conflict do nothing;
  return jsonb_build_object('ok', true);
end
$function$;