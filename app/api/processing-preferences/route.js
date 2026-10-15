import {authorizeWorkflow,checked,problem,wakeWorker,workflowError} from '../../../lib/workflow-server';

export const runtime='nodejs';

import {normalizePreferences} from '../../../lib/chat-brief.mjs';
import {UUID} from '../../../lib/video-workflow.mjs';
import {checkRateLimit,rateLimitResponse,resolveWorkspacePlan} from '../../../lib/rate-limit';

export async function POST(request){
  try{
    const body=await request.json().catch(()=>({}));
    const {workspaceId,projectId,jobId,preferences={}}=body||{};
    const {admin,token,user}=await authorizeWorkflow(request,workspaceId);
    const plan=await resolveWorkspacePlan(admin,workspaceId);
    const rate=await checkRateLimit(request,{endpoint:'api',userId:user.id,plan});
    const blocked=rateLimitResponse(rate);if(blocked)return blocked;
    if(!UUID.test(projectId||'')||!UUID.test(jobId||''))throw problem('Valid project and processing job IDs are required.');
    const job=checked(await admin.from('processing_jobs').select('id,workspace_id,project_id,status,payload').eq('id',jobId).eq('workspace_id',workspaceId).eq('project_id',projectId).maybeSingle());
    if(!job)throw problem('Processing job not found.',404);
    if(job.status!=='awaiting_preferences')throw problem('This job has already started. Refresh the chat to see its progress.',409);
    const normalized={...normalizePreferences(preferences),effects:'none',hookMode:'first-three-seconds'};
    const timezone=(()=>{const candidate=request.headers.get('x-user-timezone')||'Asia/Kolkata';try{new Intl.DateTimeFormat('en-US',{timeZone:candidate});return candidate}catch{return 'Asia/Kolkata'}})();
    const payload={...(job.payload||{}),preferences:normalized,timezone,preferencesRequired:false,transcriptOnly:false,retryCount:0};
    const updated=checked(await admin.from('processing_jobs').update({payload,status:'queued',progress:0,current_stage:null,error:null,attempt_count:0,lease_until:null,lease_token:null,updated_at:new Date().toISOString()}).eq('id',job.id).eq('workspace_id',workspaceId).eq('status','awaiting_preferences').select('id,status,payload').maybeSingle());
    if(!updated?.id)throw problem('This job has already started. Refresh the chat to see its progress.',409);
    const warning=await wakeWorker({...payload,jobId:job.id,workspaceId,projectId},token);
    return Response.json({ok:true,job:updated,warning});
  }catch(error){return workflowError(error)}
}
