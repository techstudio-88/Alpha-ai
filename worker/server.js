import{AsyncLocalStorage}from"node:async_hooks";
import express from"express";
import fs from"node:fs";
import path from"node:path";
import os from"node:os";
import {spawn} from"node:child_process";
import {randomUUID} from"node:crypto";
import {pathToFileURL} from "node:url";
import {pipeline} from "node:stream/promises";
import{GoogleGenAI,createUserContent,createPartFromUri}from"@google/genai";
import {runChatPlan,generateChatPlan} from "./chat.js";
import {publicDownload,MAX_DOWNLOAD_BYTES,byteLimit} from "./download.js";
import {allPages,captionEvents,sourceUrl,retainedRanges,youtubeVideoUrl} from "../lib/video-workflow.mjs";
import {decryptCredential} from '../lib/credential-cipher.mjs';
import {runPublishQueue} from './publish.js';
const app=express();app.use(express.json({limit:"2mb"}));
const PORT=Number(process.env.PORT||8080),SUPA=process.env.SUPABASE_URL,GEMINI_API_KEY=process.env.GEMINI_API_KEY||"",GEMINI_MODEL=process.env.GEMINI_MODEL||"gemini-2.5-flash",KEY=process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY,PUBLIC_KEY=process.env.SUPABASE_PUBLISHABLE_KEY||process.env.SUPABASE_ANON_KEY||"",SECRET=process.env.MEDIA_WORKER_SECRET||"";
const authStore=new AsyncLocalStorage();
const jobDirs=new Map();
const baseAuth={apikey:KEY||PUBLIC_KEY,Authorization:"Bearer "+(KEY||PUBLIC_KEY),"Content-Type":"application/json"};
async function db(table,{method="GET",params={},body}={}){const u=new URL(SUPA+"/rest/v1/"+table);Object.entries(params).forEach(([k,v])=>{if(Array.isArray(v))v.forEach(item=>u.searchParams.append(k,item));else u.searchParams.set(k,v)});const scoped=authStore.getStore();const headers=scoped?{apikey:PUBLIC_KEY,Authorization:"Bearer "+scoped,"Content-Type":"application/json"}:baseAuth;const r=await fetch(u,{method,headers:{...headers,Prefer:"return=representation"},body:body?JSON.stringify(body):undefined});const t=await r.text();let d;try{d=JSON.parse(t)}catch{d=t}if(!r.ok)throw new Error(table+" "+r.status+": "+t);return d}
function cmd(command,args){return new Promise((resolve,reject)=>{
  let settled=false;
  const executable=command==="ffmpeg"?process.env.FFMPEG_PATH||command:command==="ffprobe"?process.env.FFPROBE_PATH||command:command;
  const p=spawn(executable,args,{stdio:["ignore","pipe","pipe"]});
  const dir=args.map(String).find(v=>v.startsWith(path.join(os.tmpdir(),"alpha-")))?.match(/^(.+?\/alpha-[^/]+)/)?.[1];
  const size=d=>fs.readdirSync(d,{withFileTypes:true}).reduce((sum,e)=>sum+(e.isDirectory()?size(path.join(d,e.name)):fs.statSync(path.join(d,e.name)).size),0);
  const watchdog=setInterval(()=>{try{if(dir&&size(dir)>(Number(process.env.MAX_JOB_DISK_MB)||2048)*1024*1024){p.kill("SIGKILL");finish(reject,new Error("Job exceeded the configured temporary disk budget."))}}catch{}},1000);
  let checking=false;
  const cancelCheck=setInterval(async()=>{if(checking||!jobDirs.has(dir))return;checking=true;try{const rows=await db("processing_jobs",{params:{id:"eq."+jobDirs.get(dir),select:"status"}});if(rows[0]?.status==="cancelled"){p.kill("SIGKILL");finish(reject,new Error("Job cancelled."))}}catch{}finally{checking=false}},5000);
  const deadline=setTimeout(()=>{p.kill("SIGKILL");finish(reject,new Error(command+" exceeded the 30 minute operation limit."))},30*60*1000);
  const finish=(fn,value)=>{if(settled)return;settled=true;clearInterval(watchdog);clearInterval(cancelCheck);clearTimeout(deadline);fn(value)};
  let out="",err="";p.stdout.on("data",d=>out=(out+d).slice(-8*1024*1024));p.stderr.on("data",d=>err=(err+d).slice(-16000));
  p.on("error",()=>finish(reject,new Error(command+" is unavailable.")));
  p.on("close",code=>code?finish(reject,new Error(err.slice(-7000)||command+" failed with exit code "+code)):finish(resolve,out));
})}
const geminiUploads=new Map();
async function cachedGeminiUpload(ai,filePath,mimeType="video/mp4"){
  if(!geminiUploads.has(filePath))geminiUploads.set(filePath,{ai,promise:ai.files.upload({file:filePath,config:{mimeType}})});
  return geminiUploads.get(filePath).promise;
}
async function cleanupGeminiFiles(dir){
  for(const [filePath,entry] of geminiUploads){if(filePath.startsWith(dir+path.sep)){
    geminiUploads.delete(filePath);
    try{const file=await entry.promise;await entry.ai.files.delete({name:file.name})}catch{console.warn("Temporary AI file cleanup needs retry.")}
  }}
}
async function createProxy(input,out){await cmd("ffmpeg",["-y","-i",input,"-vf","scale=854:480:force_original_aspect_ratio=decrease,pad=854:480:(ow-iw)/2:(oh-ih)/2","-c:v","libx264","-preset","ultrafast","-crf","30","-c:a","aac","-b:a","96k","-movflags","+faststart",out]);return out}
async function normalizeIfVfr(input,probe,dir){
  const stream=probe?.streams?.find(x=>x.codec_type==="video"); if(!stream)return input;
  const parseRate=v=>{const [a,b]=String(v||"0/1").split("/").map(Number);return b? a/b:0};
  const r=parseRate(stream.r_frame_rate),avg=parseRate(stream.avg_frame_rate);
  const isVfr=Boolean(stream.codec_time_base&&r&&avg&&Math.abs(r-avg)>0.01)||String(stream.pix_fmt||"").length===0;
  if(!isVfr)return input;
  const target=Math.max(24,Math.min(60,Math.round(avg||r||30)));
  const out=path.join(dir,"normalized.mp4");
  await cmd("ffmpeg",["-y","-i",input,"-vf","fps="+target,"-fps_mode","cfr","-c:v","libx264","-preset","ultrafast","-crf","24","-c:a","aac","-b:a","128k","-movflags","+faststart",out]);
  return out;
}
async function renderClip(input,out,start,end){
  const requested=Math.max(0.25,Number(end)-Number(start));
  await cmd("ffmpeg",["-y","-ss",String(Math.max(0,Number(start))),"-i",input,"-t",String(requested),"-map","0:v:0?","-map","0:a:0?","-c:v","libx264","-preset","ultrafast","-crf","28","-c:a","aac","-b:a","128k","-movflags","+faststart",out]);
  const probe=JSON.parse(await cmd("ffprobe",["-v","quiet","-print_format","json","-show_format",out]));
  const actual=Number(probe.format?.duration||0);
  if(!actual||actual>requested+0.5)throw new Error("Rendered clip duration exceeded requested range.");
}
export async function renderEditedClip(input,out,start,end,opts={}){
  const requested=Math.max(0.25,Number(end)-Number(start));
  const ranges=retainedRanges(Number(start),Number(end),opts.cutRanges||[]);
  const keptDuration=ranges.reduce((sum,r)=>sum+r.end-r.start,0);
  const speed=Math.max(.5,Math.min(2,Number(opts.speed)||1));
  const zoom=Math.max(.8,Math.min(1.4,Number(opts.zoom)||1));
  const aspect=["9:16","16:9","1:1"].includes(opts.aspect)?opts.aspect:"9:16";
  const size=aspect==="16:9"?[1920,1080]:aspect==="1:1"?[1080,1080]:[1080,1920];
  const sw=Math.round(size[0]*Math.max(1,zoom)/2)*2,sh=Math.round(size[1]*Math.max(1,zoom)/2)*2;
  const captionSource=opts.assPath||opts.srtPath; const captionFilter=captionSource?`,subtitles='${String(captionSource).replaceAll("\\","/").replaceAll(":","\\:").replaceAll("'","\\'")}'`:"";
  const effect=opts.effect==="cinematic"?",eq=contrast=1.08:saturation=1.12:brightness=0.01":opts.effect==="warm"?",eq=contrast=1.04:saturation=1.08:brightness=.02,hue=h=4":opts.effect==="cool"?",eq=contrast=1.02:saturation=.95:brightness=0,hue=h=-8":opts.effect==="mono"?",hue=s=0,eq=contrast=1.05":opts.effect==="vibrant"?",eq=contrast=1.06:saturation=1.28:brightness=.01":"";const transition=opts.transition==="fade"?",fade=t=in:st=0:d=0.18,fade=t=out:st="+Math.max(0,requested/speed-.18).toFixed(3)+":d=0.18":opts.transition==="dip"?",fade=t=in:st=0:d=0.10,fade=t=out:st="+Math.max(0,requested/speed-.10).toFixed(3)+":d=0.10":"";const transitionZoom=opts.transition==="zoom"?",eq=contrast=1.03:saturation=1.05":"";
  const dynamicReframe=Array.isArray(opts.reframeKeyframes)&&opts.reframeKeyframes.length&&aspect!=="16:9"; const cropX=dynamicReframe?"("+reframeExpr(opts.reframeKeyframes,"x")+")*(iw-"+size[0]+")":"(iw-"+size[0]+")*.5"; const cropY=dynamicReframe?"("+reframeExpr(opts.reframeKeyframes,"y")+")*(ih-"+size[1]+")":"(ih-"+size[1]+")*.5"; const vf=`scale=${sw}:${sh}:force_original_aspect_ratio=increase,crop=${size[0]}:${size[1]}:x='${cropX}':y='${cropY}',setsar=1,setpts=(PTS-STARTPTS)/${speed}${effect}${transition}${transitionZoom}${captionFilter}`;
  const af=speed===1?["-c:a","aac","-b:a","128k"]:["-af","atempo="+speed,"-c:a","aac","-b:a","128k"];
  const args=["-y","-ss",String(Math.max(0,Number(start))),"-t",String(requested),"-i",input];
  if(opts.cutRanges?.length){
    const info=JSON.parse(await cmd("ffprobe",["-v","quiet","-show_streams","-of","json",input]));
    const audio=info.streams.some(s=>s.codec_type==="audio"),n=ranges.length,graph=[];
    graph.push(`[0:v]split=${n}${ranges.map((_,i)=>`[vs${i}]`).join("")}`);
    if(audio)graph.push(`[0:a]asplit=${n}${ranges.map((_,i)=>`[as${i}]`).join("")}`);
    ranges.forEach((range,i)=>{graph.push(`[vs${i}]trim=start=${range.start-start}:end=${range.end-start},setpts=PTS-STARTPTS[v${i}]`);if(audio)graph.push(`[as${i}]atrim=start=${range.start-start}:end=${range.end-start},asetpts=PTS-STARTPTS[a${i}]`)});
    graph.push(ranges.map((_,i)=>`[v${i}]${audio?`[a${i}]`:""}`).join("")+`concat=n=${n}:v=1:a=${audio?1:0}[cutv]${audio?"[cuta]":""}`);
    graph.push(`[cutv]${vf}[vout]`);
    if(audio)graph.push(`[cuta]atempo=${speed}[aout]`);
    args.push("-filter_complex",graph.join(";"),"-map","[vout]");if(audio)args.push("-map","[aout]","-c:a","aac","-b:a","128k");
  }else args.push("-map","0:v:0?","-map","0:a:0?","-vf",vf,...af);
  await cmd("ffmpeg",[...args,"-c:v","libx264","-preset","veryfast","-crf","22","-movflags","+faststart",out]);
  const probe=JSON.parse(await cmd("ffprobe",["-v","quiet","-print_format","json","-show_format","-show_streams",out]));
  const actual=Number(probe.format?.duration||0);
  if(!actual||Math.abs(actual-keptDuration/speed)>.75)throw new Error("Rendered edit duration does not match the requested range, cuts, and speed.");
}
async function analyzeVideoWithGemini(filePath,sourceDuration){
  if(!GEMINI_API_KEY)return null;
  const ai=new GoogleGenAI({apiKey:GEMINI_API_KEY});
  let file=await cachedGeminiUpload(ai,filePath);
  for(let i=0;i<60&&file?.state==="PROCESSING";i++){await new Promise(r=>setTimeout(r,5000));file=await ai.files.get({name:file.name})}
  if(file?.state!=="ACTIVE")throw new Error("Gemini video analysis failed: "+String(file?.state||"unknown"));
  const maxClip=Math.min(45,sourceDuration);
  const schema={type:"object",properties:{candidates:{type:"array",items:{type:"object",properties:{
    start_seconds:{type:"number"},end_seconds:{type:"number"},title:{type:"string"},reason:{type:"string"},
    hook_score:{type:"number"},emotional_intensity:{type:"number"},information_density:{type:"number"},
    story_completeness:{type:"number"},shareability_score:{type:"number"},audience_relevance:{type:"number"},retention_signal:{type:"number"},
    qa_score:{type:"number"},controversy_score:{type:"number"},funny_score:{type:"number"},educational_score:{type:"number"},story_score:{type:"number"},cta_score:{type:"number"},quote_score:{type:"number"},recommended_duration_seconds:{type:"number"}
  },required:["start_seconds","end_seconds","title","reason","hook_score","emotional_intensity","information_density","story_completeness","shareability_score","audience_relevance","retention_signal","qa_score","controversy_score","funny_score","educational_score","story_score","cta_score","quote_score","recommended_duration_seconds"]},maxItems:8}},required:["candidates"]};
  const prompt="You are Alpha.ai's clip-selection engine. Source duration is EXACTLY "+sourceDuration.toFixed(3)+" seconds. HARD RULES: 0 <= start_seconds < end_seconds <= "+sourceDuration.toFixed(3)+"; no clip may exceed "+maxClip.toFixed(3)+" seconds; never invent timestamps outside the source. Find the strongest complete short-form moments: hooks, surprising statements, useful insights, emotional peaks, punchlines, stories, Q&A, controversial claims, or CTAs. Prefer clean sentence boundaries and enough context. For a source shorter than the preferred clip length, use only the real source duration. Return up to 8 candidates ranked best-first. Scores 0-100. Also classify each candidate with audience relevance, retention signal, Q&A likelihood, controversy likelihood, funny/educational/story likelihood, CTA likelihood, quote-worthiness, and a recommended duration in seconds. Use 0 when a category is not present. Do not create filler clips.";
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
async function analyzeReframeWithGemini(filePath,sourceDuration){
  if(!GEMINI_API_KEY||sourceDuration<=0)return null;
  const ai=new GoogleGenAI({apiKey:GEMINI_API_KEY});
  const file=await cachedGeminiUpload(ai,filePath);
  let active=file;
  for(let i=0;i<60&&active?.state==="PROCESSING";i++){await new Promise(r=>setTimeout(r,3000));active=await ai.files.get({name:active.name})}
  if(active?.state!=="ACTIVE")throw new Error("Reframe video analysis failed.");
  const schema={type:"object",properties:{keyframes:{type:"array",items:{type:"object",properties:{time_seconds:{type:"number"},x_center:{type:"number"},y_center:{type:"number"},confidence:{type:"number"}},required:["time_seconds","x_center","y_center","confidence"]}}},required:["keyframes"]};
  const prompt="Analyze the video for automatic vertical/social reframing. Sample the main visible speaker or dominant person at useful moments across the source. Return up to 30 keyframes. x_center and y_center are normalized 0..1 coordinates of the desired crop center in the original frame. Follow the main speaker when possible; if no person is visible, keep the visual subject centered. time_seconds must be between 0 and "+sourceDuration.toFixed(2)+" seconds. Avoid abrupt jumps. Return JSON only.";
  const out=await ai.models.generateContent({model:GEMINI_MODEL,contents:createUserContent([createPartFromUri(active.uri,active.mimeType),prompt]),config:{responseMimeType:"application/json",responseSchema:schema}});
  const parsed=JSON.parse(out.text||"{}");
  const rows=(Array.isArray(parsed.keyframes)?parsed.keyframes:[]).map(x=>({time_seconds:Math.max(0,Math.min(sourceDuration,Number(x.time_seconds)||0)),x_center:Math.max(0,Math.min(1,Number(x.x_center??.5))),y_center:Math.max(0,Math.min(1,Number(x.y_center??.5))),confidence:Math.max(0,Math.min(1,Number(x.confidence)||0))})).filter(x=>Number.isFinite(x.x_center)&&Number.isFinite(x.y_center)).sort((a,b)=>a.time_seconds-b.time_seconds);
  const dedup=[];for(const row of rows){if(!dedup.length||Math.abs(row.time_seconds-dedup[dedup.length-1].time_seconds)>=.25)dedup.push(row)}
  return dedup.length?dedup.slice(0,30):null;
}
function reframeExpr(keyframes,axis){
  if(!Array.isArray(keyframes)||!keyframes.length)return ".5";
  const value=k=>axis==="x"?Number(k.x_center).toFixed(5):Number(k.y_center).toFixed(5);
  let expr=value(keyframes[keyframes.length-1]);
  for(let i=keyframes.length-2;i>=0;i--){
    const a=keyframes[i],b=keyframes[i+1],dt=Math.max(.25,b.time_seconds-a.time_seconds);
    const v0=value(a),v1=value(b);
    expr="if(lt(t,"+b.time_seconds.toFixed(3)+"),("+v0+"+("+v1+"-"+v0+")*(t-"+a.time_seconds.toFixed(3)+")/"+dt.toFixed(3)+"),"+expr+")";
  }
  const first=keyframes[0];
  return "if(lt(t,"+first.time_seconds.toFixed(3)+"),"+value(first)+","+expr+")";
}
async function analyzeTranscriptWithGemini(segments,sourceDuration){
  if(!GEMINI_API_KEY||!Array.isArray(segments)||!segments.length)return null;
  const ai=new GoogleGenAI({apiKey:GEMINI_API_KEY});
  const schema={type:"object",properties:{candidates:{type:"array",items:{type:"object",properties:{
    start_seconds:{type:"number"},end_seconds:{type:"number"},title:{type:"string"},reason:{type:"string"},
    hook_score:{type:"number"},emotional_intensity:{type:"number"},information_density:{type:"number"},
    story_completeness:{type:"number"},shareability_score:{type:"number"},audience_relevance:{type:"number"},retention_signal:{type:"number"},
    qa_score:{type:"number"},controversy_score:{type:"number"},funny_score:{type:"number"},educational_score:{type:"number"},story_score:{type:"number"},cta_score:{type:"number"},quote_score:{type:"number"},recommended_duration_seconds:{type:"number"}
  },required:["start_seconds","end_seconds","title","reason","hook_score","emotional_intensity","information_density","story_completeness","shareability_score","audience_relevance","retention_signal","qa_score","controversy_score","funny_score","educational_score","story_score","cta_score","quote_score","recommended_duration_seconds"]},maxItems:3}},required:["candidates"]};
  const windowSeconds=600;
  const all=[];
  for(let windowStart=0;windowStart<sourceDuration;windowStart+=windowSeconds){
    const windowEnd=Math.min(sourceDuration,windowStart+windowSeconds);
    const windowRows=segments.filter(s=>s.end>windowStart&&s.start<windowEnd);
    if(!windowRows.length)continue;
    const transcript=windowRows.map(s=>`[${Number(s.start).toFixed(2)}-${Number(s.end).toFixed(2)}] ${String(s.text||"").trim()}`).filter(Boolean).join("\n").slice(0,24000);
    if(!transcript)continue;
    const prompt="You are Alpha.ai's long-form clip-selection engine. Analyze ONLY this timestamped transcript window. Find up to 3 genuinely strong short-form moments: hooks, surprising statements, useful insights, emotional peaks, punchlines, stories, Q&A, controversial claims, or CTAs. Prefer complete thoughts and clean sentence boundaries. Do not invent words or timestamps. Timestamps MUST stay inside this window and the source duration. Do not create filler clips. A candidate should normally be 15-45 seconds, but may be shorter when the thought is complete. Return scores 0-100 and classify the moment. Window: "+windowStart.toFixed(2)+" to "+windowEnd.toFixed(2)+" seconds. Source duration: "+sourceDuration.toFixed(2)+" seconds.\nTRANSCRIPT:\n"+transcript;
    try{
      const result=await ai.models.generateContent({model:GEMINI_MODEL,contents:prompt,config:{responseMimeType:"application/json",responseSchema:schema}});
      const parsed=JSON.parse(result.text||"{}");
      for(const x of Array.isArray(parsed.candidates)?parsed.candidates:[]){
        const start=Math.max(windowStart,Math.min(sourceDuration,Number(x.start_seconds)||windowStart));
        const end=Math.max(start,Math.min(windowEnd,sourceDuration,Number(x.end_seconds)||start));
        if(end-start>=Math.min(2,sourceDuration))all.push({...x,start_seconds:start,end_seconds:end});
      }
    }catch(error){console.warn("Gemini transcript window failed:",windowStart,error.message)}
  }
  return all.length?dedupeClipCandidates(all):[];
}

function generateDeterministicClipCandidates(segments,sourceDuration){
  if(!Array.isArray(segments)||!segments.length||!sourceDuration)return [];
  const duration=Math.min(45,Math.max(8,sourceDuration));
  const step=10;
  const candidates=[];
  const hookWords=/\b(here's|here is|the truth|the biggest|most important|you need to|listen|watch this|nobody|everyone|actually|secret|mistake|why|how|what if|the reason|problem|solution)\b/i;
  const usefulWords=/\b(how|because|tip|tips|learn|lesson|strategy|step|steps|method|example|important|remember|should|avoid|use|build|create|increase|decrease|better|best|worst|mistake)\b/i;
  const storyWords=/\b(when i|then i|we went|i remember|years ago|story|happened|first|next|finally|after that)\b/i;
  const ctaWords=/\b(subscribe|follow|comment|share|like|check out|link|download|join|try)\b/i;
  const questionWords=/\?/;
  for(let start=0;start<sourceDuration;start+=step){
    const end=Math.min(sourceDuration,start+duration);
    if(end-start<8)continue;
    const rows=segments.filter(s=>s.end>start&&s.start<end);
    const text=rows.map(s=>String(s.text||"").trim()).filter(Boolean).join(" ");
    if(!text)continue;
    const words=text.split(/\s+/).filter(Boolean);
    const sentenceCount=(text.match(/[.!?]+/g)||[]).length;
    const density=Math.min(100,Math.round((words.length/Math.max(1,end-start))*30));
    const hook=Math.min(100,density*0.45+(hookWords.test(text)?38:0)+(text.length>90?10:0));
    const info=Math.min(100,density*0.6+(usefulWords.test(text)?32:0)+(sentenceCount>=2?10:0));
    const story=Math.min(100,density*0.35+(storyWords.test(text)?45:0)+(sentenceCount>=3?15:0));
    const qa=Math.min(100,(questionWords.test(text)?65:0)+(text.includes("answer")?25:0));
    const cta=Math.min(100,ctaWords.test(text)?75:0);
    const emotion=Math.min(100,(/[!]/.test(text)?25:0)+(hookWords.test(text)?25:0)+Math.min(50,density*.5));
    const completeness=Math.min(100,Math.round(Math.min(1,sentenceCount/3)*65+Math.min(1,text.length/500)*35));
    const shareability=Math.min(100,Math.round(hook*.35+info*.3+emotion*.2+completeness*.15));
    const score=Math.max(1,Math.min(99,Math.round(hook*.25+info*.2+story*.12+qa*.08+emotion*.12+shareability*.23)));
    candidates.push({
      start_seconds:start,
      end_seconds:end,
      title:hook>=70?"Strong hook":usefulWords.test(text)?"Useful insight":story>=65?"Story moment":qa>=60?"Question & answer":"Potential highlight",
      reason:"Transcript signal: strong speech density with "+(hook>=60?"hook-like":"contextual")+" language and "+(completeness>=65?"complete":"developing")+" thought structure.",
      hook_score:Math.round(hook),
      emotional_intensity:Math.round(emotion),
      information_density:Math.round(info),
      story_completeness:Math.round(completeness),
      shareability_score:Math.round(shareability),
      audience_relevance:Math.round(info*.7+hook*.3),
      retention_signal:Math.round(hook*.5+emotion*.25+completeness*.25),
      qa_score:Math.round(qa),
      controversy_score:0,
      funny_score:0,
      educational_score:usefulWords.test(text)?Math.round(info):0,
      story_score:Math.round(story),
      cta_score:Math.round(cta),
      quote_score:Math.round(hook*.5+completeness*.5),
      recommended_duration_seconds:Math.min(45,Math.max(8,end-start)),
      _score:score
    });
  }
  candidates.sort((a,b)=>b._score-a._score);
  const selected=[];
  for(const candidate of candidates){
    const duplicate=selected.some(existing=>{
      const overlap=Math.max(0,Math.min(candidate.end_seconds,existing.end_seconds)-Math.max(candidate.start_seconds,existing.start_seconds));
      const shorter=Math.min(candidate.end_seconds-candidate.start_seconds,existing.end_seconds-existing.start_seconds);
      return shorter>0&&overlap/shorter>=0.55;
    });
    if(!duplicate)selected.push(candidate);
    if(selected.length>=8)break;
  }
  return selected.map(({_score,...candidate})=>candidate);
}

function dedupeClipCandidates(candidates){
  const sorted=(Array.isArray(candidates)?candidates:[]).slice().sort((a,b)=>{
    const sa=(Number(b.hook_score)||0)+(Number(b.information_density)||0)+(Number(b.story_completeness)||0)+(Number(b.shareability_score)||0);
    const sb=(Number(a.hook_score)||0)+(Number(a.information_density)||0)+(Number(a.story_completeness)||0)+(Number(a.shareability_score)||0);
    return sa-sb;
  });
  const kept=[];
  for(const candidate of sorted){
    const start=Number(candidate.start_seconds),end=Number(candidate.end_seconds);
    if(!(end>start))continue;
    const duplicate=kept.some(existing=>{
      const overlap=Math.max(0,Math.min(end,Number(existing.end_seconds))-Math.max(start,Number(existing.start_seconds)));
      const shorter=Math.min(end-start,Number(existing.end_seconds)-Number(existing.start_seconds));
      return shorter>0&&overlap/shorter>=0.7;
    });
    if(!duplicate)kept.push(candidate);
    if(kept.length>=8)break;
  }
  return kept;
}
async function generateRepurposeAssets(clipId,workspaceId,clipText,seedTitle){if(!GEMINI_API_KEY||!clipText?.trim())return;try{const ai=new GoogleGenAI({apiKey:GEMINI_API_KEY});const schema={type:"object",properties:{hook:{type:"string"},title:{type:"string"},caption:{type:"string"},hashtags:{type:"array",items:{type:"string"}},youtube_description:{type:"string"},instagram_caption:{type:"string"},tiktok_caption:{type:"string"},thumbnail_prompt:{type:"string"}},required:["hook","title","caption","hashtags","youtube_description","instagram_caption","tiktok_caption","thumbnail_prompt"]};const prompt="Create repurposing assets for a short-form video. Seed title: "+JSON.stringify(seedTitle||"")+"\nTranscript excerpt:\n"+clipText.slice(0,9000)+"\nReturn one strong hook, title, caption, 5-10 hashtags, platform-specific copy for YouTube/Instagram/TikTok, and a concrete thumbnail-generation/editing prompt. Do not invent facts absent from the transcript.";const out=await ai.models.generateContent({model:GEMINI_MODEL,contents:prompt,config:{responseMimeType:"application/json",responseSchema:schema}});const data=JSON.parse(out.text||"{}");await db("clip_repurpose_assets",{method:"POST",body:{workspace_id:workspaceId,clip_id:clipId,hook:String(data.hook||"").slice(0,500),title:String(data.title||seedTitle||"").slice(0,180),caption:String(data.caption||"").slice(0,3000),social_copy:{youtube:String(data.youtube_description||"").slice(0,5000),instagram:String(data.instagram_caption||"").slice(0,3000),tiktok:String(data.tiktok_caption||"").slice(0,3000)},hashtags:Array.isArray(data.hashtags)?data.hashtags.slice(0,15):[],thumbnail_prompt:String(data.thumbnail_prompt||"").slice(0,2000),model_version:GEMINI_MODEL}}).catch(async()=>{await db("clip_repurpose_assets",{method:"PATCH",params:{clip_id:"eq."+clipId},body:{workspace_id:workspaceId,hook:String(data.hook||"").slice(0,500),title:String(data.title||seedTitle||"").slice(0,180),caption:String(data.caption||"").slice(0,3000),social_copy:{youtube:data.youtube_description||"",instagram:data.instagram_caption||"",tiktok:data.tiktok_caption||""},hashtags:Array.isArray(data.hashtags)?data.hashtags.slice(0,15):[],thumbnail_prompt:String(data.thumbnail_prompt||"").slice(0,2000),model_version:GEMINI_MODEL,updated_at:new Date().toISOString()}}).catch(()=>{})})}catch(e){console.warn("repurpose generation failed",clipId,e.message)}}
async function applyEditInstructionWithGemini(filePath,sourceDuration,selectedStart,selectedEnd,instruction){
  if(!GEMINI_API_KEY||!instruction?.trim())return null;
  const ai=new GoogleGenAI({apiKey:GEMINI_API_KEY});
  let file=await cachedGeminiUpload(ai,filePath);
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
async function patchJob(id,body){const rows=await db("processing_jobs",{params:{id:"eq."+id,select:"status"}});if(rows[0]?.status==="cancelled")throw new Error("Job cancelled.");return db("processing_jobs",{method:"PATCH",params:{id:"eq."+id,status:"neq.cancelled"},body})}
async function setStage(job,stageKey,status,progress,error=null){try{await db("processing_stages",{method:"POST",body:{job_id:job.jobId,workspace_id:job.workspaceId,stage_key:stageKey,status,progress:Math.max(0,Math.min(100,Number(progress)||0)),attempt_count:Number(job.retryCount||0)+1,started_at:status==="running"?new Date().toISOString():null,completed_at:status==="completed"?new Date().toISOString():null,heartbeat_at:new Date().toISOString(),error,metadata:{}}}).catch(async()=>{await db("processing_stages",{method:"PATCH",params:{job_id:"eq."+job.jobId,stage_key:"eq."+stageKey},body:{status,progress:Math.max(0,Math.min(100,Number(progress)||0)),heartbeat_at:new Date().toISOString(),completed_at:status==="completed"?new Date().toISOString():null,error}})});await patchJob(job.jobId,{current_stage:stageKey})}catch(e){console.warn("stage checkpoint failed",stageKey,e.message)}}
async function upload(file,storagePath,mime="video/mp4"){const stat=fs.statSync(file);const url=SUPA+"/storage/v1/object/media/"+storagePath.split("/").map(encodeURIComponent).join("/");const r=await fetch(url,{method:"POST",headers:{...(authStore.getStore()?{apikey:PUBLIC_KEY,Authorization:"Bearer "+authStore.getStore()}:baseAuth),"Content-Type":mime,"x-upsert":"true"},body:fs.createReadStream(file),duplex:"half"});if(!r.ok)throw new Error("Storage upload failed: "+await r.text());return stat.size}
async function downloadStored(storagePath,out){const url=SUPA+"/storage/v1/object/authenticated/media/"+storagePath.split("/").map(encodeURIComponent).join("/");const scoped=authStore.getStore();const r=await fetch(url,{headers:scoped?{apikey:PUBLIC_KEY,Authorization:"Bearer "+scoped}:{apikey:KEY||PUBLIC_KEY,Authorization:"Bearer "+(KEY||PUBLIC_KEY)}});if(!r.ok)throw new Error("Could not download stored source.");await pipeline(r.body,byteLimit(),fs.createWriteStream(out))}
async function downloadRemote(url,out,type="direct_url",opts={}){
  if(type==="google_photos"&&opts.googlePhotosBaseUrl&&opts.googlePhotosAccessToken){
    const photos=new URL(sourceUrl(String(opts.googlePhotosBaseUrl).replace(/=$/,'')+"=dv").url);
    if(!photos.hostname.endsWith(".googleusercontent.com"))throw new Error("Unsupported Google Photos download host.");
    return publicDownload(photos.toString(),out,{headers:{Authorization:"Bearer "+opts.googlePhotosAccessToken}});
  }
  if(type==="google_drive"&&opts.driveFileId&&opts.driveAccessToken)
    return publicDownload("https://www.googleapis.com/drive/v3/files/"+encodeURIComponent(opts.driveFileId)+"?alt=media",out,{headers:{Authorization:"Bearer "+opts.driveAccessToken}});
  const parsed=sourceUrl(url);
  if(type==="google_drive"){
    if(parsed.sourceType!=="google_drive")throw new Error("Use a Google Drive sharing link.");
    const u=new URL(parsed.url),id=u.pathname.match(/\/file\/d\/([a-zA-Z0-9_-]+)/)?.[1]||u.searchParams.get("id");
    if(!id||!/^[a-zA-Z0-9_-]+$/.test(id))throw new Error("Google Drive link must point to a shared file.");
    return publicDownload("https://drive.google.com/uc?export=download&id="+encodeURIComponent(id),out);
  }
  if(type==="dropbox"){if(parsed.sourceType!=="dropbox")throw new Error("Use a Dropbox sharing link.");const u=new URL(parsed.url);u.searchParams.set("dl","1");return publicDownload(u.toString(),out)}
  if(type==="onedrive"){if(parsed.sourceType!=="onedrive")throw new Error("Use a OneDrive sharing link.");const shareToken=Buffer.from(parsed.url).toString("base64url");return publicDownload("https://api.onedrive.com/v1.0/shares/u!"+shareToken+"/root/content",out)}
  if(type==="direct_url"||type==="s3")return publicDownload(parsed.url,out);
  if(type!=="youtube"||parsed.sourceType!=="youtube")throw new Error("Unsupported video source.");
  {
  const common=["--no-playlist","--no-warnings","--socket-timeout","30","--max-filesize",String(MAX_DOWNLOAD_BYTES),"--match-filter","duration <= 3600","-f","bv*[height<=1080]+ba/b[height<=1080]","--merge-output-format","mp4","-o",out,youtubeVideoUrl(parsed.url)];
  let lastError=null;
  for(const clientArgs of [["--extractor-args","youtube:player_client=android"],["--extractor-args","youtube:player_client=web_embedded"],[]]){
    try{await cmd("yt-dlp",[...clientArgs,...common]);lastError=null;break}catch(error){lastError=error}
  }
  if(lastError)throw lastError;
}}
async function detectSpeakersWithGemini(filePath,duration,projectId){
  if(!GEMINI_API_KEY)return;
  try{
    const ai=new GoogleGenAI({apiKey:GEMINI_API_KEY});
    let file=await cachedGeminiUpload(ai,filePath);
    for(let i=0;i<60&&file.state==="PROCESSING";i++){await new Promise(r=>setTimeout(r,3000));file=await ai.files.get({name:file.name})}
    if(file.state!=="ACTIVE")throw new Error("Speaker analysis media is unavailable.");
    const prompt="Identify distinct speakers in this video and return ONLY JSON array objects with speaker_label,start_seconds,end_seconds,confidence. Use Speaker 1, Speaker 2 etc. Cover only intervals where a person is speaking. Do not invent speakers or timestamps. Duration is "+duration.toFixed(3)+" seconds.";
    const result=await ai.models.generateContent({model:GEMINI_MODEL,contents:createUserContent([createPartFromUri(file.uri,file.mimeType),prompt]),config:{responseMimeType:"application/json"}});
    const rows=JSON.parse(result.text||"[]");if(!Array.isArray(rows))return;
    await db("speaker_segments",{method:"DELETE",params:{project_id:"eq."+projectId}}).catch(()=>{});
    const clean=rows.map(x=>({project_id:projectId,speaker_label:String(x.speaker_label||"Speaker 1").slice(0,80),start_ms:Math.max(0,Math.round((Number(x.start_seconds)||0)*1000)),end_ms:Math.min(Math.round(duration*1000),Math.round((Number(x.end_seconds)||0)*1000)),confidence:Number(x.confidence)||null,metadata:{source:"gemini"}})).filter(x=>x.end_ms>x.start_ms);
    if(clean.length)await db("speaker_segments",{method:"POST",body:clean});
    // Map diarization intervals back onto transcript segments so the transcript is speaker-aware.
    try{
      const tr=(await db("transcripts",{params:{media_asset_id:"eq."+(await db("videos",{params:{project_id:"eq."+projectId,select:"media_asset_id",limit:"1"}}))[0]?.media_asset_id,select:"id",order:"created_at.desc",limit:"1"}}))[0];
      if(tr?.id){
        const ts=await db("transcript_segments",{params:{transcript_id:"eq."+tr.id,select:"id,start_ms,end_ms",order:"start_ms.asc"}});
        for(const seg of ts||[]){
          const mid=(Number(seg.start_ms)+Number(seg.end_ms))/2;
          const hit=clean.find(s=>mid>=s.start_ms&&mid<=s.end_ms) || clean.reduce((best,s)=>Math.abs(((s.start_ms+s.end_ms)/2)-mid)<Math.abs(((best?.start_ms+best?.end_ms)/2||Infinity)-mid)?s:best,null);
          if(hit)await db("transcript_segments",{method:"PATCH",params:{id:"eq."+seg.id},body:{speaker:hit.speaker_label}});
        }
        await db("speaker_segments",{method:"DELETE",params:{project_id:"eq."+projectId}});
        const linked=clean.map(s=>{const mid=(s.start_ms+s.end_ms)/2;const hit=(ts||[]).find(t=>mid>=Number(t.start_ms)&&mid<=Number(t.end_ms));return {...s,transcript_segment_id:hit?.id||null}});
        if(linked.length)await db("speaker_segments",{method:"POST",body:linked});
      }
    }catch(e){console.warn("speaker transcript mapping failed:",e.message)}
  }catch(e){console.warn("speaker detection fallback:",e.message)}
}
async function processJob(p){const dir=fs.mkdtempSync(path.join(os.tmpdir(),"alpha-")),audio=path.join(dir,"audio.wav");jobDirs.set(dir,p.jobId);let input=path.join(dir,"source.mp4");const heartbeat=setInterval(()=>patchJob(p.jobId,{heartbeat_at:new Date().toISOString(),updated_at:new Date().toISOString(),lease_until:new Date(Date.now()+120000).toISOString()}).catch(()=>{}),30000);try{
  await patchJob(p.jobId,{status:"processing",error:null,heartbeat_at:new Date().toISOString(),lease_until:new Date(Date.now()+120000).toISOString()});
  const project=(await db("projects",{params:{id:"eq."+p.projectId,workspace_id:"eq."+p.workspaceId,select:"id,owner_id"}}))[0];
  if(!project)throw new Error("Processing project does not belong to this workspace.");
  if(!p.requestedBy)p.requestedBy=project.owner_id;
  if(p.mediaAssetId&&!(await db("media_assets",{params:{id:"eq."+p.mediaAssetId,project_id:"eq."+p.projectId,select:"id"}})).length)throw new Error("Processing video context mismatch.");
  if(p.clipId&&!(await db("clips",{params:{id:"eq."+p.clipId,project_id:"eq."+p.projectId,media_asset_id:"eq."+p.mediaAssetId,select:"id"}})).length)throw new Error("Processing clip context mismatch.");
  if(p.sourceId&&!(await db("project_sources",{params:{id:"eq."+p.sourceId,project_id:"eq."+p.projectId,select:"id"}})).length)throw new Error("Processing source context mismatch.");
  if(p.sessionId&&!(await db("ai_chat_sessions",{params:{id:"eq."+p.sessionId,workspace_id:"eq."+p.workspaceId,user_id:"eq."+p.requestedBy,select:"id"}})).length)throw new Error("Processing chat context mismatch.");
  if(p.operation==="ai_chat_plan") { await runChatPlan(p,{db,patchJob,key:GEMINI_API_KEY,model:GEMINI_MODEL}); return; }
  if(p.operation==="chat_ingest" && p.mediaAssetId && p.transcriptionChunks?.length && Number(p.transcribeChunk)>=p.transcriptionChunks.length) {
    await runChatPlan(p,{db,patchJob,key:GEMINI_API_KEY,model:GEMINI_MODEL});
    await db("projects",{method:"PATCH",params:{id:"eq."+p.projectId},body:{status:"ready"}}); return;
  }
  await patchJob(p.jobId,{progress:2,current_stage:"media_inspection"});await setStage(p,"media_inspection","running",0);
  let asset=null,assetRows=[];
  if(p.driveCredential)p.driveAccessToken=decryptCredential(p.driveCredential,SECRET);
  if(p.photosCredential)p.googlePhotosAccessToken=decryptCredential(p.photosCredential,SECRET);
  if(p.sourceType==="google_drive"&&p.driveFileId&&p.driveAccessToken){
    await db("project_sources",{method:"PATCH",params:{id:"eq."+p.sourceId},body:{status:"downloading"}});
    await downloadRemote(null,input,"google_drive",{driveFileId:p.driveFileId,driveAccessToken:p.driveAccessToken});
  }else if(p.url){
    await db("project_sources",{method:"PATCH",params:{id:"eq."+p.sourceId},body:{status:"downloading"}});
    if(p.sourceType==="direct_url"||p.sourceType==="s3")await publicDownload(p.url,input);
    else await downloadRemote(p.url,input,p.sourceType,{googlePhotosBaseUrl:p.googlePhotosBaseUrl,googlePhotosAccessToken:p.googlePhotosAccessToken,driveFileId:p.driveFileId,driveAccessToken:p.driveAccessToken});
  }else{
    assetRows=await db("media_assets",{params:{id:"eq."+p.mediaAssetId,select:"*"}});
    asset=assetRows[0];
    if(asset?.storage_path){
      await downloadStored(asset.storage_path,input);
    }else{
      const sources=await db("project_sources",{params:{project_id:"eq."+p.projectId,select:"source_type,source_url,external_id,metadata,created_at",order:"created_at.desc",limit:"5"}}).catch(()=>[]);
      const source=sources.find(x=>x.source_url||x.external_id);
      if(!source?.source_url)throw new Error("Source media is not persisted and no re-download source is available.");
      const meta=source.metadata||{};
      await downloadRemote(source.source_url,input,source.source_type,{
        googlePhotosBaseUrl:meta.base_url||meta.google_photos_base_url,
        googlePhotosAccessToken:meta.access_token,
        driveFileId:meta.file_id||source.external_id,
        driveAccessToken:meta.access_token
      });
    }
  }
  await setStage(p,"media_inspection","completed",100);await setStage(p,"audio_extraction","running",0);await patchJob(p.jobId,{progress:20,current_stage:"audio_extraction"});
  if(fs.statSync(input).size>MAX_DOWNLOAD_BYTES)throw new Error('The source exceeds the worker download size limit.');
  const probe=JSON.parse(await cmd("ffprobe",["-v","quiet","-print_format","json","-show_format","-show_streams",input]));
  const originalProbe=probe; const sourceBeforeNormalize=input; input=await normalizeIfVfr(input,originalProbe,dir); const normalizedProbe=input!==sourceBeforeNormalize?JSON.parse(await cmd("ffprobe",["-v","quiet","-print_format","json","-show_format","-show_streams",input])):originalProbe;
  const stream=normalizedProbe.streams.find(x=>x.codec_type==="video"),formatDuration=Number(normalizedProbe.format?.duration||0),streamDuration=Number(stream?.duration||0),duration=Math.max(0,Math.min(...[formatDuration,streamDuration].filter(x=>Number.isFinite(x)&&x>0))),width=Number(stream?.width||0),height=Number(stream?.height||0),fps=Number((stream?.r_frame_rate||"0/1").split("/")[0])/(Number((stream?.r_frame_rate||"0/1").split("/")[1])||1);
  if(!stream||!Number.isFinite(duration)||duration<=0)throw new Error("The source is not a readable video with a finite duration.");
  if(duration>3600)throw new Error("This worker accepts source videos up to 60 minutes.");
  if(!asset){
    const fileName=(probe.format?.tags?.title||"Imported video").replace(/[^a-zA-Z0-9._ -]/g,"-")+".mp4";
    const size=fs.statSync(input).size;
    const persistSource=true;
    const storagePath=p.workspaceId+"/"+p.projectId+"/source-"+randomUUID()+".mp4";
    await upload(input,storagePath);
    const assetRowsCreated=await db("media_assets",{
      method:"POST",
      body:{
        workspace_id:p.workspaceId,
        project_id:p.projectId,
        owner_id:p.requestedBy,
        name:fileName,
        storage_path:storagePath,
        mime_type:"video/mp4",
        size_bytes:size,
        duration_seconds:duration,
        status:"uploaded",
        metadata:{source_persisted:persistSource,source_type:p.sourceType||null}
      }
    });
    asset=assetRowsCreated?.[0]||null;
    if(!asset)throw new Error("Could not create media asset.");
    await db("videos",{
      method:"POST",
      body:{
        project_id:p.projectId,
        media_asset_id:asset.id,
        title:fileName.replace(/\.mp4$/,""),
        duration_seconds:duration,
        width,
        height,
        fps,
        status:"ready",
        metadata:{normalized_vfr:input!==sourceBeforeNormalize}
      }
    });
  }else{
    await db("media_assets",{method:"PATCH",params:{id:"eq."+asset.id},body:{duration_seconds:duration,status:"uploaded"}});
    await db("videos",{method:"PATCH",params:{media_asset_id:"eq."+asset.id},body:{duration_seconds:duration,width,height,fps,status:"ready"}}).catch(()=>{});
  }
  p={...p,mediaAssetId:asset.id,url:null,driveAccessToken:undefined,googlePhotosAccessToken:undefined,driveCredential:undefined,photosCredential:undefined};
  await patchJob(p.jobId,{payload:p});
  if(p.operation==="chat_ingest") {
    p.url=null;
    await db("ai_chat_sessions",{method:"PATCH",params:{id:"eq."+p.sessionId},body:{media_asset_id:asset.id,updated_at:new Date().toISOString()}});
    await patchJob(p.jobId,{payload:p});
  }
  if(p.sourceId)await db("project_sources",{method:"PATCH",params:{id:"eq."+p.sourceId},body:{status:"downloaded",file_name:asset.name}}).catch(()=>{});
  if(!asset.metadata?.thumbnail_storage_path){try{
    const thumbnail=path.join(dir,'thumbnail.jpg');
    await cmd('ffmpeg',['-y','-ss',String(Math.min(2,duration/2)),'-i',input,'-frames:v','1','-vf','scale=640:-2',thumbnail]);
    const thumbnailPath=p.workspaceId+'/'+p.projectId+'/thumbnails/'+asset.id+'.jpg';
    await upload(thumbnail,thumbnailPath,'image/jpeg');
    asset.metadata={...(asset.metadata||{}),thumbnail_storage_path:thumbnailPath};
    await db('media_assets',{method:'PATCH',params:{id:'eq.'+asset.id},body:{metadata:asset.metadata}});
  }catch{console.warn('Source thumbnail could not be generated.')}}
  if(p.operation!=="render_edit"&&!asset.metadata?.proxy_storage_path){try{const proxyPath=path.join(dir,"proxy.mp4");await createProxy(input,proxyPath);const proxyStorage=p.workspaceId+"/"+p.projectId+"/proxy/"+asset.id+".mp4";await upload(proxyPath,proxyStorage);await db("media_assets",{method:"PATCH",params:{id:"eq."+asset.id},body:{metadata:{...(asset.metadata||{}),proxy_storage_path:proxyStorage,normalized_vfr:input!==sourceBeforeNormalize}}})}catch(error){console.warn("proxy generation unavailable:",error.message)}}

  if(p.operation==="render_edit"){
    let start=Math.max(0,Math.min(duration,Number(p.startSeconds)||0));
    let end=Math.max(start,Math.min(duration,Number(p.endSeconds)||duration));
    let aiEdit=null;
    if(p.aiPrompt?.trim()&&p.aiEditStatus!=="applied"){
      await patchJob(p.jobId,{progress:25,payload:{...p,aiEditStatus:"analyzing"}});
      const plan=await generateChatPlan({...p,prompt:p.aiPrompt,selection:{start_seconds:start,end_seconds:end,...p}},{db,patchJob,key:GEMINI_API_KEY,model:GEMINI_MODEL});
      aiEdit=plan.clips[0];p={...p,...aiEdit,aiEditStatus:"applied",aiEditReason:aiEdit.reason};
      start=aiEdit.startSeconds;end=aiEdit.endSeconds;
    }
    if(end-start<0.25)throw new Error("Selected edit range is too short.");
    let clip=null;
    if(p.clipId){
      clip=(await db("clips",{params:{id:"eq."+p.clipId,project_id:"eq."+p.projectId,media_asset_id:"eq."+asset.id,select:"*"}}))[0]||null;
    }
    if(!clip){
      const existing=(await db("clips",{params:{project_id:"eq."+p.projectId,media_asset_id:"eq."+asset.id,start_seconds:"eq."+start.toFixed(3),end_seconds:"eq."+end.toFixed(3),select:"*",order:"created_at.asc",limit:"1"}}))[0]||null;
      clip=existing||null;
    }
    if(!clip){
      const clips=await db("clips",{method:"POST",body:{project_id:p.projectId,media_asset_id:asset.id,title:String(p.title||"Edited clip").slice(0,180),start_seconds:start,end_seconds:end,score:0,status:"processing"}});
      clip=clips?.[0]||null;
    }
    if(!clip)throw new Error("Could not create or recover edited clip.");
    p={...p,clipId:clip.id};
    await patchJob(p.jobId,{progress:72,current_stage:"clip_render",payload:p});
    const dir2=path.join(dir,"edited");fs.mkdirSync(dir2,{recursive:true});const rendered=path.join(dir2,clip.id+".mp4");
    let srtPath=null,assPath=null;
    if(p.captions!==false){
      const tr=(await db("transcripts",{params:{media_asset_id:"eq."+asset.id,select:"id",order:"created_at.desc",limit:"1"}}))[0];
      if(tr?.id){
        const rows=await db("transcript_segments",{params:{transcript_id:"eq."+tr.id,start_ms:"lt."+Math.round(end*1000),end_ms:"gt."+Math.round(start*1000),select:"start_ms,end_ms,text",order:"start_ms.asc"}}).catch(()=>[]);
        const usable=(rows||[]).filter(x=>Number(x.end_ms)>Number(x.start_ms));
        const stamp=n=>{const ms=Math.max(0,Math.round(n*1000)),h=Math.floor(ms/3600000),m=Math.floor(ms%3600000/60000),s=Math.floor(ms%60000/1000),z=ms%1000;return String(h).padStart(2,"0")+":"+String(m).padStart(2,"0")+":"+String(s).padStart(2,"0")+","+String(z).padStart(3,"0")};
        if(usable.length){
          srtPath=path.join(dir2,"captions.srt");
          const events=captionEvents(usable.map(row=>({...row,word:row.text})),start,end,Number(p.speed)||1,p.cutRanges||[]);
          fs.writeFileSync(srtPath,events.map((event,i)=>(i+1)+"\n"+stamp(event.start)+" --> "+stamp(event.end)+"\n"+event.word+"\n").join("\n"),"utf8");
        }
        const words=await allPages((offset,limit)=>db("transcript_words",{params:{transcript_id:"eq."+tr.id,start_ms:"lt."+Math.round(end*1000),end_ms:"gt."+Math.round(start*1000),select:"start_ms,end_ms,word",order:"start_ms.asc,id.asc",offset,limit}}));
        const usableWords=(words||[]).filter(x=>Number(x.end_ms)>Number(x.start_ms)&&String(x.word||"").trim());
        if(usableWords.length){
          const assTime=n=>{const ms=Math.max(0,Math.round(n*1000)),h=Math.floor(ms/3600000),m=Math.floor(ms%3600000/60000),s=Math.floor(ms%60000/1000),cs=Math.floor((ms%1000)/10);return String(h)+":"+String(m).padStart(2,"0")+":"+String(s).padStart(2,"0")+"."+String(cs).padStart(2,"0")};
          const esc=w=>String(w).replace(/[{}]/g,"").replace(/\\/g,"\\\\");
          const lines=[];let line=[],lineStart=0,lineEnd=0;
          for(const w of captionEvents(usableWords,start,end,Number(p.speed)||1,p.cutRanges||[])){const ws=w.start,we=w.end;if(!line.length)lineStart=ws;line.push({word:esc(w.word),duration:Math.max(1,Math.round((we-ws)*100))});lineEnd=we;if(line.length>=(p.captionStyle==="pop"?1:7)||we-lineStart>=3.2){lines.push({start:lineStart,end:lineEnd,words:line});line=[]}}
          if(line.length)lines.push({start:lineStart,end:lineEnd,words:line});
          assPath=path.join(dir2,"captions.ass");
          const color=/^#[\da-f]{6}$/i.test(p.captionColor||"")?p.captionColor.slice(1):"ffffff";
          const assColor="&H00"+color.slice(4,6)+color.slice(2,4)+color.slice(0,2);
          const dimensions=p.aspect==="16:9"?[1920,1080]:p.aspect==="1:1"?[1080,1080]:[1080,1920];
          const header=`[Script Info]\nScriptType: v4.00+\nPlayResX: ${dimensions[0]}\nPlayResY: ${dimensions[1]}\n[V4+ Styles]\nFormat: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding\nStyle: Default,Arial,${p.captionStyle==="minimal"?38:64},${assColor},${assColor},&H00000000,&H80000000,${p.captionStyle==="minimal"?0:1},0,0,0,100,100,0,0,1,3,0,2,60,60,100,1\n[Events]\nFormat: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text\n`;
          fs.writeFileSync(assPath,header+lines.map(x=>"Dialogue: 0,"+assTime(x.start)+","+assTime(x.end)+",Default,,0,0,0,, "+x.words.map(w=>"{\\k"+w.duration+"}"+w.word).join(" ")).join("\n"),"utf8");
        }
      }
    }
    let reframeKeyframes=null;
    if(p.reframe!==false&&p.aspect!=="16:9"&&GEMINI_API_KEY){
      try{await patchJob(p.jobId,{progress:76,current_stage:"reframing",payload:{...p,aiEditStatus:"analyzing_reframe"}});const reframeInput=path.join(dir2,"reframe-input.mp4");await renderClip(input,reframeInput,start,end);reframeKeyframes=await analyzeReframeWithGemini(reframeInput,end-start);p={...p,reframeStatus:"ready",reframeKeyframes};await patchJob(p.jobId,{payload:p})}catch(error){p={...p,reframeStatus:"fallback",reframeError:error.message};await patchJob(p.jobId,{payload:p});console.warn("AI reframe unavailable; using centered crop:",error.message)}
    }
    if(p.captions!==false&&!srtPath&&!assPath)throw new Error("Captions were requested, but no timed transcript is available.");
    const editData={source_start:start,source_end:end,duration_seconds:retainedRanges(start,end,p.cutRanges||[]).reduce((sum,range)=>sum+range.end-range.start,0)/Math.max(.5,Math.min(2,Number(p.speed)||1)),cutRanges:p.cutRanges||[],editor:true,aspect:p.aspect||"9:16",speed:Number(p.speed)||1,zoom:Number(p.zoom)||1,effect:p.effect||"none",transition:p.transition||"cut",captions:p.captions!==false,captionStyle:p.captionStyle,captionColor:p.captionColor,ai_prompt:p.instruction||p.aiPrompt||"",ai_action:aiEdit?.action||"",ai_reason:aiEdit?.reason||p.reason||""};
    const latestVersion=(await db("clip_versions",{params:{clip_id:"eq."+clip.id,select:"id,version,render_status,storage_path,edit_data",order:"version.desc",limit:"1"}}))[0]||null;
    const renderedVersion=(await db("clip_versions",{params:{clip_id:"eq."+clip.id,"edit_data->>render_job_id":"eq."+p.jobId,render_status:"eq.ready",select:"version,storage_path",limit:1}}))[0];
    if(renderedVersion?.storage_path){
      await db("clips",{method:"PATCH",params:{id:"eq."+clip.id},body:{status:"ready",render_path:renderedVersion.storage_path,start_seconds:start,end_seconds:end,title:String(p.title||clip.title||"Edited clip").slice(0,180)}});
      await patchJob(p.jobId,{status:"completed",progress:100,payload:{...p,clipId:clip.id,clipVersion:renderedVersion.version}});
      console.log("editor render reused existing job version",p.jobId,clip.id,renderedVersion.version);
      return;
    }
    const nextVersion=Math.max(1,Number(latestVersion?.version||0)+1);
    editData.render_job_id=p.jobId;
    await setStage(p,"clip_render","running",0);await patchJob(p.jobId,{progress:80});
    await renderEditedClip(input,rendered,start,end,{aspect:p.aspect,speed:p.speed,zoom:p.zoom,effect:p.effect,transition:p.transition,srtPath,assPath,reframeKeyframes,cutRanges:p.cutRanges});
    await setStage(p,"clip_render","completed",100);await setStage(p,"export","running",0);await patchJob(p.jobId,{progress:92});
    const storagePath=p.workspaceId+"/"+p.projectId+"/clips/"+clip.id+"/v"+nextVersion+".mp4";
    await upload(rendered,storagePath,"video/mp4");
    await db("clip_versions",{method:"POST",body:{clip_id:clip.id,version:nextVersion,render_status:"ready",storage_path:storagePath,edit_data:editData}});
    await setStage(p,"export","completed",100);
    await db("clips",{method:"PATCH",params:{id:"eq."+clip.id},body:{status:"ready",render_path:storagePath,start_seconds:start,end_seconds:end,title:String(p.title||clip.title||"Edited clip").slice(0,180),ai_spec:{...(clip.ai_spec||{}),...editData},caption_config:{style:p.captionStyle||"pop",color:p.captionColor||"#ffffff"},reframe_config:{aspect:p.aspect||"9:16"}}});
    await patchJob(p.jobId,{status:"completed",progress:100,payload:{...p,clipId:clip.id}});
    console.log("editor render completed",p.jobId,clip.id);
    return;
  }
  await patchJob(p.jobId,{progress:35});
  await cmd("ffmpeg",["-y","-i",input,"-vn","-ac","1","-ar","16000","-c:a","pcm_s16le",audio]);await setStage(p,"audio_extraction","completed",100);await setStage(p,"transcription","running",0);
  // Free-tier safe transcription: process short audio windows and checkpoint after every window.
  // If Render restarts, recovery resumes from the last saved window instead of starting Whisper again.
  let transcript=null;
  if(p.transcriptId){
    transcript=(await db("transcripts",{params:{id:"eq."+p.transcriptId,select:"*"}}))[0]||null;
  }
  if(!transcript){
    transcript=(await db("transcripts",{method:"POST",body:{media_asset_id:asset.id,language:"auto",text:"",provider:"transformers-whisper",status:"processing"}}))[0];
    p={...p,transcriptId:transcript.id};
    await patchJob(p.jobId,{payload:{...p,transcriptId:transcript.id,transcribeChunk:0}});
  }
  const chunkSeconds=60;
  const chunkCount=Math.max(1,Math.ceil(duration/chunkSeconds));
  let nextChunk=Math.max(0,Number(p.transcribeChunk||0));
  const browserTranscription=process.env.TRANSCRIPTION_PROVIDER==="browser"||!GEMINI_API_KEY;
  let transcriptionChunks=Array.isArray(p.transcriptionChunks)?p.transcriptionChunks:[];
  if(browserTranscription&&nextChunk<chunkCount && transcriptionChunks.length<chunkCount){
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
  if(browserTranscription&&nextChunk<chunkCount){
    // Primary transcription runs in the user's browser so Render Free does not
    // need to load/infer Whisper. The browser worker checkpoints each 15s chunk.
    await patchJob(p.jobId,{
      status:"awaiting_transcription",
      progress:43,
      current_stage:"transcription",
      payload:{...p,transcriptId:transcript.id,transcribeChunk:nextChunk,transcriptionChunks}
    });
    console.log("browser transcription queued",p.jobId,"chunks",chunkCount,"next",nextChunk);
    return;
  }
  if(!browserTranscription){
    const ai=new GoogleGenAI({apiKey:GEMINI_API_KEY});
    for(let i=nextChunk;i<chunkCount;i++){
      const start=i*chunkSeconds,length=Math.min(chunkSeconds,duration-start),chunkAudio=path.join(dir,"server-chunk-"+i+".wav");
      await cmd("ffmpeg",["-y","-ss",String(start),"-i",audio,"-t",String(length),"-c:a","pcm_s16le",chunkAudio]);
      const file=await cachedGeminiUpload(ai,chunkAudio,"audio/wav");
      const result=await ai.models.generateContent({model:GEMINI_MODEL,contents:createUserContent([createPartFromUri(file.uri,file.mimeType),
        "Transcribe only the spoken audio verbatim. Do not invent speech during silence. Return JSON {language:string,words:[{word:string,start:number,end:number}]} with word-level start/end in seconds relative to this "+length+" second audio chunk. Preserve the spoken language. No commentary."]),config:{responseMimeType:"application/json"}});
      const parsed=JSON.parse(result.text||"{}");
      if(!Array.isArray(parsed.words))throw new Error("Audio transcription returned an invalid response.");
      const wordRows=parsed.words.map(w=>({transcript_id:transcript.id,word:String(w.word||"").trim(),start_ms:Math.round((start+Math.max(0,Number(w.start)))*1000),end_ms:Math.round((start+Math.min(length,Number(w.end)))*1000)})).filter(w=>w.word&&Number.isFinite(w.start_ms)&&Number.isFinite(w.end_ms)&&w.end_ms>w.start_ms);
      const range={transcript_id:"eq."+transcript.id,start_ms:["gte."+Math.round(start*1000),"lt."+Math.round((start+length)*1000)]};
      await db("transcript_words",{method:"DELETE",params:range});
      await db("transcript_segments",{method:"DELETE",params:range});
      if(wordRows.length){
        await db("transcript_words",{method:"POST",body:wordRows});
        const rows=[];for(let j=0;j<wordRows.length;j+=12){const group=wordRows.slice(j,j+12);rows.push({transcript_id:transcript.id,start_ms:group[0].start_ms,end_ms:group.at(-1).end_ms,text:group.map(w=>w.word).join(" ")})}
        await db("transcript_segments",{method:"POST",body:rows});
      }
      p={...p,transcribeChunk:i+1,transcriptionProvider:"gemini",transcriptionTotalChunks:chunkCount};
      await patchJob(p.jobId,{payload:p,progress:43+Math.round((i+1)/chunkCount*18)});
      await setStage(p,"transcription","running",Math.round((i+1)/chunkCount*100));
    }
    const textRows=await allPages((offset,limit)=>db("transcript_segments",{params:{transcript_id:"eq."+transcript.id,select:"text",order:"start_ms.asc,id.asc",offset,limit}}));
    await db("transcripts",{method:"PATCH",params:{id:"eq."+transcript.id},body:{text:textRows.map(s=>s.text).join(" "),status:"completed",provider:"gemini"}});
  }
  const allRows=await allPages((offset,limit)=>db("transcript_segments",{params:{transcript_id:"eq."+transcript.id,select:"start_ms,end_ms,text",order:"start_ms.asc,id.asc",offset,limit}}));
  if(p.operation==='chat_ingest'){await runChatPlan(p,{db,patchJob,key:GEMINI_API_KEY,model:GEMINI_MODEL});await db('projects',{method:'PATCH',params:{id:'eq.'+p.projectId},body:{status:'ready'}});return}
  await setStage(p,"transcription","completed",100);
  const segments=(allRows||[]).map(s=>({start:Number(s.start_ms)/1000,end:Number(s.end_ms)/1000,text:s.text||""}));
  await patchJob(p.jobId,{progress:62,payload:{...p,transcriptId:transcript.id,transcribeChunk:chunkCount}});
  const safeDuration=Math.max(0,Number(duration)||0);
  if(!safeDuration)throw new Error("Source video duration could not be determined.");
  await setStage(p,"speaker_detection","running",0);await detectSpeakersWithGemini(input,safeDuration,p.projectId);await setStage(p,"speaker_detection","completed",100);
  await setStage(p,"topic_segmentation","running",0);await db("video_topics",{method:"DELETE",params:{project_id:"eq."+p.projectId}}).catch(()=>{});
  const topicWindows=[];
  for(let start=0;start<safeDuration;start+=300){const end=Math.min(safeDuration,start+300);const text=segments.filter(s=>s.end>start&&s.start<end).map(s=>s.text).join(" ").trim();if(text)topicWindows.push({start,end,text:text.slice(0,4000)});}
  let topicRows=topicWindows.map((w,i)=>({project_id:p.projectId,name:"Topic "+(i+1),score:50,metadata:{start_seconds:w.start,end_seconds:w.end,source:"deterministic"}}));
  if(GEMINI_API_KEY&&topicWindows.length){try{const prompt="Name these video sections. Return ONLY JSON array objects with index and name. Names must be factual, concise, 2-6 words. "+JSON.stringify(topicWindows.map((w,i)=>({index:i,start:w.start,end:w.end,text:w.text})));const rr=await fetch("https://generativelanguage.googleapis.com/v1beta/models/"+encodeURIComponent(GEMINI_MODEL)+":generateContent?key="+encodeURIComponent(GEMINI_API_KEY),{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:{responseMimeType:"application/json"}})});const jj=await rr.json().catch(()=>({}));const raw=jj?.candidates?.[0]?.content?.parts?.map(x=>x.text||"").join("")||"[]";const named=JSON.parse(raw);if(Array.isArray(named))topicRows=topicWindows.map((w,i)=>{const n=named.find(x=>Number(x.index)===i);return{project_id:p.projectId,name:String(n?.name||("Topic "+(i+1))).slice(0,160),score:75,metadata:{start_seconds:w.start,end_seconds:w.end,source:"gemini"}}})}catch(e){console.warn("topic segmentation fallback:",e.message)}}
  if(topicRows.length)await db("video_topics",{method:"POST",body:topicRows.map(t=>({workspace_id:p.workspaceId,project_id:t.project_id,video_id:null,title:t.name,summary:t.metadata?.source==="gemini"?"AI-segmented video topic":"Deterministic video topic",start_ms:Math.round(Number(t.metadata?.start_seconds||0)*1000),end_ms:Math.round(Number(t.metadata?.end_seconds||0)*1000),keywords:[],confidence:Number(t.score||50)/100}))}).catch(e=>console.warn("topic save failed:",e.message));
  await setStage(p,"topic_segmentation","completed",100);
  let candidates=null;
  if(GEMINI_API_KEY){
    await patchJob(p.jobId,{progress:64,payload:{...p,transcriptId:transcript.id,transcribeChunk:chunkCount,clipEngine:"gemini"}});
    try{candidates=await analyzeTranscriptWithGemini(segments,safeDuration);console.log("Gemini transcript clip candidates",p.jobId,candidates?.length||0)}
    catch(e){console.warn("Gemini clip analysis failed; using deterministic fallback:",e.message)}
  }
  if(candidates?.length)candidates=dedupeClipCandidates(candidates);await setStage(p,"clip_scoring","completed",100);await setStage(p,"clip_render","running",0);
  if(!candidates?.length){
    candidates=generateDeterministicClipCandidates(segments,safeDuration);
    console.log("Deterministic transcript clip candidates",p.jobId,candidates.length);
  }
  const existingClips=await db("clips",{params:{project_id:"eq."+p.projectId,media_asset_id:"eq."+asset.id,select:"id,start_seconds,end_seconds,status"}});
  const existingByStart=new Map((existingClips||[]).map(x=>[Number(x.start_seconds).toFixed(3),x]));
  for(let i=0;i<candidates.length;i++){
    const candidate=candidates[i];
    const start=Math.max(0,Math.min(safeDuration,Number(candidate.start_seconds)||0));
    const end=Math.max(start,Math.min(safeDuration,start+45,Number(candidate.end_seconds)||start));
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
      await renderEditedClip(input,rendered,start,end,{aspect:"9:16"});
      const storagePath=p.workspaceId+"/"+p.projectId+"/clips/"+clip.id+"/v1.mp4";
      await upload(rendered,storagePath,"video/mp4");
      if(existingVersion?.id)await db("clip_versions",{method:"PATCH",params:{id:"eq."+existingVersion.id},body:{storage_path:storagePath,render_status:"ready",edit_data:{source_start:start,source_end:end,duration_seconds:end-start}}});
      else await db("clip_versions",{method:"POST",body:{clip_id:clip.id,version:1,render_status:"ready",storage_path:storagePath,edit_data:{source_start:start,source_end:end,duration_seconds:end-start}}});
    }
    const scores=await db("clip_scores",{params:{clip_id:"eq."+clip.id,select:"id",limit:"1"}});
    if(!scores?.[0])await db("clip_scores",{method:"POST",body:{clip_id:clip.id,score,hook_score:Number(candidate.hook_score)||score,emotion_score:Number(candidate.emotional_intensity)||Math.max(0,score-3),clarity_score:Number(candidate.story_completeness)||score,shareability_score:Number(candidate.shareability_score)||Math.max(0,score-1),information_density:Number(candidate.information_density)||score,story_completeness:Number(candidate.story_completeness)||score,audience_relevance:Number(candidate.audience_relevance)||score,retention_signal:Number(candidate.retention_signal)||score,qa_score:Number(candidate.qa_score)||0,controversy_score:Number(candidate.controversy_score)||0,funny_score:Number(candidate.funny_score)||0,educational_score:Number(candidate.educational_score)||0,story_score:Number(candidate.story_score)||0,cta_score:Number(candidate.cta_score)||0,quote_score:Number(candidate.quote_score)||0,recommended_duration_seconds:Number(candidate.recommended_duration_seconds)||Math.min(45,Math.max(2,end-start)),reason:String(candidate.reason||"AI-selected moment").slice(0,500)}});
    const clipText=segments.filter(s=>s.end>start&&s.start<end).map(s=>s.text).join(" ").trim();await generateRepurposeAssets(clip.id,p.workspaceId,clipText,title);await db("clips",{method:"PATCH",params:{id:"eq."+clip.id},body:{status:"ready",score,start_seconds:start,end_seconds:end,title}});
    await patchJob(p.jobId,{progress:Math.min(98,64+Math.round(((i+1)/Math.max(1,candidates.length))*34)),payload:{...p,transcriptId:transcript.id,transcribeChunk:chunkCount,clipEngine:GEMINI_API_KEY?"gemini":"deterministic"}});
  }
  await setStage(p,"clip_render","completed",100);await setStage(p,"export","completed",100);await patchJob(p.jobId,{status:"completed",progress:100,current_stage:"completed"});await db("projects",{method:"PATCH",params:{id:"eq."+p.projectId},body:{status:"ready"}});if(p.sourceId)await db("project_sources",{method:"PATCH",params:{id:"eq."+p.sourceId},body:{status:"processed"}}).catch(()=>{});console.log("completed",p.jobId)
}catch(e){
  const cancelled=(await db("processing_jobs",{params:{id:"eq."+p.jobId,select:"status"}}).catch(()=>[]))[0]?.status==="cancelled";
  if(cancelled)return;
  console.error("job",p.jobId,e);
  // retryCount represents the attempt currently being processed. Direct /process calls start at 0, so a failure records attempt 1; recovery claims increment before calling processJob, so the same attempt is not double-counted.
  const retryCount=Number(p.retryCount||0)+1;
  const terminal=Boolean(p.sessionId)||p.operation==="render_edit"||retryCount>=5;
  const checkpoint=(await db("processing_jobs",{params:{id:"eq."+p.jobId,select:"payload"}}).catch(()=>[]))[0]?.payload||p;
  await patchJob(p.jobId,{status:terminal?"failed":"queued",error:e.message,payload:{...checkpoint,retryCount}}).catch(()=>{});
  if(p.operation!=="render_edit"&&p.operation!=="ai_chat_plan")await db("projects",{method:"PATCH",params:{id:"eq."+p.projectId},body:{status:terminal?"processing_failed":"processing"}}).catch(()=>{});
   if(terminal&&p.sourceId)await db("project_sources",{method:"PATCH",params:{id:"eq."+p.sourceId},body:{status:"failed"}}).catch(()=>{})}finally{clearInterval(heartbeat);jobDirs.delete(dir);await patchJob(p.jobId,{heartbeat_at:new Date().toISOString(),lease_until:null}).catch(()=>{});await cleanupGeminiFiles(dir);fs.rmSync(dir,{recursive:true,force:true})}}
app.get("/health",(_q,res)=>{res.json({ok:true,service:"alpha-ai-media-worker",version:"2.0",release:process.env.RENDER_GIT_COMMIT?.slice(0,12)||null,transcriptionMode:process.env.TRANSCRIPTION_PROVIDER==="browser"||!GEMINI_API_KEY?"browser":"server",publishingConfigured:Boolean(KEY&&SECRET&&process.env.YOUTUBE_CLIENT_ID&&process.env.YOUTUBE_CLIENT_SECRET),capabilities:["encrypted-credentials","transcript-cuts","server-transcription","streamed-publishing"]});setImmediate(()=>resumeQueuedJobs());});
async function authorize(req){
  if(SECRET&&req.get("x-worker-secret")===SECRET)return {id:req.body?.requestedBy||null,mode:"worker-secret",jobId:req.body?.jobId,workspaceId:req.body?.workspaceId,projectId:req.body?.projectId};
  const ticket=req.get("x-import-ticket")||"";
  if(ticket&&SUPA&&PUBLIC_KEY){
    try{
      const r=await fetch(SUPA+"/rest/v1/rpc/validate_processing_ticket",{method:"POST",headers:{apikey:KEY||PUBLIC_KEY,Authorization:"Bearer "+(KEY||PUBLIC_KEY),"Content-Type":"application/json"},body:JSON.stringify({p_ticket:ticket})});
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
      job=jobId&&workspaceId&&projectId?await db("processing_jobs",{params:{id:"eq."+jobId,select:"*"}}):[];
      if(job?.[0]?.status==="completed")return res.status(200).json({accepted:true,completed:true,jobId});
      if(job?.[0]?.status==="processing"&&job?.[0]?.lease_until&&new Date(job[0].lease_until)>new Date())return res.status(202).json({accepted:true,queued:true,jobId});
    }else{
      const bearer=(req.get("authorization")||"").replace(/^Bearer\s+/i,"");
      job=await authStore.run(bearer,()=>db("processing_jobs",{params:{id:"eq."+req.body?.jobId,select:"*"}}));
    }
    if(!job?.[0]?.id)return res.status(404).json({error:"Processing job not found."});
    if(job[0].workspace_id!==req.body.workspaceId||job[0].project_id!==req.body.projectId)return res.status(403).json({error:"Processing job context mismatch."});
    if(identity.mode==="supabase-jwt"){
      const bearer=(req.get("authorization")||"").replace(/^Bearer\s+/i,"");
      const member=await authStore.run(bearer,()=>db("workspace_members",{params:{workspace_id:"eq."+job[0].workspace_id,user_id:"eq."+identity.id,select:"workspace_id,user_id",limit:"1"}}));
      if(!member?.[0])return res.status(403).json({error:"Workspace access denied."});
    }
    // Canonical jobs come from Supabase, never from an arbitrary /process body.
    const row=job[0],stored=row.payload||{};
    if(!stored.workspaceId){
      const sourceId=stored.sourceId||stored.source_id;
      const source=sourceId?(await db("project_sources",{params:{id:"eq."+sourceId,project_id:"eq."+row.project_id,select:"*"}}))[0]:null;
      await patchJob(row.id,{payload:{...stored,workspaceId:row.workspace_id,projectId:row.project_id,requestedBy:identity.id,
        mediaAssetId:stored.mediaAssetId||stored.media_asset_id,sourceId:source?.id,sourceType:source?.source_type||"upload",url:source?.source_url||null}});
    }
    res.status(202).json({accepted:true,queued:true,jobId:row.id});
    setImmediate(()=>resumeQueuedJobs());
  }catch(e){console.error("authorize/process",e);res.status(500).json({error:e.message||"Worker authorization failed."})}
});
app.post("/assistant/plan",async(req,res)=>{
  try{
    if(!SECRET||req.get("x-worker-secret")!==SECRET)return res.status(401).json({error:"Unauthorized"});
    if(!GEMINI_API_KEY)return res.status(503).json({error:"AI provider is not configured on the media worker."});
    const prompt=String(req.body?.prompt||"").trim();
    if(!prompt)return res.status(400).json({error:"Prompt is required."});
    const transcript=String(req.body?.transcript||"").slice(0,60000);
    const ai=new GoogleGenAI({apiKey:GEMINI_API_KEY});
    const instruction=`You are Alpha.ai's professional short-form video editor. Return ONLY valid JSON.
Schema: {"summary":"string","clips":[{"a":0,"b":0,"title":"string","score":0,"reason":"string","aspect":"9:16","captionStyle":"pop","captionColor":"#00f2fe","hook":"string","zooms":[],"cuts":[],"transitions":"cut","broll":[],"overlays":[]}]}
The transcript is an indexed list where each token is "index:word". Choose 3-6 clips, normally 20-60 seconds, starting with a hook and ending on a complete thought. a/b MUST be transcript word indexes. score is 0-100. Use aspect 9:16, 1:1 or 16:9; captionStyle pop/bold/minimal/none; transitions cut/fade/flash. cuts are [[fromWordIndex,toWordIndex]]. zooms are word indexes. broll is [{"at":wordIndex,"idea":"string"}]. overlays is [{"text":"string","at":wordIndex,"dur":2}].
User request: ${prompt}
Transcript:
${transcript}`;
    const result=await ai.models.generateContent({model:GEMINI_MODEL,contents:instruction});
    const text=String(result.text||"").trim();
    const match=text.match(/\{[\s\S]*\}/);
    if(!match)throw new Error("Gemini returned no clip plan JSON.");
    let plan;try{plan=JSON.parse(match[0])}catch{throw new Error("Gemini returned invalid clip plan JSON.");}
    return res.json({ok:true,plan});
  }catch(e){console.error("assistant/plan",e);return res.status(500).json({error:e.message||"Clip planning failed."})}
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
let recoveryInFlight=false;
async function resumeQueuedJobs(){
  if(recoveryInFlight)return;
  recoveryInFlight=true;
  console.log("job recovery scan started");
  try{
    if(!KEY){console.error("Supabase server-side key is not configured; queued jobs cannot be resumed safely.");return}
    if(activeJobs.size)return;
    const rpcUrl=SUPA+"/rest/v1/rpc/claim_processing_job";const rpcResponse=await fetch(rpcUrl,{method:"POST",headers:baseAuth,body:JSON.stringify({p_worker:"media-worker"})});const claimed=rpcResponse.ok?await rpcResponse.json().catch(()=>[]):null;
    const row=Array.isArray(claimed)?claimed[0]:null;
    if(!row?.id){console.log("job recovery found no claimable job");return}
    const payload=row.payload||{};
    const normalized={...payload,jobId:row.id,workspaceId:row.workspace_id,projectId:row.project_id,sourceId:payload.sourceId||payload.source_id,sourceType:payload.sourceType||payload.source_type,mediaAssetId:payload.mediaAssetId||payload.media_asset_id,driveFileId:payload.driveFileId||payload.drive_file_id,driveAccessToken:payload.driveAccessToken||payload.drive_access_token};
    const retryCount=Number(row.attempt_count||0);
    if(retryCount>=5){await patchJob(row.id,{status:"failed",progress:0,error:"Job exceeded the maximum automatic retry limit (5).",lease_token:null,lease_until:null,payload:{...payload,retryCount}}).catch(()=>{});return}
    await patchJob(row.id,{payload:{...payload,retryCount},heartbeat_at:new Date().toISOString(),lease_until:new Date(Date.now()+120000).toISOString()});
    activeJobs.add(row.id);
    console.log("resuming queued/stale job",row.id,row.status,row.progress,"attempt",retryCount);
    processJob({...normalized,retryCount}).catch(e=>console.error("queued job",row.id,e)).finally(()=>activeJobs.delete(row.id));
  }catch(e){console.warn("queued-job recovery failed:",e.message)}
  finally{recoveryInFlight=false}
}
async function processPublishJobs(){
  if(!KEY)return;
  try{await runPublishQueue({db,supabaseUrl:SUPA,headers:baseAuth,secret:SECRET})}
  catch{console.warn('Publishing queue scan could not finish.')}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  console.log("Supabase server-side key configured:",!!KEY);
  setInterval(processPublishJobs,30000);
  setTimeout(processPublishJobs,10000);
  setTimeout(resumeQueuedJobs,5000);
  setInterval(resumeQueuedJobs,15000);
  app.listen(PORT,()=>console.log("Alpha.ai media worker listening on "+PORT));
}
