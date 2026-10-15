import {randomUUID} from "node:crypto";
import {createClient} from "@supabase/supabase-js";
import {UUID} from "../../../../lib/video-workflow.mjs";
import {checkRateLimit,rateLimitResponse,resolveWorkspacePlan} from "../../../../lib/rate-limit";

export const runtime="nodejs";
const failure=(message,status,errorId)=>Response.json({error:message,errorId},{status,headers:{"Cache-Control":"no-store"}});
function clients(){
  const url=process.env.SUPABASE_URL||process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const service=process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SECRET_KEY;
  if(!url||!anon||!service)throw new Error("CONFIG");
  const options={auth:{persistSession:false,autoRefreshToken:false}};
  return {auth:createClient(url,anon,options),admin:createClient(url,service,options)};
}
async function finishFeature(admin,usageId,succeeded){
  if(!usageId)return;
  await admin.rpc("finish_workspace_feature_usage",{p_usage_id:usageId,p_succeeded:succeeded}).then(({error})=>{if(error)throw error});
}
export async function POST(request){
  const errorId=randomUUID();
  let admin,usageId=null;
  try{
    const {auth,admin:service}=clients();admin=service;
    const header=request.headers.get("authorization")||"";
    if(!header.startsWith("Bearer "))return failure("Sign in to use this tool.",401,errorId);
    const {data:{user},error:authError}=await auth.auth.getUser(header.slice(7));
    if(authError||!user)return failure("Your session is invalid or expired. Sign in again.",401,errorId);
    const body=await request.json().catch(()=>null);
    if(!body||typeof body!=="object")return failure("Provide a valid tool request.",400,errorId);
    const tool=String(body.tool||"");
    const input=String(body.input||"").trim().slice(0,6000);
    if(!input)return failure("Add some content before generating ideas.",400,errorId);
    const prompts={
      hook:"Generate 10 short-form hooks for this content. Return a numbered list.",
      title:"Generate 10 short-form video titles. Return a numbered list.",
      caption:"Write 5 concise social captions for this content.",
      ideas:"Give 8 distinct short-form clip ideas from this content, each with a hook angle.",
      podcast:"Create a podcast-to-shorts plan with 8 clip angles and suggested durations.",
      cover_rotation:"Suggest one alternate cover concept for this content. Return a concise title, visual direction, and text overlay."
    };
    if(!Object.hasOwn(prompts,tool))return failure("Choose a supported generation tool.",400,errorId);
    const requestedWorkspace=body.workspace_id||body.workspaceId||null;
    if(requestedWorkspace&&!UUID.test(String(requestedWorkspace)))return failure("A valid workspace is required.",400,errorId);
    let membershipQuery=admin.from("workspace_members").select("workspace_id").eq("user_id",user.id).limit(1);
    if(requestedWorkspace)membershipQuery=admin.from("workspace_members").select("workspace_id").eq("user_id",user.id).eq("workspace_id",requestedWorkspace).limit(1);
    const {data:members,error:memberError}=await membershipQuery;
    if(memberError)return failure("Unable to verify workspace access. Please retry.",500,errorId);
    const workspaceId=members?.[0]?.workspace_id;
    if(!workspaceId)return failure("Workspace access denied. Select a workspace you belong to.",403,errorId);
    const plan=await resolveWorkspacePlan(admin,workspaceId);
    const rate=await checkRateLimit(request,{endpoint:"ai_call",userId:user.id,plan});
    const blocked=rateLimitResponse(rate);if(blocked)return blocked;
    if(tool==="title"||tool==="cover_rotation"){
      const suppliedId=request.headers.get("idempotency-key")||body.requestId||"";
      const requestId=String(suppliedId||"").trim()||randomUUID();
      if(requestId.length>200)return failure("The request identifier is invalid.",400,errorId);
      const featureKey=tool==="title"?"title_regeneration":"cover_rotation";
      const {data:reservation,error:reserveError}=await admin.rpc("reserve_workspace_feature_usage",{
        p_workspace_id:workspaceId,p_user_id:user.id,p_feature_key:featureKey,p_timezone:String(body.timezone||"Asia/Kolkata"),p_request_id:requestId
      });
      if(reserveError)return failure("Usage limits could not be checked. Please retry.",503,errorId);
      if(!reservation?.allowed)return failure(tool==="title"?"Your plan's daily title-generation limit has been reached. Upgrade your plan to continue.":"Your plan's daily cover-rotation limit has been reached. Upgrade your plan to continue.",429,errorId);
      if(reservation.duplicate){
        const state=String(reservation.status||"reserved");
        return failure(state==="completed"?"This request was already completed. Use a new request ID to generate another result.":"This request is already being processed. Wait for it to finish before retrying.",409,errorId);
      }
      usageId=reservation.usageId||null;
    }
    const worker=(process.env.MEDIA_WORKER_URL||"https://alpha-ai-media-worker.onrender.com").replace(/\/$/,"");
    const secret=process.env.MEDIA_WORKER_SECRET||"";
    if(!secret){if(usageId)await finishFeature(admin,usageId,false);usageId=null;return failure("AI processing is not configured yet. Please try again later.",503,errorId);}
    const response=await fetch(worker+"/assistant",{
      method:"POST",headers:{"content-type":"application/json","x-worker-secret":secret},
      body:JSON.stringify({prompt:prompts[tool],context:"Authenticated Alpha.ai tool: "+tool+"\nUser content:\n"+input}),
      signal:AbortSignal.timeout(25000),cache:"no-store"
    });
    const result=await response.json().catch(()=>({}));
    if(!response.ok){
      if(usageId)await finishFeature(admin,usageId,false);
      usageId=null;
      const status=response.status===429||response.status===503?503:502;
      return failure(status===503?"AI providers are temporarily unavailable. Your usage has been restored; please retry later.":"The tool could not complete this request. Contact support with error ID "+errorId+".",status,errorId);
    }
    if(usageId){await finishFeature(admin,usageId,true);usageId=null;}
    return Response.json({ok:true,text:String(result.text||"").slice(0,20000)},{headers:{"Cache-Control":"no-store"}});
  }catch(error){
    if(usageId&&admin)await finishFeature(admin,usageId,false).catch(()=>{});
    console.error("tool_generation_failure",{errorId,category:error?.message==="CONFIG"?"configuration":"internal"});
    return failure("The tool could not complete this request. Contact support with error ID "+errorId+".",500,errorId);
  }
}
