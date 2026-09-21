import{AsyncLocalStorage}from"node:async_hooks";
import express from"express";
import fs from"node:fs";
import path from"node:path";
import os from"node:os";
import {spawn} from"node:child_process";
import {randomUUID} from"node:crypto";
const app=express();app.use(express.json({limit:"2mb"}));
const PORT=Number(process.env.PORT||8080),SUPA=process.env.SUPABASE_URL,GEMINI_API_KEY=process.env.GEMINI_API_KEY||"",GEMINI_MODEL=process.env.GEMINI_MODEL||"gemini-3.8-flash",KEY=process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY,PUBLIC_KEY=process.env.SUPABASE_PUBLISHABLE_KEY||process.env.SUPABASE_ANON_KEY||"",SECRET=process.env.MEDIA_WORKER_SECRET||"";
const authStore=new AsyncLocalStorage();
const baseAuth={apikey:KEY||PUBLIC_KEY,Authorization:"Bearer "+(KEY||PUBLIC_KEY),"Content-Type":"application/json"};
async function db(table,{method="GET",params={},body}={}){const u=new URL(SUPA+"/rest/v1/"+table);Object.entries(params).forEach(([k,v])=>u.searchParams.set(k,v));const scoped=authStore.getStore();const headers=scoped?{apikey:PUBLIC_KEY,Authorization:"Bearer "+scoped,"Content-Type":"application/json"}:baseAuth;const r=await fetch(u,{method,headers:{...headers,Prefer:"return=representation"},body:body?JSON.stringify(body):undefined});const t=await r.text();let d;try{d=JSON.parse(t)}catch{d=t}if(!r.ok)throw new Error(table+" "+r.status+": "+t);return d}
function cmd(command,args){return new Promise((resolve,reject)=>{const p=spawn(command,args,{stdio:["ignore","pipe","pipe"]});let out="",err="";p.stdout.on("data",d=>out+=d);p.stderr.on("data",d=>err+=d);p.on("close",c=>c?reject(new Error(err.slice(-7000)||command+" failed")):resolve(out))})}
async function renderClip(input,out,start,end){
  const requested=Math.max(0.25,Number(end)-Number(start));
  await cmd("ffmpeg",["-y","-ss",String(Math.max(0,Number(start))),"-i",input,"-t",String(requested),"-map","0:v:0?","-map","0:a:0?","-c:v","libx264","-preset","ultrafast","-crf","28","-c:a","aac","-b:a","128k","-movflags","+faststart",out]);
  const probe=JSON.parse(await cmd("ffprobe",["-v","quiet","-print_format","json","-show_format",out]));
  const actual=Number(probe.format?.duration||0);
  if(!actual||actual>requested+0.5)throw new Error("Rendered clip duration exceeded requested range.");
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
async function analyzeVideoWithGemini(filePath,sourceDuration){
  if(!GEMINI_API_KEY)return null;
  const ai=new GoogleGenAI({apiKey:GEMINI_API_KEY});
  let file=await ai.files.upload({file:filePath,config:{mimeType:"video/mp4"}});
  for(let i=0;i<60&&file?.state==="PROCESSING";i++){await new Promise(r=>setTimeout(r,5000));file=await ai.files.get({name:file.name})}
  if(file?.state!=="ACTIVE")throw new Error("Gemini video analysis failed: "+String(file?.state||"unknown"));
  const maxClip=Math.min(45,sourceDuration);
  const schema={type:"object",properties:{candidates:{type:"array",items:{type:"object",properties:{
    start_seconds:{type:"number"},end_seconds:{type:"number"},title:{type:"string"},reason:{type:"string"},
    hook_score:{type:"number"},emotional_intensity:{type:"number"},information_density:{type:"number"},
    story_completeness:{type:"number"},shareability_score:{type:"number"}
  },required:["start_seconds","end_seconds","title","reason","hook_score","emotional_intensity","information_density","story_completeness","shareability_score"]},maxItems:8}},required:["candidates"]};
  const prompt="You are Alpha.ai's clip-selection engine. Source duration is EXACTLY "+sourceDuration.toFixed(3)+" seconds. HARD RULES: 0 <= start_seconds < end_seconds <= "+sourceDuration.toFixed(3)+"; no clip may exceed "+maxClip.toFixed(3)+" seconds; never invent timestamps outside the source. Find the strongest complete short-form moments: hooks, surprising statements, useful insights, emotional peaks, punchlines, stories, Q&A, controversial claims, or CTAs. Prefer clean sentence boundaries and enough context. For a source shorter than the preferred clip length, use only the real source duration. Return up to 8 candidates ranked best-first. Scores 0-100. Do not create filler clips.";
  const result=await ai.models.generateContent({model:GEMINI_MODEL,contents:createUserContent([createPartFromUri(file.uri,file.mimeType),prompt]),config:{responseMimeType:"application/json",responseSchema:schema}});
  let parsed;try{parsed=JSON.parse(result.text||"{}")}catch{throw new Error("Gemini returned invalid clip JSON.")};
  return (Array.isArray(parsed.candidates)?parsed.candidates:[]).map(x=>{
    const start=Math.max(0,Math.min(sourceDuration,Number(x.start_seconds)||0));
    const end=Math.max(start,Math.min(sourceDuration,Number(x.end_seconds)||start));
    return {...x,start_seconds:start,end_seconds:end};
  }).filter(x=>x.end_seconds-x.start_seconds>=Math.min(2,sourceDuration)).sort((a,b)=>
    ((Number(b.hook_score)||0)+(Number(b.information_density)||0)+(Number(b.story_completeness)||0)+(Number(b.shareability_score)||0))-
    ((Number(a.hook_score)||0)+(Number(a.information_density)||0)+(Number(a.story_completeness)||0)+(Number(a.shareability_score)||0))
  ).slice(0,8);
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