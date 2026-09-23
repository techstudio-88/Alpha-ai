"use client";

import {useEffect,useMemo,useRef,useState} from "react";
import {Activity,ChevronRight,Clock,Film,Fullscreen,Maximize2,Pause,Play,RotateCcw,Save,Scissors,Volume2,VolumeX,WandSparkles,ZoomIn,ZoomOut} from "lucide-react";

function LiveWaveform({videoRef}){const canvasRef=useRef(null);useEffect(()=>{const v=videoRef.current,c=canvasRef.current;if(!v||!c)return;let ctx,analyser,source,raf;try{const AudioContext=window.AudioContext||window.webkitAudioContext;const ac=new AudioContext();analyser=ac.createAnalyser();analyser.fftSize=128;source=ac.createMediaElementSource(v);source.connect(analyser);analyser.connect(ac.destination);const draw=()=>{const data=new Uint8Array(analyser.frequencyBinCount);analyser.getByteTimeDomainData(data);ctx=c.getContext("2d");ctx.clearRect(0,0,c.width,c.height);ctx.beginPath();for(let i=0;i<data.length;i++){const x=i/(data.length-1)*c.width,y=c.height/2+(data[i]-128)/128*c.height*.42;i?ctx.lineTo(x,y):ctx.moveTo(x,y)}ctx.strokeStyle="#7c5cff";ctx.lineWidth=2;ctx.stroke();raf=requestAnimationFrame(draw)};ctx=c.getContext("2d");draw();return()=>{cancelAnimationFrame(raf);source?.disconnect();analyser?.disconnect();ac.close().catch(()=>{})}}catch{}},[videoRef]);return <canvas className="editorWaveform" ref={canvasRef} width="900" height="72" aria-label="Live audio waveform"/>}

export default function EditorView({projects,supabase,onUpload}){
  const [selectedId,setSelectedId]=useState(projects[0]?.id||"");
  const [asset,setAsset]=useState(null);
  const [sourceUrl,setSourceUrl]=useState("");
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState("");
  const [playing,setPlaying]=useState(false);
  const [current,setCurrent]=useState(0);
  const [duration,setDuration]=useState(0);
  const [inPoint,setInPoint]=useState(0);
  const [outPoint,setOutPoint]=useState(0);
  const [aspect,setAspect]=useState("9:16");
  const [speed,setSpeed]=useState(1);
  const [muted,setMuted]=useState(false);
  const [zoom,setZoom]=useState(1);
  const [saved,setSaved]=useState(false);
  const [aiPrompt,setAiPrompt]=useState("");
  const [segments,setSegments]=useState([]);
  const [transcriptQuery,setTranscriptQuery]=useState("");
  const [editingSegmentId,setEditingSegmentId]=useState("");
  const [editingSegmentText,setEditingSegmentText]=useState("");
  const [segmentBusy,setSegmentBusy]=useState("");
  const [captions,setCaptions]=useState(true);
  const [effect,setEffect]=useState("none");
  const [transition,setTransition]=useState("cut");
  const [timelineHeight,setTimelineHeight]=useState(230);
  const [videoBlockHeight,setVideoBlockHeight]=useState(52);
  const [captionBlockHeight,setCaptionBlockHeight]=useState(52);
  const [videoBlockWidth,setVideoBlockWidth]=useState(100);
  const [captionBlockWidth,setCaptionBlockWidth]=useState(100);
  const [aiStatus,setAiStatus]=useState("");
  const [blockHeight,setBlockHeight]=useState(52);
  const [layoutTemplate,setLayoutTemplate]=useState("vertical-pro");
  const [fullscreenAsk,setFullscreenAsk]=useState(false),[shortcutsOpen,setShortcutsOpen]=useState(false),[splitView,setSplitView]=useState(false),[history,setHistory]=useState([]),[future,setFuture]=useState([]);
  const [rendering,setRendering]=useState(false);
  const [renderMessage,setRenderMessage]=useState("");
  const videoRef=useRef(null); const historyRef=useRef(null);
  const editorRef=useRef(null);

  const project=useMemo(()=>projects.find(p=>p.id===selectedId)||projects[0]||null,[projects,selectedId]);

  const filteredSegments=useMemo(()=>{
    const q=transcriptQuery.trim().toLowerCase();
    return q?segments.filter(s=>String(s.text||"").toLowerCase().includes(q)||String(s.speaker||"").toLowerCase().includes(q)):segments;
  },[segments,transcriptQuery]);
  const saveTranscriptSegment=async id=>{
    const text=editingSegmentText.trim(); if(!text)return;
    setSegmentBusy(id);
    const {error}=await supabase.from("transcript_segments").update({text}).eq("id",id);
    if(!error)setSegments(v=>v.map(s=>s.id===id?{...s,text}:s));
    setSegmentBusy("");setEditingSegmentId("");
  };
  const deleteTranscriptSegment=async id=>{
    setSegmentBusy(id);
    const {error}=await supabase.from("transcript_segments").delete().eq("id",id);
    if(!error)setSegments(v=>v.filter(s=>s.id!==id));
    setSegmentBusy("");
  };

  useEffect(()=>{
    if(project?.id)setSelectedId(project.id);
  },[project?.id]);

  useEffect(()=>{if(typeof window!=="undefined"&&localStorage.getItem("alpha.editor.fullscreen.ask.v1")!=="1")setFullscreenAsk(true)},[]);
  const templates={"vertical-pro":{label:"Vertical Pro",aspect:"9:16",zoom:1},"wide-cinema":{label:"Wide Cinema",aspect:"16:9",zoom:1},"square-social":{label:"Square Social",aspect:"1:1",zoom:1},"vertical-focus":{label:"Vertical Focus",aspect:"9:16",zoom:1.12}};
  const applyTemplate=k=>{const t=templates[k];setLayoutTemplate(k);setAspect(t.aspect);setZoom(t.zoom);setSaved(false)};
  const enterEditorFullscreen=async()=>{if(typeof window!=="undefined")localStorage.setItem("alpha.editor.fullscreen.ask.v1","1");setFullscreenAsk(false);await editorRef.current?.requestFullscreen?.().catch(()=>{})};
  const dismissFullscreenAsk=()=>{if(typeof window!=="undefined")localStorage.setItem("alpha.editor.fullscreen.ask.v1","1");setFullscreenAsk(false)};

  useEffect(()=>{
    let cancelled=false;
    async function load(){
      if(!project?.id||!supabase)return;
      setLoading(true);setError("");setSourceUrl("");setAsset(null);setSegments([]);setCurrent(0);setInPoint(0);setOutPoint(0);
      const {data,error:assetError}=await supabase.from("media_assets").select("id,name,storage_path,mime_type,duration_seconds,status").eq("project_id",project.id).not("storage_path","is",null).order("created_at",{ascending:false}).limit(1).maybeSingle();
      if(cancelled)return;
      if(assetError){setError(assetError.message);setLoading(false);return}
      if(!data?.storage_path){setError("This project has no uploaded media ready for editing.");setLoading(false);return}
      setAsset(data);
      const {data:transcript}=await supabase.from("transcripts").select("id,language,status,created_at").eq("media_asset_id",data.id).order("created_at",{ascending:false}).limit(1).maybeSingle();
      if(transcript?.id){
        const {data:rows}=await supabase.from("transcript_segments").select("id,start_ms,end_ms,text,speaker").eq("transcript_id",transcript.id).order("start_ms",{ascending:true});
        if(!cancelled)setSegments(rows||[]);
      }
      const signed=await supabase.storage.from("media").createSignedUrl(data.storage_path,3600);
      if(cancelled)return;
      if(signed.error||!signed.data?.signedUrl){setError(signed.error?.message||"Could not create a secure video preview.");setLoading(false);return}
      setSourceUrl(signed.data.signedUrl);
      const savedDraft=typeof window!=="undefined"?window.localStorage.getItem("alpha.editor."+project.id):null;
      if(savedDraft){
        try{
          const draft=JSON.parse(savedDraft);
          setInPoint(Math.max(0,Number(draft.inPoint)||0));
          setOutPoint(Math.max(0,Number(draft.outPoint)||0));
          setAspect(draft.aspect||"9:16");
          setSpeed(Number(draft.speed)||1);
          setZoom(Number(draft.zoom)||1);
          setCaptions(draft.captions!==false);
          setEffect(draft.effect||"none");
          setTransition(draft.transition||"cut");
          setTimelineHeight(Number(draft.timelineHeight)||230);
          setVideoBlockHeight(Number(draft.videoBlockHeight)||52);
          setCaptionBlockHeight(Number(draft.captionBlockHeight)||52);
          setVideoBlockWidth(Number(draft.videoBlockWidth)||100);
          setCaptionBlockWidth(Number(draft.captionBlockWidth)||100);
          setLayoutTemplate(draft.layoutTemplate||"vertical-pro");
          setAiPrompt(draft.aiPrompt||"");
        }catch{}
      }
      setLoading(false);
    }
    load();
    return()=>{cancelled=true};
  },[project?.id,supabase]);

  useEffect(()=>{
    const v=videoRef.current;if(!v)return;
    v.playbackRate=speed;v.muted=muted;
  },[speed,muted,sourceUrl]);

  const snapshot=()=>({inPoint,outPoint,effect,transition});
  const remember=()=>{setHistory(v=>[...v,snapshot()].slice(-30));setFuture([])};
  const undo=()=>{setHistory(v=>{if(!v.length)return v;const next=[...v],s=next.pop();setFuture(f=>[snapshot(),...f].slice(0,30));setInPoint(s.inPoint);setOutPoint(s.outPoint);setEffect(s.effect);setTransition(s.transition);return next})};
  const redo=()=>{setFuture(v=>{if(!v.length)return v;const next=[...v],s=next.shift();setHistory(h=>[...h,snapshot()].slice(-30));setInPoint(s.inPoint);setOutPoint(s.outPoint);setEffect(s.effect);setTransition(s.transition);return next})};
  const fmt=s=>{const n=Math.max(0,Number(s)||0);return Math.floor(n/60)+":"+String(Math.floor(n%60)).padStart(2,"0")};
  const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
  const togglePlay=async()=>{
    const v=videoRef.current;if(!v)return;
    if(v.paused){await v.play().catch(()=>{});setPlaying(true)}else{v.pause();setPlaying(false)}
  };
  const seek=e=>{
    const v=videoRef.current;if(!v||!duration)return;
    const t=Number(e.target.value);v.currentTime=t;setCurrent(t);
  };
  const setIn=()=>{
    const t=clamp(current,0,Math.max(0,outPoint||duration));
    setInPoint(t);setSaved(false);
  };
  const setOut=()=>{
    const t=clamp(current,Math.min(inPoint,duration),duration);
    setOutPoint(t);setSaved(false);
  };
  const reset=()=>{
    setInPoint(0);setOutPoint(duration);setAspect("9:16");setSpeed(1);setZoom(1);setSaved(false);
  };
  const saveDraft=()=>{
    if(!project?.id)return;
    const data={inPoint,outPoint:outPoint||duration,aspect,speed,zoom,captions,effect,transition,timelineHeight,videoBlockHeight,captionBlockHeight,videoBlockWidth,captionBlockWidth,layoutTemplate,aiPrompt,updatedAt:new Date().toISOString()};
    window.localStorage.setItem("alpha.editor."+project.id,JSON.stringify(data));
    setSaved(true);
  };
  const jump=(t)=>{
    const v=videoRef.current;if(!v)return;
    const next=clamp(t,0,duration);v.currentTime=next;setCurrent(next);
  };
  const fullscreen=()=>videoRef.current?.requestFullscreen?.();
  const renderSelection=async()=>{
    if(!project?.id||!asset?.id||!sourceUrl||rendering)return;
    setRendering(true);setRenderMessage("Starting render…");setAiStatus("");
    try{
      const {data:{session}}=await supabase.auth.getSession();
      if(!session?.access_token)throw new Error("Authentication expired. Refresh the app and try again.");
      const response=await fetch("/api/editor/render",{method:"POST",headers:{"content-type":"application/json","authorization":"Bearer "+session.access_token},body:JSON.stringify({workspaceId:project.workspace_id,projectId:project.id,mediaAssetId:asset.id,startSeconds:inPoint,endSeconds:outPoint||duration,title:(asset.name||"Edited clip").replace(/\\.[^.]+$/,"")+" — Edit",aspect,speed,zoom,captions,effect,transition,aiPrompt})});
      const result=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(result.error||"Could not start render.");
      const jobId=result.jobId;
      let finished=false;
      for(let i=0;i<90;i++){
        await new Promise(r=>setTimeout(r,2000));
        const {data:job,error}=await supabase.from("processing_jobs").select("status,progress,error,payload").eq("id",jobId).maybeSingle();
        if(error)throw new Error(error.message);
        if(job?.payload?.aiEditStatus==="analyzing")setAiStatus("Gemini is analyzing your edit instruction…");
        if(job?.payload?.aiEditStatus==="fallback")setAiStatus("Gemini could not apply the instruction; the original selection was rendered.");
        if(job?.payload?.aiEditStatus==="applied")setAiStatus("Gemini applied the edit instruction.");
        if(job?.status==="completed"){finished=true;setRenderMessage("Rendered clip is ready in Clip Library.");break}
        if(job?.status==="failed"){throw new Error(job.error||"Render failed.")}
        setRenderMessage("Rendering… "+Math.max(0,Number(job?.progress)||0)+"%");
      }
      if(!finished)throw new Error("Render is taking longer than expected. The job is still running; check Clip Library shortly.");
    }catch(e){setRenderMessage(e.message||"Render failed.")}finally{setRendering(false)}
  };

  return <div ref={editorRef} className="alphaEditor">
    {shortcutsOpen&&<div className="editorFullscreenPrompt"><div className="editorFullscreenCard"><div className="eyebrow">KEYBOARD</div><h3>Editor shortcuts</h3><div className="shortcutList"><span><kbd>Space</kbd> Play / pause</span><span><kbd>J</kbd> Back 5s</span><span><kbd>K</kbd> Play / pause</span><span><kbd>L</kbd> Forward 5s</span><span><kbd>I</kbd> Set in</span><span><kbd>O</kbd> Set out</span><span><kbd>⌘/Ctrl Z</kbd> Undo</span><span><kbd>⌘/Ctrl Y</kbd> Redo</span></div><button className="btn primary" onClick={()=>setShortcutsOpen(false)}>Close</button></div></div>}{fullscreenAsk&&<div className="editorFullscreenPrompt"><div className="editorFullscreenCard"><div className="eyebrow">EDITOR MODE</div><h3>Open the editor full screen?</h3><p>Alpha.ai can use the whole window for a Premiere-style editing workspace. You can still leave it full screen any time.</p><div><button className="btn" onClick={dismissFullscreenAsk}>Not now</button><button className="btn primary" onClick={enterEditorFullscreen}>Yes, full screen</button></div></div></div>}
    <div className="editorTopBar">
      <div className="editorTitleBlock">
        <div className="eyebrow">ALPHA.AI EDITOR</div>
        <h2>{project?.name||"Choose a project"}</h2>
        <span>{asset?.name||"Select a project with uploaded media"}</span>
      </div>
      <div className="editorTopActions"><button className="btn" onClick={undo} disabled={!history.length}><Undo2 size={15}/></button><button className="btn" onClick={redo} disabled={!future.length}><Redo2 size={15}/></button><button className="btn" onClick={()=>setShortcutsOpen(true)}><Keyboard size={15}/> Shortcuts</button>
        <button className="btn" onClick={reset}><RotateCcw size={15}/> Reset</button>
        <button className="btn" onClick={renderSelection} disabled={!project||!sourceUrl||rendering}><Film size={15}/>{rendering?"Rendering…":"Render clip"}</button><button className="btn primary" onClick={saveDraft} disabled={!project||!sourceUrl}><Save size={15}/>{saved?"Saved":"Save draft"}</button>
      </div>
    </div>

    {renderMessage&&<div className="editorRenderStatus">{renderMessage}</div>}<div className="editorWorkspace">
      <aside className="editorProjectRail">
        <div className="editorRailHead"><b>Projects</b><span>{projects.length}</span></div>
        <div className="editorProjectList">
          {projects.map(p=><button key={p.id} className={"editorProject "+(p.id===project?.id?"active":"")} onClick={()=>setSelectedId(p.id)}>
            <span className="editorProjectIcon"><Film size={16}/></span>
            <span><b>{p.name}</b><small>{p.status||"draft"}</small></span>
            <ChevronRight size={14}/>
          </button>)}
        </div>
        <button className="btn editorAddProject" onClick={onUpload}><Scissors size={15}/> New source</button>
      </aside>

      <main className="editorMain">
        <div className="editorCanvasPanel">
          <div className="editorCanvasToolbar">
            <div className="editorToolGroup">
              <span className="editorModeLabel"><Scissors size={15}/> Edit</span>
            </div>
            <div className="editorToolGroup">
              {["9:16","16:9","1:1"].map(x=><button key={x} className={"editorTool "+(aspect===x?"active":"")} onClick={()=>{setAspect(x);setSaved(false)}}>{x}</button>)}
              <button className="editorTool" onClick={()=>setZoom(z=>clamp(z-.1,.8,1.4))}><ZoomOut size={15}/></button>
              <span className="editorZoom">{Math.round(zoom*100)}%</span>
              <button className="editorTool" onClick={()=>setZoom(z=>clamp(z+.1,.8,1.4))}><ZoomIn size={15}/></button>
            </div>
          </div>

          <div className={"editorStage aspect-"+aspect.replace(":","x")+" "+(splitView?"splitView":"")}>
            {loading?<div className="editorEmpty"><Activity className="spin" size={24}/><b>Loading source media…</b></div>
            :sourceUrl?<video ref={videoRef} className="editorVideo" src={sourceUrl} style={{transform:"scale("+zoom+")"}} playsInline onLoadedMetadata={e=>{const d=e.currentTarget.duration||Number(asset?.duration_seconds)||0;setDuration(d);setOutPoint(prev=>prev>0?Math.min(prev,d):d)}} onTimeUpdate={e=>{const t=e.currentTarget.currentTime;setCurrent(t);if(outPoint>0&&t>=outPoint){e.currentTarget.pause();e.currentTarget.currentTime=inPoint;setPlaying(false)}}} onPlay={()=>setPlaying(true)} onPause={()=>setPlaying(false)} onError={()=>setError("The source video could not be decoded by the browser.")}/>
            :<div className="editorEmpty"><Film size={28}/><b>{error||"Select a project with ready media"}</b><span>Upload or import a video first.</span>{!projects.length&&<button className="btn primary" onClick={onUpload}>Add source video</button>}</div>}
            {sourceUrl&&<div className="editorStageBadge">{aspect} · {fmt(current)} / {fmt(duration)}</div>}
          </div>

          <div className="editorPlayback">
            <button className="editorRound" onClick={()=>jump(Math.max(0,current-5))}>−5</button>
            <button className="editorPlay" onClick={togglePlay} disabled={!sourceUrl}>{playing?<Pause size={18}/>:<Play size={18}/>}</button>
            <button className="editorRound" onClick={()=>jump(Math.min(duration,current+5))}>+5</button>
            <span className="editorTime">{fmt(current)} / {fmt(duration)}</span>
            <button className="editorTool" onClick={()=>setMuted(v=>!v)}>{muted?<VolumeX size={16}/>:<Volume2 size={16}/>}</button>
            <select className="editorSelect" value={speed} onChange={e=>setSpeed(Number(e.target.value))}>{[.5,.75,1,1.25,1.5,2].map(x=><option key={x} value={x}>{x}×</option>)}</select>
            <button className={"editorTool "+(splitView?"active":"")} onClick={()=>setSplitView(v=>!v)}><SplitSquareHorizontal size={16}/></button><button className="editorTool" onClick={fullscreen}><Fullscreen size={16}/></button>
          </div>
        </div>

        <section className="editorTranscriptPanel">
          <div className="editorTranscriptHead"><div><b>Transcript</b><span>{segments.length} segments</span></div><div className="editorTranscriptSearch"><Search size={14}/><input value={transcriptQuery} onChange={e=>setTranscriptQuery(e.target.value)} placeholder="Search transcript…"/></div></div>
          <div className="editorTranscriptList">{filteredSegments.length?filteredSegments.map(s=>editingSegmentId===s.id?<div className="editorTranscriptRow editing" key={s.id}><button className="editorTranscriptTime" onClick={()=>jump(s.start_ms/1000)}>{fmt(s.start_ms/1000)}</button><textarea value={editingSegmentText} onChange={e=>setEditingSegmentText(e.target.value)} autoFocus/><div className="editorTranscriptActions"><button className="btn small primary" disabled={segmentBusy===s.id} onClick={()=>saveTranscriptSegment(s.id)}>Save</button><button className="btn small" onClick={()=>setEditingSegmentId("")}>Cancel</button></div></div>:<div className="editorTranscriptRow" key={s.id}><button className="editorTranscriptTime" onClick={()=>jump(s.start_ms/1000)}>{fmt(s.start_ms/1000)}</button><div className="editorTranscriptText"><b>{s.speaker||"Speaker"}</b><span>{s.text}</span></div><div className="editorTranscriptActions"><button className="outlineBtn" onClick={()=>{setEditingSegmentId(s.id);setEditingSegmentText(s.text||"")}}>Edit</button><button className="outlineBtn" disabled={segmentBusy===s.id} onClick={()=>deleteTranscriptSegment(s.id)}>Delete</button></div></div>):<div className="emptyModule">No transcript segments match your search.</div>}</div>
        </section>

        <section className="editorTimelinePanel" style={{height:timelineHeight}}>
          <div className="editorControlsStrip"><div><label>Timeline height</label><input type="range" min="170" max="520" value={timelineHeight} onChange={e=>setTimelineHeight(Number(e.target.value))}/><b>{timelineHeight}px</b></div><div><label>Video block</label><input type="range" min="36" max="120" value={videoBlockHeight} onChange={e=>setVideoBlockHeight(Number(e.target.value))}/><input aria-label="Video block width" type="range" min="60" max="100" value={videoBlockWidth} onChange={e=>setVideoBlockWidth(Number(e.target.value))}/></div><div><label>Caption block</label><input type="range" min="36" max="120" value={captionBlockHeight} onChange={e=>setCaptionBlockHeight(Number(e.target.value))}/><input aria-label="Caption block width" type="range" min="60" max="100" value={captionBlockWidth} onChange={e=>setCaptionBlockWidth(Number(e.target.value))}/></div></div>
          <div className="editorTimelineHeader"><div><b>Timeline</b><span>{fmt(Math.max(0,outPoint-inPoint))} selected</span></div><div><button className="btn small" onClick={setIn}>Set in</button><button className="btn small" onClick={setOut}>Set out</button></div></div>
          <div className="editorWaveformWrap"><LiveWaveform videoRef={videoRef}/></div><div className="editorScrubber">
            <input aria-label="Video position" type="range" min="0" max={Math.max(duration,.01)} step=".01" value={Math.min(current,duration)} onChange={seek}/>
            <div className="editorRangeTrack">
              <span style={{left:(duration?inPoint/duration*100:0)+"%",right:(duration?100-outPoint/duration*100:0)+"%"}}/>
              <i style={{left:(duration?current/duration*100:0)+"%"}}/>
            </div>
          </div>
          <div className="editorTrack">
            <div className="editorTrackLabel"><Film size={14}/><span>Video</span></div>
            <div className="editorTrackBody"><span className="editorClipBlock" style={{left:(duration?inPoint/duration*100:0)+"%",width:(duration?Math.min(videoBlockWidth,Math.max(0,(outPoint-inPoint)/duration*100)):100)+"%",minHeight:videoBlockHeight+"px"}}><b>{asset?.name||"Source video"}</b><small>{fmt(inPoint)} — {fmt(outPoint||duration)}</small></span></div>
          </div>
          <div className="editorTrack">
            <div className="editorTrackLabel"><span className="editorCaptionDot"/>Captions</div>
            <div className="editorTrackBody editorCaptionTrack">{segments.length?segments.map(s=><button key={s.id} className="editorCaptionSegment" style={{minHeight:captionBlockHeight+"px",left:(duration?Math.max(0,s.start_ms/1000)/duration*100:0)+"%",width:(duration?Math.min(captionBlockWidth,Math.max(.5,(s.end_ms-s.start_ms)/1000)/duration*100):captionBlockWidth)+"%"}} onClick={()=>jump(s.start_ms/1000)} title={s.text}><span>{s.speaker?`${s.speaker}: `:""}{s.text}</span></button>):<span>No transcript segments are available for this source yet.</span>}</div>
          </div>
        </section>
      </main>

      <aside className="editorInspector">
        <div className="editorInspectorHead"><b>Inspector</b><span>{project?.status||"draft"}</span></div>
        <div className="inspectorSection"><label>Trim</label><div className="inspectorInputs"><div><small>IN</small><input type="number" min="0" max={duration} step=".1" value={inPoint.toFixed(1)} onChange={e=>setInPoint(clamp(Number(e.target.value)||0,0,outPoint||duration))}/></div><div><small>OUT</small><input type="number" min={inPoint} max={duration} step=".1" value={(outPoint||duration).toFixed(1)} onChange={e=>setOutPoint(clamp(Number(e.target.value)||duration,inPoint,duration))}/></div></div></div>
        <div className="inspectorSection"><label>Layout templates</label><div className="editorTemplateGrid">{Object.entries(templates).map(([k,t])=><button key={k} className={layoutTemplate===k?"selected":""} onClick={()=>applyTemplate(k)}>{t.label}<small>{t.aspect}</small></button>)}</div></div><div className="inspectorSection"><label>Effects</label><select className="editorSelect wide" value={effect} onChange={e=>{remember();setEffect(e.target.value)}}><option value="none">None</option><option value="cinematic">Cinematic</option><option value="warm">Warm</option><option value="cool">Cool</option><option value="mono">Monochrome</option><option value="vibrant">Vibrant</option></select></div><div className="inspectorSection"><label>Transitions</label><select className="editorSelect wide" value={transition} onChange={e=>{remember();setTransition(e.target.value)}}><option value="cut">Hard cut</option><option value="fade">Fade</option><option value="dip">Dip to black</option><option value="zoom">Zoom</option></select></div><div className="inspectorSection"><label>Canvas</label><div className="inspectorChoiceGrid">{["9:16","16:9","1:1"].map(x=><button key={x} className={aspect===x?"selected":""} onClick={()=>setAspect(x)}>{x}</button>)}</div></div>
        <div className="inspectorSection"><label>Export captions</label><button className={"editorToggle "+(captions?"on":"")} onClick={()=>setCaptions(v=>!v)}>{captions?"Captions ON":"Captions OFF"}</button></div><div className="inspectorSection"><label>AI edit prompt</label><textarea value={aiPrompt} onChange={e=>setAiPrompt(e.target.value)} placeholder="Describe an edit for this source…"/><button className="btn small primary" disabled={!aiPrompt.trim()||rendering} onClick={()=>{setAiStatus("Instruction ready for Gemini on the next render.");setSaved(false)}}><WandSparkles size={14}/> Apply instruction</button></div>
        <div className="inspectorSection"><label>AI status</label><div className="aiEditStatus">{aiStatus||"Ready"}</div></div><div className="inspectorSection"><label>Selection</label><div className="inspectorStats"><span><Clock size={14}/> Start <b>{fmt(inPoint)}</b></span><span><Clock size={14}/> End <b>{fmt(outPoint||duration)}</b></span><span><Maximize2 size={14}/> Canvas <b>{aspect}</b></span></div></div>
      </aside>
    </div>
  </div>;
}
