import { randomBytes } from 'node:crypto';
import { authorizeWorkflow, checked, problem } from '../../../../../lib/workflow-server';
import { planAmount, upiLink } from '../../../../../lib/plans.mjs';
export const runtime = 'nodejs';
export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const workspaceId = String(body.workspaceId || ''), plan = String(body.plan || ''), interval = String(body.interval || 'monthly');
    const { admin, user } = await authorizeWorkflow(request, workspaceId);
    let amountPaise;
    try { amountPaise = planAmount(plan, interval); } catch (error) { throw problem(error.message, 400); }
    const workspace = checked(await admin.from('workspaces').select('id,owner_id').eq('id', workspaceId).maybeSingle());
    if (!workspace || workspace.owner_id !== user.id) throw problem('Only the workspace owner can purchase a plan.', 403);
    const now = new Date();
    const { count, error: countError } = await admin.from('upi_payment_orders').select('id', { count: 'exact', head: true }).eq('workspace_id', workspaceId).eq('user_id', user.id).in('status', ['pending', 'submitted']).gt('expires_at', now.toISOString());
    if (countError) throw problem('Could not check existing payment orders. Please retry.', 503);
    if ((count || 0) >= 3) throw problem('You already have three open payment orders. Submit or wait for one to expire before creating another.', 409);
    const reference = 'ALPHA-' + Date.now().toString(36).toUpperCase() + '-' + randomBytes(4).toString('hex').toUpperCase();
    const expiresAt = new Date(now.getTime() + 30 * 60 * 1000).toISOString();
    const upi = upiLink({ vpa: process.env.UPI_VPA, payeeName: process.env.UPI_PAYEE_NAME, amountPaise, reference, note: 'Alpha.ai ' + plan + ' ' + interval });
    const row = checked(await admin.from('upi_payment_orders').insert({ workspace_id: workspaceId, user_id: user.id, plan, billing_interval: interval, amount_paise: amountPaise, reference, status: 'pending', expires_at: expiresAt }).select('id,workspace_id,user_id,plan,billing_interval,amount_paise,reference,status,expires_at,created_at').single());
    return Response.json({ order: row, upi });
  } catch (error) {
    const status = Number(error.status) || 500;
    return Response.json({ error: status >= 500 ? 'Could not create your UPI order. Please retry.' : error.message }, { status });
  }
}
