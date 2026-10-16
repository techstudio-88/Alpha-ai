import {createClient} from "@supabase/supabase-js";
import {randomUUID} from "node:crypto";
import {checkRateLimit,rateLimitResponse} from "../../../../../../lib/rate-limit";
export const runtime="nodejs";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fail=(error,status,errorId)=>Response.json({error,errorId},{status,headers:{"Cache-Control":"no-store"}});
export async function POST(request){
  const errorId=randomUUID();
  try{
    const authorization=request.headers.get("authorization")||"";
    if(!authorization.startsWith("Bearer "))return fail("Authentication required.",401,errorId);
    const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
    const publicKey=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SECRET_KEY;
    if(!url||!publicKey||!serviceKey)return fail("Credit administration is temporarily unavailable.",503,errorId);
    const options={auth:{persistSession:false,autoRefreshToken:false}};
    const {data:{user},error:userError}=await createClient(url,publicKey,options).auth.getUser(authorization.slice(7));
    if(userError||!user?.email)return fail("A verified admin session is required.",401,errorId);
    const admin=createClient(url,serviceKey,options);
    const {data:member,error:memberError}=await admin.from("control_center_members").select("role")
      .eq("email",user.email).eq("active",true).maybeSingle();
    if(memberError)return fail("Unable to verify admin access.",500,errorId);
    if(!member)return fail("Admin access denied.",403,errorId);
    const rate=await checkRateLimit(request,{endpoint:"api",userId:user.id,plan:"studio"});
    const blocked=rateLimitResponse(rate);if(blocked)return blocked;
    const body=await request.json();
    const {workspaceId,targetUserId,amount,reason,idempotencyKey}=body||{};
    if(!UUID.test(workspaceId||"")||!UUID.test(targetUserId||""))return fail("Choose a valid workspace and user.",400,errorId);
    if(!Number.isInteger(amount)||amount===0||Math.abs(amount)>1000000)return fail("Enter a non-zero whole-number credit adjustment within the allowed range.",400,errorId);
    if(typeof reason!=="string"||reason.trim().length<3||reason.trim().length>500)return fail("Provide an adjustment reason between 3 and 500 characters.",400,errorId);
    if(typeof idempotencyKey!=="string"||idempotencyKey.trim().length<8||idempotencyKey.length>200)return fail("A valid adjustment request ID is required.",400,errorId);
    const {data,error}=await admin.rpc("admin_adjust_credits",{
      p_workspace_id:workspaceId,p_target_user_id:targetUserId,p_actor_user_id:user.id,
      p_amount:amount,p_reason:reason.trim(),p_idempotency_key:idempotencyKey.trim()
    });
    if(error){
      if(/INSUFFICIENT_CREDITS/.test(String(error.message||"")))return fail("This adjustment would make the user's credit balance negative.",409,errorId);
      if(/Admin access denied|Target workspace access denied/.test(String(error.message||"")))return fail("Admin or target workspace access denied.",403,errorId);
      return fail("The credit adjustment could not be saved. Please retry.",500,errorId);
    }
    return Response.json({ok:true,transaction:{transactionId:data?.id,workspaceId:data?.workspace_id,
      userId:data?.user_id,amount:data?.amount,type:data?.transaction_type,reason:data?.reason,createdAt:data?.created_at}},
      {headers:{"Cache-Control":"no-store"}});
  }catch{
    console.error("admin_credit_adjustment_failure",{errorId,category:"internal"});
    return fail("The credit adjustment could not be saved. Contact support with the error ID.",500,errorId);
  }
}
