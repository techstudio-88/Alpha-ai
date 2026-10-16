import crypto from "node:crypto";
import {createClient} from "@supabase/supabase-js";
import {randomUUID} from "node:crypto";
import {UUID} from "../../../../lib/video-workflow.mjs";
import {checkRateLimit,rateLimitResponse,resolveWorkspacePlan} from "../../../../lib/rate-limit";

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
async function authorize(request,workspaceId,errorId,mutate=false){
 if(!UUID.test(workspaceId||""))return {response:fail("A valid workspace is required.",400,errorId)};
 const {auth,admin}=clients(),header=request.headers.get("authorization")||"";
 if(!header.startsWith("Bearer "))return {response:fail("Authentication required.",401,errorId)};
 const {data:{user},error}=await auth.auth.getUser(header.slice(7));
 if(error||!user)return {response:fail("Your session is invalid or expired. Sign in again.",401,errorId)};
 const {data:member,error:memberError}=await admin.from("workspace_members").select("role").eq("workspace_id",workspaceId).eq("user_id",user.id).maybeSingle();
 if(memberError)return {response:fail("Unable to verify workspace access.",500,errorId)};
 if(!member)return {response:fail("Workspace access denied.",403,errorId)};
 if(mutate&&!["owner","admin"].includes(member.role))return {response:fail("Only workspace owners or admins can manage API keys.",403,errorId)};
 const plan=await resolveWorkspacePlan(admin,workspaceId);
 const rate=await checkRateLimit(request,{endpoint:mutate?"auth":"api",userId:user.id,plan});
 const blocked=rateLimitResponse(rate);if(blocked)return {response:blocked};
 return {user,admin};
}
export async function GET(request){
 const errorId=randomUUID();
 try{
  const workspaceId=new URL(request.url).searchParams.get("workspace_id");
  const context=await authorize(request,workspaceId,errorId);if(context.response)return context.response;
  const {data,error}=await context.admin.from("api_keys").select("id,name,key_prefix,revoked_at,last_used_at,created_at")
    .eq("workspace_id",workspaceId).order("created_at",{ascending:false}).limit(100);
  if(error)return fail("Unable to load API keys.",500,errorId);
  return Response.json({keys:data||[]},{headers:{"Cache-Control":"no-store"}});
 }catch(error){
  console.error("api_key_list_failure",{errorId,category:error?.message==="CONFIG"?"configuration":"internal"});
  return fail("Unable to load API keys. Contact support with error ID "+errorId+".",500,errorId);
 }
}
export async function POST(request){
 const errorId=randomUUID();
 try{
  const body=await request.json().catch(()=>null);
  if(!body)return fail("Provide a valid API-key request.",400,errorId);
  const context=await authorize(request,body.workspace_id,errorId,true);if(context.response)return context.response;
  const raw="alpha_"+crypto.randomBytes(24).toString("hex"),hash=crypto.createHash("sha256").update(raw).digest("hex");
  const {data,error}=await context.admin.from("api_keys").insert({workspace_id:body.workspace_id,user_id:context.user.id,
    name:String(body.name||"API key").slice(0,100),key_prefix:raw.slice(0,16),key_hash:hash}).select("id,name,key_prefix,created_at").single();
  if(error)return fail("Unable to create the API key.",500,errorId);
  return Response.json({...data,key:raw},{headers:{"Cache-Control":"no-store"}});
 }catch(error){
  console.error("api_key_create_failure",{errorId,category:error?.message==="CONFIG"?"configuration":"internal"});
  return fail("Unable to create the API key. Contact support with error ID "+errorId+".",500,errorId);
 }
}
export async function DELETE(request){
 const errorId=randomUUID();
 try{
  const body=await request.json().catch(()=>null);
  if(!UUID.test(body?.id||""))return fail("A valid API-key ID is required.",400,errorId);
  const {auth,admin}=clients();
  const header=request.headers.get("authorization")||"";
  if(!header.startsWith("Bearer "))return fail("Authentication required.",401,errorId);
  const {data:{user},error:authError}=await auth.auth.getUser(header.slice(7));
  if(authError||!user)return fail("Your session is invalid or expired. Sign in again.",401,errorId);
  const {data:key,error:keyError}=await admin.from("api_keys").select("id,workspace_id").eq("id",body.id).maybeSingle();
  if(keyError)return fail("Unable to load the API key.",500,errorId);
  if(!key)return fail("API key not found.",404,errorId);
  const context=await authorize(request,key.workspace_id,errorId,true);if(context.response)return context.response;
  const {error}=await admin.from("api_keys").update({revoked_at:new Date().toISOString()}).eq("id",key.id).eq("workspace_id",key.workspace_id);
  if(error)return fail("Unable to revoke the API key.",500,errorId);
  return Response.json({ok:true},{headers:{"Cache-Control":"no-store"}});
 }catch(error){
  console.error("api_key_revoke_failure",{errorId,category:error?.message==="CONFIG"?"configuration":"internal"});
  return fail("Unable to revoke the API key. Contact support with error ID "+errorId+".",500,errorId);
 }
}
