import {createClient} from "@supabase/supabase-js";
import {randomUUID} from "node:crypto";
import {readFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {publicDownload} from "../../../../worker/download.js";
import {UUID} from "../../../../lib/video-workflow.mjs";
import {checkRateLimit,rateLimitResponse,resolveWorkspacePlan} from "../../../../lib/rate-limit";

export const runtime="nodejs";
export const maxDuration=30;
const errorResponse=(error,status,errorId)=>Response.json({error,errorId},{status,headers:{"Cache-Control":"no-store"}});
const imageMime=buffer=>{
  if(buffer.length>=8&&buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return "image/png";
  if(buffer.length>=3&&buffer[0]===255&&buffer[1]===216&&buffer[2]===255)return "image/jpeg";
  if(buffer.length>=12&&buffer.toString("ascii",0,4)==="RIFF"&&buffer.toString("ascii",8,12)==="WEBP")return "image/webp";
  if(buffer.length>=6&&["GIF87a","GIF89a"].includes(buffer.toString("ascii",0,6)))return "image/gif";
  return null;
};
function adminClient(){
  const url=process.env.SUPABASE_URL||process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key=process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SECRET_KEY;
  if(!url||!key)throw new Error("CONFIG");
  return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
}
async function imageBytes(value){
  const data=String(value||"");
  const dataUri=data.match(/^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/i);
  if(dataUri){
    const bytes=Buffer.from(dataUri[2],"base64");
    if(!bytes.length||bytes.length>1024*1024)throw Object.assign(new Error("IMAGE_SIZE"),{status:413});
    const mime=imageMime(bytes);
    if(!mime||mime!==dataUri[1].toLowerCase())throw Object.assign(new Error("IMAGE_TYPE"),{status:415});
    return {bytes,mime};
  }
  let parsed;
  try{parsed=new URL(data)}catch{throw Object.assign(new Error("IMAGE_URL"),{status:400})}
  if(parsed.protocol!=="https:")throw Object.assign(new Error("IMAGE_URL"),{status:400});
  const file=join(tmpdir(),"alpha-thumbnail-"+randomUUID()+".img");
  try{
    await publicDownload(parsed.toString(),file,{maxBytes:1024*1024});
    const bytes=await readFile(file),mime=imageMime(bytes);
    if(!mime)throw Object.assign(new Error("IMAGE_TYPE"),{status:415});
    return {bytes,mime};
  }finally{await rm(file,{force:true}).catch(()=>{})}
}
export async function POST(request){
  const errorId=randomUUID();
  try{
    const authorization=request.headers.get("authorization")||"";
    if(!authorization.startsWith("Bearer "))return errorResponse("Authentication required.",401,errorId);
    const url=process.env.NEXT_PUBLIC_SUPABASE_URL||process.env.SUPABASE_URL;
    const publicKey=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if(!url||!publicKey)return errorResponse("The service is temporarily unavailable.",503,errorId);
    const auth=createClient(url,publicKey,{auth:{persistSession:false,autoRefreshToken:false}});
    const {data:authData,error:authError}=await auth.auth.getUser(authorization.slice(7));
    if(authError||!authData.user)return errorResponse("Your session is invalid or expired. Sign in again.",401,errorId);
    const body=await request.json().catch(()=>({}));
    const workspaceId=String(body.workspace_id||"");
    if(!UUID.test(workspaceId))return errorResponse("A valid workspace is required.",400,errorId);
    const admin=adminClient();
    const {data:member,error:memberError}=await admin.from("workspace_members").select("role").eq("workspace_id",workspaceId).eq("user_id",authData.user.id).maybeSingle();
    if(memberError)return errorResponse("Unable to verify workspace access.",500,errorId);
    if(!member)return errorResponse("Workspace access denied.",403,errorId);
    const plan=await resolveWorkspacePlan(admin,workspaceId);
    const rate=await checkRateLimit(request,{endpoint:"ai_call",userId:authData.user.id,plan});
    const blocked=rateLimitResponse(rate);if(blocked)return blocked;
    let clip=null;
    if(body.clip_id){
      if(!UUID.test(String(body.clip_id)))return errorResponse("A valid clip is required.",400,errorId);
      const {data,error}=await admin.from("clips").select("id,project_id,projects!inner(workspace_id)").eq("id",body.clip_id).eq("projects.workspace_id",workspaceId).maybeSingle();
      if(error)return errorResponse("Unable to verify the selected clip.",500,errorId);
      if(!data)return errorResponse("Clip not found in this workspace.",404,errorId);
      clip=data;
    }
    const {bytes,mime}=await imageBytes(body.image_url);
    const worker=(process.env.MEDIA_WORKER_URL||"https://alpha-ai-media-worker.onrender.com").replace(/\/$/,"");
    const secret=process.env.MEDIA_WORKER_SECRET||"";
    if(!secret)return errorResponse("AI worker is not configured.",503,errorId);
    const response=await fetch(worker+"/thumbnail/analyze",{method:"POST",headers:{"content-type":"application/json","x-worker-secret":secret},
      body:JSON.stringify({imageBase64:bytes.toString("base64"),mimeType:mime}),signal:AbortSignal.timeout(20000),cache:"no-store"});
    const result=await response.json().catch(()=>({}));
    if(!response.ok)return errorResponse(response.status===503?"AI providers are temporarily unavailable. Please retry later.":"Thumbnail analysis failed. Contact support with error ID "+errorId+".",response.status===429?429:response.status===503?503:502,errorId);
    const analysis=result.analysis;
    if(!analysis||typeof analysis!=="object")return errorResponse("Thumbnail analysis returned an invalid result.",502,errorId);
    if(clip){
      const {error}=await admin.from("thumbnail_analyses").insert({
        workspace_id:workspaceId,clip_id:clip.id,storage_path:null,
        overall_score:analysis.overall_score,mobile_readability:analysis.mobile_readability,clarity:analysis.clarity,
        curiosity:analysis.curiosity,contrast:analysis.contrast,emotion:analysis.emotion,
        text_readability:analysis.text_readability,topic_clarity:analysis.topic_clarity,
        benchmark_percentile:analysis.benchmark_percentile,benchmark_type:"heuristic",model_version:process.env.GEMINI_MODEL||"worker",
        analysis:analysis.analysis||analysis
      });
      if(error)return errorResponse("The analysis could not be saved. Please retry with error ID "+errorId+".",500,errorId);
    }
    return Response.json(analysis,{headers:{"Cache-Control":"no-store"}});
  }catch(error){
    if(error?.message==="CONFIG")return errorResponse("The service is temporarily unavailable.",503,errorId);
    const status=Number(error?.status)||400;
    const message=error?.message==="IMAGE_SIZE"?"Choose an image smaller than 1 MB.":error?.message==="IMAGE_TYPE"?"Use a JPEG, PNG, WebP, or GIF image.":error?.message==="IMAGE_URL"?"Use a valid HTTPS image URL.":"Thumbnail analysis failed. Contact support with error ID "+errorId+".";
    console.error("thumbnail_analysis_failure",{errorId,category:status===413?"input_too_large":status===415?"unsupported_image":"request_failed"});
    return errorResponse(message,status>=400&&status<500?status:500,errorId);
  }
}
