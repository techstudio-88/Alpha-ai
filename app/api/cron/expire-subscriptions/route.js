import { createClient } from '@supabase/supabase-js';
import { cronAuthorized } from '../../../../lib/cron-auth.mjs';
import { sendPreferenceEmail } from '../../../../lib/email.mjs';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request) {
  if (!cronAuthorized(request)) return Response.json({ error: 'Not found' }, { status: 404 });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) return Response.json({ error: 'Subscription expiry service is not configured.' }, { status: 503 });
  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const now = new Date();
  const soonStart = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString();
  const soonEnd = new Date(now.getTime() + 4 * 24 * 60 * 60 * 1000).toISOString();
  try {
    const { data: soon, error: soonError } = await admin.from('subscriptions')
      .select('id,user_id,workspace_id,plan,current_period_end').eq('provider', 'upi').eq('status', 'active')
      .gte('current_period_end', soonStart).lt('current_period_end', soonEnd);
    if (soonError) throw soonError;
    if (soon?.length) {
      for (const sub of soon) {
        const title = 'Your Alpha.ai plan expires in 3 days';
        const message = 'Your ' + sub.plan + ' plan is scheduled to expire on ' + new Date(sub.current_period_end).toLocaleDateString('en-IN', { dateStyle: 'medium', timeZone: 'UTC' }) + '. Submit a renewal payment before expiry to keep paid features.';
        const windowStart = new Date(now.getTime() - 4 * 24 * 60 * 60 * 1000).toISOString();
        const { data: existing, error: existingError } = await admin.from('notifications').select('id').eq('user_id', sub.user_id).eq('workspace_id', sub.workspace_id).eq('title', title).gte('created_at', windowStart).limit(1);
        if (existingError) throw existingError;
        if (existing?.length) continue;
        const { error } = await admin.from('notifications').insert({ user_id: sub.user_id, workspace_id: sub.workspace_id, title, message });
        if (error) throw error;
        try { await sendPreferenceEmail(admin, sub.user_id, 'plan_expiring', title, message); }
        catch (emailError) { console.error('plan-expiring-email', { errorId: crypto.randomUUID(), message: String(emailError?.message || 'email failed').slice(0, 120) }); }
      }
    }
    const { data: expired, error: expiryError } = await admin.from('subscriptions')
      .update({ status: 'expired', plan: 'free', updated_at: now.toISOString() })
      .eq('provider', 'upi').lt('current_period_end', now.toISOString()).in('status', ['active', 'trialing'])
      .select('workspace_id');
    if (expiryError) throw expiryError;
    const workspaceIds = [...new Set((expired || []).map(row => row.workspace_id).filter(Boolean))];
    if (workspaceIds.length) {
      const { error } = await admin.from('workspace_entitlements').update({ plan: 'free', updated_at: now.toISOString() }).in('workspace_id', workspaceIds);
      if (error) throw error;
    }
    return Response.json({ ok: true, notified: soon?.length || 0, expired: expired?.length || 0, entitlementsReset: workspaceIds.length });
  } catch (error) {
    const errorId = crypto.randomUUID();
    console.error('subscription-expiry', { errorId, message: String(error?.message || 'unknown').slice(0, 180) });
    return Response.json({ error: 'Subscription expiry failed. Reference: ' + errorId }, { status: 500 });
  }
}
