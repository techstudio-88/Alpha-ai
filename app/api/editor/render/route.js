import {authorizeWorkflow,checked,mediaContext,problem,wakeWorker,workflowError} from "../../../../lib/workflow-server";
export const runtime="nodejs";
export const maxDuration=30;
export async function POST(request){
  try{
    const body=await request.json();
    const {workspaceId,projectId,mediaAssetId,clipId}=body;
    const {admin,user,token}=await authorizeWorkflow(request,workspaceId);
    const {asset}=await mediaContext(admin,workspaceId,projectId,mediaAssetId);
    if(!asset?.storage_path)throw problem("Source video is not stored. Re-import it before editing.",409);
    if(clipId){
      const clip=checked(await admin.from("clips").select("id").eq("id",clipId).eq("project_id",projectId).eq("media_asset_id",mediaAssetId).maybeSingle());
      if(!clip)throw problem("Clip does not belong to this video.",404);
      const pending=checked(await admin.from("processing_jobs").select("id").eq("workspace_id",workspaceId).eq("payload->>clipId",clipId).in("status",["queued","processing"]).limit(1));
      if(pending.length)throw problem("This clip already has a render in progress.",409);
    }
    const duration=Number(asset.duration_seconds),start=Number(body.startSeconds),end=Number(body.endSeconds);
    if(!Number.isFinite(duration)||!Number.isFinite(start)||!Number.isFinite(end)||start<0||end>duration+.01||end-start<.25)throw problem("Choose a valid range inside the source video.");
    if(body.transition&&!['cut','fade','dip'].includes(body.transition))throw problem("This transition is not implemented. Choose cut, fade, or dip to black.");
    const clamp=(n,min,max,def)=>Number.isFinite(Number(n))?Math.max(min,Math.min(max,Number(n))):def;
    const payload={operation:"render_edit",workspaceId,projectId,mediaAssetId,clipId:clipId||null,requestedBy:user.id,
      startSeconds:start,endSeconds:end,title:String(body.title||asset.name).slice(0,180),
      aspect:["9:16","16:9","1:1"].includes(body.aspect)?body.aspect:"9:16",speed:clamp(body.speed,.5,2,1),zoom:clamp(body.zoom,1,1.4,1),
      captions:body.captions!==false,captionStyle:["pop","bold","minimal"].includes(body.captionStyle)?body.captionStyle:"pop",
      captionColor:/^#[\da-f]{6}$/i.test(body.captionColor||"")?body.captionColor:"#ffffff",
      effect:["cinematic","warm","cool","mono","vibrant"].includes(body.effect)?body.effect:"none",
      transition:["fade","dip"].includes(body.transition)?body.transition:"cut",reframe:body.autoReframe!==false,
      aiPrompt:String(body.aiPrompt||"").slice(0,6000)};
    const job=checked(await admin.from("processing_jobs").insert({workspace_id:workspaceId,project_id:projectId,job_type:"render_edit",status:"queued",progress:0,payload}).select("id").single());
    const warning=await wakeWorker({...payload,jobId:job.id},token);
    return Response.json({jobId:job.id,warning},{status:202});
  }catch(error){return workflowError(error)}
}
