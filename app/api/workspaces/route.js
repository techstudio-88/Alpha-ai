import {createClient} from "@supabase/supabase-js";
import {randomUUID} from "node:crypto";
import {checkRateLimit,rateLimitResponse} from "../../../lib/rate-limit";

export const runtime="nodejs";
const fail=(error,status,errorId)=>Response.json({error,errorId},{status,headers:{"Cache-Control":"no-store"}});
export async function GET(request){
 const errorId=randomUUID();
 try{
  const header=request.headers.get("authorization")||"";
  if(!header.startsWith("Bearer "))return fail("Authentication required.",401,errorId);
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL||process.env.SUPABASE_URL;
  const anon=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const secret=process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SECRET_KEY;
  if(!url||!anon||!secret)return fail("Workspace service is temporarily unavailable.",503,errorId);
  const options={auth:{persistSession:false,autoRefreshToken:false}};
  const auth=createClient(url,anon,options),admin=createClient(url,secret,options);
  const {data:{user},error:authError}=await auth.auth.getUser(header.slice(7));
  if(authError||!user)return fail("Your session is invalid or expired. Sign in again.",401,errorId);
  const rate=await checkRateLimit(request,{endpoint:"api",userId:user.id,plan:"free"});
  const blocked=rateLimitResponse(rate);if(blocked)return blocked;
  const {data,error}=await admin.from("workspace_members").select("workspace_id,role,workspaces(id,name,owner_id)")
    .eq("user_id",user.id).limit(100);
  if(error)return fail("Unable to load your workspaces.",500,errorId);
  return Response.json({workspaces:(data||[]).map(row=>({...row.workspaces,role:row.role}))},{headers:{"Cache-Control":"no-store"}});
 }catch(error){
  console.error("workspaces_list_failure",{errorId,category:"internal"});
  return fail("Unable to load your workspaces. Contact support with error ID "+errorId+".",500,errorId);
 }
}
