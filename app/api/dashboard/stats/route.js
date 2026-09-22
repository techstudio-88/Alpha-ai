import{createClient}from"@supabase/supabase-js";
export const runtime="nodejs";
const url=process.env.NEXT_PUBLIC_SUPABASE_URL,anon=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY||process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
export async function GET(request){
 try{
  const token=(request.headers.get("authorization")||"").replace(/^Bearer\s+/i,"");const workspaceId=new URL(request.url).searchParams.get("workspaceId");
  if(!token||!workspaceId)return Response.json({error:"Authentication and workspace are required."},{status:401});
  const client=createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false}});
  const{data:{user},error:authError}=await client.auth.getUser(token);if(authError||!user)return Response.json({error:"Authentication expired."},{status:401});
  const{data:member}=await client.from("workspace_members").select("user_id").eq("workspace_id",workspaceId).eq("user_id",user.id).maybeSingle();if(!member)return Response.json({error:"Workspace access denied."},{status:403});
  const{data:projects}=await client.from("projects").select("id").eq("workspace_id",workspaceId);
  const ids=(projects||[]).map(x=>x.id);
  if(!ids.length)return Response.json({projects:0,clipsCreated:0,minutesProcessed:0,exports:0});
  const[{count:clipsCreated},{data:assets},{count:exportsCount}]=await Promise.all([
   client.from("clips").select("id",{count:"exact",head:true}).in("project_id",ids),
   client.from("media_assets").select("duration_seconds").eq("workspace_id",workspaceId).eq("status","ready"),
   client.from("clip_versions").select("id,clips!inner(project_id)",{count:"exact",head:true}).eq("render_status","ready").in("clips.project_id",ids)
  ]);
  const minutesProcessed=(assets||[]).reduce((sum,x)=>sum+Number(x.duration_seconds||0),0)/60;
  return Response.json({projects:ids.length,clipsCreated:clipsCreated||0,minutesProcessed:Number(minutesProcessed.toFixed(1)),exports:exportsCount||0});
 }catch(e){return Response.json({error:e.message||"Could not load dashboard stats."},{status:500})}
}