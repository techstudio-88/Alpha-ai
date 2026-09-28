"use client";
import React,{useEffect,useMemo,useState}from"react";
import{ArrowUp,CalendarClock,ChevronRight,FileVideo,LoaderCircle,MessageSquare,Paperclip,RotateCcw,Scissors,Sparkles,Undo2}from"lucide-react";

export default function AIChatView({workspace,supabase,onNavigate}){
 const[clips,setClips]=useState([]),[assets,setAssets]=useState([]),[selectedAsset,setSelectedAsset]=useState(""),[selected,setSelected]=useState(""),[input,setInput]=useState(""),[messages,setMessages]=useState([]),[sessions,setSessions]=useState([]),[sessionId,setSessionId]=useState(""),[busy,setBusy]=useState(false),[status,setStatus]=useState(""),[platform,setPlatform]=useState("YouTube"),[scheduledFor,setScheduledFor]=useState("");
 const clip=useMemo(()=>clips.find(x=>x.id===selected),[clips,selected]);
 const asset=useMemo(()=>assets.find(x=>x.id===selectedAsset),[assets,selectedAsset]);
 async function auth(){const{data:{session}}=await supabase.auth.getSession();if(!session?.access_token)throw new Error("Your session expired. Please sign in again.");return session.access_token}
 async function load(){
  if(!workspace?.id)return;
  const{data:projects}=await supabase.from("projects").select("id,name").eq("workspace_id",workspace.id);
  const ids=(projects||[]).map(x=>x.id);if(!ids.length)return;
  const[{data:a},{data:c},{data:s}]=await Promise.all([
   supabase.from("media_assets").select("id,name,project_id,duration_seconds,status,storage_path").in("project_id",ids).order("created_at",{ascending:false}).limit(100),
   supabase.from("clips").select("id,title,start_seconds,end_seconds,score,status,project_id,media_asset_id,ai_spec,reframe_config,caption_config,broll_config").in("project_id",ids).order("created_at",{ascending:false}).limit(100),
   supabase.from("ai_chat_sessions").select("id,title,project_id,media_asset_id,updated_at").eq("workspace_id",workspace.id).order("updated_at",{ascending:false}).limit(30)
  ]);
  setAssets(a||[]);setClips(c||[]);setSessions(s||[]);
  if(!selectedAsset&&a?.[0])setSelectedAsset(a[0].id);
 }
 useEffect(()=>{load()},[workspace?.id]);
 async function openSession(id){
  setSessionId(id);const{data}=await supabase.from("ai_chat_messages").select("id,role,content,created_at").eq("session_id",id).order("created_at",{ascending:true});setMessages((data||[]).map(x=>({role:x.role,text:x.content,id:x.id})));
  const s=sessions.find(x=>x.id===id);if(s?.media_asset_id)setSelectedAsset(s.media_asset_id)
 }
 async function plan(regenerate=false){
  const text=input.trim()||"Create the best short-form clips from this video";
  if(!selectedAsset)return setMessages(v=>[...v,{role:"assistant",text:"Select a real uploaded video first."}]);
  setBusy(true);setStatus(regenerate?"Regenerating the clip plan…":"Reading transcript and asking Gemini for the edit plan…");
  try{
   const token=await auth(),sid=sessionId||crypto.randomUUID();
   const res=await fetch("/api/ai/chat/plan",{method:"POST",headers:{"content-type":"application/json",authorization:"Bearer "+token},body:JSON.stringify({workspaceId:workspace.id,projectId:asset.project_id,mediaAssetId:selectedAsset,prompt:text,sessionId:sid})});
   const body=await res.json().catch(()=>({}));if(!res.ok)throw new Error(body.error||"AI planning failed.");
   setSessionId(body.sessionId);setInput("");setClips(v=>[...(body.clips||[]),...v.filter(x=>!(body.clips||[]).some(n=>n.id===x.id))]);setSelected(body.clips?.[0]?.id||"");
   setMessages(v=>[...v,{role:"user",text},{role:"assistant",text:body.summary||"I created the clip plan.",clips:body.clips||[]}]);
   await load();
  }catch(e){setMessages(v=>[...v,{role:"assistant",text:"Something went wrong: "+e.message}])}finally{setBusy(false);setStatus("")}
 }
 async function render(){
  if(!clip||!asset)return;
  setBusy(true);setStatus("Sending the edit to the FFmpeg worker…");
  try{
   const token=await auth();
   const{data:ver}=await supabase.from("clip_versions").select("version,edit_data,render_status,storage_path").eq("clip_id",clip.id).order("version",{ascending:false}).limit(1).maybeSingle();
   const next=Number(ver?.version||0)+1;
   await supabase.from("clip_versions").insert({clip_id:clip.id,version:next,edit_data:clip.ai_spec||{},render_status:"queued",storage_path:null});
   const spec=clip.ai_spec||{},aspect=clip.reframe_config?.aspect||"9:16";
   const res=await fetch("/api/editor/render",{method:"POST",headers:{"content-type":"application/json",authorization:"Bearer "+token},body:JSON.stringify({workspaceId:workspace.id,projectId:clip.project_id,mediaAssetId:clip.media_asset_id,clipId:clip.id,startSeconds:clip.start_seconds,endSeconds:clip.end_seconds,title:clip.title,aspect,aiPrompt:JSON.stringify(spec),captions:true,transition:spec.transitions||"cut",autoReframe:true})});
   const b=await res.json().catch(()=>({}));if(!res.ok)throw new Error(b.error||"Render could not start.");
   setMessages(v=>[...v,{role:"assistant",text:"Render queued. Track it in Processing; the rendered version will remain attached to this clip."}]);
  }catch(e){setMessages(v=>[...v,{role:"assistant",text:"Render failed: "+e.message}])}finally{setBusy(false);setStatus("")}
 }
 async function saveSchedule(){
  if(!clip||!scheduledFor)return;
  const{error}=await supabase.from("scheduled_posts").insert({workspace_id:workspace.id,clip_id:clip.id,platform,scheduled_for:new Date(scheduledFor).toISOString(),status:"scheduled",payload:{source:"ai_chat",title:clip.title}});
  if(error)return setMessages(v=>[...v,{role:"assistant",text:"Scheduling failed: "+error.message}]);
  setMessages(v=>[...v,{role:"assistant",text:`Scheduled “${clip.title}” for ${platform}.`}]);
 }
 async function updateSpec(patch){
  if(!clip)return;
  const next={...(clip.ai_spec||{}),...patch};
  const{error}=await supabase.from("clips").update({ai_spec:next,reframe_config:patch.aspect?{...(clip.reframe_config||{}),aspect:patch.aspect}:clip.reframe_config,caption_config:patch.captionStyle?{...(clip.caption_config||{}),style:patch.captionStyle,color:patch.captionColor||clip.caption_config?.color}:clip.caption_config}).eq("id",clip.id);
  if(error)setMessages(v=>[...v,{role:"assistant",text:"Could not save the edit spec: "+error.message}]);else{setClips(v=>v.map(x=>x.id===clip.id?{...x,ai_spec:next}:x));setMessages(v=>[...v,{role:"assistant",text:"Edit settings saved to the real clip. Render when ready."}])}
 }
 const quick=["Create 5 viral shorts","Make the hooks stronger","Make these tighter and faster","Find the funniest moments"];
 return <div className="workspaceFeaturePage" style={{minHeight:"calc(100vh - 40px)"}}>
  <div className="top"><div><div className="eyebrow">ALPHA.AI CHAT-FIRST CREATION</div><h1>Tell Alpha what to make.</h1><div className="muted">Real workspace media, transcript analysis, Gemini planning and FFmpeg rendering.</div></div><button className="btn" onClick={()=>onNavigate?.("clips")}><Scissors size={15}/> Clips Studio</button></div>
  <div style={{display:"grid",gridTemplateColumns:"minmax(0,1fr) 320px",gap:16}}>
   <section className="card" style={{minHeight:600,display:"flex",flexDirection:"column"}}>
    <div style={{padding:14,borderBottom:"1px solid var(--line,#e7eaf0)",display:"flex",gap:10,alignItems:"center"}}><MessageSquare size={18}/><b>AI Chat</b>{asset&&<span className="muted" style={{fontSize:12}}>· {asset.name}</span>}</div>
    <div style={{flex:1,padding:18,overflow:"auto",display:"flex",flexDirection:"column",gap:12}}>
     {!messages.length&&<div style={{margin:"auto",textAlign:"center",maxWidth:560}}><Sparkles size={32} style={{color:"#7c3aed"}}/><h2>What should we make?</h2><p className="muted">Select a real uploaded video and describe the result. Alpha saves the chat and generated clip specs to your workspace.</p><div style={{display:"flex",gap:8,flexWrap:"wrap",justifyContent:"center"}}>{quick.map(q=><button className="btn small" key={q} onClick={()=>setInput(q)}>{q}</button>)}</div></div>}
     {messages.map((m,i)=><div key={i} style={{alignSelf:m.role==="user"?"flex-end":"flex-start",maxWidth:"88%",padding:"11px 14px",borderRadius:16,background:m.role==="user"?"linear-gradient(135deg,#7c3aed,#2563eb)":"var(--card,#fff)",color:m.role==="user"?"#fff":"inherit",border:m.role==="user"?"0":"1px solid var(--line,#e7eaf0)"}}><div style={{whiteSpace:"pre-wrap"}}>{m.text}</div>{m.clips?.length&&<div style={{marginTop:10,display:"grid",gap:5}}>{m.clips.map(c=><button className="btn small" key={c.id} onClick={()=>setSelected(c.id)} style={{justifyContent:"space-between"}}><span>{c.title||"AI clip"} · {Math.round((c.end_seconds||0)-(c.start_seconds||0))}s</span><ChevronRight size={13}/></button>)}</div>}</div>)}
    </div>
    <div style={{padding:12,borderTop:"1px solid var(--line,#e7eaf0)"}}>
     <div style={{display:"flex",gap:8,marginBottom:8}}><select className="input" value={selectedAsset} onChange={e=>setSelectedAsset(e.target.value)} style={{flex:1}}><option value="">Choose uploaded video…</option>{assets.map(a=><option key={a.id} value={a.id}>{a.name} · {Math.round(Number(a.duration_seconds||0))}s</option>)}</select><label className="btn" title="Attach/import video"><Paperclip size={15}/><input hidden type="file" accept="video/*" onChange={()=>onNavigate?.("import")}/></label></div>
     <div style={{display:"flex",gap:8}}><textarea className="input" rows={2} value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();plan()}}} placeholder="Example: find 5 strong hooks, 30-45 seconds each, with bold captions." style={{resize:"vertical",flex:1}}/><button className="btn primary" disabled={busy} onClick={()=>plan()}>{busy?<LoaderCircle size={16}/>:<ArrowUp size={16}/>}</button></div>
     {status&&<div className="muted" style={{fontSize:12,marginTop:7}}>{status}</div>}
    </div>
   </section>
   <aside style={{display:"grid",gap:12,alignContent:"start"}}>
    <div className="card" style={{padding:14}}><div className="eyebrow">CHAT HISTORY</div>{sessions.map(s=><button key={s.id} className="btn small" style={{width:"100%",justifyContent:"space-between",marginTop:6,textAlign:"left"}} onClick={()=>openSession(s.id)}><span>{s.title}</span><ChevronRight size={13}/></button>)}</div>
    <div className="card" style={{padding:14}}><div className="eyebrow">CLIP EDITOR</div>{clip?<><b>{clip.title}</b><div className="muted" style={{fontSize:12,margin:"6px 0"}}>{Number(clip.start_seconds).toFixed(1)}s → {Number(clip.end_seconds).toFixed(1)}s · score {clip.score}</div><div style={{display:"flex",gap:5,flexWrap:"wrap"}}>{["9:16","1:1","16:9"].map(a=><button className="btn small" key={a} onClick={()=>updateSpec({aspect:a})}>{a}</button>)}</div><div style={{display:"flex",gap:6,marginTop:8}}>{["pop","bold","minimal"].map(a=><button className="btn small" key={a} onClick={()=>updateSpec({captionStyle:a})}>{a}</button>)}</div><button className="btn primary" style={{width:"100%",marginTop:10}} onClick={render} disabled={busy}><Scissors size={14}/> Render with FFmpeg</button><button className="btn" style={{width:"100%",marginTop:6}} onClick={()=>plan(true)} disabled={busy}><RotateCcw size={14}/> Regenerate plan</button></>:<div className="muted" style={{fontSize:13}}>Select an AI clip above.</div>}</div>
    <div className="card" style={{padding:14}}><div className="eyebrow">SCHEDULE</div><div style={{display:"flex",gap:6,marginTop:8}}><select className="input" value={platform} onChange={e=>setPlatform(e.target.value)}><option>YouTube</option><option>Instagram</option><option>TikTok</option><option>LinkedIn</option></select></div><input className="input" type="datetime-local" value={scheduledFor} onChange={e=>setScheduledFor(e.target.value)} style={{marginTop:6}}/><button className="btn" style={{width:"100%",marginTop:6}} onClick={saveSchedule} disabled={!clip||!scheduledFor}><CalendarClock size={14}/> Save to Publishing</button></div>
   </aside>
  </div>
 </div>
}