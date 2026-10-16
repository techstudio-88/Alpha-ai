import{createClient}from"@supabase/supabase-js";
import {enforceWorkspaceApiRateLimit} from "../../../lib/workflow-server";
export const runtime="nodejs";
export async function POST(request){
  try{
    const auth=request.headers.get("authorization")||"";
    if(!auth.startsWith("Bearer "))return Response.json({error:"Authentication required."},{status:401});
    const supabaseUrl=process.env.NEXT_PUBLIC_SUPABASE_URL;
    const publicKey=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY||process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    const serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SECRET_KEY;
    if(!supabaseUrl||!publicKey||!serviceKey)return Response.json({error:"Supabase is not configured."},{status:503});
    const client=createClient(supabaseUrl,publicKey,{auth:{persistSession:false,autoRefreshToken:false},global:{headers:{Authorization:auth}}});
    const{data:{user},error:userError}=await client.auth.getUser(auth.slice(7));
    if(userError||!user)return Response.json({error:"Invalid session."},{status:401});
    const body=await request.json().catch(()=>({}));
    const{workspaceId,projectId,sourceId,jobId,mediaAssetId}=body||{};
    if(!workspaceId||!projectId||!jobId)return Response.json({error:"Missing processing job context."},{status:400});
    const{data:isMember,error:memberError}=await client.rpc("is_workspace_member",{wid:workspaceId});
    if(memberError||!isMember)return Response.json({error:"Workspace access denied."},{status:403});
    const admin=createClient(supabaseUrl,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
    await enforceWorkspaceApiRateLimit(admin,"user:"+user.id,workspaceId,"/api/import-ticket",20,60,request.headers.get("x-real-ip")||request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()||null);
    const{data:ticketRows,error:ticketError}=await client.rpc("issue_processing_ticket",{
      p_workspace_id:workspaceId,p_project_id:projectId,p_source_id:sourceId||null,p_job_id:jobId,p_media_asset_id:mediaAssetId||null
    });
    if(ticketError||!ticketRows?.[0])return Response.json({error:ticketError?.message||"Unable to create processing ticket."},{status:500});
    return Response.json({ticket:ticketRows[0].ticket,expiresAt:ticketRows[0].expires_at});
  }catch(error){
    console.error("import-ticket",error);
    return Response.json({error:error?.message||"Unable to create processing ticket."},{status:error?.status||500,headers:error?.retryAfter?{"Retry-After":String(error.retryAfter)}:undefined});
  }
}