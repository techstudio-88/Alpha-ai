import {randomUUID} from "node:crypto";
import {createClient} from "@supabase/supabase-js";
import {checkRateLimit,rateLimitResponse} from "../../../../lib/rate-limit";

export const runtime="nodejs";
const fail=(error,status,errorId)=>Response.json({error,errorId},{status,headers:{"Cache-Control":"no-store"}});
export async function POST(request){
 const errorId=randomUUID();
 try{
  const header=request.headers.get("authorization")||"";
  if(!header.startsWith("Bearer "))return fail("Authentication required.",401,errorId);
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL||process.env.SUPABASE_URL;
  const anon=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const secret=process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SECRET_KEY;
  if(!url||!anon||!secret)return fail("Account deletion is temporarily unavailable.",503,errorId);
  const options={auth:{autoRefreshToken:false,persistSession:false}};
  const auth=createClient(url,anon,options),admin=createClient(url,secret,options);
  const {data:{user},error}=await auth.auth.getUser(header.slice(7));
  if(error||!user)return fail("Your session is invalid or expired. Sign in again.",401,errorId);
  const rate=await checkRateLimit(request,{endpoint:"auth",userId:user.id,plan:"free"});
  const blocked=rateLimitResponse(rate);if(blocked)return blocked;
  const deleted=await admin.auth.admin.deleteUser(user.id);
  if(deleted.error)return fail("Account deletion failed. Contact support with error ID "+errorId+".",500,errorId);
  return Response.json({ok:true},{headers:{"Cache-Control":"no-store"}});
 }catch(error){
  console.error("account_deletion_failure",{errorId,category:"internal"});
  return fail("Account deletion failed. Contact support with error ID "+errorId+".",500,errorId);
 }
}
