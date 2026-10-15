import {authorizeWorkflow,checked,workflowError} from '../../../lib/workflow-server';
import {checkRateLimit,rateLimitResponse,resolveWorkspacePlan} from '../../../lib/rate-limit';
export const runtime='nodejs';
export async function GET(request){
  try{
    const workspaceId=new URL(request.url).searchParams.get('workspace_id');
    const {admin,user}=await authorizeWorkflow(request,workspaceId);
    const plan=await resolveWorkspacePlan(admin,workspaceId);
    const rate=await checkRateLimit(request,{endpoint:'api',userId:user.id,plan});
    const blocked=rateLimitResponse(rate);if(blocked)return blocked;
    const date=new Date().toISOString().slice(0,10);
    const allowance=checked(await admin.rpc('ensure_daily_token_allowance',{p_workspace_id:workspaceId,p_user_id:user.id,p_usage_date:date}));
    const ledger=checked(await admin.from('token_ledger').select('amount,entry_type,status').eq('workspace_id',workspaceId).eq('user_id',user.id));
    const postedRewards=(ledger||[]).filter(row=>row.entry_type==='reward'&&row.status==='posted').reduce((sum,row)=>sum+Number(row.amount||0),0);
    const postedSpend=(ledger||[]).filter(row=>row.entry_type==='spend'&&row.status==='posted').reduce((sum,row)=>sum+Math.abs(Number(row.amount||0)),0);
    const daily=Number(allowance?.daily_tokens??100),spent=Math.max(Number(allowance?.tokens_spent||0),postedSpend),bonus=postedRewards;
    return Response.json({date,dailyTokens:daily,bonusTokens:bonus,spentTokens:spent,availableTokens:Math.max(0,daily+bonus-spent),processingMinutes:Number(allowance?.processing_minutes||0),upgradeRequired:spent>=daily+bonus},{headers:{'Cache-Control':'no-store'}});
  }catch(error){return workflowError(error)}
}
