import {createClient} from "@supabase/supabase-js";
import {randomUUID} from "node:crypto";
import {UUID} from "../../../lib/video-workflow.mjs";
import {checkRateLimit,rateLimitResponse,resolveWorkspacePlan} from "../../../lib/rate-limit";

export const runtime="nodejs";
const fail=(error,status,errorId)=>Response.json({error,errorId},{status,headers:{"Cache-Control":"no-store"}});
function clients(){
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL||process.env.SUPABASE_URL;
 const anon=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
 const service=process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SECRET_KEY;
 if(!url||!anon||!service)throw new Error("CONFIG");
 const options={auth:{persistSession:false,autoRefreshToken:false}};
 return {auth:createClient(url,anon,options),admin:createClient(url,service,options)};
}
export async function GET(request){
 const errorId=randomUUID();
 try{
  const header=request.headers.get("authorization")||"";
  if(!header.startsWith("Bearer "))return fail("Authentication required.",401,errorId);
  const {auth,admin}=clients();
  const {data:{user},error:authError}=await auth.auth.getUser(header.slice(7));
  if(authError||!user)return fail("Your session is invalid or expired. Sign in again.",401,errorId);
  const workspaceId=new URL(request.url).searchParams.get("workspace_id");
  if(!UUID.test(workspaceId||""))return fail("A valid workspace is required.",400,errorId);
  const {data:member,error:memberError}=await admin.from("workspace_members").select("workspace_id").eq("workspace_id",workspaceId).eq("user_id",user.id).maybeSingle();
  if(memberError)return fail("Unable to verify workspace access.",500,errorId);
  if(!member)return fail("Workspace access denied.",403,errorId);
  const plan=await resolveWorkspacePlan(admin,workspaceId);
  const rate=await checkRateLimit(request,{endpoint:"api",userId:user.id,plan});
  const blocked=rateLimitResponse(rate);if(blocked)return blocked;
  const {data:projects,error:projectError}=await admin.from("projects").select("id").eq("workspace_id",workspaceId);
  if(projectError)return fail("Unable to load workspace clips.",500,errorId);
  const ids=(projects||[]).map(row=>row.id);
  if(!ids.length)return Response.json({clips:[]},{headers:{"Cache-Control":"no-store"}});
  const {data,error}=await admin.from("clips").select("id,title,score,start_seconds,end_seconds,project_id,status").in("project_id",ids).order("created_at",{ascending:false}).limit(100);
  if(error)return fail("Unable to load workspace clips.",500,errorId);
  return Response.json({clips:data||[]},{headers:{"Cache-Control":"no-store"}});
 }catch(error){
  console.error("clips_list_failure",{errorId,category:error?.message==="CONFIG"?"configuration":"internal"});
  return fail("Unable to load workspace clips. Contact support with error ID "+errorId+".",500,errorId);
 }
}
