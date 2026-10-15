import {createClient} from "@supabase/supabase-js";
import {randomUUID} from "node:crypto";
import {checkRateLimit,rateLimitResponse,resolveWorkspacePlan} from "../../../lib/rate-limit";
export const runtime="nodejs";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function fail(error,status,errorId){return Response.json({error,errorId},{status,headers:{"Cache-Control":"no-store"}})}
export async function POST(request){
  const errorId=randomUUID();
  try{
    const auth=request.headers.get("authorization")||"";
    if(!auth.startsWith("Bearer "))return fail("Authentication required.",401,errorId);
    const supabaseUrl=process.env.NEXT_PUBLIC_SUPABASE_URL;
    const publicKey=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY||process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if(!supabaseUrl||!publicKey)return fail("The service is temporarily unavailable.",503,errorId);
    const client=createClient(supabaseUrl,publicKey,{auth:{persistSession:false,autoRefreshToken:false},global:{headers:{Authorization:auth}}});
    const {data:{user},error:userError}=await client.auth.getUser(auth.slice(7));
    if(userError||!user)return fail("Your session is invalid or expired. Sign in again.",401,errorId);
    const body=await request.json().catch(()=>({}));
    const {workspaceId,projectId,sourceId,jobId,mediaAssetId}=body||{};
    if(!UUID.test(workspaceId||"")||!UUID.test(projectId||"")||!UUID.test(jobId||""))
      return fail("A valid workspace, project and job are required.",400,errorId);
    if(sourceId!=null&&sourceId!==""&&!UUID.test(sourceId))return fail("The source identifier is invalid.",400,errorId);
    if(mediaAssetId!=null&&mediaAssetId!==""&&!UUID.test(mediaAssetId))return fail("The video identifier is invalid.",400,errorId);
    const {data:isMember,error:memberError}=await client.rpc("is_workspace_member",{wid:workspaceId});
    if(memberError||!isMember)return fail("Workspace access denied.",403,errorId);
    const plan=await resolveWorkspacePlan(client,workspaceId);
    const rate=await checkRateLimit(request,{endpoint:"upload_start",userId:user.id,plan});
    const blocked=rateLimitResponse(rate);if(blocked)return blocked;
    const {data:ticketRows,error:ticketError}=await client.rpc("issue_processing_ticket",{
      p_workspace_id:workspaceId,p_project_id:projectId,p_source_id:sourceId||null,p_job_id:jobId,p_media_asset_id:mediaAssetId||null
    });
    if(ticketError||!ticketRows?.[0])return fail("Unable to authorize this processing job. Please refresh and retry.",500,errorId);
    return Response.json({ticket:ticketRows[0].ticket,expiresAt:ticketRows[0].expires_at},{headers:{"Cache-Control":"no-store"}});
  }catch(error){
    console.error("import_ticket_failure",{errorId,category:"internal"});
    return fail("Unable to authorize this processing job. Please retry.",500,errorId);
  }
}