import{createClient}from"@supabase/supabase-js";
export const runtime="nodejs";
const url=process.env.NEXT_PUBLIC_SUPABASE_URL,anon=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY||process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,service=process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SECRET_KEY;
export async function GET(req){
 try{
  const auth=req.headers.get("authorization")||"";if(!auth.startsWith("Bearer "))return Response.json({error:"Authentication required."},{status:401});
  const client=createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false}}),{data:{user},error}=await client.auth.getUser(auth.slice(7));if(error||!user)return Response.json({error:"Authentication expired."},{status:401});
  const q=new URL(req.url).searchParams,workspaceId=q.get("workspaceId"),clipId=q.get("clipId"),query=(q.get("query")||"").trim().slice(0,200);if(!workspaceId||!clipId||!query)return Response.json({error:"workspaceId, clipId and query are required."},{status:400});
  const admin=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});const{data:member}=await admin.from("workspace_members").select("workspace_id").eq("workspace_id",workspaceId).eq("user_id",user.id).maybeSingle();if(!member)return Response.json({error:"Workspace access denied."},{status:403});
  const key=process.env.PEXELS_API_KEY;if(!key)return Response.json({configured:false,results:[],message:"Pexels B-roll search is not configured on the media worker yet."});
  const rr=await fetch("https://api.pexels.com/videos/search?"+new URLSearchParams({query,per_page:"8",orientation:"landscape"}),{headers:{Authorization:key},cache:"no-store"});const body=await rr.json().catch(()=>({}));if(!rr.ok)return Response.json({error:body?.error||"B-roll provider failed."},{status:502});
  const results=(body.videos||[]).map(v=>({id:v.id,width:v.width,height:v.height,duration:v.duration,thumbnail:v.image,files:(v.video_files||[]).filter(f=>f.file_type==="video/mp4").sort((a,b)=>Math.abs((a.width||0)-1080)-Math.abs((b.width||0)-1080)).slice(0,3)}));
  await admin.from("broll_requests").insert({workspace_id:workspaceId,clip_id:clipId,query,provider:"pexels",status:"ready",result:{count:results.length}});
  return Response.json({configured:true,results});
 }catch(e){return Response.json({error:e.message||"B-roll search failed."},{status:500})}
}