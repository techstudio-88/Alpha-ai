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
    const normalized={...normalizePreferences(preferences),effects:'none',hookMode:'first-three-seconds'};
    const payload={...(job.payload||{}),preferences:normalized,preferencesRequired:false,transcriptOnly:false,retryCount:0};
    const updated=checked(await admin.from('processing_jobs').update({payload,status:'queued',progress:0,current_stage:null,error:null,attempt_count:0,lease_until:null,lease_token:null,updated_at:new Date().toISOString()}).eq('id',job.id).eq('workspace_id',workspaceId).eq('status','awaiting_preferences').select('id,status,payload').maybeSingle());
    if(!updated?.id)throw problem('This job has already started. Refresh the chat to see its progress.',409);
    const asset=checked(await admin.from('media_assets').select('duration_seconds').eq('id',job.payload?.mediaAssetId||job.payload?.media_asset_id).eq('project_id',projectId).maybeSingle());
    const charge=await admin.rpc('consume_processing_tokens',{p_workspace_id:workspaceId,p_user_id:user.id,p_job_id:job.id,p_processing_minutes:Math.min(20,Math.max(0,Number(asset?.duration_seconds||0))/60)});
    if(charge.error){await admin.from('processing_jobs').update({status:'awaiting_preferences',payload:job.payload,error:null,attempt_count:0,updated_at:new Date().toISOString()}).eq('id',job.id).eq('status','queued');if(/allowance|token/i.test(charge.error.message||''))throw problem('Your daily 100-token allowance is used. Wait for tomorrow or upgrade to continue processing.',402);throw charge.error;}
    const warning=await wakeWorker({...payload,jobId:job.id,workspaceId,projectId},token);
    return Response.json({ok:true,job:updated,charge:charge.data,warning});
  }catch(error){return workflowError(error)}
}
