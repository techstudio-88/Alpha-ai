import{createClient}from"@supabase/supabase-js";
export const runtime="nodejs";
const url=process.env.NEXT_PUBLIC_SUPABASE_URL,anon=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY||process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
export async function POST(request){
 try{const token=(request.headers.get("authorization")||"").replace(/^Bearer\s+/i,"");if(!token)return Response.json({error:"Authentication required."},{status:401});const client=createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false}});const{data:{user},error}=await client.auth.getUser(token);if(error||!user)return Response.json({error:"Authentication expired."},{status:401});const body=await request.json().catch(()=>({}));const workspaceId=body.workspaceId||null;if(workspaceId){const{data:member}=await client.from("workspace_members").select("user_id").eq("workspace_id",workspaceId).eq("user_id",user.id).maybeSingle();if(!member)return Response.json({error:"Workspace access denied."},{status:403})}const service=process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SECRET_KEY;const admin=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});const{error:insertError}=await admin.from("user_activity_events").insert({user_id:user.id,workspace_id:workspaceId,action:String(body.action||"activity").slice(0,120),entity_type:body.entityType||null,entity_id:body.entityId||null,metadata:body.metadata||{},user_agent:request.headers.get("user-agent")||null});if(insertError)throw insertError;return Response.json({ok:true})}catch(e){return Response.json({error:e.message||"Activity could not be recorded."},{status:500})}}


export async function GET(request){
 try{
  const token=(request.headers.get("authorization")||"").replace(/^Bearer\s+/i,"");
  if(!token)return Response.json({error:"Authentication required."},{status:401});
  const client=createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:{user},error}=await client.auth.getUser(token);
  if(error||!user)return Response.json({error:"Authentication expired."},{status:401});
  const workspaceId=new URL(request.url).searchParams.get("workspaceId");
  if(!workspaceId)return Response.json({error:"workspaceId is required."},{status:400});
  const {data:member}=await client.from("workspace_members").select("user_id").eq("workspace_id",workspaceId).eq("user_id",user.id).maybeSingle();
  if(!member)return Response.json({error:"Workspace access denied."},{status:403});
  const service=process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SECRET_KEY;
  const admin=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data,error:readError}=await admin.from("user_activity_events").select("*").eq("workspace_id",workspaceId).order("created_at",{ascending:false}).limit(30);
  if(readError)throw readError;
  return Response.json({items:data||[]});
 }catch(e){return Response.json({error:e.message||"Activity could not be loaded."},{status:500})}
}