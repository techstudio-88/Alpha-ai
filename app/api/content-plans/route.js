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
async function authorize(request,workspaceId){
 if(!UUID.test(workspaceId||""))throw Object.assign(new Error("A valid workspace is required."),{status:400});
 const {auth,admin}=clients(),header=request.headers.get("authorization")||"";
 if(!header.startsWith("Bearer "))throw Object.assign(new Error("Authentication required."),{status:401});
 const {data:{user},error}=await auth.auth.getUser(header.slice(7));
 if(error||!user)throw Object.assign(new Error("Your session is invalid or expired. Sign in again."),{status:401});
 const {data:member,error:memberError}=await admin.from("workspace_members").select("workspace_id").eq("workspace_id",workspaceId).eq("user_id",user.id).maybeSingle();
 if(memberError)throw Object.assign(new Error("Unable to verify workspace access."),{status:500});
 if(!member)throw Object.assign(new Error("Workspace access denied."),{status:403});
 const plan=await resolveWorkspacePlan(admin,workspaceId);
 const rate=await checkRateLimit(request,{endpoint:"api",userId:user.id,plan});
 const blocked=rateLimitResponse(rate);
 return {admin,user,plan,blocked};
}
export async function GET(request){
 const errorId=randomUUID();
 try{
  const workspaceId=new URL(request.url).searchParams.get("workspace_id");
  const {admin,blocked}=await authorize(request,workspaceId);
  if(blocked)return blocked;
  const {data,error}=await admin.from("content_plans").select("*").eq("workspace_id",workspaceId).order("scheduled_for",{ascending:true,nullsFirst:false});
  if(error)return fail("Unable to load content plans.",500,errorId);
  return Response.json({plans:data||[]},{headers:{"Cache-Control":"no-store"}});
 }catch(error){
  console.error("content_plans_read_failure",{errorId,category:error?.message==="CONFIG"?"configuration":"internal"});
  return fail(error?.status&&error.status<500?error.message:"Unable to load content plans. Contact support with error ID "+errorId+".",error?.status||500,errorId);
 }
}
export async function POST(request){
 const errorId=randomUUID();
 try{
  const body=await request.json().catch(()=>null);
  if(!body)return fail("Provide a valid content plan.",400,errorId);
  const workspaceId=body.workspace_id;
  const {admin,user,blocked}=await authorize(request,workspaceId);
  if(blocked)return blocked;
  if(body.clip_id&&!UUID.test(body.clip_id))return fail("A valid clip is required.",400,errorId);
  if(body.clip_id){
   const {data:clip,error}=await admin.from("clips").select("id,project_id").eq("id",body.clip_id).maybeSingle();
   if(error)return fail("Unable to verify the selected clip.",500,errorId);
   if(!clip)return fail("Clip not found.",404,errorId);
   const {data:project,error:projectError}=await admin.from("projects").select("id").eq("id",clip.project_id).eq("workspace_id",workspaceId).maybeSingle();
   if(projectError)return fail("Unable to verify the selected clip.",500,errorId);
   if(!project)return fail("Clip not found in this workspace.",404,errorId);
  }
  const row={workspace_id:workspaceId,user_id:user.id,keyword:String(body.keyword||"").slice(0,200),
   search_intent:String(body.search_intent||"informational").slice(0,40),clip_id:body.clip_id||null,platform:String(body.platform||"").slice(0,40)||null,
   scheduled_for:body.scheduled_for||null,caption:String(body.caption||"").slice(0,3000)||null,
   hashtags:Array.isArray(body.hashtags)?body.hashtags.slice(0,20).map(x=>String(x).slice(0,100)):[],
   content_type:String(body.content_type||"video").slice(0,40),status:String(body.status||"idea").slice(0,40),metadata:body.metadata&&typeof body.metadata==="object"?body.metadata:{}};
  const {data,error}=await admin.from("content_plans").insert(row).select("*").single();
  if(error)return fail("Unable to save the content plan.",500,errorId);
  return Response.json(data,{headers:{"Cache-Control":"no-store"}});
 }catch(error){
  console.error("content_plans_write_failure",{errorId,category:error?.message==="CONFIG"?"configuration":"internal"});
  return fail(error?.status&&error.status<500?error.message:"Unable to save content plan. Contact support with error ID "+errorId+".",error?.status||500,errorId);
 }
}
