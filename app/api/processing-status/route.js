import {createClient} from "@supabase/supabase-js";
import {randomUUID} from "node:crypto";
import {authorizeWorkflow,checked,problem,workflowError} from "../../../lib/workflow-server";
import {UUID} from "../../../lib/video-workflow.mjs";
import {checkRateLimit,rateLimitResponse,resolveWorkspacePlan} from "../../../lib/rate-limit";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const fail=(error,status,errorId=randomUUID())=>Response.json({error,errorId},{status,headers:{"Cache-Control":"no-store"}});
export async function POST(request){
  try{
    const {workspaceId,jobId}=await request.json();
    if(!UUID.test(jobId||""))throw problem("A valid job is required.");
    const {admin,token}=await authorizeWorkflow(request,workspaceId);
    const job=checked(await admin.from("processing_jobs").select("id,project_id,status,payload").eq("id",jobId).eq("workspace_id",workspaceId).maybeSingle());
    if(!job)throw problem("Processing job not found.",404);
    if(!["queued","processing","transcribing","awaiting_transcription"].includes(job.status))
      return Response.json({jobId,status:job.status},{headers:{"Cache-Control":"no-store"}});
    const warning=await (async()=>{try{
      const workerBase=process.env.MEDIA_WORKER_URL||"https://alpha-ai-media-worker.onrender.com";
      const response=await fetch((workerBase.endsWith("/")?workerBase.slice(0,-1):workerBase)+"/process",{
        method:"POST",headers:{"content-type":"application/json",authorization:"Bearer "+token,
          ...(process.env.MEDIA_WORKER_SECRET?{"x-worker-secret":process.env.MEDIA_WORKER_SECRET}:{})},
        body:JSON.stringify({...job.payload,jobId,workspaceId,projectId:job.project_id}),
        signal:AbortSignal.timeout(8000),cache:"no-store"});
      return response.ok?null:"The job is saved and will retry if the worker is unavailable.";
    }catch{return "The job is saved and will retry if the worker is unavailable."}})();
    return Response.json({jobId,status:job.status,warning},{status:202,headers:{"Cache-Control":"no-store"}});
  }catch(error){return workflowError(error)}
}
export async function GET(request){
  const errorId=randomUUID();
  try{
    const auth=request.headers.get("authorization")||"";
    if(!auth.startsWith("Bearer "))return fail("Authentication required.",401,errorId);
    const token=auth.slice(7);
    const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
    const publicKey=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY||process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    const serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SECRET_KEY;
    if(!url||!publicKey||!serviceKey)return fail("The service is temporarily unavailable.",503,errorId);
    const authClient=createClient(url,publicKey,{auth:{persistSession:false,autoRefreshToken:false}});
    const {data:{user},error:userError}=await authClient.auth.getUser(token);
    if(userError||!user)return fail("Your session is invalid or expired. Sign in again.",401,errorId);
    const jobId=new URL(request.url).searchParams.get("jobId");
    if(!UUID.test(jobId||""))return fail("A valid job ID is required.",400,errorId);
    const admin=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
    const {data:job,error:jobError}=await admin.from("processing_jobs")
      .select("id,workspace_id,project_id,status,progress,error,error_id,failure_type,updated_at,output_locations")
      .eq("id",jobId).maybeSingle();
    if(jobError)return fail("Unable to read processing status. Please retry.",500,errorId);
    if(!job)return fail("Processing job not found.",404,errorId);
    const {data:member,error:memberError}=await admin.from("workspace_members").select("workspace_id")
      .eq("workspace_id",job.workspace_id).eq("user_id",user.id).maybeSingle();
    if(memberError)return fail("Unable to verify workspace access.",500,errorId);
    if(!member)return fail("Workspace access denied.",403,errorId);
    const plan=await resolveWorkspacePlan(admin,job.workspace_id);
    const rate=await checkRateLimit(request,{endpoint:"api",userId:user.id,plan});
    const blocked=rateLimitResponse(rate);if(blocked)return blocked;
    return Response.json({job:{...job,error:job.status==="failed"||job.status==="dead_letter"?job.error:null}},{headers:{"Cache-Control":"no-store"}});
  }catch{
    console.error("processing_status_failure",{errorId,category:"internal"});
    return fail("Unable to read processing status. Please retry.",500,errorId);
  }
}
