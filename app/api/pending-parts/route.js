import {authorizeWorkflow,checked,problem,workflowError} from "../../../lib/workflow-server";
import {UUID} from "../../../lib/video-workflow.mjs";
export const runtime="nodejs";
export const dynamic="force-dynamic";

export async function GET(request){
  try{
    const workspaceId=new URL(request.url).searchParams.get("workspace_id");
    const {admin,user}=await authorizeWorkflow(request,workspaceId);
    const rows=checked(await admin.from("pending_processing_parts")
      .select("id,workspace_id,project_id,user_id,media_asset_id,parent_job_id,part_number,start_seconds,end_seconds,usage_date,timezone,scheduled_for,status,job_id,expires_at,decided_at,created_at,updated_at")
      .eq("workspace_id",workspaceId).eq("user_id",user.id)
      .order("scheduled_for",{ascending:true}).limit(100));
    return Response.json({items:(rows||[]).map(row=>({
      id:row.id,projectId:row.project_id,mediaAssetId:row.media_asset_id,parentJobId:row.parent_job_id,
      partNumber:row.part_number,startSeconds:Number(row.start_seconds),endSeconds:Number(row.end_seconds),
      usageDate:row.usage_date,timezone:row.timezone,scheduledFor:row.scheduled_for,status:row.status,
      jobId:row.job_id,expiresAt:row.expires_at,decidedAt:row.decided_at,createdAt:row.created_at
    }))},{headers:{"Cache-Control":"no-store"}});
  }catch(error){return workflowError(error)}
}

export async function POST(request){
  try{
    const body=await request.json();
    const {workspaceId,partId,action,scheduledFor}=body||{};
    if(!UUID.test(partId||""))throw problem("A valid pending-part ID is required.");
    if(!["approve","decline","reschedule"].includes(action))throw problem("Choose approve, decline or reschedule.");
    const {admin,user}=await authorizeWorkflow(request,workspaceId);
    const part=checked(await admin.from("pending_processing_parts").select("id,status,expires_at,scheduled_for")
      .eq("id",partId).eq("workspace_id",workspaceId).eq("user_id",user.id).maybeSingle());
    if(!part)throw problem("Pending part not found.",404);
    if(part.status!=="pending"&&!(action==="reschedule"&&part.status==="approved"))
      throw problem("This part can no longer be changed.",409);
    if(action==="approve"&&new Date(part.expires_at).getTime()<=Date.now())
      throw problem("This pending part expired. Import the source again to schedule it.",410);
    let patch={updated_at:new Date().toISOString()};
    if(action==="approve")patch={...patch,status:"approved",decided_at:new Date().toISOString()};
    if(action==="decline")patch={...patch,status:"declined",decided_at:new Date().toISOString()};
    if(action==="reschedule"){
      const parsed=Date.parse(scheduledFor||"");
      if(!Number.isFinite(parsed)||parsed<=Date.now())throw problem("Choose a future scheduled time.");
      if(parsed>Date.now()+30*24*60*60*1000)throw problem("Choose a time within the next 30 days.");
      patch={...patch,scheduled_for:new Date(parsed).toISOString()};
    }
    const changed=checked(await admin.from("pending_processing_parts").update(patch)
      .eq("id",partId).eq("workspace_id",workspaceId).eq("user_id",user.id).eq("status",part.status).select("id,status,scheduled_for,expires_at").maybeSingle());
    if(!changed)throw problem("This part changed in another request. Refresh and try again.",409);
    return Response.json({ok:true,item:{id:changed.id,status:changed.status,scheduledFor:changed.scheduled_for,expiresAt:changed.expires_at}},
      {headers:{"Cache-Control":"no-store"}});
  }catch(error){return workflowError(error)}
}
