import {createClient} from "@supabase/supabase-js";
import {randomUUID} from "node:crypto";
import {UUID} from "../../../../../lib/video-workflow.mjs";
import {checkRateLimit,rateLimitResponse,resolveWorkspacePlan} from "../../../../../lib/rate-limit";

export const runtime="nodejs";
const fail=(error,status,errorId)=>Response.json({error,errorId},{status,headers:{"Cache-Control":"no-store"}});
function clients(){
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL||process.env.SUPABASE_URL;
  const anon=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY||process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const service=process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SECRET_KEY;
  if(!url||!anon||!service)throw new Error("CONFIG");
  return {url,auth:createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false}}),
    admin:createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}})};
}
async function authenticated(req){
  const header=req.headers.get("authorization")||"";
  if(!header.startsWith("Bearer "))return null;
  const {auth}=clients();
  const {data,error}=await auth.auth.getUser(header.slice(7));
  return error?null:data.user||null;
}
async function authorizedClip(req,clipId,endpoint){
  if(!UUID.test(clipId||""))return {response:fail("A valid clip is required.",400,randomUUID())};
  const user=await authenticated(req);
  if(!user)return {response:fail("Authentication required.",401,randomUUID())};
  const {admin}=clients();
  const {data:clip,error:clipError}=await admin.from("clips").select("id,title,project_id,media_asset_id,start_seconds,end_seconds,ai_spec").eq("id",clipId).maybeSingle();
  if(clipError)return {response:fail("Unable to load this clip.",500,randomUUID())};
  if(!clip)return {response:fail("Clip not found.",404,randomUUID())};
  const {data:project,error:projectError}=await admin.from("projects").select("workspace_id").eq("id",clip.project_id).maybeSingle();
  if(projectError)return {response:fail("Unable to verify this project.",500,randomUUID())};
  if(!project)return {response:fail("Project not found.",404,randomUUID())};
  const {data:member,error:memberError}=await admin.from("workspace_members").select("role").eq("workspace_id",project.workspace_id).eq("user_id",user.id).maybeSingle();
  if(memberError)return {response:fail("Unable to verify workspace access.",500,randomUUID())};
  if(!member)return {response:fail("Workspace access denied.",403,randomUUID())};
  const plan=await resolveWorkspacePlan(admin,project.workspace_id);
  const rate=await checkRateLimit(req,{endpoint,userId:user.id,plan});
  const blocked=rateLimitResponse(rate);
  if(blocked)return {response:blocked};
  return {user,admin,clip,project,plan};
}
export async function GET(req,{params}){
  const errorId=randomUUID();
  try{
    const {clipId}=await params;
    const result=await authorizedClip(req,clipId,"api");
    if(result.response)return result.response;
    const {admin,clip}=result;
    const {data,error}=await admin.from("clip_repurpose_assets").select("*").eq("clip_id",clip.id).maybeSingle();
    if(error)return fail("Unable to load repurposing assets.",500,errorId);
    return Response.json({asset:data||null},{headers:{"Cache-Control":"no-store"}});
  }catch(error){
    console.error("clip_repurpose_read_failure",{errorId,category:error?.message==="CONFIG"?"configuration":"internal"});
    return fail("Unable to load repurposing assets. Contact support with error ID "+errorId+".",500,errorId);
  }
}
export async function POST(req,{params}){
  const errorId=randomUUID();
  try{
    const {clipId}=await params;
    const result=await authorizedClip(req,clipId,"ai_call");
    if(result.response)return result.response;
    const {admin,clip,project}=result;
    const {data:transcript}=await admin.from("transcripts").select("id").eq("media_asset_id",clip.media_asset_id).order("created_at",{ascending:false}).limit(1).maybeSingle();
    let text="";
    if(transcript?.id){
      const {data:segments,error}=await admin.from("transcript_segments").select("start_ms,end_ms,text").eq("transcript_id",transcript.id)
        .lt("start_ms",Math.round(Number(clip.end_seconds)*1000)).gt("end_ms",Math.round(Number(clip.start_seconds)*1000))
        .order("start_ms",{ascending:true}).limit(300);
      if(error)return fail("Unable to read the clip transcript.",500,errorId);
      text=(segments||[]).map(row=>row.text).join(" ").trim();
    }
    if(!text)text=String(clip.ai_spec?.summary||"").trim();
    if(!text)return fail("No transcript context is available for this clip.",409,errorId);
    const worker=(process.env.MEDIA_WORKER_URL||"https://alpha-ai-media-worker.onrender.com").replace(/\/$/,"");
    const secret=process.env.MEDIA_WORKER_SECRET||"";
    if(!secret)return fail("AI worker is not configured.",503,errorId);
    const prompt="Create repurposing assets for this real short-form clip. Return ONLY valid JSON with keys hook,title,caption,hashtags,youtube_description,instagram_caption,tiktok_caption,linkedin_caption,thumbnail_prompt. Do not invent facts. Make the hook strong but faithful to the transcript. 5-10 hashtags. Clip title: "+JSON.stringify(clip.title||"")+"\nTranscript:\n"+text.slice(0,12000);
    const response=await fetch(worker+"/assistant",{method:"POST",headers:{"content-type":"application/json","x-worker-secret":secret},
      body:JSON.stringify({prompt,context:"Alpha.ai clip repurposing request"}),signal:AbortSignal.timeout(20000),cache:"no-store"});
    const workerResult=await response.json().catch(()=>({}));
    if(!response.ok)return fail(response.status===503?"AI providers are temporarily unavailable. Please retry later.":"Repurposing failed. Contact support with error ID "+errorId+".",response.status===503?503:502,errorId);
    const raw=String(workerResult.text||"").match(/\{[\s\S]*\}/)?.[0];
    if(!raw)return fail("The assistant returned an invalid repurposing package.",502,errorId);
    const data=JSON.parse(raw);
    const row={workspace_id:project.workspace_id,clip_id:clip.id,hook:String(data.hook||"").slice(0,500),
      title:String(data.title||clip.title||"").slice(0,180),caption:String(data.caption||"").slice(0,3000),
      social_copy:{youtube:String(data.youtube_description||"").slice(0,5000),instagram:String(data.instagram_caption||"").slice(0,3000),
        tiktok:String(data.tiktok_caption||"").slice(0,3000),linkedin:String(data.linkedin_caption||"").slice(0,3000)},
      hashtags:Array.isArray(data.hashtags)?data.hashtags.slice(0,15):[],thumbnail_prompt:String(data.thumbnail_prompt||"").slice(0,2000),
      model_version:process.env.GEMINI_MODEL||"worker"};
    const {data:saved,error}=await admin.from("clip_repurpose_assets").upsert(row,{onConflict:"clip_id"}).select("*").single();
    if(error)return fail("The repurposing package could not be saved. Contact support with error ID "+errorId+".",500,errorId);
    return Response.json({ok:true,asset:saved},{headers:{"Cache-Control":"no-store"}});
  }catch(error){
    console.error("clip_repurpose_failure",{errorId,category:error?.message==="CONFIG"?"configuration":"internal"});
    return fail("Repurposing failed. Contact support with error ID "+errorId+".",500,errorId);
  }
}
