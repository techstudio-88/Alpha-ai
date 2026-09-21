import{createClient}from"@supabase/supabase-js";
export const runtime="nodejs";
const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY||process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const service=process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SECRET_KEY;
const VERSIONS={terms:"2026-09-21",privacy:"2026-09-21",cookies:"2026-09-21"};
export async function POST(req){
 try{
  const auth=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"");
  if(!auth)return Response.json({error:"Authentication required."},{status:401});
  const client=createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false}});
  const{data:{user},error}=await client.auth.getUser(auth);if(error||!user)return Response.json({error:"Authentication expired."},{status:401});
  const body=await req.json().catch(()=>({}));const type=String(body.consentType||"");
  if(!["terms","privacy","cookies"].includes(type))return Response.json({error:"Invalid consent type."},{status:400});
  const granted=Boolean(body.granted);\n  if((type==="terms"||type==="privacy")&&!granted)return Response.json({error:"Terms and Privacy must be accepted to continue using Alpha.ai."},{status:400});
  const admin=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
  const{error:insertError}=await admin.from("user_privacy_consents").insert({user_id:user.id,consent_type:type,policy_version:VERSIONS[type],granted,source:"app",metadata:{necessary_cookies:true,analytics_cookies:false}});
  if(insertError)throw insertError;
  return Response.json({ok:true,consentType:type,policyVersion:VERSIONS[type]});
 }catch(e){return Response.json({error:e.message||"Could not record consent."},{status:500})}
}
