import {createClient} from "@supabase/supabase-js";
import {randomUUID} from "node:crypto";
import {UUID} from "../../../lib/video-workflow.mjs";
import {checkRateLimit,rateLimitResponse,resolveWorkspacePlan} from "../../../lib/rate-limit";

export const runtime="nodejs";
const fail=(error,status,errorId)=>Response.json({error,errorId},{status,headers:{"Cache-Control":"no-store"}});
function clients(){
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL||process.env.SUPABASE_URL;
 const anon=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
 const secret=process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SECRET_KEY;
 if(!url||!anon||!secret)throw new Error("CONFIG");
 const options={auth:{persistSession:false,autoRefreshToken:false}};
 return {auth:createClient(url,anon,options),admin:createClient(url,secret,options)};
}
async function authorize(request,workspaceId,errorId){
 const header=request.headers.get("authorization")||"";
 if(!header.startsWith("Bearer "))return {response:fail("Authentication required.",401,errorId)};
 const {auth,admin}=clients();
 const {data:{user},error}=await auth.auth.getUser(header.slice(7));
 if(error||!user)return {response:fail("Your session is invalid or expired. Sign in again.",401,errorId)};
 if(workspaceId&&!UUID.test(workspaceId))return {response:fail("A valid workspace is required.",400,errorId)};
 if(workspaceId){
  const {data:member,error}=await admin.from("workspace_members").select("workspace_id").eq("workspace_id",workspaceId).eq("user_id",user.id).maybeSingle();
  if(error)return {response:fail("Unable to verify workspace access.",500,errorId)};
  if(!member)return {response:fail("Workspace access denied.",403,errorId)};
 }
 const plan=await resolveWorkspacePlan(admin,workspaceId);
 const rate=await checkRateLimit(request,{endpoint:"api",userId:user.id,plan});
 const blocked=rateLimitResponse(rate);if(blocked)return {response:blocked};
 return {user,admin};
}
export async function POST(request){
 const errorId=randomUUID();
 try{
  const body=await request.json().catch(()=>null);
  if(!body||typeof body!=="object")return fail("Provide a valid activity event.",400,errorId);
  const workspaceId=body.workspaceId||null;
  const context=await authorize(request,workspaceId,errorId);if(context.response)return context.response;
  const {user,admin}=context;
  if(body.entityId&&!UUID.test(body.entityId))return fail("The activity entity ID is invalid.",400,errorId);
  const metadata=body.metadata&&typeof body.metadata==="object"&&!Array.isArray(body.metadata)?body.metadata:{};
  if(JSON.stringify(metadata).length>2000)return fail("Activity metadata is too large.",413,errorId);
  const {error}=await admin.from("user_activity_events").insert({user_id:user.id,workspace_id:workspaceId,
    action:String(body.action||"activity").slice(0,120),entity_type:String(body.entityType||"").slice(0,80)||null,
    entity_id:body.entityId||null,metadata,user_agent:String(request.headers.get("user-agent")||"").slice(0,300)||null});
  if(error)return fail("Activity could not be recorded.",500,errorId);
  return Response.json({ok:true},{headers:{"Cache-Control":"no-store"}});
 }catch(error){
  console.error("activity_write_failure",{errorId,category:error?.message==="CONFIG"?"configuration":"internal"});
  return fail("Activity could not be recorded. Contact support with error ID "+errorId+".",500,errorId);
 }
}
export async function GET(request){
 const errorId=randomUUID();
 try{
  const workspaceId=new URL(request.url).searchParams.get("workspaceId");
  if(!UUID.test(workspaceId||""))return fail("A valid workspace is required.",400,errorId);
  const context=await authorize(request,workspaceId,errorId);if(context.response)return context.response;
  const {data,error}=await context.admin.from("user_activity_events").select("id,user_id,workspace_id,action,entity_type,entity_id,metadata,created_at")
    .eq("workspace_id",workspaceId).order("created_at",{ascending:false}).limit(30);
  if(error)return fail("Activity could not be loaded.",500,errorId);
  return Response.json({items:data||[]},{headers:{"Cache-Control":"no-store"}});
 }catch(error){
  console.error("activity_read_failure",{errorId,category:error?.message==="CONFIG"?"configuration":"internal"});
  return fail("Activity could not be loaded. Contact support with error ID "+errorId+".",500,errorId);
 }
}
