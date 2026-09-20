import{createClient}from"@supabase/supabase-js";
import{createHmac,timingSafeEqual}from"node:crypto";
export const runtime="nodejs";
const secret=()=>process.env.MEDIA_WORKER_SECRET||"";
const b64u=(v)=>Buffer.from(v).toString("base64url");
const sign=(payload)=>createHmac("sha256",secret()).update(payload).digest("base64url");
function makeTicket(data){const body=b64u(JSON.stringify(data));return body+"."+sign(body)}
function verifyTicket(ticket){try{if(!secret()||typeof ticket!=="string")return null;const[a,b]=ticket.split(".");if(!a||!b)return null;const expected=Buffer.from(sign(a));const actual=Buffer.from(b);if(expected.length!==actual.length||!timingSafeEqual(expected,actual))return null;const data=JSON.parse(Buffer.from(a,"base64url").toString("utf8"));if(!data?.sub||!data?.workspaceId||!data?.projectId||!data?.jobId||Number(data.exp||0)<Date.now())return null;return data}catch{return null}}
export async function POST(request){
  try{
    const auth=request.headers.get("authorization")||"";
    if(!auth.startsWith("Bearer "))return Response.json({error:"Authentication required."},{status:401});
    if(!secret())return Response.json({error:"Processing ticket service is not configured."},{status:503});
    const supabaseUrl=process.env.NEXT_PUBLIC_SUPABASE_URL;
    const publicKey=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY||process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    const client=createClient(supabaseUrl,publicKey,{auth:{persistSession:false,autoRefreshToken:false},global:{headers:{Authorization:auth}}});
    const{data:{user},error:userError}=await client.auth.getUser(auth.slice(7));
    if(userError||!user)return Response.json({error:"Invalid session."},{status:401});
    const body=await request.json().catch(()=>({}));
    const{workspaceId,projectId,sourceId,jobId,mediaAssetId}=body||{};
    if(!workspaceId||!projectId||!jobId)return Response.json({error:"Missing processing job context."},{status:400});
    const{data:isMember,error:memberError}=await client.rpc("is_workspace_member",{wid:workspaceId});
    if(memberError||!isMember)return Response.json({error:"Workspace access denied."},{status:403});
    const exp=Date.now()+45*60*1000;
    const ticket=makeTicket({sub:user.id,workspaceId,projectId,sourceId:sourceId||null,jobId,mediaAssetId:mediaAssetId||null,exp});
    return Response.json({ticket,expiresAt:exp});
  }catch(error){
    console.error("import-ticket",error);
    return Response.json({error:error?.message||"Unable to create processing ticket."},{status:500});
  }
}