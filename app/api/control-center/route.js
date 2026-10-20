import { randomUUID } from "node:crypto";
import { sendPreferenceEmail } from "../../../lib/email.mjs";
import{createClient}from"@supabase/supabase-js";
import {enforceApiRateLimit} from "../../../lib/workflow-server";
export const runtime="nodejs";
const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY||process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const secret=process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SECRET_KEY;
const site=process.env.NEXT_PUBLIC_SITE_URL||"https://alpha-ai-techstudio7808-4455.vercel.app";
const adminClient=()=>createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
async function guard(request){
 if(!url||!anon||!secret)throw new Error("Control center is not configured.");
 const token=(request.headers.get("authorization")||"").replace(/^Bearer\s+/i,"");
 if(!token)throw new Error("Authentication required.");
 const client=createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false}});
 const{data:{user},error}=await client.auth.getUser(token);
 if(error||!user)throw new Error("Authentication expired.");
 const admin=adminClient(),email=(user.email||"").toLowerCase();
 const allow=(process.env.ALPHA_CONTROL_ADMIN_EMAILS||"").split(",").map(x=>x.trim().toLowerCase()).filter(Boolean);
 const{data:member}=await admin.from("control_center_members").select("id,role,active").eq("email",email).eq("active",true).maybeSingle();
 const ip=request.headers.get("x-real-ip")||request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()||"unknown";
 await enforceApiRateLimit(admin,"user:"+user.id,"/api/control-center-auth-failure",5,600,ip);
 if(!allow.includes(email)&&!member)throw Object.assign(new Error("Not found."),{status:404});
 await enforceApiRateLimit(admin,"user:"+user.id,"/api/control-center",60,60,ip);
 await admin.from("control_center_members").update({last_seen_at:new Date().toISOString()}).eq("email",email).eq("active",true);
 return{user,admin,role:member?.role||(allow.includes(email)?"admin":"viewer"),allowlisted:allow.includes(email),allow};
}
const csvEscape=v=>'"'+String(v??"").replace(/"/g,'""')+'"';
const safeErrorText=value=>String(value??"").replace(/AIza[0-9A-Za-z_-]{20,}/g,"[redacted]").replace(/key=[^&\s]+/gi,"key=[redacted]").replace(/Bearer\s+[A-Za-z0-9._-]+/gi,"Bearer [redacted]").slice(0,1000);
const safeJobPayload=payload=>{
 const scrub=value=>{
  if(Array.isArray(value))return value.map(scrub);
  if(value&&typeof value==="object")return Object.fromEntries(Object.entries(value).filter(([key])=>!/token|secret|password|api.?key|authorization|credential|signed.?url/i.test(key)).map(([key,item])=>[key,scrub(item)]));
  return typeof value==="string"?safeErrorText(value):value;
 };
 return scrub(payload||{});
};
async function writeAudit(admin,user,action,meta={},workspaceId=null,entityId=null){
 await admin.from("audit_logs").insert({user_id:user.id,workspace_id:workspaceId,action,entity_type:"control_center",entity_id:entityId,metadata:meta});
}
async function scanFlags(admin,users,jobs,events,audit){
 const now=Date.now(),flags=[];
 const push=async(userId,workspaceId,severity,signal,reason,evidence)=>{
   const cutoff=new Date(now-60*60*1000).toISOString();
   const{data:existing}=await admin.from("security_flags").select("id").eq("user_id",userId).eq("signal",signal).eq("status","open").gte("created_at",cutoff).limit(1);
   if(!existing?.length){const{data,rowError}=await admin.from("security_flags").insert({user_id:userId,workspace_id:workspaceId,severity,signal,reason,evidence}).select().single();if(!rowError&&data)flags.push(data)}
 };
 const byUser=(rows,key)=>{const m=new Map();for(const r of rows||[]){const id=r?.[key];if(!id)continue;const a=m.get(id)||[];a.push(r);m.set(id,a)}return m};
 for(const [uid,rows] of byUser(events,"user_id")){
   const recent=rows.filter(x=>new Date(x.created_at).getTime()>now-5*60*1000);
   if(recent.length>=30)await push(uid,null,"high","activity_burst","Unusually high application activity in a five-minute window.",{events:recent.length,window_minutes:5});
   const denied=recent.filter(x=>/denied|unauthorized|forbidden|auth_failed|invalid_token/i.test(String(x.action||"")));
   if(denied.length>=5)await push(uid,null,"high","repeated_denied_actions","Repeated denied or authentication-related actions were recorded.",{denied:denied.length,window_minutes:5});
 }
 const userJobs=(jobs||[]).filter(j=>j.status==="failed");
 const grouped=new Map();
 for(const j of userJobs){const uid=j.payload?.requestedBy||j.payload?.requested_by;if(uid){const a=grouped.get(uid)||[];a.push(j);grouped.set(uid,a)}}
 for(const [uid,rows] of grouped){const recent=rows.filter(x=>new Date(x.created_at).getTime()>now-30*60*1000);if(recent.length>=8)await push(uid,recent[0]?.workspace_id||null,"medium","repeated_job_failures","Many processing jobs failed for the same user in a short period.",{failed_jobs:recent.length,window_minutes:30})}
 const adminEvents=(audit||[]).filter(x=>/control_center_access_(granted|revoked)/.test(x.action));
 for(const [uid,rows] of byUser(adminEvents,"user_id")){const recent=rows.filter(x=>new Date(x.created_at).getTime()>now-10*60*1000);if(recent.length>=6)await push(uid,null,"high","rapid_access_changes","Many privileged access changes were made in a short window.",{changes:recent.length,window_minutes:10})}
 const{data:open}=await admin.from("security_flags").select("*").eq("status","open").order("created_at",{ascending:false}).limit(100);
 return open||flags;
}
export async function GET(request){
 try{
  const{user,admin,role,allowlisted,allow}=await guard(request);
  const{data:{users},error:userError}=await admin.auth.admin.listUsers({page:1,perPage:1000});if(userError)throw userError;
  const[{data:profiles},{data:workspaces},{data:projects},{data:jobs},{data:events},{data:consents},{data:members},{data:notifications},{data:audit},{data:workspaceMembers},{data:creditLedger},{data:geminiKeys},{data:rateLimits},{data:videoUsageDaily},{data:pendingParts}]=await Promise.all([
   admin.from("profiles").select("id,full_name,avatar_url,created_at,updated_at"),
   admin.from("workspaces").select("id,name,owner_id,created_at"),
   admin.from("projects").select("id,workspace_id,owner_id,name,status,created_at,updated_at").order("created_at",{ascending:false}).limit(500),
   admin.from("processing_jobs").select("id,workspace_id,project_id,status,progress,error,error_id,failure_type,created_at,updated_at,current_stage,attempt_count,heartbeat_at,lease_until,next_retry_at,dead_lettered_at,reserved_credits,video_minutes_reserved,video_usage_date,payload").order("created_at",{ascending:false}).limit(500),
   admin.from("user_activity_events").select("id,user_id,workspace_id,action,entity_type,entity_id,metadata,user_agent,ip_hash,created_at").order("created_at",{ascending:false}).limit(500),
   admin.from("user_privacy_consents").select("id,user_id,consent_type,policy_version,granted,source,metadata,created_at").order("created_at",{ascending:false}).limit(500),
   admin.from("control_center_members").select("id,email,role,active,invited_at,last_seen_at,created_at").order("created_at",{ascending:false}),
   admin.from("notifications").select("id,workspace_id,user_id,title,message,read_at,created_at").order("created_at",{ascending:false}).limit(300),
   admin.from("audit_logs").select("id,workspace_id,user_id,action,entity_type,entity_id,metadata,created_at").order("created_at",{ascending:false}).limit(500),
   admin.from("workspace_members").select("workspace_id,user_id,role,created_at").order("created_at",{ascending:false}).limit(1000),
   admin.from("credit_ledger").select("id,workspace_id,user_id,job_id,amount,transaction_type,reason,idempotency_key,created_at").order("created_at",{ascending:false}).limit(200),
   admin.from("gemini_key_health").select("key_label,is_available,cooldown_until,last_status,last_error_id,success_count,failure_count,rate_limit_count,last_used_at,updated_at").order("updated_at",{ascending:false}).limit(20),
   admin.from("api_rate_limits").select("route,window_start,request_count").order("window_start",{ascending:false}).limit(200),
   admin.from("video_usage_daily").select("workspace_id,user_id,usage_date,timezone,minutes_reserved,minutes_completed,updated_at").order("usage_date",{ascending:false}).limit(200),
   admin.from("pending_processing_parts").select("id,workspace_id,project_id,parent_job_id,job_id,part_number,start_seconds,end_seconds,usage_date,scheduled_for,status,expires_at,updated_at").order("scheduled_for",{ascending:true}).limit(200)
  ]);
  const p=new Map((profiles||[]).map(x=>[x.id,x])),w=new Map((workspaces||[]).map(x=>[x.id,x])),uMap=new Map((users||[]).map(x=>[x.id,x]));
  const u=(users||[]).map(x=>({id:x.id,email:x.email||"",phone:x.phone||"",created_at:x.created_at,last_sign_in_at:x.last_sign_in_at,confirmed_at:x.confirmed_at,app_metadata:x.app_metadata||{},user_metadata:x.user_metadata||{},profile:p.get(x.id)||null,workspaces:(workspaces||[]).filter(y=>y.owner_id===x.id).map(y=>({id:y.id,name:y.name,created_at:y.created_at}))}));
  const eventsNamed=(events||[]).map(x=>({...x,metadata:safeJobPayload(x.metadata),user_agent:safeErrorText(x.user_agent),user_email:uMap.get(x.user_id)?.email||"",workspace_name:w.get(x.workspace_id)?.name||""}));
  const auditNamed=(audit||[]).map(x=>({...x,metadata:safeJobPayload(x.metadata),user_email:uMap.get(x.user_id)?.email||"",workspace_name:w.get(x.workspace_id)?.name||""}));
  const workspaceRows=(workspaces||[]).map(x=>({...x,owner_email:uMap.get(x.owner_id)?.email||"",project_count:(projects||[]).filter(p=>p.workspace_id===x.id).length,member_count:(workspaceMembers||[]).filter(m=>m.workspace_id===x.id).length}));
  const jobsNamed=(jobs||[]).map(x=>({...x,error:safeErrorText(x.error),payload:safeJobPayload(x.payload),workspace_name:w.get(x.workspace_id)?.name||"",project_name:(projects||[]).find(p=>p.id===x.project_id)?.name||"",requested_by_email:uMap.get(x.payload?.requestedBy||x.payload?.requested_by)?.email||""}));
  const flags=await scanFlags(admin,users||[],jobs||[],events||[],audit||[]);
  const activeJobs=(jobs||[]).filter(x=>["queued","processing","awaiting_transcription","transcribing"].includes(x.status)).length,failedJobs=(jobs||[]).filter(x=>x.status==="failed").length;
  const staleJobs=(jobs||[]).filter(x=>x.status==="processing"&&(!x.heartbeat_at||Date.now()-new Date(x.heartbeat_at).getTime()>10*60*1000));
  const deadLetterJobs=(jobs||[]).filter(x=>x.status==="dead_letter"||x.dead_lettered_at);
  const completedDurations=(jobs||[]).filter(x=>x.status==="completed"&&x.created_at&&x.updated_at).map(x=>Math.max(0,(new Date(x.updated_at).getTime()-new Date(x.created_at).getTime())/1000));
  const averageJobDurationSeconds=completedDurations.length?Math.round(completedDurations.reduce((sum,n)=>sum+n,0)/completedDurations.length):null;
  const drift=allow.filter(email=>!(members||[]).some(m=>m.active&&m.email.toLowerCase()===email));
  const{data:paymentRows,error:paymentError}=await admin.from("upi_payment_orders").select("id,user_id,workspace_id,plan,billing_interval,amount_paise,reference,utr,payer_note,status,review_note,created_at,submitted_at,expires_at").order("created_at",{ascending:false}).limit(500);
  if(paymentError)throw paymentError;
  const userEmailById=new Map((users||[]).map(x=>[x.id,x.email||""]));
  const workspaceNameById=new Map((workspaces||[]).map(x=>[x.id,x.name||""]));
  const payments=(paymentRows||[]).map(x=>({...x,user_email:userEmailById.get(x.user_id)||"",workspace_name:workspaceNameById.get(x.workspace_id)||""}));
  const [{data:announcements,error:announcementError},{data:featureFlags,error:featureFlagError}]=await Promise.all([
    admin.from("announcements").select("id,title,body,active,created_at,created_by").order("created_at",{ascending:false}).limit(100),
    admin.from("feature_flags").select("key,enabled,note,updated_at,updated_by").order("key")
  ]);
  if(announcementError)throw announcementError;if(featureFlagError)throw featureFlagError;
  const [{data:subscriptions,error:subscriptionError},{data:invoices,error:invoiceError}]=await Promise.all([
    admin.from("subscriptions").select("id,user_id,workspace_id,plan,status,provider,billing_interval,current_period_start,current_period_end,cancel_at_period_end,created_at").order("created_at",{ascending:false}).limit(500),
    admin.from("billing_invoices").select("id,workspace_id,plan,amount_paise,currency,status,description,created_at,provider_payment_id,provider_invoice_id").order("created_at",{ascending:false}).limit(500)
  ]);
  if(subscriptionError)throw subscriptionError;if(invoiceError)throw invoiceError;
  let workerHealth={configured:Boolean(process.env.MEDIA_WORKER_URL),reachable:false,status:"not_configured"};
  if(process.env.MEDIA_WORKER_URL){try{const response=await fetch(process.env.MEDIA_WORKER_URL.replace(/\/$/,"")+"/health",{signal:AbortSignal.timeout(3000),cache:"no-store"});workerHealth={configured:true,reachable:response.ok,status:response.ok?"healthy":"http_"+response.status}}catch{workerHealth={configured:true,reachable:false,status:"unreachable"}}}
  return Response.json({ok:true,role,allowlisted,workerConfigured:Boolean(process.env.MEDIA_WORKER_URL),workerHealth,payments,announcements:announcements||[],featureFlags:featureFlags||[],subscriptions:subscriptions||[],invoices:invoices||[],users:u,workspaces:workspaceRows,projects:projects||[],jobs:jobsNamed,events:eventsNamed,consents:(consents||[]).map(x=>({...x,metadata:safeJobPayload(x.metadata)})),members:members||[],notifications:notifications||[],audit:auditNamed,flags:(flags||[]).map(x=>({...x,metadata:safeJobPayload(x.metadata)})),diagnostics:{geminiKeyHealth:geminiKeys||[],creditTransactions:creditLedger||[],rateLimits:(rateLimits||[]).map(({route,window_start,request_count})=>({route,window_start,request_count})),videoUsageDaily:videoUsageDaily||[],pendingParts:pendingParts||[],staleJobs:staleJobs.map(x=>({id:x.id,status:x.status,current_stage:x.current_stage,heartbeat_at:x.heartbeat_at,error_id:x.error_id})),deadLetterJobs:deadLetterJobs.map(x=>({id:x.id,status:x.status,error_id:x.error_id,failure_type:x.failure_type,dead_lettered_at:x.dead_lettered_at})),recentFailures:(jobs||[]).filter(x=>x.status==="failed"||x.status==="dead_letter").slice(0,50).map(x=>({id:x.id,status:x.status,error:safeErrorText(x.error),error_id:x.error_id,failure_type:x.failure_type,created_at:x.created_at,updated_at:x.updated_at})),averageJobDurationSeconds},stats:{activeJobs,failedJobs,queuedJobs:(jobs||[]).filter(x=>x.status==="queued").length,processingJobs:(jobs||[]).filter(x=>x.status==="processing").length,deadLetteredJobs:deadLetterJobs.length,staleJobs:staleJobs.length,creditLedgerEntries:(creditLedger||[]).length,geminiKeysUnavailable:(geminiKeys||[]).filter(x=>!x.is_available).length,rateLimitedRoutes:(rateLimits||[]).filter(x=>x.request_count>0).length,pendingParts:(pendingParts||[]).filter(x=>["pending","approved","queued","processing"].includes(x.status)).length,reservedVideoMinutes:(videoUsageDaily||[]).reduce((sum,x)=>sum+Number(x.minutes_reserved||0),0),activeAdmins:(members||[]).filter(x=>x.active).length,totalWorkspaces:(workspaces||[]).length,totalUsers:(users||[]).length},configDrift:drift,currentAdmin:user.email||""});
 }catch(e){return Response.json({error:e.message||"Control center request failed."},{status:e.status||(/access denied|Authentication/.test(e.message||"")?403:500),headers:e.retryAfter?{"Retry-After":String(e.retryAfter)}:undefined})}
}
export async function POST(request){
 try{
  const{user,admin,role}=await guard(request);
  const body=await request.json(),action=String(body.action||"");
  if(role!=="admin" && action!=="record_impersonation")return Response.json({error:"Not found."},{status:404});
  const lastSignInAt=Date.parse(user.last_sign_in_at||"");
  const requiresRecent=["approve_upi_order","reject_upi_order","subscription_change","subscription_cancel","subscription_extend","adjust_credits","delete_user_data","suspend_user","unsuspend_user"].includes(action);
  if(requiresRecent&&(!Number.isFinite(lastSignInAt)||Date.now()-lastSignInAt>900000))return Response.json({error:"For security, sign in again before this sensitive action."},{status:401});
  if(action==="suspend_user"||action==="unsuspend_user"){
   const targetUserId=String(body.userId||"");if(!/^[0-9a-f-]{36}$/i.test(targetUserId))return Response.json({error:"Choose a valid user."},{status:400});
   const{data:updated,error}=await admin.auth.admin.updateUserById(targetUserId,{ban_duration:action==="suspend_user"?"876000h":"none"});if(error)throw error;
   await writeAudit(admin,user,action,{target_user_id:targetUserId},null,targetUserId);return Response.json({ok:true,banned_until:updated?.user?.banned_until||null});
  }
  if(action==="resend_confirmation"){
   const targetUserId=String(body.userId||"");if(!/^[0-9a-f-]{36}$/i.test(targetUserId))return Response.json({error:"Choose a valid user."},{status:400});
   const{data:targetResult,error:targetError}=await admin.auth.admin.getUserById(targetUserId);if(targetError)throw targetError;
   const email=targetResult?.user?.email;if(!email)return Response.json({error:"User email not found."},{status:404});
   const{error}=await admin.auth.resend({type:"signup",email});if(error)throw error;
   await writeAudit(admin,user,"confirmation_resent",{target_user_id:targetUserId},null,targetUserId);return Response.json({ok:true});
  }
  if(action==="subscription_change"){
   const workspaceId=String(body.workspaceId||""),plan=String(body.plan||""),endAt=String(body.currentPeriodEnd||"");
   if(!/^[0-9a-f-]{36}$/i.test(workspaceId)||!["free","pro","studio"].includes(plan))return Response.json({error:"Choose a valid workspace and plan."},{status:400});
   const workspace=await admin.from("workspaces").select("id,owner_id").eq("id",workspaceId).maybeSingle();if(workspace.error)throw workspace.error;if(!workspace.data)return Response.json({error:"Workspace not found."},{status:404});
   let endDate=null;if(plan!=="free"){endDate=new Date(endAt);if(!endAt||Number.isNaN(endDate.getTime())||endDate.getTime()<=Date.now())return Response.json({error:"Paid plans require a future end date."},{status:400});}
   const now=new Date().toISOString(),status=plan==="free"?"expired":"active";
   const{data:existing,error:existingError}=await admin.from("subscriptions").select("id").eq("workspace_id",workspaceId).maybeSingle();if(existingError)throw existingError;
   const row={workspace_id:workspaceId,user_id:workspace.data.owner_id,plan,status,provider:"upi",billing_interval:"monthly",current_period_start:now,current_period_end:endDate?.toISOString()||now,cancel_at_period_end:false,updated_at:now};
   const write=existing?.id?await admin.from("subscriptions").update(row).eq("id",existing.id):await admin.from("subscriptions").insert(row);
   if(write.error)throw write.error;const{error:entError}=await admin.from("workspace_entitlements").update({plan,updated_at:now}).eq("workspace_id",workspaceId);if(entError)throw entError;
   await writeAudit(admin,user,"subscription_changed",{workspace_id:workspaceId,plan,current_period_end:row.current_period_end},workspaceId,existing?.id||workspaceId);return Response.json({ok:true});
  }
  if(action==="subscription_cancel"||action==="subscription_extend"){
   const workspaceId=String(body.workspaceId||"");if(!/^[0-9a-f-]{36}$/i.test(workspaceId))return Response.json({error:"Choose a valid workspace."},{status:400});
   const{data:sub,error}=await admin.from("subscriptions").select("id,plan,current_period_end").eq("workspace_id",workspaceId).maybeSingle();if(error)throw error;if(!sub)return Response.json({error:"Subscription not found."},{status:404});
   const now=new Date();let patch={updated_at:now.toISOString()};
   if(action==="subscription_cancel"){patch={...patch,status:"cancelled",plan:"free",cancel_at_period_end:false};const{error:entError}=await admin.from("workspace_entitlements").update({plan:"free",updated_at:now.toISOString()}).eq("workspace_id",workspaceId);if(entError)throw entError;}
   else {const days=Number(body.days);if(!Number.isInteger(days)||days<1||days>365)return Response.json({error:"Extension must be between 1 and 365 days."},{status:400});const current=new Date(sub.current_period_end||now);patch.current_period_end=new Date(Math.max(current.getTime(),now.getTime())+days*86400000).toISOString();patch.status="active";}
   const{error:updateError}=await admin.from("subscriptions").update(patch).eq("id",sub.id);if(updateError)throw updateError;await writeAudit(admin,user,action,{workspace_id:workspaceId,...patch},workspaceId,sub.id);return Response.json({ok:true});
  }
  if(action==="adjust_credits"){
   const workspaceId=String(body.workspaceId||""),targetUserId=String(body.userId||""),amount=Number(body.amount),reason=String(body.reason||"").trim().slice(0,240);
   if(!/^[0-9a-f-]{36}$/i.test(workspaceId)||!/^[0-9a-f-]{36}$/i.test(targetUserId)||!Number.isInteger(amount)||amount===0||Math.abs(amount)>10000||!reason)return Response.json({error:"Workspace, user, non-zero credit amount (up to 10,000), and reason are required."},{status:400});
   const{data:adjusted,error}=await admin.rpc("admin_adjust_credits",{p_workspace_id:workspaceId,p_target_user_id:targetUserId,p_actor_user_id:user.id,p_amount:amount,p_reason:reason,p_idempotency_key:randomUUID()});if(error)throw error;
   await writeAudit(admin,user,"credits_adjusted",{workspace_id:workspaceId,user_id:targetUserId,amount,reason},workspaceId,null);return Response.json({ok:true,adjusted});
  }
  if(action==="announcement_create"){
   const title=String(body.title||"").trim().slice(0,160),message=String(body.message||"").trim().slice(0,3000);
   if(!title||!message)return Response.json({error:"A title and message are required."},{status:400});
   const{data:row,error}=await admin.from("announcements").insert({title,body:message,active:true,created_by:user.id}).select("id,title,body,active,created_at").single();
   if(error)throw error;await writeAudit(admin,user,"announcement_created",{title},null,row.id);return Response.json({ok:true,announcement:row});
  }
  if(action==="announcement_disable"){
   const id=String(body.id||"");const{data:row,error}=await admin.from("announcements").update({active:false}).eq("id",id).select("id,title").maybeSingle();
   if(error)throw error;if(!row)return Response.json({error:"Announcement not found."},{status:404});
   await writeAudit(admin,user,"announcement_disabled",{title:row.title},null,row.id);return Response.json({ok:true});
  }
  if(action==="feature_flag_set"){
   const key=String(body.key||"").trim(),enabled=body.enabled===true,note=String(body.note||"").trim().slice(0,500);
   if(!/^[a-z][a-z0-9_.-]{1,80}$/.test(key))return Response.json({error:"Use a valid feature flag key."},{status:400});
   const{data:row,error}=await admin.from("feature_flags").upsert({key,enabled,note,updated_at:new Date().toISOString(),updated_by:user.id},{onConflict:"key"}).select("key,enabled,note").single();
   if(error)throw error;await writeAudit(admin,user,"feature_flag_changed",{key,enabled},null,key);return Response.json({ok:true,flag:row});
  }
  if(action==="approve_upi_order" || action==="reject_upi_order"){
   const orderId=String(body.orderId||"").trim(),note=String(body.note||"").trim().slice(0,1000);
   if(!/^[0-9a-f-]{36}$/i.test(orderId))return Response.json({error:"Choose a valid payment order."},{status:400});
   if(action==="approve_upi_order" && body.verifiedInBank!==true)return Response.json({error:"Confirm that you verified this payment in the bank app before approving."},{status:400});
   if(action==="reject_upi_order"&&!note)return Response.json({error:"A review note is required to reject a payment."},{status:400});
   const{data:order,error:orderError}=await admin.from("upi_payment_orders").select("id,user_id,workspace_id,status,utr,amount_paise,reference").eq("id",orderId).maybeSingle();
   if(orderError)throw orderError;if(!order||order.status!=="submitted"||!order.utr)return Response.json({error:"Only submitted orders with a UTR can be reviewed."},{status:409});
   if(action==="approve_upi_order"){
    const{data:approved,error}=await admin.rpc("approve_upi_order",{order:orderId,admin:user.email||user.id,note});
    if(error)throw error;
    await writeAudit(admin,user,"upi_payment_approved",{order_id:orderId,amount_paise:order.amount_paise,reference:order.reference,verified_in_bank:true},order.workspace_id,orderId);
    const approvalMessage="Your UPI payment for Alpha.ai was verified. Your paid plan is now active.";
    const {error:noticeError}=await admin.from("notifications").insert({user_id:order.user_id,workspace_id:order.workspace_id,title:"Payment verified",message:approvalMessage});
    if(noticeError)throw noticeError;
    try{await sendPreferenceEmail(admin,order.user_id,"payment_approved","Your Alpha.ai payment was verified",approvalMessage)}catch(error){console.error("payment-approval-email",{errorId:crypto.randomUUID(),message:String(error?.message||"email failed").slice(0,120)})}
    return Response.json({ok:true,approved});
   }
   const{data:rejected,error}=await admin.from("upi_payment_orders").update({status:"rejected",review_note:note,reviewed_at:new Date().toISOString(),reviewed_by:user.email||user.id}).eq("id",orderId).eq("status","submitted").select("id,user_id,workspace_id").maybeSingle();
   if(error)throw error;if(!rejected)return Response.json({error:"Payment order was already reviewed."},{status:409});
   const{error:notifyError}=await admin.from("notifications").insert({user_id:order.user_id,workspace_id:order.workspace_id,title:"Payment needs attention",message:note});
   if(notifyError)throw notifyError;
   await writeAudit(admin,user,"upi_payment_rejected",{order_id:orderId,review_note:note,reference:order.reference},order.workspace_id,orderId);
   try{await sendPreferenceEmail(admin,order.user_id,"payment_rejected","Your Alpha.ai payment needs attention",note)}catch(error){console.error("payment-rejection-email",{errorId:crypto.randomUUID(),message:String(error?.message||"email failed").slice(0,120)})}
   return Response.json({ok:true});
  }
  if(action==="grant_access"){
   const email=String(body.email||"").trim().toLowerCase(),memberRole=["admin","viewer"].includes(body.role)?body.role:"viewer";
   if(!email||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return Response.json({error:"Enter a valid email address."},{status:400});
   const{data:row,error}=await admin.from("control_center_members").upsert({email,role:memberRole,active:true,invited_at:new Date().toISOString()},{onConflict:"email"}).select().single();if(error)throw error;
   let invited=false;const existing=(await admin.auth.admin.listUsers({page:1,perPage:1000})).data?.users?.find(x=>(x.email||"").toLowerCase()===email);
   if(!existing){const inv=await admin.auth.admin.inviteUserByEmail(email,{redirectTo:site});if(inv.error)throw inv.error;invited=true}
   await writeAudit(admin,user,"control_center_access_granted",{email,role:memberRole,invited});return Response.json({ok:true,member:row,invited});
  }
  if(action==="revoke_access"){
   const email=String(body.email||"").trim().toLowerCase();if(email===(user.email||"").toLowerCase())return Response.json({error:"You cannot revoke your own control-center access."},{status:400});
   const{data:target}=await admin.from("control_center_members").select("email").eq("email",email).maybeSingle();if(!target)return Response.json({error:"Admin member not found."},{status:404});
   const{data:authUsers}=await admin.auth.admin.listUsers({page:1,perPage:1000});const targetUser=authUsers?.users?.find(x=>(x.email||"").toLowerCase()===email);
   const owned=(await admin.from("workspaces").select("id,name").eq("owner_id",targetUser?.id||"00000000-0000-0000-0000-000000000000")).data||[];
   if(owned.length&&String(body.confirmEmail||"").trim().toLowerCase()!==email)return Response.json({error:"Type the owner's email to confirm revocation."},{status:400});
   const{error}=await admin.from("control_center_members").update({active:false}).eq("email",email);if(error)throw error;
   await writeAudit(admin,user,"control_center_access_revoked",{email,workspace_owner:owned.length>0});return Response.json({ok:true});
  }
  if(action==="retry_job"){
   const id=String(body.jobId||"");const{data:job}=await admin.from("processing_jobs").select("*").eq("id",id).maybeSingle();if(!job)return Response.json({error:"Job not found."},{status:404});
   const payload={...(job.payload||{}),retryCount:Number(job.payload?.retryCount||0)+1};const{error}=await admin.from("processing_jobs").update({status:"queued",progress:0,error:null,current_stage:null,heartbeat_at:null,payload,updated_at:new Date().toISOString()}).eq("id",id);if(error)throw error;
   await writeAudit(admin,user,"processing_job_retried",{job_id:id},job.workspace_id,job.project_id);return Response.json({ok:true});
  }
  if(action==="cancel_job"){
   const id=String(body.jobId||"");const{data:job}=await admin.from("processing_jobs").select("id,workspace_id,project_id,status").eq("id",id).maybeSingle();if(!job)return Response.json({error:"Job not found."},{status:404});
   if(["completed","failed","cancelled"].includes(job.status))return Response.json({error:"That job is already terminal."},{status:400});
   const{error}=await admin.from("processing_jobs").update({status:"cancelled",error:"Cancelled by control center.",updated_at:new Date().toISOString()}).eq("id",id);if(error)throw error;
   await writeAudit(admin,user,"processing_job_cancelled",{job_id:id},job.workspace_id,job.project_id);return Response.json({ok:true});
  }
  if(action==="notify_bulk"){
   const ids=Array.isArray(body.userIds)?body.userIds.map(String).slice(0,100):[];const title=String(body.title||"Alpha.ai notification").slice(0,160),message=String(body.message||"").slice(0,2000);if(!ids.length||!message)return Response.json({error:"Select at least one user and write a message."},{status:400});
   const rows=[];for(const uid of ids){const{data:m}=await admin.from("workspace_members").select("workspace_id").eq("user_id",uid).order("created_at",{ascending:true}).limit(1).maybeSingle();if(m?.workspace_id)rows.push({workspace_id:m.workspace_id,user_id:uid,title,message})}
   if(rows.length)await admin.from("notifications").insert(rows);await writeAudit(admin,user,"control_center_bulk_notification",{recipients:rows.map(x=>x.user_id)});return Response.json({ok:true,sent:rows.length});
  }
  if(action==="resolve_flag"){
   const id=String(body.flagId||"");const{error}=await admin.from("security_flags").update({status:"resolved",resolved_at:new Date().toISOString(),resolved_by:user.id}).eq("id",id);if(error)throw error;await writeAudit(admin,user,"security_flag_resolved",{flag_id:id});return Response.json({ok:true});
  }
  if(action==="record_impersonation"){
   const workspaceId=String(body.workspaceId||"");const{data:w}=await admin.from("workspaces").select("id,name,owner_id").eq("id",workspaceId).maybeSingle();if(!w)return Response.json({error:"Workspace not found."},{status:404});
   await writeAudit(admin,user,"workspace_read_only_preview",{workspace_name:w.name},workspaceId);return Response.json({ok:true});
  }
  return Response.json({error:"Unknown control-center action."},{status:400});
 }catch(e){return Response.json({error:e.message||"Control center action failed."},{status:e.status||500,headers:e.retryAfter?{"Retry-After":String(e.retryAfter)}:undefined})}
}