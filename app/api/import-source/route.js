import{createClient}from"@supabase/supabase-js";
export const runtime="nodejs";
export const maxDuration=30;
const supabaseUrl=process.env.NEXT_PUBLIC_SUPABASE_URL;
const publicKey=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY||process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
export async function POST(request){
  try{
    const auth=request.headers.get("authorization")||"";
    if(!auth.startsWith("Bearer "))return Response.json({error:"Authentication required."},{status:401});
    const body=await request.json();
    const{url,sourceType,workspaceId,projectId,sourceId,jobId,mediaAssetId}=body||{};
    if(!workspaceId||!projectId||!jobId)return Response.json({error:"Missing processing job context."},{status:400});
    const client=createClient(supabaseUrl,publicKey,{auth:{persistSession:false}});
    const{data:{user},error:userError}=await client.auth.getUser(auth.slice(7));
    if(userError||!user)return Response.json({error:"Invalid session."},{status:401});
    const{data:member}=await client.from("workspace_members").select("role").eq("workspace_id",workspaceId).eq("user_id",user.id).maybeSingle();
    if(!member)return Response.json({error:"Workspace access denied."},{status:403});
    const worker=process.env.MEDIA_WORKER_URL;
    if(!worker)return Response.json({error:"Media worker is not configured. Set MEDIA_WORKER_URL on Vercel so Alpha.ai can download and process linked videos."},{status:503});
    const response=await fetch(worker.replace(/\/$/,"")+"/process",{method:"POST",headers:{"content-type":"application/json","x-worker-secret":process.env.MEDIA_WORKER_SECRET||""},body:JSON.stringify({url:url||null,sourceType:sourceType||"upload",workspaceId,projectId,sourceId:sourceId||null,jobId,mediaAssetId:mediaAssetId||null,requestedBy:user.id})});
    const result=await response.json().catch(()=>({}));
    if(!response.ok)return Response.json({error:result.error||"Media worker rejected the job."},{status:502});
    return Response.json({ok:true,jobId,worker:result});
  }catch(error){console.error("import-source",error);return Response.json({error:error?.message||"Unable to start media ingestion."},{status:500})}
}