import{createClient}from"@supabase/supabase-js";
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
 if(!allow.includes(email)&&!member)throw new Error("Control center access denied.");
 await admin.from("control_center_members").update({last_seen_at:new Date().toISOString()}).eq("email",email).eq("active",true);
 return{user,admin,role:member?.role||"owner",allowlisted:allow.includes(email),allow};
}
const csvEscape=v=>'"'+String(v??"").replace(/"/g,'""')+'"';
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
  const[{data:profiles},{data:workspaces},{data:projects},{data:jobs},{data:events},{data:consents},{data:members},{data:notifications},{data:audit}]=await Promise.all([
   admin.from("profiles").select("id,full_name,avatar_url,created_at,updated_at"),
   admin.from("workspaces").select("id,name,owner_id,created_at"),
   admin.from("projects").select("id,workspace_id,owner_id,name,status,created_at,updated_at").order("created_at",{ascending:false}).limit(500),
   admin.from("processing_jobs").select("id,workspace_id,project_id,status,progress,error,created_at,updated_at,current_stage,attempt_count,heartbeat_at,payload").order("created_at",{ascending:false}).limit(500),
   admin.from("user_activity_events").select("id,user_id,workspace_id,action,entity_type,entity_id,metadata,user_agent,ip_hash,created_at").order("created_at",{ascending:false}).limit(500),
   admin.from("user_privacy_consents").select("id,user_id,consent_type,policy_version,granted,source,metadata,created_at").order("created_at",{ascending:false}).limit(500),
   admin.from("control_center_members").select("id,email,role,active,invited_at,last_seen_at,created_at").order("created_at",{ascending:false}),
   admin.from("notifications").select("id,workspace_id,user_id,title,message,read_at,created_at").order("created_at",{ascending:false}).limit(300),
   admin.from("audit_logs").select("id,workspace_id,user_id,action,entity_type,entity_id,metadata,created_at").order("created_at",{ascending:false}).limit(500)
  ]);
  const p=new Map((profiles||[]).map(x=>[x.id,x])),w=new Map((workspaces||[]).map(x=>[x.id,x])),uMap=new Map((users||[]).map(x=>[x.id,x]));
  const u=(users||[]).map(x=>({id:x.id,email:x.email||"",phone:x.phone||"",created_at:x.created_at,last_sign_in_at:x.last_sign_in_at,confirmed_at:x.confirmed_at,app_metadata:x.app_metadata||{},user_metadata:x.user_metadata||{},profile:p.get(x.id)||null,workspaces:(workspaces||[]).filter(y=>y.owner_id===x.id).map(y=>({id:y.id,name:y.name,created_at:y.created_at}))}));
  const eventsNamed=(events||[]).map(x=>({...x,user_email:uMap.get(x.user_id)?.email||"",workspace_name:w.get(x.workspace_id)?.name||""}));
  const auditNamed=(audit||[]).map(x=>({...x,user_email:uMap.get(x.user_id)?.email||"",workspace_name:w.get(x.workspace_id)?.name||""}));
  const workspaceRows=(workspaces||[]).map(x=>({...x,owner_email:uMap.get(x.owner_id)?.email||"",project_count:(projects||[]).filter(p=>p.workspace_id===x.id).length,member_count:0}));
  const jobsNamed=(jobs||[]).map(x=>({...x,workspace_name:w.get(x.workspace_id)?.name||"",project_name:(projects||[]).find(p=>p.id===x.project_id)?.name||"",requested_by_email:uMap.get(x.payload?.requestedBy||x.payload?.requested_by)?.email||""}));
  const flags=await scanFlags(admin,users||[],jobs||[],events||[],audit||[]);
  const activeJobs=(jobs||[]).filter(x=>["queued","processing"].includes(x.status)).length,failedJobs=(jobs||[]).filter(x=>x.status==="failed").length;
  const drift=allow.filter(email=>!(members||[]).some(m=>m.active&&m.email.toLowerCase()===email));
  return Response.json({ok:true,role,allowlisted,users:u,workspaces:workspaceRows,projects:projects||[],jobs:jobsNamed,events:eventsNamed,consents:consents||[],members:members||[],notifications:notifications||[],audit:auditNamed,flags,stats:{activeJobs,failedJobs,activeAdmins:(members||[]).filter(x=>x.active).length,totalWorkspaces:(workspaces||[]).length,totalUsers:(users||[]).length},configDrift:drift,currentAdmin:user.email||""});
 }catch(e){return Response.json({error:e.message||"Control center request failed."},{status:/access denied|Authentication/.test(e.message||"")?403:500})}
}
export async function POST(request){
 try{
  const{user,admin,role}=await guard(request);
  if(role==="viewer")return Response.json({error:"Viewer access cannot change control-center settings."},{status:403});
  const body=await request.json(),action=String(body.action||"");
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
 }catch(e){return Response.json({error:e.message||"Control center action failed."},{status:500})}
}