import{createClient}from"@supabase/supabase-js";
export const runtime="nodejs";
const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY||process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const service=process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SECRET_KEY;
const worker=process.env.MEDIA_WORKER_URL||"https://alpha-ai-media-worker.onrender.com";
const secret=process.env.MEDIA_WORKER_SECRET||"";
export async function POST(req){
  try{
    if(!url||!anon||!service||!secret)return Response.json({error:"AI planning is not configured on the server."},{status:503});
    const auth=req.headers.get("authorization")||"";
    if(!auth.startsWith("Bearer "))return Response.json({error:"Authentication required."},{status:401});
    const token=auth.slice(7),client=createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false}});
    const {data:{user},error}=await client.auth.getUser(token);if(error||!user)return Response.json({error:"Authentication expired."},{status:401});
    const body=await req.json().catch(()=>({}));const workspaceId=String(body.workspaceId||""),projectId=String(body.projectId||""),mediaAssetId=String(body.mediaAssetId||""),prompt=String(body.prompt||"").trim();
    if(!workspaceId||!projectId||!mediaAssetId||!prompt)return Response.json({error:"workspaceId, projectId, mediaAssetId and prompt are required."},{status:400});
    const admin=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
    const {data:member}=await admin.from("workspace_members").select("workspace_id").eq("workspace_id",workspaceId).eq("user_id",user.id).maybeSingle();
    if(!member)return Response.json({error:"Workspace access denied."},{status:403});
    const {data:asset}=await admin.from("media_assets").select("id,project_id,name,duration_seconds").eq("id",mediaAssetId).eq("project_id",projectId).maybeSingle();
    if(!asset)return Response.json({error:"Source media not found."},{status:404});
    const {data:tr}=await admin.from("transcripts").select("id").eq("media_asset_id",mediaAssetId).order("created_at",{ascending:false}).limit(1).maybeSingle();
    if(!tr)return Response.json({error:"No transcript exists for this video yet. Run transcription first."},{status:409});
    const {data:words,error:wordError}=await admin.from("transcript_words").select("start_ms,end_ms,word").eq("transcript_id",tr.id).order("start_ms",{ascending:true}).limit(12000);
    if(wordError||!words?.length)return Response.json({error:"No word-level transcript exists for this video yet."},{status:409});
    const transcript=words.map((w,i)=>i+":"+String(w.word||"")).join(" ");
    const wr=await fetch(worker.replace(/\/$/,"")+"/assistant/plan",{method:"POST",headers:{"content-type":"application/json","x-worker-secret":secret},body:JSON.stringify({prompt,transcript})});
    const wo=await wr.json().catch(()=>({}));if(!wr.ok)return Response.json({error:wo.error||"AI planning failed."},{status:502});
    const plan=wo.plan||{};const clips=Array.isArray(plan.clips)?plan.clips.slice(0,8):[];
    if(!clips.length)return Response.json({error:"Gemini returned no usable clips."},{status:422});
    const sessionId=body.sessionId||crypto.randomUUID();
    const {error:se}=await admin.from("ai_chat_sessions").upsert({id:sessionId,workspace_id:workspaceId,user_id:user.id,title:prompt.slice(0,80)||"AI edit",project_id:projectId,media_asset_id:mediaAssetId,updated_at:new Date().toISOString()},{onConflict:"id"});
    if(se)throw new Error(se.message);
    await admin.from("ai_chat_messages").insert({session_id:sessionId,workspace_id:workspaceId,user_id:user.id,role:"user",content:prompt,metadata:{mediaAssetId}});
    const rows=clips.map(k=>{
      const a=Math.max(0,Number(k.a)||0),b=Math.max(a,Number(k.b)||a),wa=words[a],wb=words[Math.min(b,words.length-1)];
      const start=Number(wa?.start_ms||0)/1000,end=Math.min(Number(asset.duration_seconds||999999),Number(wb?.end_ms||0)/1000);
      return {project_id:projectId,media_asset_id:mediaAssetId,title:String(k.title||"AI clip").slice(0,180),start_seconds:start,end_seconds:Math.max(start,end),score:Number(k.score||0),status:"planned",ai_spec:{...k,a,b,summary:plan.summary||""},caption_config:{style:k.captionStyle||"pop",color:k.captionColor||"#00f2fe"},reframe_config:{aspect:["9:16","1:1","16:9"].includes(k.aspect)?k.aspect:"9:16"},broll_config:Array.isArray(k.broll)?k.broll:[]};
    }).filter(x=>x.end_seconds-x.start_seconds>=0.5);
    const {data:created,error:ce}=await admin.from("clips").insert(rows).select("id,title,start_seconds,end_seconds,score,status,ai_spec,project_id,media_asset_id");
    if(ce)throw new Error(ce.message);
    await admin.from("ai_chat_messages").insert({session_id:sessionId,workspace_id:workspaceId,user_id:user.id,role:"assistant",content:String(plan.summary||"I created an AI clip plan."),metadata:{clipIds:(created||[]).map(x=>x.id),plan}});
    return Response.json({ok:true,sessionId,summary:plan.summary||"",clips:created||[]});
  }catch(e){console.error("ai chat plan",e);return Response.json({error:e.message||"AI clip planning failed."},{status:500})}
}