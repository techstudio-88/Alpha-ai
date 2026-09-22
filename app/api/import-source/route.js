import{createClient}from"@supabase/supabase-js";
export const runtime="nodejs";
export const maxDuration=50;
const supabaseUrl=process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SECRET_KEY;
const sleep=(ms)=>new Promise((resolve)=>setTimeout(resolve,ms));
async function callWorker(worker,ticket,payload){
  let lastError=null;
  for(let attempt=0;attempt<4;attempt++){
    const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),12000);
    try{
      const response=await fetch(worker.replace(/\/$/,"")+"/process",{method:"POST",headers:{"content-type":"application/json","x-import-ticket":ticket||""},body:JSON.stringify(payload),signal:controller.signal,cache:"no-store"});
      const result=await response.json().catch(()=>({}));
      if(response.ok)return{response,result};
      if(response.status===401||response.status===403||response.status===404)return{response,result};
      lastError=new Error(result.error||`Media worker returned HTTP ${response.status}`);
    }catch(error){lastError=error}finally{clearTimeout(timer)}
    if(attempt<3)await sleep(750);
  }
  throw lastError||new Error("Media worker did not respond.");
}
export async function POST(request){
  try{
    const ticket=request.headers.get("x-import-ticket")||"";
    const body=await request.json();const{url,sourceType,workspaceId,projectId,sourceId,jobId,mediaAssetId}=body||{};
    if(!ticket)return Response.json({error:"Processing ticket is required."},{status:401});
    if(!workspaceId||!projectId||!jobId)return Response.json({error:"Missing processing job context."},{status:400});
    if(!supabaseUrl||!serviceKey)return Response.json({error:"Supabase server credentials are not configured."},{status:503});
    const verifier=createClient(supabaseUrl,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
    const{data:rows,error:ticketError}=await verifier.rpc("validate_processing_ticket",{p_ticket:ticket});
    const valid=rows?.[0];
    if(ticketError||!valid)return Response.json({error:"Invalid or expired processing ticket."},{status:401});
    if(valid.workspace_id!==workspaceId||valid.project_id!==projectId||String(valid.job_id)!==String(jobId)||String(valid.source_id||"")!==String(sourceId||"")||String(valid.media_asset_id||"")!==String(mediaAssetId||""))return Response.json({error:"Processing ticket context mismatch."},{status:401});
    const worker=process.env.MEDIA_WORKER_URL||"https://alpha-ai-media-worker.onrender.com";
    const{response,result}=await callWorker(worker,ticket,{url:url||null,sourceType:sourceType||"upload",workspaceId,projectId,sourceId:sourceId||null,jobId,mediaAssetId:mediaAssetId||null,requestedBy:valid.user_id});
    if(!response.ok)return Response.json({error:result.error||"Media worker rejected the job."},{status:response.status===401||response.status===403?response.status:502});
    return Response.json({ok:true,jobId,worker:result});
  }catch(error){
    console.error("import-source",error);
    return Response.json({error:error?.name==="AbortError"?"Media worker is waking up. Please retry the import.":error?.message||"Unable to start media ingestion."},{status:502});
  }
}