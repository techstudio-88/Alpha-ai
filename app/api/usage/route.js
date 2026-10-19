import {authorizeWorkflow,checked,workflowError} from '../../../lib/workflow-server';
export const runtime='nodejs';
export async function GET(request){
  try{
    const workspaceId=new URL(request.url).searchParams.get('workspace_id');
    const {admin,user}=await authorizeWorkflow(request,workspaceId);
    const date=new Date().toISOString().slice(0,10);
    const allowance=checked(await admin.rpc('ensure_daily_token_allowance',{p_workspace_id:workspaceId,p_user_id:user.id,p_usage_date:date}));
    const ledger=checked(await admin.from('token_ledger').select('amount,entry_type,status').eq('workspace_id',workspaceId).eq('user_id',user.id));
    const postedRewards=(ledger||[]).filter(row=>row.entry_type==='reward'&&row.status==='posted').reduce((sum,row)=>sum+Number(row.amount||0),0);
    const postedSpend=(ledger||[]).filter(row=>row.entry_type==='spend'&&row.status==='posted').reduce((sum,row)=>sum+Math.abs(Number(row.amount||0)),0);
    const daily=Number(allowance?.daily_tokens??100),spent=Math.max(Number(allowance?.tokens_spent||0),postedSpend),bonus=postedRewards;
    const entitlement=checked(await admin.from('workspace_entitlements').select('plan').eq('workspace_id',workspaceId).maybeSingle());
    const plan=['pro','studio'].includes(String(entitlement?.plan||'free').toLowerCase())?String(entitlement.plan).toLowerCase():'free';
    const creditRow=checked(await admin.from('usage_credits').select('credits').eq('workspace_id',workspaceId).eq('user_id',user.id).maybeSingle());
    const creditBalance=creditRow?.credits!=null?Number(creditRow.credits):Math.max(0,daily+bonus-spent);
    return Response.json({
      date,
      plan,
      credits:creditBalance,
      dailyCredits:daily,
      bonusCredits:bonus,
      spentCredits:spent,
      availableCredits:creditBalance,
      dailyTokens:daily,
      bonusTokens:bonus,
      spentTokens:spent,
      availableTokens:creditBalance,
      dailyVideoMinutes:20,
      processingMinutes:Number(allowance?.processing_minutes||0),
      upgradeRequired:creditBalance<=0 && spent>=daily+bonus
    },{headers:{'Cache-Control':'no-store'}});
  }catch(error){return workflowError(error)}
}
