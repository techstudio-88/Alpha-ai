"use client";

import React,{useEffect,useMemo,useRef,useState} from "react";
import {ArrowLeft,Check,Download,FileVideo,Film,LoaderCircle,Pause,Play,RefreshCw,Sparkles,Upload,Video,X} from "lucide-react";

const HF_MODEL="Xenova/whisper-tiny.en";
const GEMINI_MODEL="gemini-3.8-flash";
const CDN="https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.2";
const esc=s=>String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));

function sentences(words){
  const out=[];let st=0;
  words.forEach((w,i)=>{
    if(/[.!?]$/.test(w.t)||i===words.length-1||i-st>=28){
      if(i>=st)out.push({a:st,b:i,s:words[st].s,e:w.e,txt:words.slice(st,i+1).map(x=>x.t).join(" ")});
      st=i+1;
    }
  });
  return out;
}
const POWER=/\b(secret|never|always|mistake|why|how|truth|nobody|stop|biggest|worst|best|free|money|life|actually|important|problem|learn)\b/i;

function heuristic(words,min,max){
  const ss=sentences(words),c=[];
  for(let i=0;i<ss.length;i++)for(let j=i;j<ss.length;j++){
    const d=ss[j].e-ss[i].s;if(d>max)break;if(d<min)continue;
    const txt=ss.slice(i,j+1).map(x=>x.txt).join(" ");
    const pace=(ss[j].b-ss[i].a+1)/Math.max(.1,d);
    const power=(txt.match(new RegExp(POWER.source,"gi"))||[]).length;
    const score=40+(/[?]/.test(ss[i].txt)?15:0)+(POWER.test(ss[i].txt)?15:0)+Math.min(15,power*3)+(pace>2&&pace<3.5?10:0)+(/\d/.test(ss[i].txt)?5:0)-Math.abs(d-35)/3;
    c.push({start:ss[i].s,end:ss[j].e,a:ss[i].a,b:ss[j].b,score:Math.round(clamp(score,1,99)),title:ss[i].txt.slice(0,70),reason:"Hook + pacing + keyword score"});
  }
  c.sort((a,b)=>b.score-a.score);
  const picked=[];
  for(const x of c){if(picked.length>=6)break;if(!picked.some(y=>x.start<y.end&&x.end>y.start))picked.push(x)}
  return picked;
}

async function gemini(words,key,min,max){
  const script=words.map((w,i)=>i+":"+w.t).join(" ").slice(0,90000);
  const prompt="Pick up to 6 self-contained short-form clips from this word-indexed transcript. Each clip must be "+min+"-"+max+" seconds, start with a strong hook, and end on a complete thought. Return ONLY a JSON array with objects {a,b,title,score,reason}. a and b are word indexes. Do not invent indexes.\n\n"+script;
  const r=await fetch("https://generativelanguage.googleapis.com/v1beta/models/"+GEMINI_MODEL+":generateContent?key="+encodeURIComponent(key),{
    method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:{responseMimeType:"application/json"}})
  });
  if(!r.ok)throw new Error("Gemini "+r.status);
  const j=await r.json();
  const raw=j?.candidates?.[0]?.content?.parts?.map(p=>p.text||"").join("")||"";
  const parsed=JSON.parse(raw.replace(/^\s*\`\`\`json\s*/,"").replace(/\s*\`\`\`\s*$/,"").trim());
  return (Array.isArray(parsed)?parsed:[]).filter(x=>words[x.a]&&words[x.b]&&x.b>x.a).map(x=>({...x,start:words[x.a].s,end:words[x.b].e})).slice(0,6);
}

async function transcribeFile(file,model,onProgress){
  if(file.size>500*1024*1024)throw new Error("This browser Clip Lab accepts files up to 500 MB.");
  onProgress("Decoding audio…");
  const ctx=new AudioContext({sampleRate:16000});
  try{
    const buffer=await ctx.decodeAudioData(await file.arrayBuffer());
    const audio=buffer.getChannelData(0);
    onProgress("Loading Whisper model…");
    const {pipeline}=await import(CDN);
    const asr=await pipeline("automatic-speech-recognition",model,{
      progress_callback:p=>{if(p.status==="progress")onProgress("Downloading Whisper model "+Math.round(p.progress||0)+"%…")}
    });
    onProgress("Transcribing… keep this tab visible.");
    const r=await asr(audio,{return_timestamps:"word",chunk_length_s:30,stride_length_s:5});
    return (r.chunks||[]).map(c=>({t:String(c.text||"").trim(),s:Number(c.timestamp?.[0]??0),e:Number(c.timestamp?.[1]??((c.timestamp?.[0]??0)+.3))})).filter(x=>x.t&&Number.isFinite(x.s));
  }finally{await ctx.close().catch(()=>{})}
}

function formatTime(s){s=Math.max(0,Math.floor(Number(s)||0));return String(Math.floor(s/60)).padStart(2,"0")+":"+String(s%60).padStart(2,"0")}

export default function ClipLabView({onBack}){
  const [file,setFile]=useState(null),[url,setUrl]=useState(""),[words,setWords]=useState([]),[clips,setClips]=useState([]),[outs,setOuts]=useState([]);
  const [tab,setTab]=useState("import"),[status,setStatus]=useState(""),[busy,setBusy]=useState(false),[rendering,setRendering]=useState(null);
  const [min,setMin]=useState(20),[max,setMax]=useState(60),[key,setKey]=useState(""),[model,setModel]=useState(HF_MODEL);
  const [selected,setSelected]=useState(null),[del,setDel]=useState(new Set()),[preview,setPreview]=useState(false);
  const videoRef=useRef(null),renderVideoRef=useRef(null),canvasRef=useRef(null),fileInput=useRef(null);

  useEffect(()=>()=>{if(url)URL.revokeObjectURL(url);outs.forEach(o=>o.url&&URL.revokeObjectURL(o.url))},[]);
  useEffect(()=>{try{setKey(localStorage.getItem("alpha.cliplab.gemini")||"")}catch{}},[]);
  const saveKey=v=>{setKey(v);try{localStorage.setItem("alpha.cliplab.gemini",v)}catch{}};

  const activeWords=useMemo(()=>words.filter((_,i)=>!del.has(i)),[words,del]);

  const chooseFile=f=>{
    if(!f)return;
    if(url)URL.revokeObjectURL(url);
    setFile(f);setUrl(URL.createObjectURL(f));setWords([]);setClips([]);setOuts([]);setSelected(null);setDel(new Set());setTab("import");setStatus(f.name);
  };

  const detect=async()=>{
    if(!words.length)return;
    setBusy(true);setStatus("Finding clip candidates…");
    try{
      let found;
      if(key.trim())found=await gemini(words,key.trim(),min,max);
      else found=heuristic(words,min,max);
      if(!found.length)found=heuristic(words,min,max);
      setClips(found);setTab("clips");setStatus(found.length+" clip candidates found.");
    }catch(e){
      const found=heuristic(words,min,max);setClips(found);setTab("clips");
      setStatus("Gemini failed ("+(e?.message||"request error")+"). Built-in scoring used instead.");
    }finally{setBusy(false)}
  };

  const run=async()=>{
    if(!file)return setStatus("Choose a video or audio file first.");
    setBusy(true);
    try{
      const w=await transcribeFile(file,model,setStatus);setWords(w);setDel(new Set());
      setStatus("Transcript ready. Finding clips…");
      let found;
      try{found=key.trim()?await gemini(w,key.trim(),min,max):heuristic(w,min,max)}catch(e){found=heuristic(w,min,max);setStatus("AI selection unavailable; built-in scoring selected "+found.length+" clips.")}
      setClips(found);setTab("clips");setStatus("Ready: "+w.length+" words, "+found.length+" clip candidates.");
    }catch(e){setStatus("Pipeline failed: "+(e?.message||"unknown error"))}
    finally{setBusy(false)}
  };

  const previewClip=i=>{
    const c=clips[i];if(!videoRef.current||!url)return;
    setSelected(i);setPreview(true);videoRef.current.src=url;videoRef.current.currentTime=c.start;
    videoRef.current.play().catch(()=>{});
  };

  const renderClip=async i=>{
    if(rendering!==null)return;
    if(!url||!clips[i])return setStatus("Attach the source video before rendering.");
    const c=clips[i],rv=renderVideoRef.current,cv=canvasRef.current;
    setRendering(i);setStatus("Rendering "+formatTime(c.end-c.start)+" clip in real time…");
    try{
      rv.src=url;await new Promise((res,rej)=>{const ok=()=>{rv.removeEventListener("loadedmetadata",ok);res()};rv.addEventListener("loadedmetadata",ok);rv.addEventListener("error",()=>rej(new Error("Video could not be decoded.")),{once:true})});
      rv.currentTime=c.start;await new Promise(r=>{const h=()=>{rv.removeEventListener("seeked",h);r()};rv.addEventListener("seeked",h)});
      const ctx=cv.getContext("2d"),stream=cv.captureStream(30),audio=rv.captureStream?.().getAudioTracks?.()[0];if(audio)stream.addTrack(audio);
      const mime=MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus")?"video/webm;codecs=vp9,opus":"video/webm";
      const rec=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:6000000}),chunks=[];
      rec.ondataavailable=e=>e.data.size&&chunks.push(e.data);
      const done=new Promise(r=>rec.addEventListener("stop",r,{once:true}));
      const ws=words.slice(c.a,c.b+1).filter((_,k)=>!del.has(c.a+k));
      rec.start(250);rv.currentTime=c.start;await rv.play();
      await new Promise(resolve=>{
        const frame=()=>{
          const t=rv.currentTime;
          if(t>=c.end||rv.ended){rv.pause();rec.stop();resolve();return}
          const scale=Math.max(1080/rv.videoWidth,1920/rv.videoHeight),dw=rv.videoWidth*scale,dh=rv.videoHeight*scale;
          ctx.fillStyle="#000";ctx.fillRect(0,0,1080,1920);ctx.drawImage(rv,(1080-dw)/2,(1920-dh)/2,dw,dh);
          let k=ws.findIndex(w=>t>=w.s&&t<=w.e);if(k<0){const n=ws.findIndex(w=>w.s>t);k=n<0?ws.length-1:Math.max(0,n-1)}
          const group=ws.slice(Math.floor(Math.max(0,k)/4)*4,Math.floor(Math.max(0,k)/4)*4+4);
          ctx.font="900 82px system-ui";ctx.textAlign="left";ctx.lineWidth=14;ctx.strokeStyle="#000";ctx.lineJoin="round";
          const widths=group.map(w=>ctx.measureText(w.t.toUpperCase()+" ").width),total=widths.reduce((a,b)=>a+b,0);let px=(1080-total)/2;
          group.forEach((w,n)=>{const on=w===ws[k];const tx=w.t.toUpperCase();ctx.save();if(on){const m=ctx.measureText(tx).width/2;ctx.translate(px+m,1400);ctx.scale(1.1,1.1);ctx.translate(-(px+m),-1400)}ctx.strokeText(tx,px,1400);ctx.fillStyle=on?"#00d9ff":"#fff";ctx.fillText(tx,px,1400);ctx.restore();px+=widths[n]});
          requestAnimationFrame(frame);
        };requestAnimationFrame(frame);
      });
      await done;
      const blob=new Blob(chunks,{type:"video/webm"}),name="alpha-clip-"+(i+1)+".webm";
      setOuts(v=>[{name,title:c.title,url:URL.createObjectURL(blob),blob},...v]);setTab("review");setStatus("Rendered "+name+" successfully.");
    }catch(e){setStatus("Render failed: "+(e?.message||"unknown error"))}
    finally{setRendering(null)}
  };

  const toggleWord=i=>setDel(v=>{const n=new Set(v);n.has(i)?n.delete(i):n.add(i);return n});
  const clearFiller=()=>setDel(v=>{const n=new Set(v);words.forEach((w,i)=>/^(um+|uh+|erm|hmm+)[,.!?]*$/i.test(w.t)&&n.add(i));return n});

  const tabs=[["import","Import",Upload],["clips","Clip Lab",Sparkles],["transcript","Transcript",FileVideo],["review","Review",Film]];
  return <div className="studioScreen">
    <div className="screenHead studioScreenHead">
      <div><div className="eyebrow">BROWSER AI PIPELINE</div><h1>Import → Clip Lab → Review</h1><p className="muted">Run Whisper, clip discovery and caption rendering locally in Chrome. The source video is not uploaded by this lab.</p></div>
      {onBack&&<button className="btn" onClick={onBack}><ArrowLeft size={14}/> Back</button>}
    </div>
    <div className="card" style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:14}}>
      {tabs.map(([id,label,I])=><button key={id} className={"btn "+(tab===id?"primary":"")} onClick={()=>setTab(id)}><I size={14}/>{label}</button>)}
      <span style={{marginLeft:"auto",fontSize:12,alignSelf:"center"}} className="muted">{status}</span>
    </div>

    {tab==="import"&&<div className="studioGrid">
      <section className="card" style={{gridColumn:"1 / -1"}}>
        <div style={{display:"grid",gap:14}}>
          <button type="button" onClick={()=>fileInput.current?.click()} disabled={busy} style={{border:"1px dashed var(--line,#39404a)",borderRadius:16,padding:"42px 18px",background:"transparent",cursor:"pointer"}}>
            <Upload size={34}/><h3 style={{margin:"10px 0 4px"}}>{file?esc(file.name):"Choose a video or audio file"}</h3><p className="muted">Browser processing · maximum 500 MB · Chrome recommended</p>
          </button>
          <input ref={fileInput} hidden type="file" accept="video/*,audio/*" onChange={e=>chooseFile(e.target.files?.[0])}/>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:10}}>
            <label>Whisper model<select className="input" value={model} onChange={e=>setModel(e.target.value)}><option value="Xenova/whisper-tiny.en">Whisper tiny · fast</option><option value="Xenova/whisper-base.en">Whisper base · better accuracy</option></select></label>
            <label>Gemini API key (optional)<input className="input" type="password" value={key} onChange={e=>saveKey(e.target.value)} placeholder="Used only in this browser"/></label>
            <label>Min clip seconds<input className="input" type="number" min="10" max="180" value={min} onChange={e=>setMin(clamp(+e.target.value||20,10,180))}/></label>
            <label>Max clip seconds<input className="input" type="number" min="15" max="300" value={max} onChange={e=>setMax(clamp(+e.target.value||60,15,300))}/></label>
          </div>
          <button className="btn primary" disabled={!file||busy} onClick={run}>{busy?<><LoaderCircle size={15} className="spin"/> Processing…</>:<><Sparkles size={15}/> Transcribe + find clips</>}</button>
          {words.length>0&&<div className="message"><Check size={14}/> {words.length} timestamped words are ready.</div>}
        </div>
      </section>
    </div>}

    {tab==="clips"&&<div className="studioGrid">
      <section className="card" style={{gridColumn:"1 / -1",display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
        <b>{clips.length} candidates</b><span className="muted">· {min}-{max}s</span><button className="btn small" disabled={busy||!words.length} onClick={detect}><RefreshCw size={13}/> Re-detect</button>
        {!file&&<button className="btn small" onClick={()=>setTab("import")}>Attach source</button>}
      </section>
      {clips.length?clips.map((c,i)=><section className="card" key={i}>
        <div style={{display:"flex",justifyContent:"space-between",gap:8}}><b>{esc(c.title)}</b><strong>{c.score}</strong></div>
        <div className="muted" style={{fontFamily:"monospace",fontSize:12,margin:"7px 0"}}>{formatTime(c.start)} → {formatTime(c.end)} · {Math.round(c.end-c.start)}s</div>
        <p className="muted" style={{fontSize:12}}>{esc(c.reason||"")}</p>
        <div style={{display:"flex",gap:8,marginTop:12}}><button className="btn small" onClick={()=>previewClip(i)} disabled={!file}><Play size={13}/> Preview</button><button className="btn primary small" onClick={()=>renderClip(i)} disabled={!file||rendering!==null}>{rendering===i?<><LoaderCircle size={13} className="spin"/> Rendering…</>:<><Video size={13}/> Render 9:16</>}</button></div>
      </section>):<div className="card" style={{gridColumn:"1 / -1"}}><p className="muted">No candidates yet. Import a source and run transcription.</p></div>}
    </div>}

    {tab==="transcript"&&<section className="card">
      {!words.length?<p className="muted">No transcript yet.</p>:<><div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:12}}><button className="btn small" onClick={clearFiller}>Cut fillers</button><button className="btn small" onClick={()=>setDel(new Set())}>Restore all</button><span className="muted" style={{fontSize:12,alignSelf:"center"}}>Tap words to exclude them from rendered clips.</span></div><div style={{lineHeight:2.1,fontSize:14}}>{words.slice(0,5000).map((w,i)=><button key={i} onClick={()=>toggleWord(i)} style={{border:0,background:"transparent",padding:"1px 3px",textDecoration:del.has(i)?"line-through":"none",opacity:del.has(i)?.45:1,cursor:"pointer"}} title={formatTime(w.s)}>{esc(w.t)}</button>)}</div></>}
    </section>}

    {tab==="review"&&<div className="studioGrid">
      {outs.length?outs.map((o,i)=><section className="card" key={i}><video controls playsInline src={o.url} style={{width:"100%",maxHeight:520,background:"#000",borderRadius:12}}/><div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:8,marginTop:10}}><div><b>{esc(o.title)}</b><div className="muted" style={{fontSize:12}}>{o.name}</div></div><a className="btn primary" href={o.url} download={o.name}><Download size={14}/> Download WebM</a></div></section>):<div className="card" style={{gridColumn:"1 / -1"}}><p className="muted">Render a clip from Clip Lab to review it here.</p></div>}
    </div>}

    {preview&&selected!==null&&<div className="modal" onMouseDown={()=>setPreview(false)}><div className="modalCard" onMouseDown={e=>e.stopPropagation()}><button className="close" onClick={()=>setPreview(false)}><X size={16}/></button><div className="eyebrow">SOURCE PREVIEW</div><h3>{esc(clips[selected]?.title)}</h3><video ref={videoRef} controls playsInline style={{width:"100%",maxHeight:"70vh",background:"#000",borderRadius:12}} onTimeUpdate={e=>{if(e.currentTarget.currentTime>=clips[selected]?.end)e.currentTarget.pause()}}/><p className="muted">{formatTime(clips[selected]?.start)} → {formatTime(clips[selected]?.end)}</p></div></div>}
    <video ref={renderVideoRef} muted playsInline style={{display:"none"}}/>
    <canvas ref={canvasRef} width="1080" height="1920" style={{display:"none"}}/>
  </div>;
}
