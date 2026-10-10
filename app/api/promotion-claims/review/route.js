import {authorizeWorkflow,checked,problem,workflowError} from '../../../../lib/workflow-server';
export const runtime='nodejs';
export async function POST(request){
  try{
    const body=await request.json().catch(()=>({}));
    const {workspaceId,claimId,status,note}=body;
    if(!claimId||!['approved','rejected'].includes(status))throw problem('claimId and an approved/rejected status are required.');
    const {admin,user}=await authorizeWorkflow(request,workspaceId);
    const member=checked(await admin.from('workspace_members').select('role').eq('workspace_id',workspaceId).eq('user_id',user.id).maybeSingle());
    if(!member||!['owner','admin'].includes(member.role))throw problem('Only workspace owners or admins can review promotion claims.',403);
    const claim=checked(await admin.from('promotion_claims').select('*').eq('id',claimId).eq('workspace_id',workspaceId).maybeSingle());
    if(!claim)throw problem('Promotion claim not found.',404);
    if(claim.status!=='pending')throw problem('This promotion claim has already been reviewed.',409);
    const updated=checked(await admin.from('promotion_claims').update({status,reviewer_note:String(note||'').slice(0,2000),reviewed_at:new Date().toISOString()}).eq('id',claimId).eq('status','pending').select('*').single());
    const ledgerStatus=status==='approved'?'posted':'reversed';
    await admin.from('token_ledger').update({status:ledgerStatus,metadata:{reviewedBy:user.id,status}}).eq('reference_type','promotion_claim').eq('reference_id',claimId).eq('status','pending');
    return Response.json({claim:updated,rewardTokens:status==='approved'?claim.reward_tokens:0,note:status==='approved'?'Tokens posted after manual approval.':'Claim rejected; no tokens were posted.'});
  }catch(error){return workflowError(error)}
}
