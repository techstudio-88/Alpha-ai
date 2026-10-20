import { authorizeWorkflow, checked, problem } from '../../../../../lib/workflow-server';
export const runtime = 'nodejs';
export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const workspaceId = String(body.workspaceId || ''), orderId = String(body.orderId || ''), utr = String(body.utr || '').trim(), payerNote = String(body.payerNote || '').trim().slice(0, 240);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(orderId)) throw problem('Choose a valid payment order.');
    if (!/^\d{12}$/.test(utr)) throw problem('Enter the 12-digit UTR from your UPI app.');
    const { admin, user } = await authorizeWorkflow(request, workspaceId);
    const order = checked(await admin.from('upi_payment_orders').select('id,status,expires_at,workspace_id,user_id').eq('id', orderId).eq('workspace_id', workspaceId).eq('user_id', user.id).maybeSingle());
    if (!order) throw problem('Payment order not found.', 404);
    if (order.status !== 'pending' && order.status !== 'submitted') throw problem('This order can no longer accept a transaction ID. Create a new order.', 409);
    if (new Date(order.expires_at).getTime() <= Date.now()) {
      if (order.status === 'pending') await admin.from('upi_payment_orders').update({ status: 'expired' }).eq('id', order.id).eq('status', 'pending');
      throw problem('This QR expired. Create a new order to pay.', 410);
    }
    const result = checked(await admin.rpc('submit_upi_utr', { p_order: orderId, p_user: user.id, p_workspace: workspaceId, p_utr: utr }));
    if (!result?.ok) {
      if (result?.error === 'utr_used') throw problem('That UTR has already been submitted for another payment.', 409);
      if (result?.error === 'bad_utr') throw problem('Enter the 12-digit UTR from your UPI app.');
      throw problem('This order is no longer eligible for submission. Refresh and try again.', 409);
    }
    if (payerNote) checked(await admin.from('upi_payment_orders').update({ payer_note: payerNote }).eq('id', orderId).eq('user_id', user.id).select('id').single());
    return Response.json({ ok: true, status: 'submitted', message: 'Payment submitted for verification.' });
  } catch (error) {
    const status = Number(error.status) || 500;
    return Response.json({ error: status >= 500 ? 'Could not submit this payment. Please retry.' : error.message }, { status });
  }
}
