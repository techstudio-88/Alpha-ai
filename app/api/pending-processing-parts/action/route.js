import {authorizeWorkflow,checked,problem,workflowError} from "../../../../lib/workflow-server";
import {UUID} from "../../../../lib/video-workflow.mjs";
import {nextPendingPartStatus} from "../../../../lib/pending-part-actions.mjs";

export const runtime="nodejs";
export async function POST(request) {
  try {
    const {workspaceId,partId,action}=await request.json();
    const {admin}=await authorizeWorkflow(request,workspaceId);
    if(!UUID.test(partId||""))throw problem("A valid pending-part ID is required.");
    const part=checked(await admin.from("pending_processing_parts")
      .select("id,workspace_id,user_id,status,scheduled_for,parent_job_id,project_id")
      .eq("id",partId).eq("workspace_id",workspaceId).maybeSingle());
    if(!part)throw problem("Pending video part not found.",404);
    const nextStatus=nextPendingPartStatus(part.status,action);
    if(nextStatus===part.status)return Response.json({ok:true,partId,status:part.status,duplicate:true});
    const changed=checked(await admin.from("pending_processing_parts")
      .update({status:nextStatus,decided_at:new Date().toISOString(),updated_at:new Date().toISOString()})
      .eq("id",partId).eq("workspace_id",workspaceId).eq("status","pending").select("id"));
    if(!changed.length)throw problem("This pending part was changed by another request. Refresh and try again.",409);
    if(action==="reject"&&part.parent_job_id){
      const outstanding=checked(await admin.from("pending_processing_parts").select("id").eq("parent_job_id",part.parent_job_id).in("status",["pending","approved","queued","processing"]).limit(1));
      if(!outstanding.length){
        const parent=checked(await admin.from("processing_jobs").select("status").eq("id",part.parent_job_id).maybeSingle());
        if(parent?.status==="completed")await admin.from("projects").update({status:"ready"}).eq("id",part.project_id);
      }
    }
    return Response.json({ok:true,partId,status:nextStatus,scheduledFor:part.scheduled_for},{status:202});
  } catch(error) { return workflowError(error); }
}
