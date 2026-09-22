import { createClient } from "@supabase/supabase-js";
export default async function SharePage({params}){
 const {slug}=await params;
 const c=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
 const {data}=await c.from("public_shares").select("slug,enabled,branding_enabled,view_count,clip_id,clips(title,start_seconds,end_seconds)").eq("slug",slug).eq("enabled",true).maybeSingle();
 if(!data)return <main style={{padding:40,fontFamily:"sans-serif"}}><h1>Clip not found</h1></main>;
 return <main style={{maxWidth:900,margin:"40px auto",padding:24,fontFamily:"sans-serif"}}><h1>{data.clips?.title||"Alpha.ai Clip"}</h1><p>AI-selected short-form clip.</p><div style={{aspectRatio:"16/9",background:"#111",borderRadius:16,display:"grid",placeItems:"center",color:"#fff"}}>Video playback will use the published clip asset.</div><p>{data.view_count||0} views</p>{data.branding_enabled!==false&&<small>Made with Alpha.ai</small>}</main>
}
export async function generateMetadata({params}){const {slug}=await params;return {title:"Alpha.ai clip "+slug,description:"A clip shared from Alpha.ai."}}