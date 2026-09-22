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
 const admin=adminClient();
 const allow=(process.env.ALPHA_CONTROL_ADMIN_EMAILS||"").split(",").map(x=>x.trim().toLowerCase()).filter(Boolean);
 const {data:member}=await admin.from("control_center_members").select("role,active").eq("email",(user.email||"").toLowerCase()).eq("active",true).maybeSingle();
 if(!allow.includes((user.email||"").toLowerCase())&&!member)throw new Error("Control center access denied.");
 return{user,admin,role:member?.role||"owner"};
}
export async function GET(request){
 try{
  const{admin}=await guard(request);
  const{data:{users},error:userError}=await admin.auth.admin.listUsers({page:1,perPage:1000});
  if(userError)throw userError;
  const[{data:profiles},{data:workspaces},{data:projects},{data:jobs},{data:events},{data:consents},{data:members},{data:notifications},{data:audit}]=await Promise.all([
   admin.from("profiles").select("id,full_name,avatar_url,created_at,updated_at"),
   admin.from("workspaces").select("id,name,owner_id,created_at"),
   admin.from("projects").select("id,workspace_id,owner_id,name,status,created_at,updated_at").order("created_at",{ascending:false}).limit(200),
   admin.from("processing_jobs").select("id,workspace_id,project_id,status,progress,error,created_at,updated_at,payload").order("created_at",{ascending:false}).limit(200),
   admin.from("user_activity_events").select("id,user_id,workspace_id,action,entity_type,entity_id,metadata,user_agent,created_at").order("created_at",{ascending:false}).limit(300),
   admin.from("user_privacy_consents").select("id,user_id,consent_type,policy_version,granted,source,metadata,created_at").order("created_at",{ascending:false}).limit(300),
   admin.from("control_center_members").select("id,email,role,active,invited_at,last_seen_at,created_at").order("created_at",{ascending:false}),
   admin.from("notifications").select("id,workspace_id,user_id,title,message,read_at,created_at").order("created_at",{ascending:false}).limit(200),
   admin.from("audit_logs").select("id,workspace_id,user_id,action,entity_type,entity_id,metadata,created_at").order("created_at",{ascending:false}).limit(300)
  ]);
  const p=new Map((profiles||[]).map(x=>[x.id,x]));
  const w=new Map((workspaces||[]).map(x=>[x.id,x]));
  const u=(users||[]).map(x=>({id:x.id,email:x.email||"",phone:x.phone||"",created_at:x.created_at,last_sign_in_at:x.last_sign_in_at,confirmed_at:x.confirmed_at,app_metadata:x.app_metadata||{},user_metadata:x.user_metadata||{},profile:p.get(x.id)||null,workspaces:(workspaces||[]).filter(y=>y.owner_id===x.id).map(y=>({id:y.id,name:y.name,created_at:y.created_at}))}));
  const withNames=(events||[]).map(x=>({...x,user_email:(users||[]).find(y=>y.id===x.user_id)?.email||"",workspace_name:w.get(x.workspace_id)?.name||""}));
  return Response.json({ok:true,users:u,workspaces:workspaces||[],projects:projects||[],jobs:jobs||[],events:withNames,consents:consents||[],members:members||[],notifications:notifications||[],audit:audit||[]});
 }catch(e){return Response.json({error:e.message||"Control center request failed."},{status:e.message?.includes("access denied")?403:401})}
}
export async function POST(request){
 try{
  const{user,admin,role}=await guard(request);
  if(role==="viewer")return Response.json({error:"Viewer access cannot change control-center settings."},{status:403});
  const body=await request.json();
  const action=String(body.action||"");
  if(action==="grant_access"){
   const email=String(body.email||"").trim().toLowerCase();
   const memberRole=["admin","viewer"].includes(body.role)?body.role:"viewer";
   if(!email||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return Response.json({error:"Enter a valid email address."},{status:400});
   const{data:row,error}=await admin.from("control_center_members").upsert({email,role:memberRole,active:true,invited_at:new Date().toISOString()},{onConflict:"email"}).select().single();
   if(error)throw error;
   let invited=false;
   const existing=(await admin.auth.admin.listUsers({page:1,perPage:1000})).data?.users?.find(x=>(x.email||"").toLowerCase()===email);
   if(!existing){
    const inv=await admin.auth.admin.inviteUserByEmail(email,{redirectTo:site});
    if(inv.error)throw inv.error;
    invited=true;
   }
   await admin.from("audit_logs").insert({user_id:user.id,action:"control_center_access_granted",entity_type:"control_center_member",metadata:{email,role:memberRole,invited}});
   return Response.json({ok:true,member:row,invited});
  }
  if(action==="revoke_access"){
   const email=String(body.email||"").trim().toLowerCase();
   if(email===(user.email||"").toLowerCase())return Response.json({error:"You cannot revoke your own control-center access."},{status:400});
   const{error}=await admin.from("control_center_members").update({active:false}).eq("email",email);
   if(error)throw error;
   await admin.from("audit_logs").insert({user_id:user.id,action:"control_center_access_revoked",entity_type:"control_center_member",metadata:{email}});
   return Response.json({ok:true});
  }
  if(action==="notify"){
   const userId=String(body.userId||"");
   const title=String(body.title||"Alpha.ai notification").slice(0,160);
   const message=String(body.message||"").slice(0,2000);
   if(!userId||!message)return Response.json({error:"Recipient and message are required."},{status:400});
   const{data:owned}=await admin.from("workspaces").select("id").eq("owner_id",user.id);
   const workspaceId=owned?.[0]?.id||null;
   if(!workspaceId)return Response.json({error:"No owned workspace is available for notifications."},{status:403});
   const{data:recipient}=await admin.from("workspace_members").select("user_id").eq("workspace_id",workspaceId).eq("user_id",userId).maybeSingle();
   if(!recipient)return Response.json({error:"That user is not a member of your workspace."},{status:403});
   const{error}=await admin.from("notifications").insert({workspace_id:workspaceId,user_id:userId,title,message});
   if(error)throw error;
   await admin.from("audit_logs").insert({user_id:user.id,workspace_id:workspaceId,action:"control_center_notification_sent",entity_type:"notification",metadata:{recipient:userId}});
   return Response.json({ok:true});
  }
  if(action==="record_activity"){
   const workspaceId=body.workspaceId||null;
   const{error}=await admin.from("user_activity_events").insert({user_id:user.id,workspace_id:workspaceId,action:String(body.event||"activity").slice(0,120),entity_type:body.entityType||null,entity_id:body.entityId||null,metadata:body.metadata||{},user_agent:request.headers.get("user-agent")||null});
   if(error)throw error;
   return Response.json({ok:true});
  }
  return Response.json({error:"Unknown control-center action."},{status:400});
 }catch(e){return Response.json({error:e.message||"Control center action failed."},{status:e.message?.includes("access denied")?403:500})}
}