import {randomUUID} from "node:crypto";
import {createClient} from "@supabase/supabase-js";
import {authorizeWorkflow,enforceApiRateLimit,reserveWorkspaceFeatureUsage,finishWorkspaceFeatureUsage,problem,workflowError} from "../../../../lib/workflow-server";

const db=()=>createClient(process.env.SUPABASE_URL||process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SECRET_KEY,{auth:{persistSession:false}});
const prompts={
  hook:"Generate 10 short-form hooks for this content. Return a numbered list.",
  title:"Generate 10 short-form video titles. Return a numbered list.",
  caption:"Write 5 concise social captions for this content.",
  ideas:"Give 8 distinct short-form clip ideas from this content, each with a hook angle.",
  podcast:"Create a podcast-to-shorts plan with 8 clip angles and suggested durations."
};
export async function POST(request){
  let admin=null,usageId=null;
  try{
    const body=await request.json();
    const tool=String(body.tool||"");
    const input=String(body.input||"").slice(0,6000);
    if(!input)return Response.json({error:"Input required"},{status:400});
    const prompt=prompts[tool]||prompts.ideas;
    const workspaceId=body.workspaceId||body.workspace_id||null;
    const authHeader=request.headers.get("authorization")||"";
    if(authHeader.startsWith("Bearer ")){
      if(!workspaceId)throw problem("workspaceId is required for authenticated tool usage.",400);
      const access=await authorizeWorkflow(request,workspaceId);
      admin=access.admin;
      if(tool==="title"||tool==="cover"||tool==="thumbnail"){
        const featureKey=tool==="title"?"title_regeneration":"cover_rotation";
        const requestId=String(body.request_id||body.idempotency_key||randomUUID());
        const reservation=await reserveWorkspaceFeatureUsage(admin,workspaceId,access.user.id,featureKey,requestId,String(body.timezone||"Asia/Kolkata"));
        usageId=reservation.usageId||null;
      }
    }else{
      const ip=request.headers.get("x-real-ip")||request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()||"unknown";
      await enforceApiRateLimit(db(),"anonymous:"+ip,"/api/tools/generate",20,60,ip);
    }
    const worker=(process.env.MEDIA_WORKER_URL||"https://alpha-ai-media-worker.onrender.com").replace(/\/$/,"");
    const response=await fetch(worker+"/assistant",{
      method:"POST",
      headers:{"content-type":"application/json","x-worker-secret":process.env.MEDIA_WORKER_SECRET||""},
      body:JSON.stringify({prompt,context:input}),
      signal:AbortSignal.timeout(20000)
    });
    if(!response.ok)throw Object.assign(new Error("AI provider is temporarily unavailable. Please retry shortly."),{status:503});
    const result=await response.json();
    if(usageId)await finishWorkspaceFeatureUsage(admin,usageId,true);
    return Response.json({ok:true,text:String(result.text||"").slice(0,16000)});
  }catch(error){
    if(usageId&&admin)await finishWorkspaceFeatureUsage(admin,usageId,false).catch(()=>{});
    return workflowError(error);
  }
}
