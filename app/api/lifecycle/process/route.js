import {createClient} from "@supabase/supabase-js";
import {randomUUID} from "node:crypto";
import {cronAuthorized} from "../../../../lib/cron-auth.mjs";

export const runtime="nodejs";
const templates={
 welcome:{subject:"Welcome to Alpha.ai",html:"<h2>Welcome to Alpha.ai</h2><p>Turn long videos into ready-to-publish clips.</p><p>Upload your first video and let Alpha.ai find the strongest moments.</p>"},
 first_clip:{subject:"Your first Alpha.ai clip is ready",html:"<h2>Your first clip is ready</h2><p>Open Alpha.ai to review, edit and publish it.</p>"},
 inactive:{subject:"Ready to create another clip?",html:"<h2>Your content is waiting</h2><p>Come back to Alpha.ai and turn another long video into short-form content.</p>"}
};
const fail=(message,status,errorId)=>Response.json({error:message,errorId},{status,headers:{"Cache-Control":"no-store"}});
export async function runLifecycle(){
 const errorId=randomUUID();
 try{
  const url=process.env.SUPABASE_URL||process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret=process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SECRET_KEY;
  if(!url||!secret)return fail("Lifecycle processing is not configured.",503,errorId);
  const admin=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:rows,error}=await admin.from("email_lifecycle_events").select("id,event_type,status,scheduled_for,attempt_count,metadata")
    .eq("status","pending").lte("scheduled_for",new Date().toISOString()).order("scheduled_for",{ascending:true}).limit(50);
  if(error)return fail("Lifecycle events could not be loaded.",500,errorId);
  let sent=0,processed=0;
  for(const row of rows||[]){
   processed++;
   const email=String(row.metadata?.email||"").trim();
   if(!email||!process.env.RESEND_API_KEY||!process.env.LIFECYCLE_FROM_EMAIL){
    await admin.from("email_lifecycle_events").update({status:"provider_unconfigured",last_error:"Email provider or recipient is not configured"}).eq("id",row.id);
    continue;
   }
   const attempt=(row.attempt_count||0)+1;
   const claimed=await admin.from("email_lifecycle_events").update({status:"processing",attempt_count:attempt})
    .eq("id",row.id).eq("status","pending").select("id");
   if(claimed.error||!claimed.data?.length)continue;
   const template=templates[row.event_type]||{subject:"Your Alpha.ai update",html:"<p>There is a new update in Alpha.ai.</p>"};
   try{
    const response=await fetch("https://api.resend.com/emails",{method:"POST",
      headers:{Authorization:"Bearer "+process.env.RESEND_API_KEY,"Content-Type":"application/json"},
      body:JSON.stringify({from:process.env.LIFECYCLE_FROM_EMAIL,to:[email],subject:template.subject,html:template.html}),
      signal:AbortSignal.timeout(12000),cache:"no-store"});
    if(!response.ok)throw new Error("provider_failed");
    const {error:saveError}=await admin.from("email_lifecycle_events").update({status:"sent",sent_at:new Date().toISOString(),last_error:null}).eq("id",row.id);
    if(saveError)throw new Error("state_update_failed");
    sent++;
   }catch{
    const nextStatus=attempt>=3?"failed":"pending";
    await admin.from("email_lifecycle_events").update({status:nextStatus,last_error:"Email delivery failed",
      scheduled_for:new Date(Date.now()+Math.min(86400000,2**attempt*3600000)).toISOString()}).eq("id",row.id);
    console.warn("lifecycle_email_delivery_failed",{errorId,attempt,terminal:nextStatus==="failed"});
   }
  }
  return Response.json({ok:true,processed,sent},{headers:{"Cache-Control":"no-store"}});
 }catch{
  console.error("lifecycle_processing_failure",{errorId,category:"internal"});
  return fail("Lifecycle processing failed. Contact support with error ID "+errorId+".",500,errorId);
 }
}
export async function GET(request){
 const errorId=randomUUID();
 if(!cronAuthorized(request))return fail("Unauthorized.",401,errorId);
 return runLifecycle();
}
export async function POST(request){return GET(request)}
