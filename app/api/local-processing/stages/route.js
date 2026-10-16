import {authorizeWorkflow,checked,problem,workflowError} from "../../../../lib/workflow-server";

export const runtime = "nodejs";

export async function POST(request){
  try{
    const body=await request.json();
    const {workspaceId,jobId,action}=body||{};
    const {admin}=await authorizeWorkflow(request,workspaceId);
    const job=checked(await admin.from("processing_jobs").select("id,project_id,workspace_id")
      .eq("id",jobId).eq("workspace_id",workspaceId).maybeSingle());
    if(!job)throw problem("Processing job was not found in this workspace.",404);
    const now=new Date().toISOString();
    const keys=["media_inspection","audio_extraction","transcription","topic_segmentation","clip_scoring","clip_render","export"];
    if(action==="start"){
      const existing=checked(await admin.from("processing_stages").select("stage_key").eq("job_id",jobId));
      const found=new Set((existing||[]).map(stage=>stage.stage_key));
      const rows=keys.filter(key=>!found.has(key)).map(stage_key=>({
        job_id:jobId,workspace_id:workspaceId,stage_key,
        status:stage_key==="media_inspection"||stage_key==="audio_extraction"?"completed":stage_key==="transcription"?"running":"pending",
        progress:stage_key==="media_inspection"||stage_key==="audio_extraction"?100:0,
        started_at:stage_key==="transcription"?now:null,
        completed_at:stage_key==="media_inspection"||stage_key==="audio_extraction"?now:null,
        metadata:{processor:"browser-local"}
      }));
      if(rows.length)checked(await admin.from("processing_stages").insert(rows));
      return Response.json({ok:true,stages:keys.length});
    }
    if(action==="complete"){
      for(const stage_key of ["transcription","topic_segmentation","clip_scoring"]){
        checked(await admin.from("processing_stages").update({
          status:"completed",progress:100,completed_at:now,heartbeat_at:now,error:null,updated_at:now
        }).eq("job_id",jobId).eq("workspace_id",workspaceId).eq("stage_key",stage_key));
      }
      return Response.json({ok:true});
    }
    throw problem("Use action start or complete.");
  }catch(error){return workflowError(error)}
}
