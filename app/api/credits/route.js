import {randomUUID} from "node:crypto";
import {authorizeWorkflow,checked,workflowError} from "../../../lib/workflow-server";
import {checkRateLimit,rateLimitResponse,resolveWorkspacePlan} from "../../../lib/rate-limit";

export const runtime="nodejs";

export async function GET(request) {
  try {
    const url=new URL(request.url);
    const workspaceId=url.searchParams.get("workspace_id");
    const {admin,user}=await authorizeWorkflow(request,workspaceId);
    const plan=await resolveWorkspacePlan(admin,workspaceId);
    const rate=await checkRateLimit(request,{endpoint:"api",userId:user.id,plan});
    const blocked=rateLimitResponse(rate);if(blocked)return blocked;
    const balance=checked(await admin.from("usage_credits")
      .select("credits,updated_at")
      .eq("workspace_id",workspaceId).eq("user_id",user.id).maybeSingle());
    const transactions=checked(await admin.from("credit_ledger")
      .select("id,job_id,amount,transaction_type,reason,idempotency_key,created_at")
      .eq("workspace_id",workspaceId).eq("user_id",user.id)
      .order("created_at",{ascending:false}).limit(100));
    return Response.json({
      balance:Number(balance?.credits||0),
      updatedAt:balance?.updated_at||null,
      transactions:(transactions||[]).map(({id,job_id,amount,transaction_type,reason,created_at})=>({
        transactionId:id,jobId:job_id,amount, type:transaction_type,reason,createdAt:created_at
      }))
    },{headers:{"Cache-Control":"no-store"}});
  } catch(error) {
    return workflowError(error);
  }
}

export async function POST() {
  const errorId=randomUUID();
  console.error("credits_write_blocked",{errorId});
  return Response.json({error:"Credit changes can only be made by an accepted job or an authorized support action.",errorId},{status:405,headers:{"Cache-Control":"no-store"}});
}
