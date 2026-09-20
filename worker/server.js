import express from"express";
import fs from"node:fs";
import path from"node:path";
import os from"node:os";
import {spawn} from"node:child_process";
import {randomUUID} from"node:crypto";
const app=express();app.use(express.json({limit:"2mb"}));
const PORT=Number(process.env.PORT||8080),SUPA=process.env.SUPABASE_URL,KEY=process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY,PUBLIC_KEY=process.env.SUPABASE_PUBLISHABLE_KEY||process.env.SUPABASE_ANON_KEY||"",SECRET=process.env.MEDIA_WORKER_SECRET||"";
const authStore=new AsyncLocalStorage();
const baseAuth={apikey:KEY||PUBLIC_KEY,Authorization:"Bearer "+(KEY||PUBLIC_KEY),"Content-Type":"application/json"};
async function db(table,{method="GET",params={},body}={}){const u=new URL(SUPA+"/rest/v1/"+table);Object.entries(params).forEach(([k,v])=>u.searchParams.set(k,v));const scoped=authStore.getStore();const headers=scoped?{apikey:PUBLIC_KEY,Authorization:"Bearer "+scoped,"Content-Type":"application/json"}:baseAuth;const r=await fetch(u,{method,headers:{...headers,Prefer:"return=representation"},body:body?JSON.stringify(body):undefined});const t=await r.text();let d;try{d=JSON.parse(t)}catch{d=t}if(!r.ok)throw new Error(table+" "+r.status+": "+t);return d}
function cmd(command,args){return new Promise((resolve,reject)=>{const p=spawn(command,args,{stdio:["ignore","pipe","pipe"]});let out="",err="";p.stdout.on("data",d=>out+=d);p.stderr.on("data",d=>err+=d);p.on("close",c=>c?reject(new Error(err.slice(-7000)||command+" failed")):resolve(out))})}
async function patchJob(id,body){return db("processing_jobs",{method:"PATCH",params:{id:"eq."+id},body})}
async function upload(file,storagePath,mime="video/mp4"){const stat=fs.statSync(file);const url=SUPA+"/storage/v1/object/media/"+storagePath.split("/").map(encodeURIComponent).join("/");const r=await fetch(url,{method:"POST",headers:{...(authStore.getStore()?{apikey:PUBLIC_KEY,Authorization:"Bearer "+authStore.getStore()}:baseAuth),"Content-Type":mime,"x-upsert":"true"},body:fs.createReadStream(file),duplex:"half"});if(!r.ok)throw new Error("Storage upload failed: "+await r.text());return stat.size}
async function downloadStored(storagePath,out){const url=SUPA+"/storage/v1/object/authenticated/media/"+storagePath.split("/").map(encodeURIComponent).join("/");const scoped=authStore.getStore();const r=await fetch(url,{headers:scoped?{apikey:PUBLIC_KEY,Authorization:"Bearer "+scoped}:{apikey:KEY||PUBLIC_KEY,Authorization:"Bearer "+(KEY||PUBLIC_KEY)}});if(!r.ok)throw new Error("Could not download uploaded source: "+await r.text());const w=fs.createWriteStream(out);for await(const chunk of r.body)w.write(chunk);await new Promise((res,rej)=>{w.end(res);w.on("error",rej)})}
async function downloadRemote(url,out,type="direct_url"){if(type==="google_drive"){const m=url.match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?[^#]*id=)([a-zA-Z0-9_-]+)/i);const id=m?.[1];if(!id)throw new Error("Google Drive link must point to a shared file.");await cmd("gdown",["--id",id,"-O",out,"--fuzzy"]);return}if(type==="dropbox"){const direct=url.replace(/[?&]dl=0\\b/,"?dl=1");await cmd("curl",["-L","--fail","--retry","3","-o",out,direct]);return}await cmd("yt-dlp",["--no-playlist","--no-warnings","-f","bv*+ba/b","--merge-output-format","mp4","-o",out,url])}
async function processJob(p){const dir=fs.mkdtempSync(path.join(os.tmpdir(),"alpha-")),input=path.join(dir,"source.mp4"),audio=path.join(dir,"audio.wav");try{
  await patchJob(p.jobId,{status:"processing",progress:2});
  let asset=null,assetRows=[];
  if(p.url){await db("project_sources",{method:"PATCH",params:{id:"eq."+p.sourceId},body:{status:"downloading"}});await downloadRemote(p.url,input,p.sourceType)}
  else{assetRows=await db("media_assets",{params:{id:"eq."+p.mediaAssetId,select:"*"}});asset=assetRows[0];if(!asset?.storage_path)throw new Error("Uploaded source has no storage path.");await downloadStored(asset.storage_path,input)}
  await patchJob(p.jobId,{progress:20});
  const probe=JSON.parse(await cmd("ffprobe",["-v","quiet","-print_format","json","-show_format","-show_streams",input]));
  const stream=probe.streams.find(x=>x.codec_type==="video"),duration=Number(probe.format?.duration||0),width=Number(stream?.width||0),height=Number(stream?.height||0),fps=Number((stream?.r_frame_rate||"0/1").split("/")[0])/(Number((stream?.r_frame_rate||"0/1").split("/")[1])||1);
  if(!asset){const fileName=(probe.format?.tags?.title||"Imported video").replace(/[^a-zA-Z0-9._ -]/g,"-")+".mp4",storagePath=p.workspaceId+"/"+p.projectId+"/source-"+randomUUID()+".mp4",size=await upload(input,storagePath);asset=(await db("media_assets",{method:"POST",body:{workspace_id:p.workspaceId,project_id:p.projectId,owner_id:p.requestedBy,name:fileName,storage_path:storagePath,mime_type:"video/mp4",size_bytes:size,duration_seconds:duration,status:"uploaded"}}))[0];await db("videos",{method:"POST",body:{project_id:p.projectId,media_asset_id:asset.id,title:fileName.replace(/\.mp4$/,""),duration_seconds:duration,width,height,fps,status:"ready"}})}else{await db("media_assets",{method:"PATCH",params:{id:"eq."+asset.id},body:{duration_seconds:duration,status:"uploaded"}});await db("videos",{method:"PATCH",params:{media_asset_id:"eq."+asset.id},body:{duration_seconds:duration,width,height,fps,status:"ready"}}).catch(()=>{})}
  if(p.sourceId)await db("project_sources",{method:"PATCH",params:{id:"eq."+p.sourceId},body:{status:"downloaded",file_name:asset.name}}).catch(()=>{});
  await patchJob(p.jobId,{progress:35});
  await cmd("ffmpeg",["-y","-i",input,"-vn","-ac","1","-ar","16000","-c:a","pcm_s16le",audio]);
  let segments=[];try{segments=JSON.parse(await cmd("python3",["transcribe.py",audio,process.env.WHISPER_MODEL||"small"]))}catch(e){console.warn("Whisper failed:",e.message)}
  const transcript=(await db("transcripts",{method:"POST",body:{media_asset_id:asset.id,language:"auto",text:segments.map(s=>s.text).join(" "),provider:"faster-whisper",status:segments.length?"completed":"failed"}}))[0];
  for(const s of segments)await db("transcript_segments",{method:"POST",body:{transcript_id:transcript.id,start_ms:Math.round(s.start*1000),end_ms:Math.round(s.end*1000),text:s.text,speaker:null,confidence:null}});
  await patchJob(p.jobId,{progress:62});
  const maxStart=Math.max(0,duration-45),count=Math.min(12,Math.max(1,Math.floor(maxStart/30)+1));
  for(let i=0;i<count;i++){const start=Math.min(maxStart,i*30),end=Math.min(duration,start+45),words=segments.filter(s=>s.end>start&&s.start<end).reduce((n,s)=>n+s.text.split(/\\s+/).filter(Boolean).length,0),score=Math.min(99,Math.round(55+Math.min(40,words/2))),clip=(await db("clips",{method:"POST",body:{project_id:p.projectId,media_asset_id:asset.id,title:"AI moment "+Math.round(start)+"s",start_seconds:start,end_seconds:end,score,status:"ready"}}))[0];await db("clip_scores",{method:"POST",body:{clip_id:clip.id,score,hook_score:score,emotion_score:Math.max(0,score-3),clarity_score:Math.min(99,score+1),shareability_score:Math.max(0,score-1),reason:"Speech density and continuous context"}})}
  await patchJob(p.jobId,{status:"completed",progress:100});await db("projects",{method:"PATCH",params:{id:"eq."+p.projectId},body:{status:"ready"}});if(p.sourceId)await db("project_sources",{method:"PATCH",params:{id:"eq."+p.sourceId},body:{status:"processed"}}).catch(()=>{});console.log("completed",p.jobId)
}catch(e){console.error("job",p.jobId,e);await patchJob(p.jobId,{status:"failed",progress:0,error:e.message}).catch(()=>{});await db("projects",{method:"PATCH",params:{id:"eq."+p.projectId},body:{status:"processing_failed"}}).catch(()=>{});if(p.sourceId)await db("project_sources",{method:"PATCH",params:{id:"eq."+p.sourceId},body:{status:"failed"}}).catch(()=>{})}finally{fs.rmSync(dir,{recursive:true,force:true})}}
app.get("/health",(_q,res)=>res.json({ok:true,service:"alpha-ai-media-worker",version:"1.0"}));
async function authorize(req){
  if(SECRET&&req.get("x-worker-secret")===SECRET)return {id:req.body?.requestedBy||null,mode:"worker-secret"};
  const bearer=req.get("authorization")||"";
  if(!bearer.startsWith("Bearer ")||!PUBLIC_KEY)return null;
  const r=await fetch(SUPA+"/auth/v1/user",{headers:{apikey:PUBLIC_KEY,Authorization:bearer}});
  if(!r.ok)return null;
  const u=await r.json();
  return u?.id?{id:u.id,mode:"supabase-jwt"}:null;
}
app.post("/process",async(req,res)=>{
  try{
    const identity=await authorize(req);
    if(!identity)return res.status(401).json({error:"Unauthorized"});
    if(identity.mode==="supabase-jwt"&&req.body?.requestedBy&&identity.id!==req.body.requestedBy)return res.status(403).json({error:"Requested user does not match access token."});
    const job=await db("processing_jobs",{params:{id:"eq."+req.body?.jobId,select:"id,workspace_id,project_id"}});
    if(!job?.[0])return res.status(404).json({error:"Processing job not found."});
    if(identity.mode==="supabase-jwt"){
      const member=await db("workspace_members",{params:{workspace_id:"eq."+job[0].workspace_id,user_id:"eq."+identity.id,select:"workspace_id,user_id",limit:"1"}});
      if(!member?.[0])return res.status(403).json({error:"Workspace access denied."});
    }
    res.status(202).json({accepted:true,jobId:req.body?.jobId});
    authStore.run((req.get("authorization")||"").replace(/^Bearer\s+/i,""),()=>processJob({...req.body,requestedBy:identity.id||req.body?.requestedBy})).catch(e=>console.error(e));
  }catch(e){console.error("authorize/process",e);res.status(500).json({error:e.message||"Worker authorization failed."})}
});
app.listen(PORT,()=>console.log("Alpha.ai media worker listening on "+PORT));