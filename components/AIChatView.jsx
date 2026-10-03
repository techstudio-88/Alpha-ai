"use client";
import {useCallback,useEffect,useRef,useState} from "react";
import {ArrowUp,CalendarClock,ChevronRight,FileVideo,History,Link,LoaderCircle,MessageSquare,Paperclip,Plus,RefreshCw,Scissors,Sparkles,X} from "lucide-react";
import {Upload} from "tus-js-client";
import {allPages} from "../lib/video-workflow.mjs";

const activeStatuses=["queued","processing","awaiting_transcription","transcribing"];
const time=value=>{const n=Math.max(0,Number(value)||0);return `${Math.floor(n/60)}:${String(Math.floor(n%60)).padStart(2,"0")}`};
function check(result){if(result.error)throw new Error(result.error.message);return result.data}

function JobStatus({job,onRetry}){
  const active=activeStatuses.includes(job.status);
  return <div className={"chatJob "+(job.status==="failed"?"chatJobFailed":"")} aria-live="polite">
    <div>{active&&<LoaderCircle size={14} className="chatSpin"/>}<b>{job.status==="completed"?(job.payload?.operation==="render_edit"?"Render complete":"Plan saved"):
      job.status==="awaiting_transcription"?"Waiting for browser Whisper":job.status==="transcribing"?"Transcribing audio":job.status==="failed"?"Processing failed":String(job.current_stage||job.status).replaceAll("_"," ")}</b><span>{Number(job.progress)||0}%</span></div>
    <progress max="100" value={Number(job.progress)||0}/>
    {job.payload?.analysisWindows>0&&<small>Transcript window {job.payload.analysisWindow} of {job.payload.analysisWindows}</small>}
    {["awaiting_transcription","transcribing"].includes(job.status)&&<small>Keep Alpha.ai open. Whisper runs on this device and saves each audio chunk to Supabase.</small>}
    {job.error&&<p>{job.error}</p>}
    {job.status==="failed"&&<button className="btn small" onClick={()=>onRetry(job)}><RefreshCw size={13}/> Retry job</button>}
    {job.status==="queued"&&<button className="btn small" onClick={()=>onRetry(job)}><RefreshCw size={13}/> Wake worker</button>}
  </div>
}
function ClipResult({clip,job,supabase,onEdit,onRetry}){
  const [src,setSrc]=useState(""),[error,setError]=useState("");
  const version=(clip.clip_versions||[]).filter(v=>v.render_status==="ready"&&v.storage_path).sort((a,b)=>b.version-a.version)[0];
  const path=version?.storage_path;
  useEffect(()=>{
    let alive=true;
    async function sign(){setError("");if(!path){setSrc("");return}try{const data=check(await supabase.storage.from("media").createSignedUrl(path,3600));if(alive)setSrc(data.signedUrl)}catch(e){if(alive)setError(e.message)}}
    sign();const timer=setInterval(sign,3000000);return()=>{alive=false;clearInterval(timer)};
  },[path,supabase]);
  const open=()=>window.dispatchEvent(new CustomEvent("alpha:open-editor",{detail:clip}));
  return <article className="chatClipResult">
    {src?<video src={src} controls playsInline preload="metadata" onError={()=>setError("The rendered media could not be loaded. Refresh to renew its signed URL.")}/>:<button className="chatClipPending" onClick={open}><FileVideo size={30}/><span>{job?.status==="failed"?"Render needs attention":"Clip output pending"}</span></button>}
    <div className="chatClipBody"><button className="chatClipTitle" onClick={open}>{clip.title}<ChevronRight size={16}/></button>
      <small>Source {time(clip.start_seconds)} – {time(clip.end_seconds)} · {Number((clip.end_seconds-clip.start_seconds)/(clip.ai_spec?.speed||1)).toFixed(1)}s{version?` · Render v${version.version}`:""}</small>
      {clip.ai_spec?.reason&&<p>{clip.ai_spec.reason}</p>}
      {error&&<p role="alert">{error}</p>}
      {job&&<JobStatus job={job} onRetry={onRetry}/>}
      {src&&job&&job.status!=="completed"&&<small>Preview shows the last successful render.</small>}
      <div className="chatClipActions"><button className="btn small primary" onClick={open}><Scissors size={13}/> Open editor</button><button className="btn small" onClick={()=>onEdit(clip)} disabled={job&&activeStatuses.includes(job.status)}><Sparkles size={13}/> Edit with AI</button>{src&&<button className="btn small" title="Schedule clip" onClick={()=>window.dispatchEvent(new CustomEvent("alpha:schedule",{detail:clip}))}><CalendarClock size={13}/></button>}</div>
    </div>
  </article>
}

export default function AIChatView({workspace,supabase,onNavigate}){
  const [sessions,setSessions]=useState([]),[sessionId,setSessionId]=useState(""),[messages,setMessages]=useState([]),[assets,setAssets]=useState([]),[assetId,setAssetId]=useState(""),[source,setSource]=useState(null),[clips,setClips]=useState([]),[jobs,setJobs]=useState([]);
  const [input,setInput]=useState(""),[url,setUrl]=useState(""),[showLink,setShowLink]=useState(false),[showHistory,setShowHistory]=useState(false),[editing,setEditing]=useState(null),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState(""),[notice,setNotice]=useState(""),[uploadProgress,setUploadProgress]=useState(null),[paused,setPaused]=useState(false);
  const [dragging,setDragging]=useState(false);
  const textarea=useRef(null),bottom=useRef(null),uploader=useRef(null),requestId=useRef(null),refreshRef=useRef(null),stopUpload=useRef(null);
  const asset=assets.find(a=>a.id===assetId);
  const pending=jobs.some(j=>activeStatuses.includes(j.status));
  const locked=busy||pending;
  const token=useCallback(async()=>{
    let {data}=await supabase.auth.getSession();
    if(data.session?.expires_at*1000<Date.now()+60000)data=(await supabase.auth.refreshSession()).data;
    if(!data.session?.access_token)throw new Error("Your session expired. Sign in again.");return data.session.access_token;
  },[supabase]);
  async function api(path,body){const response=await fetch(path,{method:"POST",headers:{"content-type":"application/json",authorization:"Bearer "+await token()},body:JSON.stringify(body)});const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.error||`Request failed (${response.status})`);return data}
  function chooseSession(id){setSessionId(id);setMessages([]);setJobs([]);setClips([]);setAssetId("");setSource(null);setEditing(null);setError("");setNotice("");requestId.current=null;setShowHistory(false);localStorage.setItem("alpha.chat."+workspace.id,id)}
  useEffect(()=>{const saved=localStorage.getItem("alpha.chat."+workspace.id)||"";setSessionId(saved)},[workspace.id]);
  useEffect(()=>{
    let alive=true,running=false;
    async function refresh(){
      if(running)return;running=true;
      try{
        const session=check(await supabase.auth.getSession())?.session;
        const [history,media]=await Promise.all([
          supabase.from("ai_chat_sessions").select("*").eq("workspace_id",workspace.id).eq("user_id",session?.user.id).order("updated_at",{ascending:false}).limit(100),
          supabase.from("media_assets").select("id,name,status,project_id,duration_seconds,storage_path,projects!inner(workspace_id)").eq("projects.workspace_id",workspace.id).order("created_at",{ascending:false}).limit(150)
        ]);
        const h=check(history),a=check(media);
        let m=[],j=[],c=[];
        if(sessionId){
          m=await allPages(async(offset,size)=>check(await supabase.from("ai_chat_messages").select("*").eq("session_id",sessionId).eq("workspace_id",workspace.id).order("created_at").order("id").range(offset,offset+size-1)));
          j=await allPages(async(offset,size)=>check(await supabase.from("processing_jobs").select("id,status,progress,current_stage,error,payload,created_at,updated_at").eq("workspace_id",workspace.id).eq("payload->>sessionId",sessionId).order("created_at").order("id").range(offset,offset+size-1)));
          const ids=[...new Set(m.flatMap(x=>x.metadata?.clipIds||[]))];
          for(let i=0;i<ids.length;i+=50)c.push(...check(await supabase.from("clips").select("*,clip_versions(id,version,render_status,storage_path,edit_data)").in("id",ids.slice(i,i+50))));
        }
        if(!alive)return;
        setSessions(h);setAssets(a);setMessages(m);setJobs(j);setClips(c);
        const current=h.find(s=>s.id===sessionId);
        if(current?.media_asset_id)setAssetId(v=>v||current.media_asset_id);
        const attached=m.filter(x=>x.metadata?.sourceId).at(-1);
        if(attached)setSource(v=>v||{id:attached.metadata.sourceId,project_id:attached.metadata.projectId});
      }catch(e){if(alive)setError(e.message)}finally{running=false;if(alive)setLoading(false)}
    }
    refreshRef.current=refresh;refresh();const timer=setInterval(refresh,3000);
    return()=>{alive=false;clearInterval(timer)};
  },[workspace.id,sessionId,supabase]);
  useEffect(()=>{bottom.current?.scrollIntoView({block:"end",behavior:"smooth"})},[messages.length]);
  useEffect(()=>()=>{uploader.current?.abort();stopUpload.current?.()},[]);

  async function attach(file){
    if(locked)return;
    setBusy(true);setError("");setNotice("");
    const sid=sessionId||crypto.randomUUID();
    try{
      const data=await api("/api/ai/chat/source",{workspaceId:workspace.id,sessionId:sid,...(file?{name:file.name,size:file.size,mimeType:file.type}:{url,name:"Linked video"})});
      if(!sessionId)chooseSession(sid);
      setSource(data.source);setEditing(null);setAssetId(data.asset?.id||"");
      if(file){
        setAssets(v=>[data.asset,...v]);setUploadProgress(0);
        const accessToken=await token();
        await new Promise((resolve,reject)=>{
          stopUpload.current=()=>reject(new Error("Upload stopped before completion. Reattach the file to upload it."));
          const upload=new Upload(file,{
            endpoint:process.env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/$/,"")+"/storage/v1/upload/resumable",
            headers:{authorization:"Bearer "+accessToken,apikey:process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY||process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY},
            onBeforeRequest:async request=>request.setHeader("authorization","Bearer "+await token()),
            chunkSize:6*1024*1024,retryDelays:[0,3000,5000,10000,20000],uploadDataDuringCreation:true,removeFingerprintOnSuccess:true,
            metadata:{bucketName:"media",objectName:data.asset.storage_path,contentType:data.asset.mime_type,cacheControl:"3600"},
            onProgress:(bytes,total)=>setUploadProgress(Math.round(bytes/total*100)),onError:reject,onSuccess:resolve
          });uploader.current=upload;
          upload.findPreviousUploads().then(previous=>{if(previous.length)upload.resumeFromPreviousUpload(previous[0]);upload.start()}).catch(reject);
        });
        check(await supabase.from("media_assets").update({status:"uploaded"}).eq("id",data.asset.id));
        check(await supabase.from("project_sources").update({status:"queued"}).eq("id",data.source.id));
        check(await supabase.from("ai_chat_messages").insert({session_id:sid,workspace_id:workspace.id,user_id:(await supabase.auth.getUser()).data.user.id,
          role:"system",content:`${file.name} uploaded. Send your instructions to transcribe and create clips.`,metadata:{mediaAssetId:data.asset.id}}));
        setAssets(v=>v.map(a=>a.id===data.asset.id?{...a,status:"uploaded"}:a));
      }
      setNotice(file?"Upload complete. Describe the clips you want below.":"URL attached. Describe what to make; the worker will download and analyze the video.");setShowLink(false);setUrl("");
      await refreshRef.current?.();
    }catch(e){setError(e.message)}finally{setBusy(false);setUploadProgress(null);setPaused(false);uploader.current=null;stopUpload.current=null}
  }
  async function send(){
    if(locked||!input.trim())return;
    if(!asset&&!source)return setError("Upload a video, attach a URL, or select an existing source first.");
    setBusy(true);setError("");setNotice("");
    const sid=sessionId||crypto.randomUUID();
    requestId.current=requestId.current||crypto.randomUUID();
    try{
      const result=await api("/api/ai/chat/plan",{workspaceId:workspace.id,projectId:asset?.project_id||source.project_id,
        mediaAssetId:assetId||null,sourceId:asset?null:source?.id||null,sessionId:sid,requestId:requestId.current,prompt:input.trim(),clipId:editing?.id||null});
      if(!sessionId){setSessionId(sid);localStorage.setItem("alpha.chat."+workspace.id,sid)}
      setInput("");requestId.current=null;setEditing(null);setNotice(result.warning||"Instruction saved. The processing queue will update here.");
      setJobs(v=>[...v,{id:result.jobId,status:"queued",progress:0,payload:{}}]);await refreshRef.current?.();
    }catch(e){setError(e.message)}finally{setBusy(false)}
  }
  async function retry(job){try{const result=await api(job.status==="queued"?"/api/processing-status":"/api/ai/chat/retry",{workspaceId:workspace.id,jobId:job.id});setNotice(result.warning||"Worker notified; the job remains in the processing queue.");await refreshRef.current?.()}catch(e){setError(e.message)}}
  const newChat=()=>{if(!busy){chooseSession("");setInput("")}};
  const edit=clip=>{setEditing(clip);setAssetId(clip.media_asset_id);textarea.current?.focus()};
  return <div className={"alphaChatWorkspace "+(dragging?"chatDragTarget":"")} onDragEnter={e=>{e.stopPropagation();if(e.dataTransfer.types.includes("Files")&&!locked)setDragging(true)}} onDragOver={e=>{e.preventDefault();e.stopPropagation()}} onDragLeave={e=>{if(!e.currentTarget.contains(e.relatedTarget))setDragging(false)}} onDrop={e=>{e.preventDefault();e.stopPropagation();setDragging(false);const file=e.dataTransfer.files?.[0];if(file&&!locked)attach(file)}}>
    <aside className={"chatHistory "+(showHistory?"chatHistoryOpen":"")} aria-label="AI chat history">
      <div className="chatHistoryHeading"><MessageSquare size={17}/><b>Your conversations</b></div>
      <button className="btn primary" onClick={newChat} disabled={busy}><Plus size={16}/> New chat</button>
      <div className="chatHistoryList">{sessions.map(s=><button className={s.id===sessionId?"active":""} key={s.id} onClick={()=>chooseSession(s.id)} disabled={busy}><MessageSquare size={14}/><span>{s.title}<small>{new Date(s.updated_at).toLocaleDateString()}</small></span></button>)}{!sessions.length&&!loading&&<p className="muted">Your saved video conversations will appear here.</p>}</div>
      <small>Conversations, instructions and results are saved to your Alpha.ai workspace.</small>
    </aside>
    <section className="chatMain">
      <header className="chatHeader"><div><span className="eyebrow">ALPHA.AI · VIDEO WORKSPACE</span><h1>{editing?"Refine your clip":"Create through conversation"}</h1></div><div><button className="btn small chatHistoryToggle" onClick={()=>setShowHistory(v=>!v)} aria-label="Toggle chat history"><History size={16}/></button><button className="btn small" onClick={()=>onNavigate?.("clips")}><Scissors size={15}/> Clips</button></div></header>
      <div className="chatMessages" aria-label="Conversation">
        {!messages.length&&<div className="chatWelcome"><div className="chatOrb"><Sparkles size={32}/></div><h2>One video. What should we make?</h2><p>Bring a long-form video. Alpha reads its real transcript, plans with Gemini, and renders your clips with FFmpeg.</p><div className="chatStarters">{["Find 3 insightful clips, 30–45 seconds each","Create a short with the strongest opening hook","Find a complete, useful answer and add bold captions"].map(text=><button key={text} onClick={()=>{setInput(text);textarea.current?.focus()}}>{text}<ChevronRight size={14}/></button>)}</div></div>}
        {messages.map(m=><div className={"chatMessage chatMessage-"+m.role} key={m.id}><div className="chatMessageAuthor">{m.role==="user"?"You":m.role==="system"?"Source":"Alpha"}</div><div className="chatMessageText">{m.content}</div>
          {m.metadata?.jobId&&jobs.filter(j=>j.id===m.metadata.jobId).map(j=><JobStatus key={j.id} job={j} onRetry={retry}/>)}
          {m.metadata?.clipIds?.length>0&&<div className="chatResults">{m.metadata.clipIds.map(id=>{const clip=clips.find(c=>c.id===id);const job=jobs.filter(j=>j.payload?.clipId===id&&j.payload.operation==="render_edit").at(-1);return clip?<ClipResult key={id} clip={clip} job={job} supabase={supabase} onEdit={edit} onRetry={retry}/>:<p key={id}>This clip is no longer available in the workspace.</p>})}</div>}
        </div>)}<div ref={bottom}/>
      </div>
      <div className="chatComposerWrap">
        {error&&<div className="chatError" role="alert">{error}<button onClick={()=>setError("")} aria-label="Dismiss error"><X size={14}/></button></div>}
        {notice&&<p className="chatNotice" role="status">{notice}</p>}
        {uploadProgress!==null&&<div className="chatJob"><div><b>{paused?"Upload paused":"Uploading video"}</b><span>{uploadProgress}%</span></div><progress max="100" value={uploadProgress}/><button className="btn small" onClick={()=>{if(paused)uploader.current?.start();else uploader.current?.abort();setPaused(!paused)}}>{paused?"Resume":"Pause"}</button></div>}
        {editing&&<div className="chatEditing"><Scissors size={14}/><span>Editing: {editing.title} · {time(editing.start_seconds)}–{time(editing.end_seconds)}</span><button aria-label="Stop editing this clip" onClick={()=>setEditing(null)}><X size={14}/></button></div>}
        <div className="chatSourceRow"><FileVideo size={16}/><select value={assetId} onChange={e=>{setAssetId(e.target.value);setSource(null);setEditing(null)}} disabled={locked} aria-label="Source video"><option value="">{source?"Attached URL — ready to import":"Choose an existing video or attach one…"}</option>{assets.map(a=><option key={a.id} value={a.id}>{a.name}{a.duration_seconds?` · ${time(a.duration_seconds)}`:""}{a.status==="uploading"?" · upload incomplete":""}</option>)}</select></div>
        {showLink&&<form className="chatLinkInput" onSubmit={e=>{e.preventDefault();attach(null)}}><input type="url" required value={url} onChange={e=>setUrl(e.target.value)} placeholder="https://youtube.com/watch?v=… or a video/source URL" aria-label="Video URL"/><button className="btn small" disabled={locked||!url}>Attach URL</button></form>}
        <div className="chatComposer"><textarea ref={textarea} value={input} onChange={e=>{setInput(e.target.value);requestId.current=null}} rows={3} maxLength={6000} placeholder={editing?"Try: trim the opening, speed up to 1.2x, use square format and yellow bold captions…":"Describe the moments, duration and style you want…"} onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();send()}}}/>
          <div className="chatComposerActions"><div><label className={"btn small "+(locked?"chatDisabled":"")} title="Upload video"><Paperclip size={16}/><span>Video</span><input hidden type="file" accept="video/*,.mkv,.avi" disabled={locked} onChange={e=>{const file=e.target.files?.[0];e.target.value="";if(file)attach(file)}}/></label><button className="btn small" onClick={()=>setShowLink(v=>!v)} disabled={locked}><Link size={15}/> URL</button></div><button className="btn primary" onClick={send} disabled={locked||!input.trim()} aria-label="Send instruction">{locked?<LoaderCircle size={18} className="chatSpin"/>:<ArrowUp size={18}/>}</button></div>
        </div><small className="chatComposerHint">{pending?"Processing continues in this saved conversation. You can open another chat.":"YouTube · Drive shared files · Dropbox · OneDrive · direct video URLs. Source access and storage limits apply."}</small>
      </div>
    </section>
  </div>
}
