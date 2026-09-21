import {createClient} from "@supabase/supabase-js";
export const runtime="nodejs";
const SITE_WORKER=process.env.MEDIA_WORKER_URL||"https://alpha-ai-media-worker.onrender.com";
const WORKER_SECRET=process.env.MEDIA_WORKER_SECRET||"";
const SUPA=process.env.NEXT_PUBLIC_SUPABASE_URL||process.env.SUPABASE_URL||"";
const SERVICE=process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SECRET_KEY||"";
export async function POST(req){
  try{
    const auth=req.headers.get("authorization")||"";
    if(!auth.startsWith("Bearer "))return Response.json({error:"Authentication required."},{status:401});
    const token=auth.slice(7);
    const supabase=createClient(SUPA,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY||process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||"");
    const {data:{user},error}=await supabase.auth.getUser(token);
    if(error||!user)return Response.json({error:"Authentication expired."},{status:401});
    const body=await req.json().catch(()=>({}));
    const prompt=String(body.prompt||"").trim();
    if(!prompt)return Response.json({error:"Prompt is required."},{status:400});
    const workspaceId=String(body.workspaceId||"");
    if(!workspaceId)return Response.json({error:"Workspace is required."},{status:400});
    const admin=createClient(SUPA,SERVICE);
    const {data:member}=await admin.from("workspace_members").select("user_id,role,can_export").eq("workspace_id",workspaceId).eq("user_id",user.id).maybeSingle();
    if(!member)return Response.json({error:"Workspace access denied."},{status:403});
    const {data:projects}=await admin.from("projects").select("id,name,status,created_at").eq("workspace_id",workspaceId).order("created_at",{ascending:false}).limit(12);
    const {data:clips}=await admin.from("clips").select("id,title,status,start_seconds,end_seconds,score,project_id").in("project_id",(projects||[]).map(x=>x.id)).order("created_at",{ascending:false}).limit(20);
    const context=JSON.stringify({projects:projects||[],clips:clips||[]});
    const r=await fetch(SITE_WORKER+"/assistant",{method:"POST",headers:{"content-type":"application/json","x-worker-secret":WORKER_SECRET},body:JSON.stringify({prompt,context})});
    const out=await r.json().catch(()=>({}));
    if(!r.ok)return Response.json({error:out.error||"Assistant provider failed."},{status:r.status});
    return Response.json(out);
  }catch(e){return Response.json({error:e.message||"Assistant failed."},{status:500})}
}