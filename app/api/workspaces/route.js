import crypto from 'node:crypto';
import{createClient}from"@supabase/supabase-js";
const admin=()=>createClient(process.env.SUPABASE_URL||process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SECRET_KEY,{auth:{persistSession:false}});
const pub=()=>createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,{auth:{persistSession:false}});
export async function GET(req){const a=req.headers.get("authorization")||"";if(!a.startsWith("Bearer "))return Response.json({error:"Unauthorized"},{status:401});const{data:{user}}=await pub().auth.getUser(a.slice(7));if(!user)return Response.json({error:"Unauthorized"},{status:401});const{data,error}=await admin().from("workspace_members").select("workspace_id,role,workspaces(id,name,owner_id)").eq("user_id",user.id);if(error)return Response.json({error:error.message},{status:500});return Response.json({workspaces:(data||[]).map(x=>({...x.workspaces,role:x.role}))})}


export async function POST(req) {
  const requestId = crypto.randomUUID();
  try {
    const authorization = req.headers.get('authorization') || '';
    if (!authorization.startsWith('Bearer ')) return Response.json({error:'Authentication required.',requestId},{status:401});
    const token = authorization.slice(7);
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const service = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
    if (!url || !anon || !service) return Response.json({error:'Workspace creation is not configured.',requestId},{status:503});
    const options = {auth:{persistSession:false,autoRefreshToken:false}};
    const publicClient = createClient(url,anon,options);
    const adminClient = createClient(url,service,options);
    const {data:{user},error:authError} = await publicClient.auth.getUser(token);
    if (authError || !user) return Response.json({error:'Your session expired. Sign in again.',requestId},{status:401});
    const body = await req.json().catch(()=>({}));
    const name = String(body.name || '').trim().replace(/\s+/g,' ').slice(0,80);
    if (name.length < 2) return Response.json({error:'Enter a workspace name with at least 2 characters.',requestId},{status:400});
    const currentWorkspaceId = String(body.current_workspace_id || '');
    if (!currentWorkspaceId) return Response.json({error:'Select your current workspace and try again.',requestId},{status:400});
    const {data:membership} = await adminClient.from('workspace_members').select('workspace_id').eq('workspace_id',currentWorkspaceId).eq('user_id',user.id).maybeSingle();
    if (!membership) return Response.json({error:'Workspace access denied.',requestId},{status:403});
    const {data:entitlement} = await adminClient.from('workspace_entitlements').select('plan').eq('workspace_id',currentWorkspaceId).maybeSingle();
    const {data:subscription} = await adminClient.from('subscriptions').select('plan').eq('workspace_id',currentWorkspaceId).maybeSingle();
    const plan = String(entitlement?.plan || subscription?.plan || 'free').toLowerCase();
    if (!['pro','studio'].includes(plan)) return Response.json({error:'Multiple workspaces are a Pro feature. Upgrade your workspace to create another one.',code:'UPGRADE_REQUIRED',requestId},{status:402,headers:{'Cache-Control':'no-store'}});
    const {data:created,error:createError} = await adminClient.from('workspaces').insert({name,owner_id:user.id}).select('id,name,owner_id,created_at').single();
    if (createError || !created) throw new Error('create workspace');
    const {error:memberError} = await adminClient.from('workspace_members').insert({workspace_id:created.id,user_id:user.id,role:'owner'});
    if (memberError) {
      await adminClient.from('workspaces').delete().eq('id',created.id).eq('owner_id',user.id);
      throw new Error('create membership');
    }
    const {error:subscriptionError} = await adminClient.from('subscriptions').upsert({workspace_id:created.id,plan,status:'active'},{onConflict:'workspace_id'});
    if (subscriptionError) {
      await adminClient.from('workspace_members').delete().eq('workspace_id',created.id).eq('user_id',user.id);
      await adminClient.from('workspaces').delete().eq('id',created.id).eq('owner_id',user.id);
      throw new Error('create subscription');
    }
    await adminClient.from('workspace_entitlements').upsert({workspace_id:created.id,plan},{onConflict:'workspace_id'}).catch(()=>{});
    return Response.json({workspace:{...created,role:'owner'},requestId},{status:201,headers:{'Cache-Control':'no-store'}});
  } catch {
    return Response.json({error:'Could not create the workspace. Please retry.',requestId},{status:500});
  }
}
