import {createClient} from "@supabase/supabase-js";
import {randomUUID} from "node:crypto";
import {checkRateLimit,rateLimitResponse,resolveWorkspacePlan} from "../../../../../lib/rate-limit";

export const runtime="nodejs";
const fail=(error,status,errorId)=>Response.json({error,errorId},{status,headers:{"Cache-Control":"no-store"}});
export async function PATCH(request,{params}){
 const errorId=randomUUID();
 try{
  const {slug}=await params;
  if(!/^[a-zA-Z0-9_-]{8,80}$/.test(slug||""))return fail("Invalid share link.",400,errorId);
  const header=request.headers.get("authorization")||"";
  if(!header.startsWith("Bearer "))return fail("Authentication required.",401,errorId);
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL||process.env.SUPABASE_URL;
  const anon=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const secret=process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SECRET_KEY;
  if(!url||!anon||!secret)return fail("Share settings are temporarily unavailable.",503,errorId);
  const options={auth:{persistSession:false,autoRefreshToken:false}};
  const auth=createClient(url,anon,options),admin=createClient(url,secret,options);
  const {data:{user},error:authError}=await auth.auth.getUser(header.slice(7));
  if(authError||!user)return fail("Your session is invalid or expired. Sign in again.",401,errorId);
  const {data:share,error:shareError}=await admin.from("public_shares").select("id,user_id,workspace_id").eq("slug",slug).maybeSingle();
  if(shareError)return fail("Unable to load share settings.",500,errorId);
  if(!share||share.user_id!==user.id)return fail("Share link not found or access denied.",403,errorId);
  const plan=await resolveWorkspacePlan(admin,share.workspace_id);
  const rate=await checkRateLimit(request,{endpoint:"api",userId:user.id,plan});
  const blocked=rateLimitResponse(rate);if(blocked)return blocked;
  const body=await request.json().catch(()=>null);
  if(!body||typeof body!=="object")return fail("Provide valid share settings.",400,errorId);
  const {data,error}=await admin.from("public_shares").update({branding_enabled:body.branding_enabled!==false,enabled:body.enabled!==false})
    .eq("id",share.id).eq("user_id",user.id).select("slug,enabled,branding_enabled").single();
  if(error)return fail("Unable to save share settings.",500,errorId);
  return Response.json(data,{headers:{"Cache-Control":"no-store"}});
 }catch(error){
  console.error("share_settings_failure",{errorId,category:"internal"});
  return fail("Unable to update share settings. Contact support with error ID "+errorId+".",500,errorId);
 }
}
