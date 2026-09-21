import{AsyncLocalStorage}from"node:async_hooks";
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
async function renderClip(input,out,start,end){
  const duration=Math.max(0.25,Number(end)-Number(start));
  await cmd("ffmpeg",["-y","-ss",String(Math.max(0,Number(start))),"-i",input,"-t",String(duration),"-map","0:v:0?","-map","0:a:0?","-c:v","libx264","-preset","ultrafast","-crf","28","-c:a","aac","-b:a","128k","-movflags","+faststart",out]);
}
let transcriberPromise=null;
async function transcribeAudio(file){
  const {pipeline}=await import("@huggingface/transformers");
  const wavefile=await import("wavefile");
  const {WaveFile}=wavefile.default||wavefile;
  if(!transcriberPromise){
    const model=(process.env.WHISPER_MODEL&&process.env.WHISPER_MODEL.includes("/"))?process.env.WHISPER_MODEL:"onnx-community/whisper-tiny";
    transcriberPromise=pipeline("automatic-speech-recognition",model,{dtype:"q4"});
  }
  const transcriber=await transcriberPromise;
  const wav=new WaveFile(fs.readFileSync(file));
  wav.toBitDepth("32f");wav.toSampleRate(16000);
  let samples=wav.getSamples();if(Array.isArray(samples))samples=samples[0];
  const result=await transcriber(samples,{chunk_length_s:15,stride_length_s:3,return_timestamps:true});
  return (Array.isArray(result?.chunks)?result.chunks:[]).map(x=>{
    const t=x.timestamp||[0,0];
    return {start:Number(t[0]||0),end:Number(t[1]||t[0]||0),text:String(x.text||"").trim()};
  }).filter(x=>x.text&&x.end>x.start);
}
async function patchJob(id,body){return db("processing_jobs",{method:"PATCH",params:{id:"eq."+id},body})}
async function upload(file,storagePath,mime="video/mp4"){const stat=fs.statSync(file);const url=SUPA+"/storage/v1/object/media/"+storagePath.split("/").map(encodeURIComponent).join("/");const r=await fetch(url,{method:"POST",headers:{...(authStore.getStore()?{apikey:PUBLIC_KEY,Authorization:"Bearer "+authStore.getStore()}:baseAuth),"Content-Type":mime,"x-upsert":"true"},body:fs.createReadStream(file),duplex:"half"});if(!r.ok)throw new Error("Storage upload failed: "+await r.text());return stat.size}
async function downloadStored(storagePath,out){const url=SUPA+"/storage/v1/object/authenticated/media/"+storagePath.split("/").map(encodeURIComponent).join("/");const scoped=authStore.getStore();const r=await fetch(url,{headers:scoped?{apikey:PUBLIC_KEY,Authorization:"Bearer "+scoped}:{apikey:KEY||PUBLIC_KEY,Authorization:"Bearer "+(KEY||PUBLIC_KEY)}});if(!r.ok)throw new Error("Could not download uploaded source: "+await r.text());const w=fs.createWriteStream(out);for await(const chunk of r.body)w.write(chunk);await new Promise((res,rej)=>{w.end(res);w.on("error",rej)})}
async function downloadRemote(url,out,type="direct_url",opts={}){if(type==="google_drive"&&opts.driveFileId&&opts.driveAccessToken){const r=await fetch("https://www.googleapis.com/drive/v3/files/"+encodeURIComponent(opts.driveFileId)+"?alt=media",{headers:{Authorization:"Bearer "+opts.driveAccessToken}});if(!r.ok)throw new Error("Google Drive download failed: "+await r.text());const w=fs.createWriteStream(out);for await(const chunk of r.body)w.write(chunk);await new Promise((res,rej)=>{w.end(res);w.on("error",rej)});return}if(type==="google_drive"){const m=url.match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?[^#]*id=)([a-zA-Z0-9_-]+)/i);const id=m?.[1];if(!id)throw new Error("Google Drive link must point to a shared file.");await cmd("gdown",["--id",id,"-O",out,"--fuzzy"]);return}if(type==="dropbox"){const u=new URL(url);u.searchParams.set("dl","1");await cmd("curl",["-L","--fail","--retry","3","-o",out,u.toString()]);return}if(type==="onedrive"){const shareToken=Buffer.from(url).toString("base64").replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");const contentUrl="https://api.onedrive.com/v1.0/shares/u!"+shareToken+"/root/content";await cmd("curl",["-L","--fail","--retry","3","-o",out,contentUrl]);return}if(type==="direct_url"){await cmd("curl",["-L","--fail","--retry","3","-o",out,url]);return}await cmd("yt-dlp",["--no-playlist","--no-warnings","-f","bv*+ba/b","--merge-output-format","mp4","-o",out,url])}
async function processJob(p){const dir=fs.mkdtempSync(path.join(os.tmpdir(),"alpha-")),input=path.join(dir,"source.mp4"),audio=path.join(dir,"audio.wav");try{
  await patchJob(p.jobId,{status:"processing",progress:2});
  let asset=null,assetRows=[];
  if(p.sourceType==="google_drive"&&p.driveFileId&&p.driveAccessToken){
    await db("project_sources",{method:"PATCH",params:{id:"eq."+p.sourceId},body:{status:"downloading"}});
    await downloadRemote(null,input,"google_drive",{driveFileId:p.driveFileId,driveAccessToken:p.driveAccessToken});
  }else if(p.url){
    await db("project_sources",{method:"PATCH",params:{id:"eq."+p.sourceId},body:{status:"downloading"}});
    await downloadRemote(p.url,input,p.sourceType);
  }else{
    assetRows=await db("media_assets",{params:{id:"eq."+p.mediaAssetId,select:"*"}});
    asset=assetRows[0];
    if(!asset?.storage_path)throw new Error("Uploaded source has no storage path.");
    await downloadStored(asset.storage_path,input);
  }
  await patchJob(p.jobId,{progress:20});
  const probe=JSON.parse(await cmd("ffprobe",["-v","quiet","-print_format","json","-show_format","-show_streams",input]));
  const stream=probe.streams.find(x=>x.codec_type==="video"),duration=Number(probe.format?.duration||0),width=Number(stream?.width||0),height=Number(stream?.height||0),fps=Number((stream?.r_frame_rate||"0/1").split("/")[0])/(Number((stream?.r_frame_rate||"0/1").split("/")[1])||1);
  if(!asset){const fileName=(probe.format?.tags?.title||"Imported video").replace(/[^a-zA-Z0-9._ -]/g,"-")+".mp4",storagePath=p.workspaceId+"/"+p.projectId+"/source-"+randomUUID()+".mp4",size=await upload(input,storagePath);asset=(await db("media_assets",{method:"POST",body:{workspace_id:p.workspaceId,project_id:p.projectId,owner_id:p.requestedBy,name:fileName,storage_path:storagePath,mime_type:"video/mp4",size_bytes:size,duration_seconds:duration,status:"uploaded"}}))[0];await db("videos",{method:"POST",body:{project_id:p.projectId,media_asset_id:asset.id,title:fileName.replace(/\.mp4$/,""),duration_seconds:duration,width,height,fps,status:"ready"}})}else{await db("media_assets",{method:"PATCH",params:{id:"eq."+asset.id},body:{duration_seconds:duration,status:"uploaded"}});await db("videos",{method:"PATCH",params:{media_asset_id:"eq."+asset.id},body:{duration_seconds:duration,width,height,fps,status:"ready"}}).catch(()=>{})}
  if(p.sourceId)await db("project_sources",{method:"PATCH",params:{id:"eq."+p.sourceId},body:{status:"downloaded",file_name:asset.name}}).catch(()=>{});
  await patchJob(p.jobId,{progress:35});
  await cmd("ffmpeg",["-y","-i",input,"-vn","-ac","1","-ar","16000","-c:a","pcm_s16le",audio]);
  // Free-tier safe transcription: process short audio windows and checkpoint after every window.
  // If Render restarts, recovery resumes from the last saved window instead of starting Whisper again.
  let transcript=null;
  if(p.transcriptId){
    transcript=(await db("transcripts",{params:{id:"eq."+p.transcriptId,select:"*"}}))[0]||null;
  }
  if(!transcript){
    transcript=(await db("transcripts",{method:"POST",body:{media_asset_id:asset.id,language:"auto",text:"",provider:"transformers-whisper",status:"processing"}}))[0];
    await patchJob(p.jobId,{payload:{...p,transcriptId:transcript.id,transcribeChunk:0}});
  }
  const chunkSeconds=15;
  const chunkCount=Math.max(1,Math.ceil(duration/chunkSeconds));
  let nextChunk=Math.max(0,Number(p.transcribeChunk||0));
  let transcriptionChunks=Array.isArray(p.transcriptionChunks)?p.transcriptionChunks:[];
  if(nextChunk<chunkCount && transcriptionChunks.length<chunkCount){
    transcriptionChunks=[];
    for(let i=0;i<chunkCount;i++){
      const start=i*chunkSeconds, length=Math.min(chunkSeconds,Math.max(0,duration-start));
      if(length<=0)break;
      const chunkAudio=path.join(dir,"chunk-"+i+".wav");
      await cmd("ffmpeg",["-y","-ss",String(start),"-i",audio,"-t",String(length),"-c:a","pcm_s16le",chunkAudio]);
      const storagePath=p.workspaceId+"/"+p.projectId+"/transcription/"+transcript.id+"/chunk-"+i+".wav";
      await upload(chunkAudio,storagePath,"audio/wav");
      transcriptionChunks.push({index:i,start,length,storagePath});
      await patchJob(p.jobId,{progress:35+Math.round(((i+1)/chunkCount)*8),payload:{...p,transcriptId:transcript.id,transcribeChunk:0,transcriptionChunks}});
    }
  }
  if(nextChunk<chunkCount){
    await patchJob(p.jobId,{status:"awaiting_transcription",progress:43,payload:{...p,transcriptId:transcript.id,transcribeChunk:nextChunk,transcriptionChunks}});
    console.log("awaiting browser transcription",p.jobId,nextChunk,"/",chunkCount);
    return;
  }
  const allRows=await db("transcript_segments",{params:{transcript_id:"eq."+transcript.id,select:"start_ms,end_ms,text",order:"start_ms.asc"}});
  const segments=(allRows||[]).map(s=>({start:Number(s.start_ms)/1000,end:Number(s.end_ms)/1000,text:s.text||""}));
  await patchJob(p.jobId,{progress:62,payload:{...p,transcriptId:transcript.id,transcribeChunk:chunkCount}});
  const maxStart=Math.max(0,duration-45),count=Math.min(12,Math.max(1,Math.floor(maxStart/30)+1));
  const existingClips=await db("clips",{params:{project_id:"eq."+p.projectId,media_asset_id:"eq."+asset.id,select:"id,start_seconds,end_seconds,status"}});
  const existingByStart=new Map((existingClips||[]).map(x=>[Number(x.start_seconds).toFixed(3),x]));
  for(let i=0;i<count;i++){
    const start=Math.min(maxStart,i*30),end=Math.min(duration,start+45),key=start.toFixed(3);
    let clip=existingByStart.get(key);
    const words=segments.filter(s=>s.end>start&&s.start<end).reduce((n,s)=>n+s.text.split(/\\s+/).filter(Boolean).length,0);
    const score=Math.min(99,Math.round(55+Math.min(40,words/2)));
    if(!clip){
      clip=(await db("clips",{method:"POST",body:{project_id:p.projectId,media_asset_id:asset.id,title:"AI moment "+Math.round(start)+"s",start_seconds:start,end_seconds:end,score,status:"processing"}}))[0];
      existingByStart.set(key,clip);
    }else{
      await db("clips",{method:"PATCH",params:{id:"eq."+clip.id},body:{status:"processing",score,end_seconds:end}});
    }
    const versions=await db("clip_versions",{params:{clip_id:"eq."+clip.id,version:"eq.1",select:"id,storage_path,render_status",limit:"1"}});
    const existingVersion=versions?.[0];
    if(!existingVersion?.storage_path){
      const clipDir=path.join(dir,"clips");fs.mkdirSync(clipDir,{recursive:true});
      const rendered=path.join(clipDir,clip.id+".mp4");
      await renderClip(input,rendered,start,end);
      const storagePath=p.workspaceId+"/"+p.projectId+"/clips/"+clip.id+"/v1.mp4";await upload(rendered,storagePath,"video/mp4");
      if(existingVersion?.id){
        await db("clip_versions",{method:"PATCH",params:{id:"eq."+existingVersion.id},body:{storage_path:storagePath,render_status:"ready",edit_data:{source_start:start,source_end:end,duration_seconds:end-start}}});
      }else{
        await db("clip_versions",{method:"POST",body:{clip_id:clip.id,version:1,render_status:"ready",storage_path:storagePath,edit_data:{source_start:start,source_end:end,duration_seconds:end-start}}});
      }
    }
    const scores=await db("clip_scores",{params:{clip_id:"eq."+clip.id,select:"id",limit:"1"}});
    if(!scores?.[0])await db("clip_scores",{method:"POST",body:{clip_id:clip.id,score,hook_score:score,emotion_score:Math.max(0,score-3),clarity_score:Math.min(99,score+1),shareability_score:Math.max(0,score-1),reason:"Speech density and continuous context"}});
    await db("clips",{method:"PATCH",params:{id:"eq."+clip.id},body:{status:"ready",score}});
    await patchJob(p.jobId,{progress:Math.min(98,62+Math.round(((i+1)/count)*36)),payload:{...p,transcriptId:transcript.id,transcribeChunk:chunkCount}});
  }
  await patchJob(p.jobId,{status:"completed",progress:100});await db("projects",{method:"PATCH",params:{id:"eq."+p.projectId},body:{status:"ready"}});if(p.sourceId)await db("project_sources",{method:"PATCH",params:{id:"eq."+p.sourceId},body:{status:"processed"}}).catch(()=>{});console.log("completed",p.jobId)
}catch(e){console.error("job",p.jobId,e);await patchJob(p.jobId,{status:"failed",progress:0,error:e.message}).catch(()=>{});await db("projects",{method:"PATCH",params:{id:"eq."+p.projectId},body:{status:"processing_failed"}}).catch(()=>{});if(p.sourceId)await db("project_sources",{method:"PATCH",params:{id:"eq."+p.sourceId},body:{status:"failed"}}).catch(()=>{})}finally{fs.rmSync(dir,{recursive:true,force:true})}}
app.get("/health",(_q,res)=>res.json({ok:true,service:"alpha-ai-media-worker",version:"1.0"}));
async function authorize(req){
  if(SECRET&&req.get("x-worker-secret")===SECRET)return {id:req.body?.requestedBy||null,mode:"worker-secret",jobId:req.body?.jobId,workspaceId:req.body?.workspaceId,projectId:req.body?.projectId};
  const ticket=req.get("x-import-ticket")||"";
  if(ticket&&SUPA&&PUBLIC_KEY){
    try{
      const r=await fetch(SUPA+"/rest/v1/rpc/validate_processing_ticket",{method:"POST",headers:{apikey:PUBLIC_KEY,Authorization:"Bearer "+PUBLIC_KEY,"Content-Type":"application/json"},body:JSON.stringify({p_ticket:ticket})});
      const rows=await r.json().catch(()=>[]);
      const row=Array.isArray(rows)?rows[0]:null;
      if(r.ok&&row?.user_id){
        if(String(row.job_id)!==String(req.body?.jobId)||String(row.workspace_id)!==String(req.body?.workspaceId)||String(row.project_id)!==String(req.body?.projectId))return null;
        return {id:row.user_id,mode:"processing-ticket",jobId:row.job_id,workspaceId:row.workspace_id,projectId:row.project_id};
      }
    }catch(e){console.warn("processing ticket validation failed:",e.message)}
  }
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
    let job;
    if(identity.mode==="processing-ticket"||identity.mode==="worker-secret"){
      const jobId=identity.jobId||req.body?.jobId,workspaceId=identity.workspaceId||req.body?.workspaceId,projectId=identity.projectId||req.body?.projectId;
      job=jobId&&workspaceId&&projectId?[{id:jobId,workspace_id:workspaceId,project_id:projectId}]:[];
    }else{
      const bearer=(req.get("authorization")||"").replace(/^Bearer\s+/i,"");
      job=await authStore.run(bearer,()=>db("processing_jobs",{params:{id:"eq."+req.body?.jobId,select:"id,workspace_id,project_id"}}));
    }
    if(!job?.[0]?.id)return res.status(404).json({error:"Processing job not found."});
    if(identity.mode==="supabase-jwt"){
      const bearer=(req.get("authorization")||"").replace(/^Bearer\s+/i,"");
      const member=await authStore.run(bearer,()=>db("workspace_members",{params:{workspace_id:"eq."+job[0].workspace_id,user_id:"eq."+identity.id,select:"workspace_id,user_id",limit:"1"}}));
      if(!member?.[0])return res.status(403).json({error:"Workspace access denied."});
    }
    res.status(202).json({accepted:true,jobId:req.body?.jobId});
    const bearer=(req.get("authorization")||"").replace(/^Bearer\s+/i,"");
    authStore.run(bearer,()=>processJob({...req.body,requestedBy:identity.id||req.body?.requestedBy})).catch(e=>console.error(e));
  }catch(e){console.error("authorize/process",e);res.status(500).json({error:e.message||"Worker authorization failed."})}
});
const activeJobs=new Set();
async function resumeQueuedJobs(){
  console.log("job recovery scan started");
  if(!KEY){console.error("Supabase server-side key is not configured; queued jobs cannot be resumed safely.");return}
  if(activeJobs.size)return;
  try{
    const [queued,stale]=await Promise.all([
      db("processing_jobs",{params:{status:"eq.queued",select:"id,status,workspace_id,project_id,payload,created_at,updated_at",order:"created_at.asc",limit:"25"}}),
      db("processing_jobs",{params:{status:"eq.processing",select:"id,workspace_id,project_id,payload,created_at,updated_at",order:"updated_at.asc",limit:"25"}})
    ]);
    const cutoff=Date.now()-600000;
    const rows=[...(queued||[]),...(stale||[])].filter(row=>row?.status==="queued"||new Date(row?.updated_at||row?.created_at||0).getTime()<cutoff);
    console.log("job recovery scan found",JSON.stringify({queued:queued?.length||0,processing:stale?.length||0,candidates:rows.length}));
    const row=[...rows].sort((a,b)=>Number(!!b?.payload?.media_asset_id)-Number(!!a?.payload?.media_asset_id)||String(a.created_at).localeCompare(String(b.created_at)))[0];
    const payload=row?.payload||{};
    if(!row)return;
    console.log("job recovery selected",row.id,row.status,row.progress);
    const normalized={
      ...payload,
      jobId:row.id,
      workspaceId:row.workspace_id,
      projectId:row.project_id,
      sourceId:payload.sourceId||payload.source_id,
      sourceType:payload.sourceType||payload.source_type,
      mediaAssetId:payload.mediaAssetId||payload.media_asset_id,
      driveFileId:payload.driveFileId||payload.drive_file_id,
      driveAccessToken:payload.driveAccessToken||payload.drive_access_token
    };
    const claimed=await db("processing_jobs",{method:"PATCH",params:{id:"eq."+row.id,select:"id"},body:{status:"processing",progress:Math.max(1,Number(row.progress||1)),error:null}});
    console.log("job recovery claim result",JSON.stringify(claimed));
    if(!claimed?.[0]?.id)return;
    activeJobs.add(row.id);
    console.log("resuming queued/stale job",row.id);
    processJob(normalized).catch(e=>console.error("queued job",row.id,e)).finally(()=>activeJobs.delete(row.id));
  }catch(e){console.warn("queued-job recovery failed:",e.message)}
}
console.log("Supabase server-side key configured:",!!KEY);
setTimeout(resumeQueuedJobs,5000);
setInterval(resumeQueuedJobs,15000);
app.listen(PORT,()=>console.log("Alpha.ai media worker listening on "+PORT));