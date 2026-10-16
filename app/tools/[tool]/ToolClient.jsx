"use client";
import {useState} from "react";
import {supabase} from "../../../lib/supabase.js";

export default function ToolClient({tool,names}){
  const [input,setInput]=useState("");
  const [out,setOut]=useState("");
  const [busy,setBusy]=useState(false);
  async function run(){
    setBusy(true);setOut("");
    try{
      const headers={"content-type":"application/json"};
      let workspaceId=null;
      if(supabase){
        const {data:{session}}=await supabase.auth.getSession();
        if(session?.access_token){
          headers.Authorization="Bearer "+session.access_token;
          const {data:membership}=await supabase.from("workspace_members").select("workspace_id").eq("user_id",session.user.id).limit(1).maybeSingle();
          workspaceId=membership?.workspace_id||null;
        }
      }
      const requestId=globalThis.crypto?.randomUUID?.()||String(Date.now())+"-"+Math.random().toString(36).slice(2);
      const r=await fetch("/api/tools/generate",{method:"POST",headers,body:JSON.stringify({tool,input,workspaceId,request_id:requestId})});
      const j=await r.json();
      setOut(j.text||j.error||"No result.");
    }finally{setBusy(false);}
  }
  return <main className="seo-page"><h1>{names[tool]}</h1><p>Paste a topic, transcript or content idea.</p><textarea value={input} onChange={e=>setInput(e.target.value)} rows={10} style={{width:"100%",maxWidth:800}}/><br/><button onClick={run} disabled={busy||!input.trim()}>{busy?"Generating…":"Generate"}</button>{out&&<pre style={{whiteSpace:"pre-wrap"}}>{out}</pre>}</main>;
}