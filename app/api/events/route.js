import { createClient } from "@supabase/supabase-js";
export async function POST(req){
  try{
    const body=await req.json();
    const url=process.env.NEXT_PUBLIC_SUPABASE_URL||process.env.SUPABASE_URL;
    const key=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const service=process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SECRET_KEY;
    if(!url||!service)return Response.json({error:"Analytics is not configured."},{status:503});
    const auth=req.headers.get("authorization")||"";
    let userId=null;
    if(auth.startsWith("Bearer ")&&key){
      const c=createClient(url,key,{auth:{persistSession:false}});
      const {data}=await c.auth.getUser(auth.slice(7)); userId=data.user?.id||null;
    }
    const eventName=String(body?.event_name||"").trim();
    if(!eventName||eventName.length>100)return Response.json({error:"Invalid event."},{status:400});
    const admin=createClient(url,service,{auth:{persistSession:false}});
    const row={event_name:eventName,user_id:userId,session_id:String(body?.session_id||"").slice(0,200)||null,anonymous_id:String(body?.anonymous_id||"").slice(0,200)||null,source:String(body?.source||"").slice(0,200)||null,medium:String(body?.medium||"").slice(0,200)||null,campaign:String(body?.campaign||"").slice(0,200)||null,content_id:String(body?.content_id||"").slice(0,200)||null,landing_path:String(body?.landing_path||"").slice(0,500)||null,referrer:String(body?.referrer||"").slice(0,1000)||null,metadata:body?.metadata&&typeof body.metadata==="object"?body.metadata:{}};
    const {error}=await admin.from("product_events").insert(row);
    if(error)throw error;
    if(userId && (eventName==="signup"||eventName==="signup_completed"||eventName==="conversion")){await admin.from("content_attribution").upsert({user_id:userId,session_id:row.session_id,anonymous_id:row.anonymous_id,content_id:row.content_id,landing_path:row.landing_path,source:row.source,medium:row.medium,campaign:row.campaign,referrer:row.referrer,signup_at:eventName.startsWith("signup")?new Date().toISOString():null,conversion_at:eventName==="conversion"?new Date().toISOString():null,first_touch_at:new Date().toISOString(),metadata:row.metadata},{onConflict:"id"});}
    return Response.json({ok:true});
  }catch(e){return Response.json({error:e.message||"Event failed."},{status:500})}
}