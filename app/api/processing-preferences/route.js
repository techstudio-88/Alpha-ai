import {authorizeWorkflow,checked,problem,wakeWorker,workflowError} from '../../../lib/workflow-server';

export const runtime='nodejs';

import {normalizePreferences} from '../../../lib/chat-brief.mjs';

export async function POST(request){
  try{
    const body=await request.json().catch(()=>({}));
    const {workspaceId,projectId,jobId,preferences={}}=body||{};
    const {admin,token,user}=await authorizeWorkflow(request,workspaceId);
    if(!projectId||!jobId)throw problem('Project and processing job are required.');
    const job=checked(await admin.from('processing_jobs').select('id,workspace_id,project_id,status,payload').eq('id',jobId).eq('workspace_id',workspaceId).eq('project_id',projectId).maybeSingle());
    if(!job)throw problem('Processing job not found.',404);
    if(job.status!=='awaiting_preferences')throw problem('This job has already started. Refresh the chat to see its progress.',409);
    if(!preferences||typeof preferences!=='object'||Array.isArray(preferences))throw problem('Choose valid clip preferences.');
    const assetId=job.payload?.mediaAssetId||job.payload?.media_asset_id;
    if(!assetId)throw problem('The source video for this job could not be verified.',409);
    const asset=checked(await admin.from('media_assets').select('id,duration_seconds,status,project_id').eq('id',assetId).eq('project_id',projectId).maybeSingle());
    if(!asset)throw problem('Source video not found in this project.',404);
    if(asset.status==='uploading')throw problem('Wait for the source upload to finish before starting clip generation.',409);
    const durationSeconds=Number(asset.duration_seconds);
    if(!Number.isFinite(durationSeconds)||durationSeconds<=0)throw problem('The source video duration is not available yet. Retry after media inspection completes.',409);
    const normalized={...normalizePreferences(preferences),effects:'none',hookMode:'first-three-seconds'};
    const payload={...(job.payload||{}),preferences:normalized,preferencesRequired:false,transcriptOnly:false,retryCount:0};
    const updated=checked(await admin.from('processing_jobs').update({payload,status:'reserving',progress:0,current_stage:null,error:null,attempt_count:0,lease_until:null,lease_token:null,updated_at:new Date().toISOString()}).eq('id',job.id).eq('workspace_id',workspaceId).eq('project_id',projectId).eq('status','awaiting_preferences').select('id,status,payload').maybeSingle());
    if(!updated?.id)throw problem('This job has already started. Refresh the chat to see its progress.',409);
    const credits=Math.max(1,Math.ceil(durationSeconds/60));
    const charge=await admin.rpc('reserve_job_credits',{
      p_workspace_id:workspaceId,p_job_id:job.id,p_user_id:user.id,p_amount:credits,
      p_reason:'Accepted video processing',p_idempotency_key:'processing:'+job.id+':reserve'
    });
    if(charge.error){
      await admin.from('processing_jobs').update({status:'awaiting_preferences',payload:job.payload,error:null,attempt_count:0,updated_at:new Date().toISOString()}).eq('id',job.id).eq('workspace_id',workspaceId).eq('project_id',projectId).eq('status','reserving');
      if(/INSUFFICIENT_CREDITS|credit/i.test(charge.error.message||''))throw problem('Not enough processing credits for this video. Upgrade your plan or add credits to continue.',402);
      throw charge.error;
    }
    const accepted=checked(await admin.from('processing_jobs').update({status:'queued',updated_at:new Date().toISOString()})
      .eq('id',job.id).eq('workspace_id',workspaceId).eq('project_id',projectId).eq('status','reserving')
      .select('id,status').maybeSingle());
    if(!accepted?.id){
      await admin.from('processing_jobs').update({status:'failed',error:'Processing acceptance was interrupted.',updated_at:new Date().toISOString()})
        .eq('id',job.id).eq('workspace_id',workspaceId).eq('status','reserving');
      await admin.rpc('refund_failed_job_credits',{p_workspace_id:workspaceId,p_job_id:job.id,p_user_id:user.id,p_reason:'Refund after interrupted acceptance',p_idempotency_key:'processing:'+job.id+':acceptance-refund'});
      throw problem('The job changed before processing could start. Refresh and try again.',409);
    }
    const warning=await wakeWorker({...payload,jobId:job.id,workspaceId,projectId},token);
    return Response.json({ok:true,job:updated,charge:charge.data,warning});
  }catch(error){return workflowError(error)}
}
