import {authorizeWorkflow,checked,problem,wakeWorker,workflowError} from '../../../../lib/workflow-server';
export const runtime='nodejs';
export async function POST(request){
  try{
    const {workspaceId,jobId,action}=await request.json();
    const {admin,token}=await authorizeWorkflow(request,workspaceId);
    if(!['cancel','retry'].includes(action))throw problem('Choose cancel or retry.');
    const job=checked(await admin.from('processing_jobs').select('id,project_id,status,payload').eq('id',jobId).eq('workspace_id',workspaceId).maybeSingle());
    if(!job)throw problem('Job not found.',404);
    const allowed=action==='retry'?['failed','cancelled']:['queued','processing','awaiting_transcription','transcribing'];
    if(!allowed.includes(job.status))throw problem('This job cannot be changed in its current state.',409);
    const patch=action==='cancel'?{status:'cancelled',lease_until:null}:{status:'queued',error:null,attempt_count:0,lease_until:null,payload:{...job.payload,retryCount:0}};
    const changed=checked(await admin.from('processing_jobs').update(patch).eq('id',job.id).eq('workspace_id',workspaceId).eq('status',job.status).select('id'));
    if(!changed.length)throw problem('The job changed. Refresh before retrying.',409);
    const warning=action==='retry'?await wakeWorker({...patch.payload,jobId:job.id,workspaceId,projectId:job.project_id},token):null;
    return Response.json({ok:true,warning},{status:202});
  }catch(error){return workflowError(error)}
}
