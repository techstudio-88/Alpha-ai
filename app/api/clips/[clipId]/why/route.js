import {createClient} from "@supabase/supabase-js";
import {randomUUID} from "node:crypto";
import {UUID} from "../../../../lib/video-workflow.mjs";
import {checkRateLimit,rateLimitResponse,resolveWorkspacePlan} from "../../../../lib/rate-limit";
export const runtime="nodejs";
const fail=(error,status,errorId)=>Response.json({error,errorId},{status,headers:{"Cache-Control":"no-store"}});
export async function GET(request,{params}){
 const errorId=randomUUID();
 try{
  const header=request.headers.get("authorization")||"";
  if(!header.startsWith("Bearer "))return fail("Authentication required.",401,errorId);
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL||process.env.SUPABASE_URL;
  const anon=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const secret=process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SECRET_KEY;
  if(!url||!anon||!secret)return fail("Clip analysis is temporarily unavailable.",503,errorId);
  const options={auth:{persistSession:false,autoRefreshToken:false}};
  const auth=createClient(url,anon,options),admin=createClient(url,secret,options);
  const {data:{user},error:authError}=await auth.auth.getUser(header.slice(7));
  if(authError||!user)return fail("Your session is invalid or expired. Sign in again.",401,errorId);
  const {clipId}=await params;
  if(!UUID.test(clipId||""))return fail("A valid clip is required.",400,errorId);
  const {data:clip,error:clipError}=await admin.from("clips").select("id,title,project_id,score,ai_spec,start_seconds,end_seconds").eq("id",clipId).maybeSingle();
  if(clipError)return fail("Unable to load clip analysis.",500,errorId);
  if(!clip)return fail("Clip not found.",404,errorId);
  const {data:project,error:projectError}=await admin.from("projects").select("workspace_id").eq("id",clip.project_id).maybeSingle();
  if(projectError)return fail("Unable to verify clip access.",500,errorId);
  const {data:member,error:memberError}=project?await admin.from("workspace_members").select("role").eq("workspace_id",project.workspace_id).eq("user_id",user.id).maybeSingle():{data:null,error:null};
  if(memberError)return fail("Unable to verify clip access.",500,errorId);
  if(!member)return fail("Workspace access denied.",403,errorId);
  const plan=await resolveWorkspacePlan(admin,project.workspace_id);
  const rate=await checkRateLimit(request,{endpoint:"api",userId:user.id,plan});
  const blocked=rateLimitResponse(rate);if(blocked)return blocked;
  const {data:score,error:scoreError}=await admin.from("clip_scores").select("*").eq("clip_id",clipId).order("id",{ascending:false}).limit(1).maybeSingle();
  if(scoreError)return fail("Unable to load clip analysis.",500,errorId);
  const s=score||{};
  const signals=[["Hook strength",s.hook_score],["Information density",s.information_density],["Story completeness",s.story_completeness],["Audience relevance",s.audience_relevance],["Retention signal",s.retention_signal],["Shareability",s.shareability_score]].filter(([,value])=>value!=null).map(([name,value])=>({name,value:Number(value)})).sort((a,b)=>b.value-a.value);
  const reasons=[];
  if(signals[0])reasons.push(signals[0].name+" is the strongest recorded signal at "+Math.round(signals[0].value)+"/100.");
  if(s.reason)reasons.push(String(s.reason));
  if(s.recommended_duration_seconds)reasons.push("The model recommended about "+Math.round(Number(s.recommended_duration_seconds))+" seconds.");
  if(!reasons.length)reasons.push("This clip does not have detailed scoring metadata yet.");
  return Response.json({clip,score:s,signals,reasons},{headers:{"Cache-Control":"no-store"}});
 }catch{
  console.error("clip_analysis_failure",{errorId,category:"internal"});
  return fail("Unable to load clip analysis. Contact support with error ID "+errorId+".",500,errorId);
 }
}
