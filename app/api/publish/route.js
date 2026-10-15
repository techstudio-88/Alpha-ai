import {createClient} from "@supabase/supabase-js";
import {createHash,randomUUID} from "node:crypto";
import {checkRateLimit,rateLimitResponse,resolveWorkspacePlan} from "../../../lib/rate-limit";
import {UUID} from "../../../lib/video-workflow.mjs";
export const runtime="nodejs";
const fail=(error,status,errorId)=>Response.json({error,errorId},{status,headers:{"Cache-Control":"no-store"}});
const options={auth:{persistSession:false,autoRefreshToken:false}};
function clients(){
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL||process.env.SUPABASE_URL;
  const publicKey=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const secret=process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SECRET_KEY;
  if(!url||!publicKey||!secret)throw new Error("CONFIG");
  return {url,auth:createClient(url,publicKey,options),admin:createClient(url,secret,options)};
}
async function authenticated(request){
  const h=request.headers.get("authorization")||"";
  if(!h.startsWith("Bearer "))return null;
  const {auth}=clients();
  const {data,error}=await auth.auth.getUser(h.slice(7));
  return error?null:data.user||null;
}
function stableId(value){return "publish:"+createHash("sha256").update(JSON.stringify(value)).digest("hex")}
export async function POST(request){
  const errorId=randomUUID();
  try{
    const u=await authenticated(request);if(!u)return fail("Your session is invalid or expired. Sign in again.",401,errorId);
    const b=await request.json().catch(()=>({}));
    if(!UUID.test(b.clip_id||""))return fail("A valid clip is required.",400,errorId);
    const platform=String(b.platform||"").toLowerCase();
    if(platform!=="youtube")return fail("YouTube publishing is currently the only configured provider.",400,errorId);
    const {admin}=clients();
    const {data:clip,error:clipError}=await admin.from("clips").select("id,project_id").eq("id",b.clip_id).maybeSingle();
    if(clipError)return fail("Unable to verify this clip.",500,errorId);
    if(!clip)return fail("Clip not found.",404,errorId);
    const {data:project,error:projectError}=await admin.from("projects").select("workspace_id").eq("id",clip.project_id).maybeSingle();
    if(projectError)return fail("Unable to verify this project.",500,errorId);
    if(!project)return fail("Project not found.",404,errorId);
    const {data:member,error:memberError}=await admin.from("workspace_members").select("role")
      .eq("workspace_id",project.workspace_id).eq("user_id",u.id).maybeSingle();
    if(memberError)return fail("Unable to verify workspace access.",500,errorId);
    if(!member)return fail("Workspace access denied.",403,errorId);
    const {data:entitlement,error:entitlementError}=await admin.from("workspace_entitlements")
      .select("plan,auto_publish,scheduling_enabled").eq("workspace_id",project.workspace_id).maybeSingle();
    if(entitlementError)return fail("Unable to verify plan entitlements.",500,errorId);
    const plan=await resolveWorkspacePlan(admin,project.workspace_id);
    const rate=await checkRateLimit(request,{endpoint:"api",userId:u.id,plan});
    const blocked=rateLimitResponse(rate);if(blocked)return blocked;
    const scheduledFor=b.scheduled_for?new Date(b.scheduled_for):new Date();
    if(!Number.isFinite(scheduledFor.getTime()))return fail("Choose a valid publishing time.",400,errorId);
    const isScheduled=scheduledFor.getTime()>Date.now()+60_000;
    const autoPublish=b.auto_publish===true;
    if(autoPublish&&!entitlement?.auto_publish)return fail("Automatic publishing requires Pro or Studio. Upgrade to enable it.",403,errorId);
    if(isScheduled&&!entitlement?.scheduling_enabled)return fail("Scheduled publishing requires the Studio plan. Upgrade or choose Publish now.",403,errorId);
    const metadata={title:String(b.title||"").slice(0,100),description:String(b.description||"").slice(0,5000),
      privacy:["private","unlisted","public"].includes(b.privacy)?b.privacy:"private",auto_publish:autoPublish};
    const idempotencyKey=String(b.idempotency_key||stableId({workspaceId:project.workspace_id,clipId:clip.id,platform,scheduledFor:scheduledFor.toISOString(),metadata}));
    if(idempotencyKey.length>200)return fail("The publish request ID is too long.",400,errorId);
    const row={workspace_id:project.workspace_id,user_id:u.id,clip_id:clip.id,platform,status:"queued",
      scheduled_for:scheduledFor.toISOString(),metadata,idempotency_key:idempotencyKey};
    const {data:created,error:createError}=await admin.from("publish_jobs").upsert(row,{onConflict:"idempotency_key",ignoreDuplicates:true}).select("*").maybeSingle();
    if(createError)return fail("The publishing job could not be saved. Please retry.",500,errorId);
    if(created)return Response.json(created,{headers:{"Cache-Control":"no-store"}});
    const {data:existing,error:existingError}=await admin.from("publish_jobs").select("*").eq("idempotency_key",idempotencyKey).maybeSingle();
    if(existingError||!existing)return fail("The publishing job could not be confirmed. Retry with the same request.",500,errorId);
    if(existing.user_id!==u.id||existing.workspace_id!==project.workspace_id)return fail("This publish request ID is already used.",409,errorId);
    return Response.json(existing,{headers:{"Cache-Control":"no-store"}});
  }catch(error){
    console.error("publish_request_failure",{errorId,category:error?.message==="CONFIG"?"configuration":"internal"});
    return fail("The publishing request could not be completed. Contact support with the error ID.",500,errorId);
  }
}
export async function GET(request){
  const errorId=randomUUID();
  try{
    const u=await authenticated(request);if(!u)return fail("Your session is invalid or expired. Sign in again.",401,errorId);
    const {admin}=clients();
    const {data,error}=await admin.from("publish_jobs").select("id,workspace_id,user_id,clip_id,platform,status,scheduled_for,external_id,error,error_id,failure_type,created_at,updated_at,published_at")
      .eq("user_id",u.id).order("created_at",{ascending:false}).limit(100);
    if(error)return fail("Unable to load publishing history.",500,errorId);
    return Response.json(data||[],{headers:{"Cache-Control":"no-store"}});
  }catch(error){
    console.error("publish_history_failure",{errorId,category:error?.message==="CONFIG"?"configuration":"internal"});
    return fail("Unable to load publishing history. Contact support with the error ID.",500,errorId);
  }
}
