import{createClient}from"@supabase/supabase-js";
import {authorizeWorkflow,checked,problem,wakeWorker,workflowError} from "../../../lib/workflow-server";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function POST(request){
  try{
    const {workspaceId,jobId}=await request.json();
    const {admin,token}=await authorizeWorkflow(request,workspaceId);
    const job=checked(await admin.from("processing_jobs").select("id,project_id,status,payload").eq("id",jobId).eq("workspace_id",workspaceId).maybeSingle());
    if(!job)throw problem("Processing job not found.",404);
    if(!["queued","processing"].includes(job.status))return Response.json({jobId,status:job.status});
    const warning=await wakeWorker({...job.payload,jobId,workspaceId,projectId:job.project_id},token);
    return Response.json({jobId,status:job.status,warning},{status:202});
  }catch(error){return workflowError(error)}
}
export async function GET(request){
  try{
    const auth=request.headers.get("authorization")||"";
    if(!auth.startsWith("Bearer "))return Response.json({error:"Authentication required."},{status:401});
    const token=auth.slice(7);
    const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
    const publicKey=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY||process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    const serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SECRET_KEY;
    if(!url||!publicKey||!serviceKey)return Response.json({error:"Supabase server credentials are not configured."},{status:503});
    const authClient=createClient(url,publicKey,{auth:{persistSession:false,autoRefreshToken:false}});
    const{data:{user},error:userError}=await authClient.auth.getUser(token);
    if(userError||!user)return Response.json({error:"Invalid session."},{status:401});
    const jobId=new URL(request.url).searchParams.get("jobId");
    if(!jobId)return Response.json({error:"Job ID is required."},{status:400});
    const admin=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
    const{data:job,error:jobError}=await admin.from("processing_jobs").select("id,workspace_id,project_id,status,progress,error,updated_at").eq("id",jobId).maybeSingle();
    if(jobError)return Response.json({error:jobError.message},{status:500});
    if(!job)return Response.json({error:"Processing job not found."},{status:404});
    const{data:member,error:memberError}=await admin.from("workspace_members").select("workspace_id").eq("workspace_id",job.workspace_id).eq("user_id",user.id).maybeSingle();
    if(memberError)return Response.json({error:memberError.message},{status:500});
    if(!member)return Response.json({error:"Workspace access denied."},{status:403});
    return new Response(JSON.stringify({job}),{
      status:200,
      headers:{"Content-Type":"application/json","Cache-Control":"no-store, no-cache, must-revalidate, proxy-revalidate"}
    });
  }catch(error){
    console.error("processing-status",error);
    return Response.json({error:error?.message||"Unable to read processing status."},{status:500});
  }
}
