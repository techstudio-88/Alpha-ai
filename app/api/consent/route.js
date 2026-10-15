import {createClient} from "@supabase/supabase-js";
import {randomUUID} from "node:crypto";
import {checkRateLimit,rateLimitResponse} from "../../../lib/rate-limit";

export const runtime="nodejs";
const VERSIONS={terms:"2026-09-21",privacy:"2026-09-21",cookies:"2026-09-21"};
const fail=(error,status,errorId)=>Response.json({error,errorId},{status,headers:{"Cache-Control":"no-store"}});
export async function POST(request){
 const errorId=randomUUID();
 try{
  const header=request.headers.get("authorization")||"";
  if(!header.startsWith("Bearer "))return fail("Authentication required.",401,errorId);
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL||process.env.SUPABASE_URL;
  const anon=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const secret=process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SECRET_KEY;
  if(!url||!anon||!secret)return fail("Consent recording is temporarily unavailable.",503,errorId);
  const options={auth:{persistSession:false,autoRefreshToken:false}};
  const client=createClient(url,anon,options),admin=createClient(url,secret,options);
  const {data:{user},error}=await client.auth.getUser(header.slice(7));
  if(error||!user)return fail("Your session is invalid or expired. Sign in again.",401,errorId);
  const rate=await checkRateLimit(request,{endpoint:"auth",userId:user.id,plan:"free"});
  const blocked=rateLimitResponse(rate);if(blocked)return blocked;
  const body=await request.json().catch(()=>null),type=String(body?.consentType||"");
  if(!["terms","privacy","cookies"].includes(type))return fail("Choose a valid consent type.",400,errorId);
  const granted=Boolean(body.granted);
  if((type==="terms"||type==="privacy")&&!granted)return fail("Terms and Privacy must be accepted to continue using Alpha.ai.",400,errorId);
  const {error:insertError}=await admin.from("user_privacy_consents").insert({user_id:user.id,consent_type:type,
    policy_version:VERSIONS[type],granted,source:"app",metadata:{necessary_cookies:true,analytics_cookies:false}});
  if(insertError)return fail("Could not record consent. Please retry.",500,errorId);
  return Response.json({ok:true,consentType:type,policyVersion:VERSIONS[type]},{headers:{"Cache-Control":"no-store"}});
 }catch(error){
  console.error("consent_write_failure",{errorId,category:"internal"});
  return fail("Could not record consent. Contact support with error ID "+errorId+".",500,errorId);
 }
}
