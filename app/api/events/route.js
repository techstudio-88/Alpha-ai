import{createClient}from"@supabase/supabase-js";
export const runtime="nodejs";
const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY||process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const service=process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SECRET_KEY;
export async function POST(req){
 try{
  const body=await req.json().catch(()=>({}));
  const eventName=String(body.eventName||"").slice(0,120);
  if(!eventName)return Response.json({error:"eventName required"},{status:400});
  const token=(req.headers.get("authorization")||"").replace(/^Bearer\\s+/i,"");
  let userId=null;
  if(token){const c=createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false}});const{data:{user}}=await c.auth.getUser(token);userId=user?.id||null}
  const admin=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
  const row={user_id:userId,workspace_id:body.workspaceId||null,event_name:eventName,session_id:String(body.sessionId||"").slice(0,200)||null,anonymous_id:String(body.anonymousId||"").slice(0,200)||null,source:String(body.source||"").slice(0,120)||null,medium:String(body.medium||"").slice(0,120)||null,campaign:String(body.campaign||"").slice(0,200)||null,content_id:String(body.contentId||"").slice(0,200)||null,landing_path:String(body.landingPath||"").slice(0,500)||null,referrer:String(body.referrer||"").slice(0,1000)||null,metadata:body.metadata||{}};
  const{error}=await admin.from("product_events").insert(row);if(error)throw error;
  return Response.json({ok:true});
 }catch(e){return Response.json({error:e.message||"Event could not be recorded."},{status:500})}
}