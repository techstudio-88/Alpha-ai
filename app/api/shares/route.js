import {createClient} from "@supabase/supabase-js";
import {randomUUID} from "node:crypto";
import {UUID} from "../../../lib/video-workflow.mjs";
import {checkRateLimit,rateLimitResponse,resolveWorkspacePlan} from "../../../lib/rate-limit";

export const runtime="nodejs";
const fail=(error,status,errorId)=>Response.json({error,errorId},{status,headers:{"Cache-Control":"no-store"}});
function clients(){
 const url=process.env.SUPABASE_URL||process.env.NEXT_PUBLIC_SUPABASE_URL;
 const anon=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
 const secret=process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SECRET_KEY;
 if(!url||!anon||!secret)throw new Error("CONFIG");
 const options={auth:{persistSession:false,autoRefreshToken:false}};
 return {auth:createClient(url,anon,options),admin:createClient(url,secret,options)};
}
async function authorize(request,workspaceId,errorId){
 if(!UUID.test(workspaceId||""))return {response:fail("A valid workspace is required.",400,errorId)};
 const {auth,admin}=clients(),header=request.headers.get("authorization")||"";
 if(!header.startsWith("Bearer "))return {response:fail("Authentication required.",401,errorId)};
 const {data:{user},error}=await auth.auth.getUser(header.slice(7));
 if(error||!user)return {response:fail("Your session is invalid or expired. Sign in again.",401,errorId)};
 const {data:member,error:memberError}=await admin.from("workspace_members").select("workspace_id").eq("workspace_id",workspaceId).eq("user_id",user.id).maybeSingle();
 if(memberError)return {response:fail("Unable to verify workspace access.",500,errorId)};
 if(!member)return {response:fail("Workspace access denied.",403,errorId)};
 const plan=await resolveWorkspacePlan(admin,workspaceId);
 const rate=await checkRateLimit(request,{endpoint:"api",userId:user.id,plan});
 const blocked=rateLimitResponse(rate);if(blocked)return {response:blocked};
 return {user,admin};
}
export async function GET(request){
 const errorId=randomUUID();
 try{
  const workspaceId=new URL(request.url).searchParams.get("workspace_id");
  const context=await authorize(request,workspaceId,errorId);if(context.response)return context.response;
  const {data,error}=await context.admin.from("public_shares").select("id,clip_id,slug,enabled,branding_enabled,view_count,created_at")
    .eq("workspace_id",workspaceId).order("created_at",{ascending:false}).limit(100);
  if(error)return fail("Unable to load share links.",500,errorId);
  return Response.json({shares:data||[]},{headers:{"Cache-Control":"no-store"}});
 }catch(error){
  console.error("shares_read_failure",{errorId,category:error?.message==="CONFIG"?"configuration":"internal"});
  return fail("Unable to load share links. Contact support with error ID "+errorId+".",500,errorId);
 }
}
export async function POST(request){
 const errorId=randomUUID();
 try{
  const body=await request.json().catch(()=>null);
  if(!body)return fail("Provide a valid share request.",400,errorId);
  const workspaceId=body.workspace_id,clipId=body.clip_id;
  if(!UUID.test(clipId||""))return fail("A valid clip is required.",400,errorId);
  const context=await authorize(request,workspaceId,errorId);if(context.response)return context.response;
  const {admin,user}=context;
  const {data:clip,error:clipError}=await admin.from("clips").select("id,project_id").eq("id",clipId).maybeSingle();
  if(clipError)return fail("Unable to verify this clip.",500,errorId);
  if(!clip)return fail("Clip not found.",404,errorId);
  const {data:project,error:projectError}=await admin.from("projects").select("id").eq("id",clip.project_id).eq("workspace_id",workspaceId).maybeSingle();
  if(projectError)return fail("Unable to verify this clip.",500,errorId);
  if(!project)return fail("Clip not found in this workspace.",404,errorId);
  const slug=randomUUID().replaceAll("-","").slice(0,18);
  const {data,error}=await admin.from("public_shares").insert({workspace_id:workspaceId,user_id:user.id,clip_id:clipId,slug,
    enabled:true,branding_enabled:body.branding_enabled!==false,metadata:{}}).select("id,slug,enabled,branding_enabled").single();
  if(error)return fail("Unable to create the share link.",500,errorId);
  return Response.json(data,{headers:{"Cache-Control":"no-store"}});
 }catch(error){
  console.error("shares_create_failure",{errorId,category:error?.message==="CONFIG"?"configuration":"internal"});
  return fail("Unable to create the share link. Contact support with error ID "+errorId+".",500,errorId);
 }
}
