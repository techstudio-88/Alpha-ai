import{createClient}from"@supabase/supabase-js";
export const runtime="nodejs";
const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const service=process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SECRET_KEY;
export async function POST(request){
 try{
  const token=(request.headers.get("authorization")||"").replace(/^Bearer\s+/i,"");
  if(!token)return Response.json({error:"Authentication required."},{status:401});
  if(!url||!anon||!service)throw new Error("Supabase server configuration is incomplete.");
  const authClient=createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:{user},error:authError}=await authClient.auth.getUser(token);
  if(authError||!user)return Response.json({error:"Authentication expired."},{status:401});
  const admin=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
  let{data:member}=await admin.from("workspace_members").select("workspace_id").eq("user_id",user.id).order("created_at",{ascending:true}).limit(1).maybeSingle();
  let workspace=null;
  if(member?.workspace_id){
   const r=await admin.from("workspaces").select("*").eq("id",member.workspace_id).maybeSingle();
   workspace=r.data||null;
  }
  if(!workspace){
   const r=await admin.from("workspaces").select("*").eq("owner_id",user.id).order("created_at",{ascending:true}).limit(1).maybeSingle();
   workspace=r.data||null;
  }
  if(!workspace){
   const meta=user.user_metadata||{};
   const displayName=String(meta.full_name||meta.name||user.email?.split("@")[0]||"My Workspace").trim()||"My Workspace";
   await admin.from("profiles").upsert({id:user.id,full_name:meta.full_name||meta.name||null,avatar_url:meta.avatar_url||null},{onConflict:"id"});
   const created=await admin.from("workspaces").insert({name:displayName+"'s Workspace",owner_id:user.id}).select().single();
   if(created.error)throw created.error;
   workspace=created.data;
  }
  const membership=await admin.from("workspace_members").upsert({workspace_id:workspace.id,user_id:user.id,role:"owner"},{onConflict:"workspace_id,user_id"}).select().maybeSingle();
  if(membership.error)throw membership.error;
  const sub=await admin.from("subscriptions").upsert({workspace_id:workspace.id,plan:"free",status:"active"},{onConflict:"workspace_id"}).select().maybeSingle();
  if(sub.error)throw sub.error;
  const usage=await admin.from("usage").upsert({workspace_id:workspace.id,period_start:new Date().toISOString().slice(0,7)+"-01"},{onConflict:"workspace_id,period_start"}).select().maybeSingle();
  if(usage.error)throw usage.error;
  return Response.json({workspace});
 }catch(e){return Response.json({error:e?.message||"Unable to prepare your workspace."},{status:500})}
}