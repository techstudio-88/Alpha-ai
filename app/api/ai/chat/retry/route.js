import {authorizeWorkflow,checked,problem,wakeWorker,workflowError} from "../../../../../lib/workflow-server";
export const runtime="nodejs";
export async function POST(request){
  try{
    const {workspaceId,jobId}=await request.json();
    const {admin,user,token}=await authorizeWorkflow(request,workspaceId);
    const job=checked(await admin.from("processing_jobs").select("*").eq("id",jobId).eq("workspace_id",workspaceId).maybeSingle());
    if(!job||job.payload?.requestedBy!==user.id)throw problem("Job not found.",404);
    if(job.status!=="failed")throw problem("Only failed jobs can be retried.",409);
    checked(await admin.from("processing_jobs").update({status:"queued",error:null,lease_until:null,attempt_count:0,
      payload:{...job.payload,retryCount:0}}).eq("id",jobId).eq("status","failed"));
    const warning=await wakeWorker({...job.payload,jobId,workspaceId,projectId:job.project_id},token);
    return Response.json({jobId,warning},{status:202});
  }catch(error){return workflowError(error)}
}
