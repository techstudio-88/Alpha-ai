import crypto from "node:crypto";
import {createClient} from "@supabase/supabase-js";
import {UUID} from "../../../../../../../lib/video-workflow.mjs";
import {checkRateLimit,rateLimitResponse,resolveWorkspacePlan} from "../../../../../../../lib/rate-limit";

export const runtime="nodejs";
const fail=(error,status,errorId)=>Response.json({error,errorId},{status,headers:{"Cache-Control":"no-store"}});
function client(){
 const url=process.env.SUPABASE_URL||process.env.NEXT_PUBLIC_SUPABASE_URL;
 const secret=process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SECRET_KEY;
 if(!url||!secret)throw new Error("CONFIG");
 return createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});
}
async function authenticateApiKey(request,admin){
 const raw=(request.headers.get("x-api-key")||"").trim();
 if(!raw)return null;
 const hash=crypto.createHash("sha256").update(raw).digest("hex");
 const {data,error}=await admin.from("api_keys").select("id,workspace_id").eq("key_hash",hash).is("revoked_at",null).maybeSingle();
 if(error)throw new Error("DB");
 if(data)await admin.from("api_keys").update({last_used_at:new Date().toISOString()}).eq("id",data.id);
 return data||null;
}
export async function GET(request,{params}){
 const errorId=crypto.randomUUID();
 try{
  const {projectId}=await params;
  if(!UUID.test(projectId||""))return fail("A valid project is required.",400,errorId);
  const admin=client();
  const key=await authenticateApiKey(request,admin);
  if(!key)return fail("A valid API key is required.",401,errorId);
  const plan=await resolveWorkspacePlan(admin,key.workspace_id);
  const rate=await checkRateLimit(request,{endpoint:"api",userId:key.id,plan});
  const blocked=rateLimitResponse(rate);if(blocked)return blocked;
  const {data:project,error:projectError}=await admin.from("projects").select("id,workspace_id")
    .eq("id",projectId).eq("workspace_id",key.workspace_id).maybeSingle();
  if(projectError)return fail("Unable to load this project.",500,errorId);
  if(!project)return fail("Project not found.",404,errorId);
  const {data:clips,error}=await admin.from("clips").select("id,title,start_seconds,end_seconds,score,status,created_at")
    .eq("project_id",projectId).order("score",{ascending:false}).limit(100);
  if(error)return fail("Unable to load project clips.",500,errorId);
  return Response.json({project_id:projectId,clips:data||[]},{headers:{"Cache-Control":"no-store"}});
 }catch(error){
  console.error("public_api_clips_failure",{errorId,category:error?.message==="CONFIG"?"configuration":"internal"});
  return fail("Unable to load project clips. Contact support with error ID "+errorId+".",500,errorId);
 }
}
