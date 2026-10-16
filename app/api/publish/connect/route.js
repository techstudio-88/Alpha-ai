import {createClient} from "@supabase/supabase-js";
import {randomUUID,createHmac} from "node:crypto";
import {UUID} from "../../../../lib/video-workflow.mjs";
import {checkRateLimit,rateLimitResponse,resolveWorkspacePlan} from "../../../../lib/rate-limit";

export const runtime="nodejs";
const fail=(error,status,errorId)=>Response.json({error,errorId},{status,headers:{"Cache-Control":"no-store"}});
function stateSecret(){return process.env.OAUTH_STATE_SECRET||process.env.CRON_SECRET||""}
export async function POST(request){
 const errorId=randomUUID();
 try{
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL||process.env.SUPABASE_URL;
  const anon=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const service=process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SECRET_KEY;
  if(!url||!anon||!service)return fail("Channel connection is temporarily unavailable.",503,errorId);
  const header=request.headers.get("authorization")||"";
  if(!header.startsWith("Bearer "))return fail("Authentication required.",401,errorId);
  const auth=createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:{user},error:authError}=await auth.auth.getUser(header.slice(7));
  if(authError||!user)return fail("Your session is invalid or expired. Sign in again.",401,errorId);
  const params=new URL(request.url).searchParams,platform=params.get("platform"),workspaceId=params.get("workspace_id");
  if(platform!=="youtube")return fail("Only YouTube connection is currently supported.",400,errorId);
  if(!UUID.test(workspaceId||""))return fail("A valid workspace is required.",400,errorId);
  const admin=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:member,error:memberError}=await admin.from("workspace_members").select("workspace_id").eq("workspace_id",workspaceId).eq("user_id",user.id).maybeSingle();
  if(memberError)return fail("Unable to verify workspace access.",500,errorId);
  if(!member)return fail("Workspace access denied.",403,errorId);
  const plan=await resolveWorkspacePlan(admin,workspaceId);
  const rate=await checkRateLimit(request,{endpoint:"auth",userId:user.id,plan});
  const blocked=rateLimitResponse(rate);if(blocked)return blocked;
  const clientId=process.env.YOUTUBE_CLIENT_ID,secret=stateSecret();
  if(!clientId||!secret)return fail("YouTube connection is not configured.",503,errorId);
  const now=Date.now();
  const state=Buffer.from(JSON.stringify({workspace_id:workspaceId,user_id:user.id,iat:now,exp:now+10*60*1000,nonce:randomUUID()})).toString("base64url");
  const signature=createHmac("sha256",secret).update(state).digest("hex"),signed=state+"."+signature;
  const redirect=process.env.YOUTUBE_REDIRECT_URI||new URL("/api/publish/callback",new URL(request.url).origin).toString();
  const query=new URLSearchParams({client_id:clientId,redirect_uri:redirect,response_type:"code",
    scope:"https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly",
    access_type:"offline",prompt:"consent",state:signed});
  return Response.json({url:"https://accounts.google.com/o/oauth2/v2/auth?"+query.toString()},{headers:{"Cache-Control":"no-store"}});
 }catch(error){
  console.error("publish_connect_failure",{errorId,category:error?.message==="CONFIG"?"configuration":"internal"});
  return fail("Channel connection could not start. Contact support with error ID "+errorId+".",500,errorId);
 }
}
export async function GET(){return Response.json({error:"POST required."},{status:405})}
