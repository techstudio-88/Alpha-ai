function checked(result) {
  if (result.error) throw new Error('Workspace setup could not finish. Please retry.');
  return result.data;
}

// Initializing a session must never change another member's role or an existing plan.
export async function bootstrapWorkspace(admin, user) {
  const member = checked(await admin.from('workspace_members')
    .select('workspace_id,role').eq('user_id', user.id)
    .order('created_at', {ascending:true}).limit(1).maybeSingle());
  let workspace = member ? checked(await admin.from('workspaces')
    .select('*').eq('id', member.workspace_id).maybeSingle()) : null;
  if (!workspace) workspace = checked(await admin.from('workspaces')
    .select('*').eq('owner_id', user.id).order('created_at', {ascending:true})
    .limit(1).maybeSingle());
  if (!workspace) {
    const meta = user.user_metadata || {};
    const displayName = String(meta.full_name || meta.name || user.email?.split('@')[0] || 'My Studio').trim();
    checked(await admin.from('profiles').upsert({id:user.id, full_name:meta.full_name || meta.name || null, avatar_url:meta.avatar_url || null}, {onConflict:'id'}));
    workspace = checked(await admin.from('workspaces')
      .insert({name:displayName + "'s Workspace", owner_id:user.id}).select().single());
  }
  if (workspace.owner_id === user.id) {
    checked(await admin.from('workspace_members').upsert(
      {workspace_id:workspace.id, user_id:user.id, role:'owner'},
      {onConflict:'workspace_id,user_id', ignoreDuplicates:true}));
  } else if (!member || member.workspace_id !== workspace.id) {
    throw new Error('Workspace membership is unavailable. Please ask the owner to restore access.');
  }
  checked(await admin.from('subscriptions').upsert(
    {workspace_id:workspace.id, plan:'free', status:'active'},
    {onConflict:'workspace_id', ignoreDuplicates:true}));
  const periodStart = new Date().toISOString().slice(0,7) + '-01';
  const usage = checked(await admin.from('usage').select('workspace_id')
    .eq('workspace_id',workspace.id).eq('period_start',periodStart).maybeSingle());
  if (!usage) checked(await admin.from('usage').insert({workspace_id:workspace.id, period_start:periodStart}));
  return workspace;
}
