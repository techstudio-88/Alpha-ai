import{createClient}from"@supabase/supabase-js";
import {randomUUID} from "node:crypto";
import {encryptCredential} from '../../../../lib/credential-cipher.mjs';
import {requireWorkerCapability} from '../../../../lib/worker-capabilities';
import {UUID} from '../../../../lib/video-workflow.mjs';
import {checkRateLimit,rateLimitResponse,resolveWorkspacePlan} from '../../../../lib/rate-limit';
export const runtime="nodejs";
const fail=(error,status,errorId)=>Response.json({error,errorId},{status,headers:{"Cache-Control":"no-store"}});
export async function POST(request){
 const errorId=randomUUID();
 try{
  const auth=request.headers.get("authorization")||"";const body=await request.json();const{accessToken,file,workspaceId,userId}=body||{};
   const workerSecret=process.env.MEDIA_WORKER_SECRET||"";
   if(!workerSecret)return fail("The import service is temporarily unavailable.",503,errorId);
  if(!auth.startsWith("Bearer ")||!accessToken||!file?.id||!UUID.test(workspaceId||""))return fail("Choose a valid Drive video and workspace.",400,errorId);
  const supabase=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY||process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false},global:{headers:{Authorization:auth}}});
  const{data:{user},error}=await supabase.auth.getUser(auth.slice(7));if(error||!user||user.id!==userId)return fail("Your session is invalid or expired. Sign in again.",401,errorId);
  const{data:isMember,error:memberError}=await supabase.rpc("is_workspace_member",{wid:workspaceId});if(memberError||!isMember)return fail("Workspace access denied.",403,errorId);
  const plan=await resolveWorkspacePlan(supabase,workspaceId);
  const rate=await checkRateLimit(request,{endpoint:"upload_start",userId:user.id,plan});
  const blocked=rateLimitResponse(rate);if(blocked)return blocked;
  const meta=await fetch("https://www.googleapis.com/drive/v3/files/"+encodeURIComponent(file.id)+"?fields=id,name,mimeType,size,modifiedTime,capabilities",{headers:{Authorization:"Bearer "+accessToken}});const md=await meta.json();if(!meta.ok)return fail("Unable to verify the selected Drive file.",400,errorId);
  if(!md.mimeType?.startsWith("video/"))return fail("The selected Drive file is not a video.",400,errorId);
  const driveSize=Number(md.size||0);
  if(driveSize>5*1024**3)return fail("Choose a video no larger than 5 GB.",413,errorId);
  if(md.capabilities?.canDownload===false)return fail("Google Drive does not allow this file to be downloaded.",400,errorId);
  await requireWorkerCapability('encrypted-credentials');
  const project=await supabase.from("projects").insert({workspace_id:workspaceId,owner_id:user.id,name:md.name?.replace(/\.[^.]+$/,"")||"Google Drive video",status:"uploading"}).select().single();if(project.error)throw project.error;
  const source=await supabase.from("project_sources").insert({workspace_id:workspaceId,project_id:project.data.id,source_type:"google_drive",source_url:"https://drive.google.com/file/d/"+md.id+"/view",external_id:md.id,file_name:md.name,status:"queued",metadata:{provider:"google_drive",file_id:md.id,name:md.name,mime_type:md.mimeType,size_bytes:md.size||null,modified_time:md.modifiedTime}}).select().single();if(source.error)throw source.error;
   const job=await supabase.from("processing_jobs").insert({workspace_id:workspaceId,project_id:project.data.id,job_type:"ingest",status:"queued",progress:0,payload:{workspaceId,projectId:project.data.id,requestedBy:user.id,sourceType:"google_drive",sourceId:source.data.id,driveFileId:md.id,driveCredential:encryptCredential(accessToken,workerSecret),file_name:md.name}}).select().single();if(job.error)throw job.error;
  const worker=process.env.MEDIA_WORKER_URL||"https://alpha-ai-media-worker.onrender.com";
  if(!workerSecret)throw new Error("Media worker authentication is not configured.");
   const wr=await fetch(worker.replace(/\/$/,"")+"/process",{method:"POST",headers:{"content-type":"application/json","x-worker-secret":workerSecret},body:JSON.stringify({workspaceId,projectId:project.data.id,jobId:job.data.id,requestedBy:user.id}),signal:AbortSignal.timeout(10000)}).catch(()=>null);
   const wd=await wr?.json().catch(()=>({}));if(wr&&[401,403].includes(wr.status))throw new Error("Media worker rejected the import.");
  return Response.json({ok:true,projectId:project.data.id,jobId:job.data.id,file:md});
 }catch(e){console.error("google_drive_import_failure",{errorId,category:"internal"});return fail("Google Drive import failed. Please retry or contact support with the error ID.",500,errorId)}
}
