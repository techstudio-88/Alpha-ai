import{createClient}from"@supabase/supabase-js";
import {encryptCredential} from '../../../../lib/credential-cipher.mjs';
import {requireWorkerCapability} from '../../../../lib/worker-capabilities';
export const runtime="nodejs";
export async function POST(request){
 try{
  const auth=request.headers.get("authorization")||"";const body=await request.json();const{accessToken,item,workspaceId,userId}=body||{};
   const secret=process.env.MEDIA_WORKER_SECRET||"";
   await requireWorkerCapability('encrypted-credentials');
   if(!secret)return Response.json({error:'Media worker credential encryption is not configured.'},{status:503});
  if(!auth.startsWith("Bearer ")||!accessToken||!item?.id||!item?.mediaFile?.baseUrl||!workspaceId)return Response.json({error:"Google Photos import context is incomplete."},{status:400});
  const supabase=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY||process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false},global:{headers:{Authorization:auth}}});
  const{data:{user},error}=await supabase.auth.getUser(auth.slice(7));if(error||!user||user.id!==userId)return Response.json({error:"Invalid session."},{status:401});
  const{data:isMember,error:memberError}=await supabase.rpc("is_workspace_member",{wid:workspaceId});if(memberError||!isMember)return Response.json({error:"Workspace access denied."},{status:403});
  const mediaFile=item.mediaFile; if(!String(mediaFile.mimeType||"").startsWith("video/"))return Response.json({error:"Selected Google Photos item is not a video."},{status:400});
   const sourceUrl=String(mediaFile.baseUrl);const externalId=String(item.id);
   const sourceHost=new URL(sourceUrl);if(sourceHost.protocol!=='https:'||!sourceHost.hostname.endsWith('.googleusercontent.com')||sourceHost.username||sourceHost.password||sourceHost.port)return Response.json({error:'Unsupported Google Photos source.'},{status:400});
  const existing=await supabase.from("project_sources").select("id,project_id,status").eq("workspace_id",workspaceId).eq("external_id",externalId).eq("source_type","google_photos").limit(1).maybeSingle();if(existing.data?.id)return Response.json({ok:true,projectId:existing.data.project_id,alreadyImported:true});
  const name=String(mediaFile.filename||"Google Photos video").replace(/\.[^.]+$/,"")||"Google Photos video";
  const project=await supabase.from("projects").insert({workspace_id:workspaceId,owner_id:user.id,name,status:"uploading"}).select().single();if(project.error)throw project.error;
  const source=await supabase.from("project_sources").insert({workspace_id:workspaceId,project_id:project.data.id,source_type:"google_photos",source_url:sourceUrl,external_id:externalId,file_name:mediaFile.filename||null,status:"queued",metadata:{provider:"google_photos",media_id:externalId,mime_type:mediaFile.mimeType,base_url_expires_in:"60m"}}).select().single();if(source.error)throw source.error;
   const job=await supabase.from("processing_jobs").insert({workspace_id:workspaceId,project_id:project.data.id,job_type:"ingest",status:"queued",progress:0,payload:{workspaceId,projectId:project.data.id,requestedBy:user.id,sourceType:"google_photos",sourceId:source.data.id,url:sourceUrl,googlePhotosBaseUrl:sourceUrl,photosCredential:encryptCredential(accessToken,secret),googlePhotosMediaId:externalId,file_name:mediaFile.filename||null}}).select().single();if(job.error)throw job.error;
   const worker=process.env.MEDIA_WORKER_URL||"https://alpha-ai-media-worker.onrender.com";
   const wr=await fetch(worker.replace(/\/$/,"")+"/process",{method:"POST",headers:{"content-type":"application/json","x-worker-secret":secret},body:JSON.stringify({workspaceId,projectId:project.data.id,jobId:job.data.id,requestedBy:user.id}),signal:AbortSignal.timeout(10000)}).catch(()=>null);
   const wd=await wr?.json().catch(()=>({}));if(wr&&[401,403].includes(wr.status))throw new Error(wd.error||"Media worker authorization failed.");
  return Response.json({ok:true,projectId:project.data.id,jobId:job.data.id,file:mediaFile});
 }catch(e){console.error("google-photos-import",e);return Response.json({error:e?.message||"Google Photos import failed."},{status:500})}
}
