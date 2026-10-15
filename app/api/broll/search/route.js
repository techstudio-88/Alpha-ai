import {createClient} from "@supabase/supabase-js";
import {randomUUID} from "node:crypto";
import {UUID} from "../../../lib/video-workflow.mjs";
import {checkRateLimit,rateLimitResponse,resolveWorkspacePlan} from "../../../lib/rate-limit";

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
  if(!url||!anon||!secret)return fail("B-roll search is temporarily unavailable.",503,errorId);
  const options={auth:{persistSession:false,autoRefreshToken:false}};
  const client=createClient(url,anon,options),admin=createClient(url,secret,options);
  const {data:{user},error}=await client.auth.getUser(header.slice(7));
  if(error||!user)return fail("Your session is invalid or expired. Sign in again.",401,errorId);
  const params=new URL(request.url).searchParams,workspaceId=params.get("workspaceId"),clipId=params.get("clipId"),query=(params.get("query")||"").trim().slice(0,200);
  if(!UUID.test(workspaceId||"")||!UUID.test(clipId||"")||!query)return fail("Provide a valid workspace, clip, and search query.",400,errorId);
  const {data:member,error:memberError}=await admin.from("workspace_members").select("workspace_id").eq("workspace_id",workspaceId).eq("user_id",user.id).maybeSingle();
  if(memberError)return fail("Unable to verify workspace access.",500,errorId);
  if(!member)return fail("Workspace access denied.",403,errorId);
  const {data:clip,error:clipError}=await admin.from("clips").select("id,project_id").eq("id",clipId).maybeSingle();
  if(clipError)return fail("Unable to verify this clip.",500,errorId);
  if(!clip)return fail("Clip not found.",404,errorId);
  const {data:project,error:projectError}=await admin.from("projects").select("id").eq("id",clip.project_id).eq("workspace_id",workspaceId).maybeSingle();
  if(projectError)return fail("Unable to verify this clip.",500,errorId);
  if(!project)return fail("Clip not found in this workspace.",404,errorId);
  const plan=await resolveWorkspacePlan(admin,workspaceId);
  const rate=await checkRateLimit(request,{endpoint:"ai_call",userId:user.id,plan});
  const blocked=rateLimitResponse(rate);if(blocked)return blocked;
  const key=process.env.PEXELS_API_KEY;
  if(!key)return Response.json({configured:false,results:[],message:"B-roll search is not configured yet."},{headers:{"Cache-Control":"no-store"}});
  const response=await fetch("https://api.pexels.com/videos/search?"+new URLSearchParams({query,per_page:"8",orientation:"landscape"}),
    {headers:{Authorization:key},cache:"no-store",signal:AbortSignal.timeout(12000)});
  const body=await response.json().catch(()=>({}));
  if(!response.ok)return fail("B-roll provider is temporarily unavailable.",502,errorId);
  const results=(body.videos||[]).map(v=>({id:v.id,width:v.width,height:v.height,duration:v.duration,thumbnail:v.image,
    files:(v.video_files||[]).filter(file=>file.file_type==="video/mp4").sort((a,b)=>Math.abs((a.width||0)-1080)-Math.abs((b.width||0)-1080)).slice(0,3)}));
  const {error:saveError}=await admin.from("broll_requests").insert({workspace_id:workspaceId,clip_id:clipId,query,provider:"pexels",status:"ready",result:{count:results.length}});
  if(saveError)return fail("B-roll results could not be saved.",500,errorId);
  return Response.json({configured:true,results},{headers:{"Cache-Control":"no-store"}});
 }catch(error){
  console.error("broll_search_failure",{errorId,category:"internal"});
  return fail("B-roll search failed. Contact support with error ID "+errorId+".",500,errorId);
 }
}
