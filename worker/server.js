import{AsyncLocalStorage}from"node:async_hooks";
import express from"express";
import fs from"node:fs";
import path from"node:path";
import os from"node:os";
import {spawn} from"node:child_process";
import {randomUUID} from"node:crypto";
import{GoogleGenAI,createUserContent,createPartFromUri}from"@google/genai";
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
async function renderEditedClip(input,out,start,end,opts={}){
  const requested=Math.max(0.25,Number(end)-Number(start));
  const speed=Math.max(.5,Math.min(2,Number(opts.speed)||1));
  const zoom=Math.max(.8,Math.min(1.4,Number(opts.zoom)||1));
  const aspect=["9:16","16:9","1:1"].includes(opts.aspect)?opts.aspect:"9:16";
  const size=aspect==="16:9"?[1920,1080]:aspect==="1:1"?[1080,1080]:[1080,1920];
  const sw=Math.round(size[0]*zoom),sh=Math.round(size[1]*zoom);
  const captionFilter=opts.srtPath?`,subtitles=${String(opts.srtPath).replaceAll("\\","/").replaceAll(":","\\:").replaceAll("'","\\'")}:force_style='FontName=Arial,FontSize=20,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=2,Shadow=0,Alignment=2,MarginV=70'`:"";
  const effect=opts.effect==="cinematic"?",eq=contrast=1.08:saturation=1.12:brightness=0.01":opts.effect==="warm"?",eq=contrast=1.04:saturation=1.08:brightness=.02,hue=h=4":opts.effect==="cool"?",eq=contrast=1.02:saturation=.95:brightness=0,hue=h=-8":opts.effect==="mono"?",hue=s=0,eq=contrast=1.05":opts.effect==="vibrant"?",eq=contrast=1.06:saturation=1.28:brightness=.01":"";const transition=opts.transition==="fade"?",fade=t=in:st=0:d=.18,fade=t=out:st="+Math.max(0,requested/speed-.18).toFixed(3)+":d=.18":opts.transition==="dip"?",fade=t=in:st=0:d=.10,fade=t=out:st="+Math.max(0,requested/speed-.10).toFixed(3)+":d=.10":"";const transitionZoom=opts.transition==="zoom"?",eq=contrast=1.03:saturation=1.05":"";
  const vf=`scale=${sw}:${sh}:force_original_aspect_ratio=increase,crop=${sw}:${sh},scale=${size[0]}:${size[1]},setpts=PTS/${speed}${effect}${transition}${transitionZoom}${captionFilter}`;
  const af=speed===1?["-c:a","aac","-b:a","128k"]:["-af","atempo="+speed,"-c:a","aac","-b:a","128k"];
  await cmd("ffmpeg",["-y","-ss",String(Math.max(0,Number(start))),"-i",input,"-t",String(requested),"-map","0:v:0?","-map","0:a:0?","-vf",vf,"-c:v","libx264","-preset","ultrafast","-crf","28",...af,"-movflags","+faststart",out]);
  const probe=JSON.parse(await cmd("ffprobe",["-v","quiet","-print_format","json","-show_format","-show_streams",out]));
  const actual=Number(probe.format?.duration||0);
  if(!actual||actual>requested/Math.max(.5,speed)+.75)throw new Error("Rendered edit duration exceeded requested range.");
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
async function applyEditInstructionWithGemini(filePath,sourceDuration,selectedStart,selectedEnd,instruction){
  if(!GEMINI_API_KEY||!instruction?.trim())return null;
  const ai=new GoogleGenAI({apiKey:GEMINI_API_KEY});
  let file=await ai.files.upload({file:filePath,config:{mimeType:"video/mp4"}});
  for(let i=0;i<60&&file?.state==="PROCESSING";i++){await new Promise(r=>setTimeout(r,5000));file=await ai.files.get({name:file.name})}
  if(file?.state!=="ACTIVE")throw new Error("Gemini edit analysis failed: "+String(file?.state||"unknown"));
  const lo=Math.max(0,Math.min(sourceDuration,Number(selectedStart)||0));
  const hi=Math.max(lo,Math.min(sourceDuration,Number(selectedEnd)||sourceDuration));
  const schema={type:"object",properties:{start_seconds:{type:"number"},end_seconds:{type:"number"},title:{type:"string"},reason:{type:"string"},action:{type:"string"}},required:["start_seconds","end_seconds","title","reason","action"]};
  const prompt="You are Alpha.ai's AI editor. User instruction: "+JSON.stringify(String(instruction).slice(0,2000))+". Source duration is exactly "+sourceDuration.toFixed(3)+" seconds. Current selection is "+lo.toFixed(3)+" to "+hi.toFixed(3)+" seconds. Return ONE precise edit range that best fulfills the instruction. HARD RULES: start_seconds >= "+lo.toFixed(3)+", end_seconds <= "+hi.toFixed(3)+", start < end, minimum 0.25 seconds. Never invent timestamps or content. If the instruction asks for a strongest moment, answer, hook, quote, punchline, story beat, or useful section, choose the smallest complete context inside the selection. If it cannot be satisfied, keep the current selection.";
  const result=await ai.models.generateContent({model:GEMINI_MODEL,contents:createUserContent([createPartFromUri(file.uri,file.mimeType),prompt]),config:{responseMimeType:"application/json",responseSchema:schema}});
  let parsed;try{parsed=JSON.parse(result.text||"{}")}catch{throw new Error("Gemini returned invalid edit JSON.")};
  const start=Math.max(lo,Math.min(hi,Number(parsed.start_seconds)||lo));
  const end=Math.max(start,Math.min(hi,Number(parsed.end_seconds)||hi));
  return {start_seconds:start,end_seconds:end,title:String(parsed.title||"AI edited clip").slice(0,180),reason:String(parsed.reason||"").slice(0,500),action:String(parsed.action||"").slice(0,300)};
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
  const stream=probe.streams.find(x=>x.codec_type==="video"),formatDuration=Number(probe.format?.duration||0),streamDuration=Number(stream?.duration||0),duration=Math.max(0,Math.min(...[formatDuration,streamDuration].filter(x=>Number.isFinite(x)&&x>0))),width=Number(stream?.width||0),height=Number(stream?.height||0),fps=Number((stream?.r_frame_rate||"0/1").split("/")[0])/(Number((stream?.r_frame_rate||"0/1").split("/")[1])||1);
  if(!asset){const fileName=(probe.format?.tags?.title||"Imported video").replace(/[^a-zA-Z0-9._ -]/g,"-")+".mp4",storagePath=p.workspaceId+"/"+p.projectId+"/source-"+randomUUID()+".mp4",size=await upload(input,storagePath);asset=(await db("media_assets",{method:"POST",body:{workspace_id:p.workspaceId,project_id:p.projectId,owner_id:p.requestedBy,name:fileName,storage_path:storagePath,mime_type:"video/mp4",size_bytes:size,duration_seconds:duration,status:"uploaded"}}))[0];await db("videos",{method:"POST",body:{project_id:p.projectId,media_asset_id:asset.id,title:fileName.replace(/\.mp4$/,""),duration_seconds:duration,width,height,fps,status:"ready"}})}else{await db("media_assets",{method:"PATCH",params:{id:"eq."+asset.id},body:{duration_seconds:duration,status:"uploaded"}});await db("videos",{method:"PATCH",params:{media_asset_id:"eq."+asset.id},body:{duration_seconds:duration,width,height,fps,status:"ready"}}).catch(()=>{})}
  if(p.sourceId)await db("project_sources",{method:"PATCH",params:{id:"eq."+p.sourceId},body:{status:"downloaded",file_name:asset.name}}).catch(()=>{});
  if(p.operation==="render_edit"){
    let start=Math.max(0,Math.min(duration,Number(p.startSeconds)||0));
    let end=Math.max(start,Math.min(duration,Number(p.endSeconds)||duration));
    let aiEdit=null;
    if(p.aiPrompt?.trim()&&GEMINI_API_KEY){
      await patchJob(p.jobId,{progress:25,payload:{...p,aiEditStatus:"analyzing"}});
      try{
        aiEdit=await applyEditInstructionWithGemini(input,duration,start,end,p.aiPrompt);
        if(aiEdit){start=aiEdit.start_seconds;end=aiEdit.end_seconds;await patchJob(p.jobId,{payload:{...p,aiEditStatus:"applied",aiEditAction:aiEdit.action,aiEditReason:aiEdit.reason}});console.log("Gemini editor instruction applied",p.jobId,aiEdit.action)}
      }catch(e){aiEdit={action:"fallback_original_selection",reason:e.message};await patchJob(p.jobId,{payload:{...p,aiEditStatus:"fallback",aiEditError:e.message}});console.warn("Gemini editor instruction failed; keeping selection:",e.message)}
    }
    if(end-start<0.25)throw new Error("Selected edit range is too short.");
    const clips=await db("clips",{method:"POST",body:{project_id:p.projectId,media_asset_id:asset.id,title:String(p.title||"Edited clip").slice(0,180),start_seconds:start,end_seconds:end,score:0,status:"processing"}});
    const clip=clips?.[0];if(!clip)throw new Error("Could not create edited clip.");
    const dir2=path.join(dir,"edited");fs.mkdirSync(dir2,{recursive:true});const rendered=path.join(dir2,clip.id+".mp4");
    let srtPath=null;
    if(p.captions!==false){
      const tr=(await db("transcripts",{params:{media_asset_id:"eq."+asset.id,select:"id",order:"created_at.desc",limit:"1"}}))[0];
      if(tr?.id){const rows=await db("transcript_segments",{params:{transcript_id:"eq."+tr.id,start_ms:"lt."+Math.round(end*1000),end_ms:"gt."+Math.round(start*1000),select:"start_ms,end_ms,text",order:"start_ms.asc"}}).catch(()=>[]);const usable=(rows||[]).filter(x=>Number(x.end_ms)>Number(x.start_ms));
        if(usable.length){srtPath=path.join(dir2,"captions.srt");const stamp=n=>{const ms=Math.max(0,Math.round(n*1000)),h=Math.floor(ms/3600000),m=Math.floor(ms%3600000/60000),s=Math.floor(ms%60000/1000),z=ms%1000;return String(h).padStart(2,"0")+":"+String(m).padStart(2,"0")+":"+String(s).padStart(2,"0")+","+String(z).padStart(3,"0")};fs.writeFileSync(srtPath,usable.map((x,i)=>(i+1)+"\\n"+stamp(Number(x.start_ms)/1000-start)+" --> "+stamp(Number(x.end_ms)/1000-start)+"\\n"+String(x.text||"").replace(/\\r?\\n/g," ")+"\\n").join("\\n"),"utf8")}
      }
    }
    await renderEditedClip(input,rendered,start,end,{aspect:p.aspect,speed:p.speed,zoom:p.zoom,effect:p.effect,transition:p.transition,srtPath});
    const storagePath=p.workspaceId+"/"+p.projectId+"/clips/"+clip.id+"/v1.mp4";
    await upload(rendered,storagePath,"video/mp4");
    await db("clip_versions",{method:"POST",body:{clip_id:clip.id,version:1,render_status:"ready",storage_path:storagePath,edit_data:{source_start:start,source_end:end,duration_seconds:(end-start)/Math.max(.5,Math.min(2,Number(p.speed)||1)),editor:true,aspect:p.aspect||"9:16",speed:Number(p.speed)||1,zoom:Number(p.zoom)||1,effect:p.effect||"none",transition:p.transition||"cut",captions:p.captions!==false,ai_prompt:p.aiPrompt||"",ai_action:aiEdit?.action||"",ai_reason:aiEdit?.reason||""}}});
    await db("clips",{method:"PATCH",params:{id:"eq."+clip.id},body:{status:"ready",score:0,start_seconds:start,end_seconds:end,title:String(p.title||"Edited clip").slice(0,180)}});
    await patchJob(p.jobId,{status:"completed",progress:100,payload:{...p,clipId:clip.id}});
    console.log("editor render completed",p.jobId,clip.id);
    return;
  }
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
  const safeDuration=Math.max(0,Number(duration)||0);
  if(!safeDuration)throw new Error("Source video duration could not be determined.");
  let candidates=null;
  if(GEMINI_API_KEY){
    await patchJob(p.jobId,{progress:64,payload:{...p,transcriptId:transcript.id,transcribeChunk:chunkCount,clipEngine:"gemini"}});
    try{candidates=await analyzeVideoWithGemini(input,safeDuration);console.log("Gemini clip candidates",p.jobId,candidates?.length||0)}
    catch(e){console.warn("Gemini clip analysis failed; using deterministic fallback:",e.message)}
  }
  if(!candidates?.length){
    const count=safeDuration<=45?1:Math.min(12,Math.floor((safeDuration-1)/30)+1);
    candidates=Array.from({length:count},(_,i)=>{
      const start=Math.min(Math.max(0,safeDuration-45),i*30);
      const end=Math.min(safeDuration,start+Math.min(45,safeDuration));
      const words=segments.filter(s=>s.end>start&&s.start<end).reduce((n,s)=>n+s.text.split(/\s+/).filter(Boolean).length,0);
      const score=Math.min(99,Math.round(55+Math.min(40,words/2)));
      return {start_seconds:start,end_seconds:end,title:"AI moment "+Math.round(start)+"s",reason:"Speech density and continuous context",hook_score:score,emotional_intensity:Math.max(0,score-3),information_density:score,story_completeness:score,shareability_score:Math.max(0,score-1)};
    });
  }
  const existingClips=await db("clips",{params:{project_id:"eq."+p.projectId,media_asset_id:"eq."+asset.id,select:"id,start_seconds,end_seconds,status"}});
  const existingByStart=new Map((existingClips||[]).map(x=>[Number(x.start_seconds).toFixed(3),x]));
  for(let i=0;i<candidates.length;i++){
    const candidate=candidates[i];
    const start=Math.max(0,Math.min(safeDuration,Number(candidate.start_seconds)||0));
    const end=Math.max(start,Math.min(safeDuration,Number(candidate.end_seconds)||start));
    if(end<=start)continue;
    const key=start.toFixed(3);
    let clip=existingByStart.get(key);
    const aiScore=Math.round((Number(candidate.hook_score)||0)*0.3+(Number(candidate.information_density)||0)*0.25+(Number(candidate.story_completeness)||0)*0.2+(Number(candidate.shareability_score)||0)*0.25);
    const score=Math.max(1,Math.min(99,aiScore||55));
    const title=String(candidate.title||("AI moment "+Math.round(start)+"s")).slice(0,180);
    if(!clip){
      clip=(await db("clips",{method:"POST",body:{project_id:p.projectId,media_asset_id:asset.id,title,start_seconds:start,end_seconds:end,score,status:"processing"}}))[0];
      existingByStart.set(key,clip);
    }else{
      await db("clips",{method:"PATCH",params:{id:"eq."+clip.id},body:{status:"processing",score,start_seconds:start,end_seconds:end,title}});
    }
    const versions=await db("clip_versions",{params:{clip_id:"eq."+clip.id,version:"eq.1",select:"id,storage_path,render_status",limit:"1"}});
    const existingVersion=versions?.[0];
    if(!existingVersion?.storage_path){
      const clipDir=path.join(dir,"clips");fs.mkdirSync(clipDir,{recursive:true});
      const rendered=path.join(clipDir,clip.id+".mp4");
      await renderClip(input,rendered,start,end);
      const storagePath=p.workspaceId+"/"+p.projectId+"/clips/"+clip.id+"/v1.mp4";
      await upload(rendered,storagePath,"video/mp4");
      if(existingVersion?.id)await db("clip_versions",{method:"PATCH",params:{id:"eq."+existingVersion.id},body:{storage_path:storagePath,render_status:"ready",edit_data:{source_start:start,source_end:end,duration_seconds:end-start}}});
      else await db("clip_versions",{method:"POST",body:{clip_id:clip.id,version:1,render_status:"ready",storage_path:storagePath,edit_data:{source_start:start,source_end:end,duration_seconds:end-start}}});
    }
    const scores=await db("clip_scores",{params:{clip_id:"eq."+clip.id,select:"id",limit:"1"}});
    if(!scores?.[0])await db("clip_scores",{method:"POST",body:{clip_id:clip.id,score,hook_score:Number(candidate.hook_score)||score,emotion_score:Number(candidate.emotional_intensity)||Math.max(0,score-3),clarity_score:Number(candidate.story_completeness)||score,shareability_score:Number(candidate.shareability_score)||Math.max(0,score-1),reason:String(candidate.reason||"AI-selected moment").slice(0,500)}});
    await db("clips",{method:"PATCH",params:{id:"eq."+clip.id},body:{status:"ready",score,start_seconds:start,end_seconds:end,title}});
    await patchJob(p.jobId,{progress:Math.min(98,64+Math.round(((i+1)/Math.max(1,candidates.length))*34)),payload:{...p,transcriptId:transcript.id,transcribeChunk:chunkCount,clipEngine:GEMINI_API_KEY?"gemini":"deterministic"}});
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
app.post("/assistant",async(req,res)=>{
  try{
    if(!SECRET||req.get("x-worker-secret")!==SECRET)return res.status(401).json({error:"Unauthorized"});
    if(!GEMINI_API_KEY)return res.status(503).json({error:"AI provider is not configured on the media worker."});
    const prompt=String(req.body?.prompt||"").trim();
    if(!prompt)return res.status(400).json({error:"Prompt is required."});
    const context=String(req.body?.context||"").slice(0,12000);
    const ai=new GoogleGenAI({apiKey:GEMINI_API_KEY});
    const result=await ai.models.generateContent({model:GEMINI_MODEL,contents:"You are Alpha.ai Assistant. Help the user with content strategy, clips, hooks, titles, transcripts, editing plans, publishing copy and workspace organization. Be practical and concise. Never claim to have performed an action you did not perform.\nWorkspace context:\n"+context+"\nUser request:\n"+prompt});
    return res.json({ok:true,text:String(result.text||"").trim()});
  }catch(e){console.error("assistant",e);return res.status(500).json({error:e.message||"Assistant failed."})}
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
    const normalized={...payload,jobId:row.id,workspaceId:row.workspace_id,projectId:row.project_id,sourceId:payload.sourceId||payload.source_id,sourceType:payload.sourceType||payload.source_type,mediaAssetId:payload.mediaAssetId||payload.media_asset_id,driveFileId:payload.driveFileId||payload.drive_file_id,driveAccessToken:payload.driveAccessToken||payload.drive_access_token};
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