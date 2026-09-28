"use client";

import React,{useEffect,useMemo,useState} from "react";
import {ArrowUp,ChevronRight,FileVideo,LoaderCircle,MessageSquare,Paperclip,Sparkles,Scissors,X} from "lucide-react";

export default function AIChatView({workspace,supabase,onNavigate}){
  const [clips,setClips]=useState([]),[selected,setSelected]=useState(""),[input,setInput]=useState(""),[messages,setMessages]=useState([]),[busy,setBusy]=useState(false),[status,setStatus]=useState(""),[file,setFile]=useState(null);
  const [history,setHistory]=useState(()=>{try{return JSON.parse(localStorage.getItem("alpha-ai-chat-history")||"[]")}catch{return []}});
  const clip=useMemo(()=>clips.find(x=>x.id===selected),[clips,selected]);

  useEffect(()=>{let alive=true;(async()=>{if(!workspace?.id)return;const {data:projects}=await supabase.from("projects").select("id").eq("workspace_id",workspace.id);const ids=(projects||[]).map(x=>x.id);if(!ids.length)return;const {data}=await supabase.from("clips").select("id,title,start_seconds,end_seconds,project_id,media_asset_id").in("project_id",ids).order("created_at",{ascending:false}).limit(50);if(alive)setClips(data||[])})();return()=>{alive=false}},[workspace?.id]);

  const save=(next)=>{setHistory(next);try{localStorage.setItem("alpha-ai-chat-history",JSON.stringify(next.slice(-30)))}catch{}};
  const quick=["Make the hook stronger","Tighten this clip and remove dead air","Make it more social with punchy captions","Turn this into a 30-second short"];

  async function send(){
    const text=input.trim();if(!text||busy)return;
    if(!clip){setMessages(v=>[...v,{role:"assistant",text:"Select a real clip first. I can then send your instruction through Alpha.ai's authenticated Gemini render pipeline."}]);return}
    if(!clip.media_asset_id){setMessages(v=>[...v,{role:"assistant",text:"This clip has no source media attached, so I can't render an edit yet."}]);return}
    setInput("");setMessages(v=>[...v,{role:"user",text}]);setBusy(true);setStatus("Sending your instruction to the real render pipeline…");
    try{
      const {data:{session}}=await supabase.auth.getSession();if(!session?.access_token)throw new Error("Your session expired. Please sign in again.");
      const res=await fetch("/api/editor/render",{method:"POST",headers:{"content-type":"application/json",authorization:"Bearer "+session.access_token},body:JSON.stringify({workspaceId:workspace.id,projectId:clip.project_id,mediaAssetId:clip.media_asset_id,clipId:clip.id,startSeconds:clip.start_seconds,endSeconds:clip.end_seconds,title:clip.title||"AI Chat edit",aiPrompt:text})});
      const body=await res.json().catch(()=>({}));if(!res.ok)throw new Error(body.error||"The AI edit could not be started.");
      if(!body.jobId)throw new Error("The render pipeline did not return a processing job.");
      setStatus("Gemini is analyzing the edit…");
      let done=false;
      for(let i=0;i<60;i++){
        await new Promise(r=>setTimeout(r,2000));
        const {data:job,error}=await supabase.from("processing_jobs").select("status,error,payload").eq("id",body.jobId).maybeSingle();
        if(error)throw new Error(error.message);
        if(job?.status==="failed")throw new Error(job.error||"The AI edit failed.");
        if(job?.status==="completed"){const p=job.payload||{};setMessages(v=>[...v,{role:"assistant",text:p.aiEditReason?String(p.aiEditReason):p.aiEditAction?"Gemini applied: "+String(p.aiEditAction):"Gemini finished the edit. Check Clip Library for the updated clip."}]);done=true;break}
        setStatus("Processing your edit…");
      }
      if(!done)setMessages(v=>[...v,{role:"assistant",text:"The edit is still processing. You can continue working; the job will remain in Processing/Clip Library."}]);
      const next=[...history,{at:new Date().toISOString(),clipId:clip.id,prompt:text}];save(next);
    }catch(e){setMessages(v=>[...v,{role:"assistant",text:"Something went wrong: "+(e?.message||"Unknown error")}])}
    finally{setBusy(false);setStatus("")}
  }

  return <div className="workspaceFeaturePage" style={{minHeight:"calc(100vh - 40px)"}}>
    <div className="top"><div><div className="eyebrow">ALPHA.AI CHAT-FIRST CREATION</div><h1>Tell Alpha what to make.</h1><div className="muted">Describe the edit in plain language. Real clips use the existing authenticated Gemini + render pipeline.</div></div><div style={{display:"flex",gap:8}}><button className="btn" onClick={()=>onNavigate?.("clips")}><Scissors size={15}/> Clips Studio</button></div></div>
    <div style={{display:"grid",gridTemplateColumns:"minmax(0,1fr) 300px",gap:16,alignItems:"stretch"}}>
      <section className="card" style={{minHeight:520,display:"flex",flexDirection:"column",overflow:"hidden"}}>
        <div style={{padding:16,borderBottom:"1px solid var(--line,#e7eaf0)",display:"flex",alignItems:"center",gap:10}}><span className="emptyOrb" style={{width:36,height:36}}><MessageSquare size={17}/></span><div><b>AI Chat</b><div className="muted" style={{fontSize:12}}>Chat-first editing</div></div></div>
        <div style={{flex:1,padding:18,overflow:"auto",display:"flex",flexDirection:"column",gap:12}}>
          {!messages.length&&<div style={{margin:"auto",textAlign:"center",maxWidth:560}}><Sparkles size={30} style={{color:"#7c3aed"}}/><h2 style={{margin:"10px 0 6px"}}>What should we change?</h2><p className="muted">Choose a real clip, then ask for hooks, tighter pacing, captions, or other edit instructions.</p><div style={{display:"flex",gap:8,flexWrap:"wrap",justifyContent:"center",marginTop:16}}>{quick.map(q=><button key={q} className="btn small" onClick={()=>setInput(q)}>{q}</button>)}</div></div>}
          {messages.map((m,i)=><div key={i} style={{alignSelf:m.role==="user"?"flex-end":"flex-start",maxWidth:"82%",padding:"11px 14px",borderRadius:16,background:m.role==="user"?"linear-gradient(135deg,#7c3aed,#2563eb)":"var(--card,#fff)",color:m.role==="user"?"#fff":"inherit",border:m.role==="user"?"0":"1px solid var(--line,#e7eaf0)",whiteSpace:"pre-wrap"}}>{m.text}</div>)}
        </div>
        <div style={{padding:12,borderTop:"1px solid var(--line,#e7eaf0)"}}><div style={{display:"flex",gap:8,alignItems:"center",marginBottom:8}}><select className="input" value={selected} onChange={e=>setSelected(e.target.value)} style={{flex:1}}><option value="">Choose a real clip…</option>{clips.map(c=><option key={c.id} value={c.id}>{c.title||"Untitled clip"} · {Math.round((c.end_seconds||0)-(c.start_seconds||0))}s</option>)}</select><label className="btn" title="Attach a reference file"><Paperclip size={15}/><input hidden type="file" accept="video/*,audio/*" onChange={e=>setFile(e.target.files?.[0]||null)}/></label></div>{file&&<div className="muted" style={{fontSize:12,marginBottom:7}}><FileVideo size={13} style={{display:"inline",verticalAlign:"-2px"}}/> {file.name} <button className="btn small" onClick={()=>setFile(null)}><X size={11}/></button></div>}<div style={{display:"flex",gap:8,alignItems:"flex-end"}}><textarea className="input" rows={2} value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();send()}}} placeholder="Example: make the opening faster, emphasize the key quote, and keep the speaker centered." style={{resize:"vertical",flex:1}}/><button className="btn primary" disabled={busy||!input.trim()} onClick={send}>{busy?<LoaderCircle size={16} className="pulse"/>:<ArrowUp size={16}/>}</button></div>{status&&<div className="muted" style={{fontSize:12,marginTop:7}}>{status}</div>}</div>
      </section>
      <aside className="card" style={{padding:16}}><div className="eyebrow">CHAT CONTEXT</div><h3 style={{margin:"6px 0 12px"}}>Real workspace data</h3><div className="muted" style={{fontSize:13,lineHeight:1.6}}>This first production slice deliberately reuses Alpha.ai's existing clips, Supabase session, Gemini edit endpoint and processing jobs. It does not create fake clips or pretend local scheduling is publishing.</div><hr style={{margin:"16px 0",border:0,borderTop:"1px solid var(--line,#e7eaf0)"}}/><b style={{fontSize:13}}>{clips.length} real clips available</b><div style={{marginTop:12,display:"grid",gap:6}}>{clips.slice(0,6).map(c=><button key={c.id} className="btn small" style={{justifyContent:"space-between",textAlign:"left"}} onClick={()=>setSelected(c.id)}><span>{c.title||"Untitled clip"}</span><ChevronRight size={13}/></button>)}</div><button className="btn" style={{width:"100%",marginTop:14}} onClick={()=>onNavigate?.("assistant")}>Open full AI Assistant</button></aside>
    </div>
  </div>
}
