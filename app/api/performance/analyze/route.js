import{createClient}from"@supabase/supabase-js";
export const runtime="nodejs";
const url=process.env.NEXT_PUBLIC_SUPABASE_URL,anon=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY||process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const service=process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SECRET_KEY;
export async function POST(req){
 try{
  const token=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"");if(!token)return Response.json({error:"Authentication required."},{status:401});
  const client=createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false}});const{data:{user},error:ue}=await client.auth.getUser(token);if(ue||!user)return Response.json({error:"Authentication expired."},{status:401});
  const body=await req.json().catch(()=>({}));const workspaceId=body.workspaceId;const clipId=body.clipId;const platform=String(body.platform||"youtube_shorts");
  if(!workspaceId||!clipId)return Response.json({error:"workspaceId and clipId are required."},{status:400});
  const{data:member}=await client.from("workspace_members").select("user_id").eq("workspace_id",workspaceId).eq("user_id",user.id).maybeSingle();if(!member)return Response.json({error:"Workspace access denied."},{status:403});
  const admin=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
  const{data:clip}=await admin.from("clips").select("*").eq("id",clipId).eq("project_id",body.projectId||undefined).maybeSingle();if(!clip)return Response.json({error:"Clip not found."},{status:404});
  const{data:scores}=await admin.from("clip_scores").select("*").eq("clip_id",clipId).maybeSingle();
  const{data:history}=await admin.from("content_performance").select("views,likes,comments,shares,retention,ctr,platform").eq("workspace_id",workspaceId).eq("platform",platform).order("captured_at",{ascending:false}).limit(100);
  const baseline=Number(body.baselineViews||0)||Number(history?.map(x=>Number(x.views)||0).filter(Boolean).sort((a,b)=>a-b)[Math.floor((history?.length||1)/2)]||0);
  const apiKey=process.env.GEMINI_API_KEY||"";
  if(!apiKey)return Response.json({error:"Performance analysis requires GEMINI_API_KEY."},{status:503});
  const prompt=`Analyze a short-form video clip for Alpha.ai. This is an estimate, not a factual probability or guarantee. Platform: ${platform}. User supplied baseline views: ${baseline||"not supplied"}. Clip: ${JSON.stringify({title:clip.title,start:clip.start_seconds,end:clip.end_seconds})}. Existing AI scores: ${JSON.stringify(scores||{})}. Historical observations: ${JSON.stringify(history||[])}. Return JSON with: low_views, high_views, relative_low, relative_high, confidence ("low","medium","high"), hook_assessment, retention_assessment, packaging_assessment, risks[], opportunities[], methodology. Never claim certainty. If there is insufficient history, explicitly lower confidence and rely on content signals rather than inventing a statistical probability.`;
  const model=process.env.GEMINI_MODEL||"gemini-3.8-flash";
  const gr=await fetch("https://generativelanguage.googleapis.com/v1beta/models/"+encodeURIComponent(model)+":generateContent?key="+encodeURIComponent(apiKey),{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:{responseMimeType:"application/json"}})});
  const gj=await gr.json().catch(()=>({}));
  if(!gr.ok)throw new Error(gj?.error?.message||"Gemini request failed.");
  const raw=gj?.candidates?.[0]?.content?.parts?.map(x=>x.text||"").join("")||"{}";
  const analysis=JSON.parse(raw);
  const row={workspace_id:workspaceId,project_id:clip.project_id,clip_id:clipId,platform,baseline_views:baseline||null,predicted_low_views:Number(analysis.low_views)||null,predicted_high_views:Number(analysis.high_views)||null,relative_low:Number(analysis.relative_low)||null,relative_high:Number(analysis.relative_high)||null,confidence:String(analysis.confidence||"low"),model_version:"performance-v1",input_features:{clip,scores,history,baseline},explanation:analysis};
  const{data:saved,error}=await admin.from("performance_predictions").insert(row).select().single();if(error)throw error;
  return Response.json({prediction:saved});
 }catch(e){return Response.json({error:e.message||"Performance analysis failed."},{status:500})}
}