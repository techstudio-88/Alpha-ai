create or replace function public.submit_upi_utr(p_order uuid, p_user uuid, p_workspace uuid, p_utr text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  n integer;
begin
  if p_utr !~ '^[0-9]{12}$' then return jsonb_build_object('ok', false, 'error', 'bad_utr'); end if;
  update public.upi_payment_orders
     set utr = p_utr, status = 'submitted', submitted_at = now()
   where id = p_order and user_id = p_user and workspace_id = p_workspace
     and status in ('pending','submitted')
     and expires_at > now()
     and created_at > now() - interval '24 hours';
  get diagnostics n = row_count;
  if n = 0 then
    update public.upi_payment_orders set status='expired',reviewed_at=now(),review_note='Order expired before UTR submission'
      where id=p_order and user_id=p_user and workspace_id=p_workspace and status='pending' and expires_at<=now();
    return jsonb_build_object('ok', false, 'error', 'not_allowed');
  end if;
  return jsonb_build_object('ok', true);
exception when unique_violation then
  return jsonb_build_object('ok', false, 'error', 'utr_used');
end
$function$;