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
export async function POST(request){
 const errorId=randomUUID();
 try{
  const header=request.headers.get("authorization")||"";
  if(!header.startsWith("Bearer "))return fail("Authentication required.",401,errorId);
  const {auth,admin}=clients();
  const {data:{user},error:authError}=await auth.auth.getUser(header.slice(7));
  if(authError||!user)return fail("Your session is invalid or expired. Sign in again.",401,errorId);
  const body=await request.json().catch(()=>null);
  const workspaceId=body?.workspace_id,clipId=body?.clip_id;
  if(!UUID.test(workspaceId||"")||!UUID.test(clipId||""))return fail("A valid workspace and clip are required.",400,errorId);
  const {data:member,error:memberError}=await admin.from("workspace_members").select("workspace_id").eq("workspace_id",workspaceId).eq("user_id",user.id).maybeSingle();
  if(memberError)return fail("Unable to verify workspace access.",500,errorId);
  if(!member)return fail("Workspace access denied.",403,errorId);
  const plan=await resolveWorkspacePlan(admin,workspaceId);
  const rate=await checkRateLimit(request,{endpoint:"ai_call",userId:user.id,plan});
  const blocked=rateLimitResponse(rate);if(blocked)return blocked;
  const {data:clip,error:clipError}=await admin.from("clips").select("id,title,start_seconds,end_seconds,score,project_id").eq("id",clipId).maybeSingle();
  if(clipError)return fail("Unable to load this clip.",500,errorId);
  if(!clip)return fail("Clip not found.",404,errorId);
  const {data:project,error:projectError}=await admin.from("projects").select("id,workspace_id").eq("id",clip.project_id).eq("workspace_id",workspaceId).maybeSingle();
  if(projectError)return fail("Unable to verify clip ownership.",500,errorId);
  if(!project)return fail("Clip not found in this workspace.",404,errorId);
  const baseline=Math.max(0,Math.min(1_000_000_000,Number(body.baseline_views)||0));
  const platform=String(body.platform||"unknown").slice(0,40);
  const {data:perf,error:perfError}=await admin.from("content_performance").select("views,likes,comments,shares,saves,retention,ctr")
    .eq("clip_id",clipId).order("captured_at",{ascending:false}).limit(20);
  if(perfError)return fail("Unable to load performance history.",500,errorId);
  const {data:scores,error:scoresError}=await admin.from("clip_scores").select("*").eq("clip_id",clipId).maybeSingle();
  if(scoresError)return fail("Unable to load clip scores.",500,errorId);
  const hist=(perf||[]).map(x=>Number(x.views)||0).filter(Boolean).sort((a,z)=>a-z);
  const median=hist.length?hist[Math.floor(hist.length/2)]:baseline;
  const quality=Math.max(1,Math.min(99,Number(clip.score)||50));
  const low=Math.round(Math.max(0,baseline*(0.55+quality/400)));
  const high=Math.round(Math.max(low,baseline*(1.15+quality/100)));
  const confidence=hist.length>=10?"medium":"low";
  const explanation={quality_score:quality,hook_score:scores?.hook_score??null,retention_signal:scores?.retention_signal??null,
    information_density:scores?.information_density??null,shareability:scores?.shareability_score??null,historical_samples:hist.length,
    historical_median:median,note:"This is an estimate, not a guarantee. Confidence increases as Alpha.ai receives more comparable published-performance data."};
  const {data:saved,error:savedError}=await admin.from("performance_predictions").insert({workspace_id:workspaceId,project_id:project.id,clip_id:clip.id,
    platform,baseline_views:baseline,predicted_low_views:low,predicted_high_views:high,relative_low:baseline?low/baseline:null,
    relative_high:baseline?high/baseline:null,confidence,model_version:"alpha-v1-baseline",
    input_features:{baseline_views:baseline,platform},explanation}).select("*").single();
  if(savedError)return fail("Unable to save the performance estimate.",500,errorId);
  return Response.json(saved,{headers:{"Cache-Control":"no-store"}});
 }catch(error){
  console.error("performance_analysis_failure",{errorId,category:error?.message==="CONFIG"?"configuration":"internal"});
  return fail("Performance analysis failed. Contact support with error ID "+errorId+".",500,errorId);
 }
}
