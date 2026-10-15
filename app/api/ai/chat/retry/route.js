import {authorizeWorkflow,checked,problem,wakeWorker,workflowError} from "../../../../../lib/workflow-server";
import {UUID} from "../../../../../lib/video-workflow.mjs";
import {checkRateLimit,rateLimitResponse,resolveWorkspacePlan} from "../../../../../lib/rate-limit";
export const runtime="nodejs";
export async function POST(request){
  try{
    const {workspaceId,jobId}=await request.json();
    if(!UUID.test(jobId||""))throw problem("A valid job is required.");
    const {admin,user,token}=await authorizeWorkflow(request,workspaceId);
    const plan=await resolveWorkspacePlan(admin,workspaceId);
    const rate=await checkRateLimit(request,{endpoint:"ai_call",userId:user.id,plan});
    const blocked=rateLimitResponse(rate);if(blocked)return blocked;
    const job=checked(await admin.from("processing_jobs").select("*").eq("id",jobId).eq("workspace_id",workspaceId).maybeSingle());
    if(!job||job.payload?.requestedBy!==user.id)throw problem("Job not found.",404);
    if(job.status!=="failed")throw problem("Only failed jobs can be retried.",409);
    checked(await admin.from("processing_jobs").update({status:"queued",error:null,lease_until:null,attempt_count:0,
      payload:{...job.payload,retryCount:0}}).eq("id",jobId).eq("status","failed"));
    const warning=await wakeWorker({...job.payload,jobId,workspaceId,projectId:job.project_id},token);
    return Response.json({jobId,warning},{status:202});
  }catch(error){return workflowError(error)}
}
