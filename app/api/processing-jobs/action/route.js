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
    const isPartJob=Boolean(job.payload?.scheduledPartId);
    const retryPayload=isPartJob?{...job.payload,retryCount:0,videoQuotaPlanned:true}:{...job.payload,retryCount:0,videoQuotaPlanned:false,videoQuotaPlan:null,partStartSeconds:null,partEndSeconds:null,partNumber:null,usageDate:null};
    const patch=action==='cancel'?{status:'cancelled',lease_until:null,cancel_requested_at:new Date().toISOString()}:{status:'queued',error:null,attempt_count:0,lease_until:null,next_retry_at:null,dead_lettered_at:null,error_id:null,failure_type:null,payload:retryPayload};
    const changed=checked(await admin.from('processing_jobs').update(patch).eq('id',job.id).eq('workspace_id',workspaceId).eq('status',job.status).select('id'));
    if(!changed.length)throw problem('The job changed. Refresh before retrying.',409);
    let accountingWarning=null;
    if(action==='cancel'){
      const cancelledAt=new Date().toISOString();
      if(job.payload?.scheduledPartId)await admin.from('pending_processing_parts').update({status:'cancelled',decided_at:cancelledAt,updated_at:cancelledAt}).eq('id',job.payload.scheduledPartId);
      const childParts=await admin.from('pending_processing_parts').select('id,job_id').eq('parent_job_id',job.id).in('status',['pending','approved','queued','processing']);
      await admin.from('pending_processing_parts').update({status:'cancelled',decided_at:cancelledAt,updated_at:cancelledAt}).eq('parent_job_id',job.id).in('status',['pending','approved','queued','processing']);
      for(const part of childParts.data||[]){
        if(!part.job_id||part.job_id===job.id)continue;
        const cancelledChild=await admin.from('processing_jobs').update({status:'cancelled',cancel_requested_at:cancelledAt,lease_until:null,next_retry_at:null}).eq('id',part.job_id).in('status',['queued','processing','awaiting_transcription','transcribing']).select('id');
        if(cancelledChild.data?.length)await admin.rpc('finish_video_usage_for_job',{p_job_id:part.job_id,p_succeeded:false});
      }
      const usageResult=await admin.rpc('finish_video_usage_for_job',{p_job_id:job.id,p_succeeded:false});
      if(usageResult.error)accountingWarning='Cancellation succeeded, but reserved video minutes need reconciliation.';
      const requester=job.payload?.requestedBy;
      if(requester){
        const refund=await admin.rpc('refund_failed_job_credits',{p_workspace_id:workspaceId,p_job_id:job.id,p_user_id:requester,p_reason:'Refund after user cancellation',p_idempotency_key:'job:'+job.id+':refund'});
        if(refund.error)accountingWarning='Cancellation succeeded, but credit refund needs reconciliation.';
      }
    }
    const warning=action==='retry'?await wakeWorker({...patch.payload,jobId:job.id,workspaceId,projectId:job.project_id},token):accountingWarning;
    return Response.json({ok:true,warning},{status:202});
  }catch(error){return workflowError(error)}
}
