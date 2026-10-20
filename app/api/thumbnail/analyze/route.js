import {randomUUID} from "node:crypto";
import {lookup} from "node:dns/promises";
import {isIP} from "node:net";
import {createClient} from "@supabase/supabase-js";
import {enforceWorkspaceApiRateLimit,reserveWorkspaceFeatureUsage,finishWorkspaceFeatureUsage,problem,workflowError} from "../../../../lib/workflow-server";

export const runtime="nodejs";
const admin=()=>createClient(process.env.SUPABASE_URL||process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SECRET_KEY,{auth:{persistSession:false}});
const publicClient=()=>createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,{auth:{persistSession:false}});
function isPrivateAddress(address){
  const value=String(address||"").toLowerCase().replace(/^::ffff:/,"");
  if(isIP(value)===4){
    const octets=value.split(".").map(Number);
    return octets[0]===0||octets[0]===10||octets[0]===127||octets[0]===169&&octets[1]===254||octets[0]===172&&octets[1]>=16&&octets[1]<=31||octets[0]===192&&octets[1]===168||octets[0]===100&&octets[1]>=64&&octets[1]<=127||octets[0]>=224||octets[0]===198&&(octets[1]===18||octets[1]===19);
  }
  return value==="::"||value==="::1"||value.startsWith("fc")||value.startsWith("fd")||value.startsWith("fe80:")||value.startsWith("ff");
}

export async function POST(req){
  let client=null,usageId=null;
  try{
    const auth=req.headers.get("authorization")||"";
    if(!auth.startsWith("Bearer "))throw problem("Unauthorized",401);
    const {data:userData}=await publicClient().auth.getUser(auth.slice(7));
    const user=userData?.user;
    if(!user)throw problem("Unauthorized",401);
    const body=await req.json();
    const workspaceId=String(body.workspace_id||body.workspaceId||"");
    if(!workspaceId)throw problem("workspace_id required",400);
    client=admin();
    const {data:member,error:memberError}=await client.from("workspace_members").select("role").eq("workspace_id",workspaceId).eq("user_id",user.id).maybeSingle();
    if(memberError)throw memberError;
    if(!member)throw problem("Workspace access denied",403);
    const ip=req.headers.get("x-real-ip")||req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()||null;
    await enforceWorkspaceApiRateLimit(client,"user:"+user.id,workspaceId,"/api/thumbnail/analyze",10,60,ip);
    const reservation=await reserveWorkspaceFeatureUsage(client,workspaceId,user.id,"cover_rotation",String(body.request_id||randomUUID()),String(body.timezone||"Asia/Kolkata"));
    usageId=reservation.usageId||null;

    const imageUrl=String(body.image_url||"");
    if(!imageUrl)throw problem("image_url required",400);
    let target;
    try{target=new URL(imageUrl)}catch{throw problem("Invalid thumbnail URL.",400)}
    const host=target.hostname.toLowerCase();
    if(target.protocol!=="https:"||host==="localhost"||host.endsWith(".localhost"))throw problem("Only public HTTPS thumbnail URLs are supported.",400);
    try{
      const literal=host.replace(/^\[|\]$/g,"");
      const addresses=isIP(literal)?[{address:literal}]:await lookup(literal,{all:true,verbatim:true});
      if(!addresses.length||addresses.some(item=>isPrivateAddress(item.address)))throw problem("Thumbnail URL must resolve only to public IP addresses.",400);
    }catch(error){if(error?.status)throw error;throw problem("Thumbnail URL could not be resolved safely.",400)}
    const imageResponse=await fetch(target,{signal:AbortSignal.timeout(10000),redirect:"error"});
    if(!imageResponse.ok)throw problem("Thumbnail could not be fetched.",400);
    const contentLength=Number(imageResponse.headers.get("content-length")||0);
    if(contentLength>1200000)throw problem("Thumbnail is too large. Use an image under 1.2 MB.",413);
    const mime=(imageResponse.headers.get("content-type")||"image/jpeg").split(";")[0].trim().toLowerCase();
    if(!["image/jpeg","image/png","image/webp"].includes(mime))throw problem("Only JPEG, PNG, and WebP thumbnails are supported.",400);
    const buffer=Buffer.from(await imageResponse.arrayBuffer());
    if(buffer.byteLength>1200000)throw problem("Thumbnail is too large. Use an image under 1.2 MB.",413);
    const prompt="Analyze this video thumbnail for short-form creator content. Return JSON with overall_score,mobile_readability,clarity,curiosity,contrast,emotion,text_readability,topic_clarity,benchmark_percentile and an analysis object containing strengths,weaknesses,improvements. Do not claim this is a true market percentile; use a heuristic benchmark.";
    const worker=(process.env.MEDIA_WORKER_URL||"").replace(/\/$/,"");
    if (!worker) throw new Error("Media worker is not configured. Set MEDIA_WORKER_URL to enable remote processing.");
    const response=await fetch(worker+"/assistant",{
      method:"POST",
      headers:{"content-type":"application/json","x-worker-secret":process.env.MEDIA_WORKER_SECRET||""},
      body:JSON.stringify({prompt,context:"Thumbnail analysis request. Use heuristic judgments only.",imageBase64:buffer.toString("base64"),mimeType:mime,responseMimeType:"application/json"}),
      signal:AbortSignal.timeout(20000)
    });
    if(!response.ok)throw Object.assign(new Error("AI provider is temporarily unavailable. Please retry shortly."),{status:503});
    const result=await response.json();
    const analysis=JSON.parse(String(result.text||"{}"));
    if(body.clip_id){
      const {error}=await client.from("thumbnail_analyses").insert({
        workspace_id:workspaceId,clip_id:body.clip_id,storage_path:body.storage_path||null,
        overall_score:analysis.overall_score,mobile_readability:analysis.mobile_readability,
        clarity:analysis.clarity,curiosity:analysis.curiosity,contrast:analysis.contrast,
        emotion:analysis.emotion,text_readability:analysis.text_readability,topic_clarity:analysis.topic_clarity,
        benchmark_percentile:analysis.benchmark_percentile,benchmark_type:"heuristic",model_version:"gemini",
        analysis:analysis.analysis||analysis
      });
      if(error)throw error;
    }
    await finishWorkspaceFeatureUsage(client,usageId,true);
    usageId=null;
    return Response.json(analysis);
  }catch(error){
    if(usageId&&client)await finishWorkspaceFeatureUsage(client,usageId,false).catch(()=>{});
    return workflowError(error);
  }
}
