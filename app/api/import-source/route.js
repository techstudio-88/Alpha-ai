import {createClient} from "@supabase/supabase-js";
import {randomUUID} from "node:crypto";
import {checkRateLimit,rateLimitResponse,resolveWorkspacePlan} from "../../../lib/rate-limit";

export const runtime="nodejs";
export const maxDuration=50;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function fail(message,status,errorId=randomUUID()) {
  return Response.json({error:message,errorId},{status,headers:{"Cache-Control":"no-store"}});
}
async function callWorker(worker,ticket,payload){
  let lastStatus=0;
  for(let attempt=0;attempt<4;attempt++){
    const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),12000);
    try{
      const response=await fetch(worker.replace(/\\/$/,"")+"/process",{
        method:"POST",
        headers:{"content-type":"application/json","x-import-ticket":ticket},
        body:JSON.stringify(payload),signal:controller.signal,cache:"no-store"
      });
      if(response.ok)return {ok:true};
      lastStatus=response.status;
      if([401,403,404].includes(response.status))return {ok:false,status:response.status};
    }catch(error){lastStatus=error?.name==="AbortError"?504:502}
    finally{clearTimeout(timer)}
    if(attempt<3)await sleep(750*(attempt+1));
  }
  return {ok:false,status:lastStatus||502};
}
export async function POST(request){
  const errorId=randomUUID();
  try{
    const ticket=request.headers.get("x-import-ticket")||"";
    const body=await request.json();
    const {url,sourceType,workspaceId,projectId,sourceId,jobId,mediaAssetId,rightsConfirmed}=body||{};
    if(!ticket)return fail("Processing authorization is required.",401,errorId);
    if(!UUID.test(workspaceId||"")||!UUID.test(projectId||"")||!UUID.test(jobId||""))
      return fail("A valid workspace, project and job are required.",400,errorId);
    for(const [label,value] of [["source",sourceId],["video",mediaAssetId]])
      if(value!=null&&value!==""&&!UUID.test(value))return fail("The "+label+" identifier is invalid.",400,errorId);
    if(url&&!rightsConfirmed)return fail("Confirm that you own or have rights to this content before importing a URL.",403,errorId);
    const supabaseUrl=process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SECRET_KEY;
    if(!supabaseUrl||!serviceKey)return fail("The service is temporarily unavailable. Please try again later.",503,errorId);
    const verifier=createClient(supabaseUrl,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
    const {data:rows,error:ticketError}=await verifier.rpc("validate_processing_ticket",{p_ticket:ticket});
    const valid=rows?.[0];
    if(ticketError||!valid)return fail("Processing authorization is invalid or expired.",401,errorId);
    if(valid.workspace_id!==workspaceId||valid.project_id!==projectId||String(valid.job_id)!==String(jobId)||
      String(valid.source_id||"")!==String(sourceId||"")||String(valid.media_asset_id||"")!==String(mediaAssetId||""))
      return fail("Processing authorization does not match this job.",403,errorId);
    const plan=await resolveWorkspacePlan(verifier,workspaceId);
    const rate=await checkRateLimit(request,{endpoint:"link_fetch",userId:valid.user_id,plan});
    const blocked=rateLimitResponse(rate);if(blocked)return blocked;
    const worker=process.env.MEDIA_WORKER_URL||"https://alpha-ai-media-worker.onrender.com";
    const result=await callWorker(worker,ticket,{url:url||null,sourceType:sourceType||"upload",workspaceId,projectId,
      sourceId:sourceId||null,jobId,mediaAssetId:mediaAssetId||null,requestedBy:valid.user_id,
      rightsConfirmed:Boolean(rightsConfirmed)});
    if(!result.ok){
      const status=[401,403].includes(result.status)?result.status:502;
      return fail(status===401||status===403?"The media worker rejected this processing request.":"Your job is saved, but the media worker has not acknowledged it yet. Please retry shortly.",status,errorId);
    }
    return Response.json({ok:true,jobId},{headers:{"Cache-Control":"no-store"}});
  }catch(error){
    console.error("import_source_failure",{errorId,category:error?.name==="AbortError"?"timeout":"internal"});
    return fail("We couldn't start video processing. Please retry using the same project.",500,errorId);
  }
}
