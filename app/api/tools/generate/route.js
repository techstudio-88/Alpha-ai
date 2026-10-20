import {randomUUID} from "node:crypto";
import {createClient} from "@supabase/supabase-js";
import {authorizeWorkflow,enforceApiRateLimit,reserveWorkspaceFeatureUsage,finishWorkspaceFeatureUsage,workflowError,problem} from "../../../../lib/workflow-server";

const db=()=>createClient(process.env.SUPABASE_URL||process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SECRET_KEY,{auth:{persistSession:false}});
const prompts={
  hook:"Generate 10 short-form hooks for this content. Return a numbered list.",
  title:"Generate 10 short-form video titles. Return a numbered list.",
  caption:"Write 5 concise social captions for this content.",
  ideas:"Give 8 distinct short-form clip ideas from this content, each with a hook angle.",
  podcast:"Create a podcast-to-shorts plan with 8 clip angles and suggested durations.",
  cover:"Generate five distinct thumbnail cover concepts with visual hierarchy, short overlay text, and a reason each would attract attention.",
  thumbnail:"Generate five distinct thumbnail cover concepts with visual hierarchy, short overlay text, and a reason each would attract attention."
};
export async function POST(request){
  let admin=null,usageId=null;
  try{
    const body=await request.json().catch(()=>null);
    if(!body||typeof body!=="object"||Array.isArray(body))throw problem("Send a valid JSON request.",400);
    const tool=String(body.tool||"");
    if(!Object.hasOwn(prompts,tool))throw problem("Choose a supported generation tool.",400);
    const input=typeof body.input==="string"?body.input.trim().slice(0,6000):"";
    if(!input)throw problem("Input required.",400);
    const workspaceId=body.workspaceId||body.workspace_id||null;
    const authHeader=request.headers.get("authorization")||"";
    if(authHeader.startsWith("Bearer ")){
      if(!workspaceId)throw problem("workspaceId is required for authenticated tool usage.",400);
      const access=await authorizeWorkflow(request,workspaceId);
      admin=access.admin;
      if(tool==="title"||tool==="cover"||tool==="thumbnail"){
        const featureKey=tool==="title"?"title_regeneration":"cover_rotation";
        const requestId=String(body.request_id||body.idempotency_key||randomUUID()).slice(0,200);
        const reservation=await reserveWorkspaceFeatureUsage(admin,workspaceId,access.user.id,featureKey,requestId,String(body.timezone||"Asia/Kolkata"));
        usageId=reservation.usageId||null;
      }
    }else{
      const ip=request.headers.get("x-real-ip")||request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()||"unknown";
      await enforceApiRateLimit(db(),"anonymous:"+ip,"/api/tools/generate",20,60,ip);
    }
    const configuredWorker=process.env.MEDIA_WORKER_URL||process.env.WORKER_URL;
    if(!configuredWorker)throw problem("AI generation is not configured yet. Set MEDIA_WORKER_URL in the server environment and retry.",503);
    let workerUrl;
    try{workerUrl=new URL(configuredWorker)}catch{throw problem("AI generation service configuration is invalid. Contact support with error ID AI_WORKER_CONFIG.",503)}
    if(workerUrl.protocol!=="https:"&&workerUrl.hostname!=="localhost"&&workerUrl.hostname!=="127.0.0.1")throw problem("AI generation service configuration is invalid. Contact support with error ID AI_WORKER_CONFIG.",503);
    const response=await fetch(new URL("/assistant",workerUrl),{
      method:"POST",
      headers:{"content-type":"application/json",...(process.env.MEDIA_WORKER_SECRET?{"x-worker-secret":process.env.MEDIA_WORKER_SECRET}:{})},
      body:JSON.stringify({prompt:prompts[tool],context:input}),
      signal:AbortSignal.timeout(20000),
      cache:"no-store"
    });
    if(!response.ok)throw problem("AI generation is temporarily unavailable. Please retry shortly.",503);
    const result=await response.json().catch(()=>null);
    if(!result||typeof result.text!=="string"||!result.text.trim())throw problem("AI generation returned an empty response. Please retry.",502);
    if(usageId)await finishWorkspaceFeatureUsage(admin,usageId,true);
    return Response.json({ok:true,text:result.text.slice(0,16000)},{headers:{"Cache-Control":"no-store"}});
  }catch(error){
    if(usageId&&admin)await finishWorkspaceFeatureUsage(admin,usageId,false).catch(()=>{});
    return workflowError(error);
  }
}
