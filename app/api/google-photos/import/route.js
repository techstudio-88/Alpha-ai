import {createClient} from "@supabase/supabase-js";
import {randomUUID} from "node:crypto";
import {encryptCredential} from "../../../../lib/credential-cipher.mjs";
import {requireWorkerCapability} from "../../../../lib/worker-capabilities";
import {checkRateLimit,rateLimitResponse,resolveWorkspacePlan} from "../../../../lib/rate-limit";
import {UUID} from "../../../../lib/video-workflow.mjs";

export const runtime="nodejs";
const fail=(message,status,errorId)=>Response.json({error:message,errorId},{status,headers:{"Cache-Control":"no-store"}});
export async function POST(request){
 const errorId=randomUUID();
 try{
  const auth=request.headers.get("authorization")||"";
  const body=await request.json().catch(()=>null);
  const {accessToken,item,workspaceId,userId}=body||{};
  const secret=process.env.MEDIA_WORKER_SECRET||"";
  if(!auth.startsWith("Bearer ")||!accessToken||!item?.id||!item?.mediaFile?.baseUrl||!UUID.test(workspaceId||""))
    return fail("Choose a valid Google Photos video and workspace.",400,errorId);
  if(!secret)return fail("The import service is temporarily unavailable.",503,errorId);
  await requireWorkerCapability("encrypted-credentials");
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL||process.env.SUPABASE_URL;
  const publicKey=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY||process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if(!url||!publicKey)return fail("The import service is temporarily unavailable.",503,errorId);
  const supabase=createClient(url,publicKey,{auth:{persistSession:false,autoRefreshToken:false},global:{headers:{Authorization:auth}}});
  const {data:{user},error:authError}=await supabase.auth.getUser(auth.slice(7));
  if(authError||!user||user.id!==userId)return fail("Your session is invalid or expired. Sign in again.",401,errorId);
  const {data:isMember,error:memberError}=await supabase.rpc("is_workspace_member",{wid:workspaceId});
  if(memberError||!isMember)return fail("Workspace access denied.",403,errorId);
  const plan=await resolveWorkspacePlan(supabase,workspaceId);
  const rate=await checkRateLimit(request,{endpoint:"upload_start",userId:user.id,plan});
  const blocked=rateLimitResponse(rate);if(blocked)return blocked;
  const mediaFile=item.mediaFile;
  if(!String(mediaFile.mimeType||"").startsWith("video/"))return fail("The selected Google Photos item is not a video.",400,errorId);
  const sourceUrl=String(mediaFile.baseUrl),externalId=String(item.id);
  let sourceHost;
  try{sourceHost=new URL(sourceUrl)}catch{return fail("The selected Google Photos source is invalid.",400,errorId)}
  if(sourceHost.protocol!=="https:"||!sourceHost.hostname.endsWith(".googleusercontent.com")||sourceHost.username||sourceHost.password||sourceHost.port)
    return fail("Unsupported Google Photos source.",400,errorId);
  const existing=await supabase.from("project_sources").select("id,project_id,status")
    .eq("workspace_id",workspaceId).eq("external_id",externalId).eq("source_type","google_photos").limit(1).maybeSingle();
  if(existing.error)return fail("Unable to verify whether this video was already imported.",500,errorId);
  if(existing.data?.id)return Response.json({ok:true,projectId:existing.data.project_id,alreadyImported:true},{headers:{"Cache-Control":"no-store"}});
  const name=String(mediaFile.filename||"Google Photos video").replace(/\.[^.]+$/,"").slice(0,180)||"Google Photos video";
  const project=await supabase.from("projects").insert({workspace_id:workspaceId,owner_id:user.id,name,status:"uploading"}).select("id").single();
  if(project.error)return fail("Unable to prepare the import. Please retry.",500,errorId);
  const source=await supabase.from("project_sources").insert({workspace_id:workspaceId,project_id:project.data.id,source_type:"google_photos",
    source_url:sourceUrl,external_id:externalId,file_name:String(mediaFile.filename||"").slice(0,255)||null,status:"queued",
    metadata:{provider:"google_photos",media_id:externalId,mime_type:mediaFile.mimeType,base_url_expires_in:"60m"}}).select("id").single();
  if(source.error)return fail("Unable to prepare the import. Please retry.",500,errorId);
  const job=await supabase.from("processing_jobs").insert({workspace_id:workspaceId,project_id:project.data.id,job_type:"ingest",status:"queued",progress:0,
    payload:{workspaceId,projectId:project.data.id,requestedBy:user.id,sourceType:"google_photos",sourceId:source.data.id,url:sourceUrl,
      googlePhotosBaseUrl:sourceUrl,photosCredential:encryptCredential(accessToken,secret),googlePhotosMediaId:externalId,file_name:String(mediaFile.filename||"").slice(0,255)}})
    .select("id").single();
  if(job.error)return fail("Unable to queue this video for processing. Please retry.",500,errorId);
  const worker=(process.env.MEDIA_WORKER_URL||"https://alpha-ai-media-worker.onrender.com").replace(/\/$/,"");
  const response=await fetch(worker+"/process",{method:"POST",headers:{"content-type":"application/json","x-worker-secret":secret},
    body:JSON.stringify({workspaceId,projectId:project.data.id,jobId:job.data.id,requestedBy:user.id}),
    signal:AbortSignal.timeout(10000),cache:"no-store"}).catch(()=>null);
  if(response&&[401,403].includes(response.status))return fail("The processing worker rejected this request. Contact support with error ID "+errorId+".",502,errorId);
  return Response.json({ok:true,projectId:project.data.id,jobId:job.data.id,file:{id:externalId,name:mediaFile.filename||name,mimeType:mediaFile.mimeType}},
    {headers:{"Cache-Control":"no-store"}});
 }catch(error){
  console.error("google_photos_import_failure",{errorId,category:"internal"});
  return fail("Google Photos import failed. Contact support with error ID "+errorId+".",500,errorId);
 }
}
