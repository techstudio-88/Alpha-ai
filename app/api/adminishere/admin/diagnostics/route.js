import {createClient} from "@supabase/supabase-js";
import {randomUUID} from "node:crypto";
import {checkRateLimit,rateLimitResponse} from "../../../../lib/rate-limit";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const fail=(message,status,errorId)=>Response.json({error:message,errorId},{status,headers:{"Cache-Control":"no-store"}});
export async function GET(request){
  const errorId=randomUUID();
  try{
    const auth=request.headers.get("authorization")||"";
    if(!auth.startsWith("Bearer "))return fail("Authentication required.",401,errorId);
    const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
    const publicKey=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SECRET_KEY;
    if(!url||!publicKey||!serviceKey)return fail("Admin diagnostics are temporarily unavailable.",503,errorId);
    const options={auth:{persistSession:false,autoRefreshToken:false}};
    const {data:{user},error:userError}=await createClient(url,publicKey,options).auth.getUser(auth.slice(7));
    if(userError||!user?.email)return fail("A verified admin session is required.",401,errorId);
    const admin=createClient(url,serviceKey,options);
    const {data:member,error:memberError}=await admin.from("control_center_members").select("role")
      .eq("email",user.email).eq("active",true).maybeSingle();
    if(memberError)return fail("Unable to verify admin access.",500,errorId);
    if(!member)return fail("Admin access denied.",403,errorId);
    const rate=await checkRateLimit(request,{endpoint:"api",userId:user.id,plan:"studio"});
    const blocked=rateLimitResponse(rate);if(blocked)return blocked;

    const [jobsResult,keysResult,creditsResult,publishResult,sourceResult]=await Promise.all([
      admin.from("processing_jobs").select("id,workspace_id,project_id,status,progress,created_at,updated_at,error,error_id,failure_type,attempt_count,next_retry_at,dead_lettered_at,output_locations").in("status",["failed","dead_letter","queued","processing"]).order("updated_at",{ascending:false}).limit(100),
      admin.from("gemini_key_health").select("key_label,is_available,cooldown_until,last_status,last_error_id,success_count,failure_count,rate_limit_count,last_used_at,updated_at").order("key_label"),
      admin.from("credit_ledger").select("id,workspace_id,user_id,job_id,amount,transaction_type,reason,created_at").order("created_at",{ascending:false}).limit(50),
      admin.from("publish_jobs").select("id,workspace_id,user_id,clip_id,platform,status,attempt_count,last_attempt_at,created_at,updated_at,published_at").in("status",["failed","queued","processing"]).order("updated_at",{ascending:false}).limit(50),
      admin.from("project_sources").select("id,workspace_id,project_id,source_type,status,created_at").eq("status","failed").order("created_at",{ascending:false}).limit(50)
    ]);
    if([jobsResult,keysResult,creditsResult,publishResult,sourceResult].some(r=>r.error))
      return fail("Diagnostics could not load all records. Please retry.",500,errorId);
    const jobs=jobsResult.data||[];
    const now=Date.now();
    return Response.json({
      generatedAt:new Date().toISOString(),
      queue:{queued:jobs.filter(j=>j.status==="queued").length,processing:jobs.filter(j=>j.status==="processing").length,
        failed:jobs.filter(j=>j.status==="failed").length,deadLetter:jobs.filter(j=>j.status==="dead_letter").length},
      jobs:jobs.map(j=>({id:j.id,workspaceId:j.workspace_id,projectId:j.project_id,status:j.status,progress:j.progress,
        createdAt:j.created_at,updatedAt:j.updated_at,processingMs:Math.max(0,new Date(j.updated_at||j.created_at).getTime()-new Date(j.created_at).getTime()),
        errorId:j.error_id||null,failureType:j.failure_type||null,reason:j.error||null,attempts:j.attempt_count||0,
        retryAt:j.next_retry_at||null,deadLetteredAt:j.dead_lettered_at||null,outputs:j.output_locations||{}})),
      geminiKeyHealth:(keysResult.data||[]).map(k=>({...k,currentlyCoolingDown:Boolean(k.cooldown_until&&new Date(k.cooldown_until).getTime()>now)})),
      creditTransactions:(creditsResult.data||[]).map(t=>({transactionId:t.id,workspaceId:t.workspace_id,userId:t.user_id,jobId:t.job_id,
        amount:t.amount,type:t.transaction_type,reason:t.reason,createdAt:t.created_at})),
      publishing:(publishResult.data||[]).map(p=>({id:p.id,workspaceId:p.workspace_id,userId:p.user_id,clipId:p.clip_id,
        platform:p.platform,status:p.status,attempts:p.attempt_count,lastAttemptAt:p.last_attempt_at,
        createdAt:p.created_at,updatedAt:p.updated_at,publishedAt:p.published_at})),
      failedSources:(sourceResult.data||[]).map(s=>({id:s.id,workspaceId:s.workspace_id,projectId:s.project_id,
        sourceType:s.source_type,status:s.status,createdAt:s.created_at}))
    },{headers:{"Cache-Control":"no-store"}});
  }catch{
    console.error("admin_diagnostics_failure",{errorId,category:"internal"});
    return fail("Admin diagnostics could not be loaded. Please retry.",500,errorId);
  }
}
