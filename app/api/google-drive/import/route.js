import{createClient}from"@supabase/supabase-js";
export const runtime="nodejs";
export async function POST(request){
 try{
  const auth=request.headers.get("authorization")||"";const body=await request.json();const{accessToken,file,workspaceId,userId}=body||{};
  if(!auth.startsWith("Bearer ")||!accessToken||!file?.id||!workspaceId)return Response.json({error:"Google Drive import context is incomplete."},{status:400});
  const supabase=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY||process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false},global:{headers:{Authorization:auth}}});
  const{data:{user},error}=await supabase.auth.getUser(auth.slice(7));if(error||!user||user.id!==userId)return Response.json({error:"Invalid session."},{status:401});
  const{data:isMember,error:memberError}=await supabase.rpc("is_workspace_member",{wid:workspaceId});if(memberError||!isMember)return Response.json({error:"Workspace access denied."},{status:403});
  const meta=await fetch("https://www.googleapis.com/drive/v3/files/"+encodeURIComponent(file.id)+"?fields=id,name,mimeType,size,modifiedTime,capabilities",{headers:{Authorization:"Bearer "+accessToken}});const md=await meta.json();if(!meta.ok)return Response.json({error:md.error?.message||"Unable to verify Drive file."},{status:400});
  if(!md.mimeType?.startsWith("video/"))return Response.json({error:"Selected Drive file is not a video."},{status:400});
  if(md.capabilities?.canDownload===false)return Response.json({error:"Google Drive does not allow this file to be downloaded."},{status:400});
  const project=await supabase.from("projects").insert({workspace_id:workspaceId,owner_id:user.id,name:md.name?.replace(/\.[^.]+$/,"")||"Google Drive video",status:"uploading"}).select().single();if(project.error)throw project.error;
  const source=await supabase.from("project_sources").insert({workspace_id:workspaceId,project_id:project.data.id,source_type:"google_drive",source_url:"https://drive.google.com/file/d/"+md.id+"/view",status:"queued",metadata:{provider:"google_drive",file_id:md.id,name:md.name,mime_type:md.mimeType,size_bytes:md.size||null,modified_time:md.modifiedTime}}).select().single();if(source.error)throw source.error;
  const job=await supabase.from("processing_jobs").insert({workspace_id:workspaceId,project_id:project.data.id,job_type:"ingest",status:"queued",progress:0,payload:{source_type:"google_drive",source_id:source.data.id,file_id:md.id,file_name:md.name}}).select().single();if(job.error)throw job.error;
  const worker=process.env.MEDIA_WORKER_URL||"https://alpha-ai-media-worker.onrender.com";
  const wr=await fetch(worker.replace(/\/$/,"")+"/process",{method:"POST",headers:{"content-type":"application/json",authorization:auth,"x-worker-secret":process.env.MEDIA_WORKER_SECRET||""},body:JSON.stringify({url:null,sourceType:"google_drive",workspaceId,projectId:project.data.id,sourceId:source.data.id,jobId:job.data.id,requestedBy:user.id,driveFileId:md.id,driveAccessToken:accessToken,driveFileName:md.name})});
  const wd=await wr.json().catch(()=>({}));if(!wr.ok)throw new Error(wd.error||"Media worker rejected the Google Drive import.");
  return Response.json({ok:true,projectId:project.data.id,jobId:job.data.id,file:md});
 }catch(e){console.error("google-drive-import",e);return Response.json({error:e?.message||"Google Drive import failed."},{status:500})}
}