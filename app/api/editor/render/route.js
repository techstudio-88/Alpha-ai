import{createClient}from"@supabase/supabase-js";
export const runtime="nodejs";
export const maxDuration=50;
const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY||process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const service=process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SECRET_KEY;
const worker=process.env.MEDIA_WORKER_URL||"https://alpha-ai-media-worker.onrender.com";
export async function POST(request){
  try{
    const body=await request.json();
    const{workspaceId,projectId,mediaAssetId,clipId,startSeconds,endSeconds,title,aspect="9:16",speed=1,zoom=1,aiPrompt="",captions=true,effect="none",transition="cut"}=body||{};
    if(!workspaceId||!projectId||!mediaAssetId)return Response.json({error:"Missing editor context."},{status:400});
    if(!url||!anon||!service||!process.env.MEDIA_WORKER_SECRET)return Response.json({error:"Editor rendering is not configured on the server."},{status:503});
    const auth=request.headers.get("authorization")||"";
    if(!auth.startsWith("Bearer "))return Response.json({error:"Authentication required."},{status:401});
    const client=createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false}});
    const{data:{user},error:userError}=await client.auth.getUser(auth.replace(/^Bearer\s+/i,""));
    if(userError||!user)return Response.json({error:"Authentication expired."},{status:401});
    const admin=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
    const{data:member}=await admin.from("workspace_members").select("workspace_id").eq("workspace_id",workspaceId).eq("user_id",user.id).maybeSingle();
    if(!member)return Response.json({error:"Workspace access denied."},{status:403});
    const{data:asset,error:assetError}=await admin.from("media_assets").select("id,storage_path,duration_seconds,name").eq("id",mediaAssetId).eq("project_id",projectId).maybeSingle();
    if(assetError||!asset?.storage_path)return Response.json({error:"Source media not found."},{status:404});
    const duration=Number(asset.duration_seconds||0);
    const start=Math.max(0,Math.min(duration,Number(startSeconds)||0));
    const end=Math.max(start,Math.min(duration,Number(endSeconds)||duration));
    if(end-start<0.25)return Response.json({error:"Selected range is too short."},{status:400});
    const safeSpeed=Math.max(.5,Math.min(2,Number(speed)||1)); const safeZoom=Math.max(.8,Math.min(1.4,Number(zoom)||1)); const safeAspect=["9:16","16:9","1:1"].includes(aspect)?aspect:"9:16";
    const payload={operation:"render_edit",workspaceId,projectId,mediaAssetId,clipId:clipId||null,requestedBy:user.id,startSeconds:start,endSeconds:end,title:String(title||asset.name||"Edited clip").slice(0,180),aspect:safeAspect,speed:safeSpeed,zoom:safeZoom,captions:Boolean(captions),effect:String(effect||"none"),transition:String(transition||"cut"),aiPrompt:String(aiPrompt||"").slice(0,2000)};
    const{data:job,error:jobError}=await admin.from("processing_jobs").insert({workspace_id:workspaceId,project_id:projectId,job_type:"render_edit",status:"queued",progress:1,payload}).select("id").single();
    if(jobError||!job)return Response.json({error:jobError?.message||"Could not create render job."},{status:500});
    const response=await fetch(worker.replace(/\/$/,"")+"/process",{method:"POST",headers:{"content-type":"application/json","x-worker-secret":process.env.MEDIA_WORKER_SECRET},body:JSON.stringify({...payload,jobId:job.id}),cache:"no-store"});
    const result=await response.json().catch(()=>({}));
    if(!response.ok)return Response.json({error:result.error||"Media worker rejected render."},{status:502});
    return Response.json({ok:true,jobId:job.id});
  }catch(error){console.error("editor render",error);return Response.json({error:error?.message||"Unable to render edit."},{status:500})}
}