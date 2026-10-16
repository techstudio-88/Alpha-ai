import {createClient} from "@supabase/supabase-js";
import {randomUUID} from "node:crypto";
import {checkRateLimit,rateLimitResponse} from "../../../../../lib/rate-limit";

export const runtime="nodejs";
const fail=(error,status,errorId)=>Response.json({error,errorId},{status,headers:{"Cache-Control":"no-store"}});
export async function POST(request,{params}){
 const errorId=randomUUID();
 try{
  const {slug}=await params;
  if(!/^[a-zA-Z0-9_-]{8,80}$/.test(slug||""))return fail("Share link not found.",404,errorId);
  const url=process.env.SUPABASE_URL||process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret=process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SECRET_KEY;
  if(!url||!secret)return fail("Share links are temporarily unavailable.",503,errorId);
  const rate=await checkRateLimit(request,{endpoint:"api",plan:"free"});
  const blocked=rateLimitResponse(rate);if(blocked)return blocked;
  const admin=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data,error}=await admin.from("public_shares").select("id,view_count,enabled").eq("slug",slug).eq("enabled",true).maybeSingle();
  if(error)return fail("Unable to load this share link.",500,errorId);
  if(!data)return fail("Share link not found.",404,errorId);
  const {data:updated,error:updateError}=await admin.from("public_shares").update({view_count:(data.view_count||0)+1})
    .eq("id",data.id).eq("enabled",true).select("view_count").maybeSingle();
  if(updateError)return fail("Unable to record this share view.",500,errorId);
  if(!updated)return fail("Share link is no longer available.",404,errorId);
  return Response.json({ok:true,view_count:updated.view_count},{headers:{"Cache-Control":"no-store"}});
 }catch(error){
  console.error("share_view_failure",{errorId,category:"internal"});
  return fail("Unable to load this share link. Contact support with error ID "+errorId+".",500,errorId);
 }
}
