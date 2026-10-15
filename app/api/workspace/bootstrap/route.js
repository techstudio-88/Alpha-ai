import {createClient} from "@supabase/supabase-js";
import {randomUUID} from "node:crypto";
import {bootstrapWorkspace} from "../../../../lib/workspace-bootstrap.mjs";
import {checkRateLimit,rateLimitResponse} from "../../../../lib/rate-limit";
export const runtime="nodejs";
const fail=(error,status,errorId)=>Response.json({error,errorId},{status,headers:{"Cache-Control":"no-store"}});
export async function POST(request){
 const errorId=randomUUID();
 try{
  const authorization=request.headers.get("authorization")||"";
  if(!authorization.startsWith("Bearer "))return fail("Authentication required.",401,errorId);
  const token=authorization.slice(7);
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL||process.env.SUPABASE_URL;
  const anon=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const service=process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SECRET_KEY;
  if(!url||!anon||!service)return fail("Workspace setup is temporarily unavailable.",503,errorId);
  const options={auth:{persistSession:false,autoRefreshToken:false}};
  const auth=createClient(url,anon,options),admin=createClient(url,service,options);
  const {data:{user},error}=await auth.auth.getUser(token);
  if(error||!user)return fail("Your session is invalid or expired. Sign in again.",401,errorId);
  const rate=await checkRateLimit(request,{endpoint:"auth",userId:user.id,plan:"free"});
  const blocked=rateLimitResponse(rate);if(blocked)return blocked;
  const workspace=await bootstrapWorkspace(admin,user);
  return Response.json({workspace},{headers:{"Cache-Control":"no-store"}});
 }catch(error){
  console.error("workspace_bootstrap_failure",{errorId,category:"internal"});
  return fail("Unable to prepare your workspace. Contact support with error ID "+errorId+".",500,errorId);
 }
}
