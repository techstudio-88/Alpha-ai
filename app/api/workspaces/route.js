import { createClient } from '@supabase/supabase-js';
import { enforceApiRateLimit } from '../../../lib/workflow-server';
import { highestWorkspacePlan, workspaceLimitError, workspaceLimitForPlan } from '../../../lib/workspace-limits.mjs';
export const runtime = 'nodejs';
const options = { auth: { persistSession: false, autoRefreshToken: false } };
function clients() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publicKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!url || !publicKey || !secret) throw Object.assign(new Error('Workspace service is not configured.'), { status: 503 });
  return { publicClient: createClient(url, publicKey, options), admin: createClient(url, secret, options) };
}
async function authenticated(request) {
  const authorization = request.headers.get('authorization') || '';
  if (!authorization.startsWith('Bearer ')) throw Object.assign(new Error('Sign in to continue.'), { status: 401 });
  const { publicClient, admin } = clients();
  const { data, error } = await publicClient.auth.getUser(authorization.slice(7));
  if (error || !data.user) throw Object.assign(new Error('Your session expired. Sign in again.'), { status: 401 });
  const ip = request.headers.get('x-real-ip') || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null;
  await enforceApiRateLimit(admin, 'user:' + data.user.id, '/api/workspaces', 20, 60, ip);
  return { admin, user: data.user };
}
export async function GET(request) {
  try {
    const { admin, user } = await authenticated(request);
    const { data, error } = await admin.from('workspace_members').select('workspace_id,role,workspaces(id,name,owner_id)').eq('user_id', user.id);
    if (error) throw error;
    const rows = (data || []).filter(row => row.workspaces).map(row => ({ ...row.workspaces, role: row.role }));
    const ids = rows.map(row => row.id);
    const entitlements = ids.length ? await admin.from('workspace_entitlements').select('workspace_id,plan').in('workspace_id', ids) : { data: [], error: null };
    if (entitlements.error) throw entitlements.error;
    const plans = new Map((entitlements.data || []).map(row => [row.workspace_id, row.plan || 'free']));
    return Response.json({ workspaces: rows.map(row => ({ ...row, plan: plans.get(row.id) || 'free' })) });
  } catch (error) {
    const status = Number(error.status) || 500;
    return Response.json({ error: status >= 500 ? 'Could not load workspaces. Please retry.' : error.message }, { status });
  }
}
export async function POST(request) {
  let createdId = null;
  try {
    const body = await request.json().catch(() => ({}));
    const name = String(body.name || '').trim().replace(/\s+/g, ' ');
    if (name.length < 2 || name.length > 80 || /[\u0000-\u001f\u007f]/.test(name)) throw Object.assign(new Error('Workspace name must be 2–80 characters.'), { status: 400 });
    const { admin, user } = await authenticated(request);
    const { data: memberships, error: memberError } = await admin.from('workspace_members').select('workspace_id,role,workspaces(id,name,owner_id)').eq('user_id', user.id);
    if (memberError) throw memberError;
    const owned = (memberships || []).filter(row => row.workspaces?.owner_id === user.id);
    const ownedIds = owned.map(row => row.workspaces.id);
    const entResult = ownedIds.length ? await admin.from('workspace_entitlements').select('workspace_id,plan,daily_video_minutes,max_resolution,watermark_text,title_regenerations,cover_rotations,auto_publish,scheduling_enabled,brand_kit_limit,priority_queue,fair_use_unlimited').in('workspace_id', ownedIds) : { data: [], error: null };
    if (entResult.error) throw entResult.error;
    const entitlements = entResult.data || [];
    let plan = highestWorkspacePlan(entitlements.map(row => row.plan || 'free'));
    let best = entitlements.sort((a,b) => ({free:0,pro:1,studio:2}[b.plan]||0)-({free:0,pro:1,studio:2}[a.plan]||0))[0] || null;
    if (plan !== 'free' && best) {
      const sub = await admin.from('subscriptions').select('status,current_period_end,billing_interval,provider').eq('workspace_id', best.workspace_id).maybeSingle();
      if (sub.error) throw sub.error;
      if (!sub.data || sub.data.status !== 'active' || !sub.data.current_period_end || new Date(sub.data.current_period_end).getTime() <= Date.now()) { plan = 'free'; best = null; }
    }
    const limitError = workspaceLimitError(plan, owned.length);
    if (limitError) return Response.json({ error: limitError, plan, limit: workspaceLimitForPlan(plan) }, { status: 402 });
    const { data: workspace, error: createError } = await admin.from('workspaces').insert({ name, owner_id: user.id }).select('id,name,owner_id,created_at').single();
    if (createError || !workspace) throw createError || new Error('Workspace creation failed.');
    createdId = workspace.id;
    const member = await admin.from('workspace_members').upsert({ workspace_id: workspace.id, user_id: user.id, role: 'owner' }, { onConflict: 'workspace_id,user_id', ignoreDuplicates: true });
    if (member.error) throw member.error;
    const subscriptionValues = { workspace_id: workspace.id, plan, status: 'active' };
    if (plan !== 'free' && best) {
      const sourceSub = await admin.from('subscriptions').select('provider,billing_interval,current_period_start,current_period_end').eq('workspace_id', best.workspace_id).maybeSingle();
      if (sourceSub.error) throw sourceSub.error;
      if (sourceSub.data) Object.assign(subscriptionValues, sourceSub.data);
    }
    const subInsert = await admin.from('subscriptions').upsert(subscriptionValues, { onConflict: 'workspace_id', ignoreDuplicates: true });
    if (subInsert.error) throw subInsert.error;
    if (plan !== 'free' && best) {
      const entitlementValues = { ...best }; delete entitlementValues.workspace_id;
      entitlementValues.updated_at = new Date().toISOString();
      const copied = await admin.from('workspace_entitlements').update(entitlementValues).eq('workspace_id', workspace.id);
      if (copied.error) throw copied.error;
    }
    return Response.json({ workspace: { ...workspace, role: 'owner', plan } }, { status: 201 });
  } catch (error) {
    if (createdId) { try { const { admin } = clients(); await admin.from('workspaces').delete().eq('id', createdId); } catch {} }
    const status = Number(error.status) || 500;
    return Response.json({ error: status >= 500 ? 'Could not create workspace. Please retry.' : error.message }, { status });
  }
}
