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
    const timezone=(()=>{const candidate=String(user.user_metadata?.timezone||'Asia/Kolkata');try{new Intl.DateTimeFormat('en-US',{timeZone:candidate});return candidate}catch{return 'Asia/Kolkata'}})();
    const videoDate=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
    const entitlement=checked(await admin.from('workspace_entitlements').select('plan,daily_video_minutes,fair_use_unlimited').eq('workspace_id',workspaceId).maybeSingle());
    const videoUsage=checked(await admin.from('video_usage_daily').select('minutes_reserved,minutes_completed,usage_date,timezone').eq('workspace_id',workspaceId).eq('user_id',user.id).eq('usage_date',videoDate).maybeSingle());
    const videoLimit=Number(entitlement?.daily_video_minutes??20),videoReserved=Number(videoUsage?.minutes_reserved||0),videoCompleted=Number(videoUsage?.minutes_completed||0),videoUnlimited=Boolean(entitlement?.fair_use_unlimited);
    return Response.json({date,dailyTokens:daily,bonusTokens:bonus,spentTokens:spent,availableTokens:Math.max(0,daily+bonus-spent),processingMinutes:Number(allowance?.processing_minutes||0),upgradeRequired:spent>=daily+bonus,
      videoMinutes:{date:videoDate,timezone,plan:entitlement?.plan||'free',limit:videoLimit,reserved:videoReserved,completed:videoCompleted,used:videoReserved+videoCompleted,remaining:videoUnlimited?null:Math.max(0,videoLimit-videoReserved-videoCompleted),unlimited:videoUnlimited}
    },{headers:{'Cache-Control':'no-store'}});
  }catch(error){return workflowError(error)}
}
