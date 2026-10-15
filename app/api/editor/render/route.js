import {authorizeWorkflow,mediaContext,problem,wakeWorker,workflowError} from '../../../../lib/workflow-server';
import {requireWorkerCapability} from '../../../../lib/worker-capabilities';
import {enqueueEditorRender} from '../../../../lib/editor-render.mjs';
import {checkRateLimit,rateLimitResponse,resolveWorkspacePlan} from '../../../../lib/rate-limit';
export const runtime='nodejs';
export const maxDuration=30;
export async function POST(request){
  try{
    const body=await request.json();
    const context=await authorizeWorkflow(request,body.workspaceId);
    const plan=await resolveWorkspacePlan(context.admin,body.workspaceId);
    const rate=await checkRateLimit(request,{endpoint:'api',userId:context.user.id,plan});
    const blocked=rateLimitResponse(rate);if(blocked)return blocked;
    const {asset}=await mediaContext(context.admin,body.workspaceId,body.projectId,body.mediaAssetId);
    if(!asset?.storage_path)throw problem('Source video is not stored. Re-import it before editing.',409);
    const result=await enqueueEditorRender({...context,body,asset,requireCapability:requireWorkerCapability,wake:wakeWorker});
    return Response.json(result,{status:202});
  }catch(error){return workflowError(error)}
}
