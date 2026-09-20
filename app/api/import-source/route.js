import{createClient}from"@supabase/supabase-js";
import{createHmac,timingSafeEqual}from"node:crypto";
export const runtime="nodejs";
export const maxDuration=50;
const supabaseUrl=process.env.NEXT_PUBLIC_SUPABASE_URL;
const publicKey=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY||process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const secret=()=>process.env.MEDIA_WORKER_SECRET||"";
const sleep=(ms)=>new Promise((resolve)=>setTimeout(resolve,ms));
function verifyTicket(ticket){try{if(!secret()||typeof ticket!=="string")return null;const[a,b]=ticket.split(".");if(!a||!b)return null;const expected=Buffer.from(createHmac("sha256",secret()).update(a).digest("base64url"));const actual=Buffer.from(b);if(expected.length!==actual.length||!timingSafeEqual(expected,actual))return null;const data=JSON.parse(Buffer.from(a,"base64url").toString("utf8"));if(!data?.sub||!data?.workspaceId||!data?.projectId||!data?.jobId||Number(data.exp||0)<Date.now())return null;return data}catch{return null}}
async function callWorker(worker,auth,payload){
  let lastError=null;
  for(let attempt=0;attempt<4;attempt++){
    const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),12000);
    try{
      const response=await fetch(worker.replace(/\/$/,"")+"/process",{method:"POST",headers:{"content-type":"application/json","authorization":auth||"","x-worker-secret":process.env.MEDIA_WORKER_SECRET||""},body:JSON.stringify(payload),signal:controller.signal,cache:"no-store"});
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
    const auth=request.headers.get("authorization")||"";
    const ticket=verifyTicket(request.headers.get("x-import-ticket")||"");
    const body=await request.json();const{url,sourceType,workspaceId,projectId,sourceId,jobId,mediaAssetId}=body||{};
    if(!workspaceId||!projectId||!jobId)return Response.json({error:"Missing processing job context."},{status:400});
    let requestedBy=null;let workerAuth=auth;
    if(ticket){
      if(ticket.workspaceId!==workspaceId||ticket.projectId!==projectId||ticket.jobId!==jobId||String(ticket.sourceId||"")!==String(sourceId||"")||String(ticket.mediaAssetId||"")!==String(mediaAssetId||""))return Response.json({error:"Invalid processing ticket."},{status:401});
      requestedBy=ticket.sub;workerAuth="";
    }else{
      if(!auth.startsWith("Bearer "))return Response.json({error:"Authentication required."},{status:401});
      const client=createClient(supabaseUrl,publicKey,{auth:{persistSession:false,autoRefreshToken:false},global:{headers:{Authorization:auth}}});
      const{data:{user},error:userError}=await client.auth.getUser(auth.slice(7));
      if(userError||!user)return Response.json({error:"Invalid session."},{status:401});
      requestedBy=user.id;
      const{data:isMember,error:memberError}=await client.rpc("is_workspace_member",{wid:workspaceId});
      if(memberError||!isMember)return Response.json({error:"Workspace access denied."},{status:403});
    }
    const worker=process.env.MEDIA_WORKER_URL||"https://alpha-ai-media-worker.onrender.com";
    const{response,result}=await callWorker(worker,workerAuth,{url:url||null,sourceType:sourceType||"upload",workspaceId,projectId,sourceId:sourceId||null,jobId,mediaAssetId:mediaAssetId||null,requestedBy});
    if(!response.ok)return Response.json({error:result.error||"Media worker rejected the job."},{status:response.status===401||response.status===403?response.status:502});
    return Response.json({ok:true,jobId,worker:result});
  }catch(error){
    console.error("import-source",error);
    return Response.json({error:error?.name==="AbortError"?"Media worker is waking up. Please retry the import.":error?.message||"Unable to start media ingestion."},{status:502});
  }
}