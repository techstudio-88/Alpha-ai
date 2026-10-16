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
      .select("id,workspace_id,user_id,status,scheduled_for")
      .eq("id",partId).eq("workspace_id",workspaceId).maybeSingle());
    if(!part)throw problem("Pending video part not found.",404);
    const nextStatus=nextPendingPartStatus(part.status,action);
    if(nextStatus===part.status)return Response.json({ok:true,partId,status:part.status,duplicate:true});
    const changed=checked(await admin.from("pending_processing_parts")
      .update({status:nextStatus,decided_at:new Date().toISOString(),updated_at:new Date().toISOString()})
      .eq("id",partId).eq("workspace_id",workspaceId).eq("status","pending").select("id"));
    if(!changed.length)throw problem("This pending part was changed by another request. Refresh and try again.",409);
    return Response.json({ok:true,partId,status:nextStatus,scheduledFor:part.scheduled_for},{status:202});
  } catch(error) { return workflowError(error); }
}
