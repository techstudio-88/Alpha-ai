"use client";
import {useState} from "react";

export default function ToolClient({tool,names}){
  const [input,setInput]=useState("");
  const [out,setOut]=useState("");
  const [busy,setBusy]=useState(false);
  async function run(){
    setBusy(true);setOut("");
    try{
      const r=await fetch("/api/tools/generate",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({tool,input})});
      const j=await r.json();
      setOut(j.text||j.error||"No result.");
    }finally{setBusy(false);}
  }
  return <main className="seo-page"><h1>{names[tool]}</h1><p>Paste a topic, transcript or content idea.</p><textarea value={input} onChange={e=>setInput(e.target.value)} rows={10} style={{width:"100%",maxWidth:800}}/><br/><button onClick={run} disabled={busy||!input.trim()}>{busy?"Generating…":"Generate"}</button>{out&&<pre style={{whiteSpace:"pre-wrap"}}>{out}</pre>}</main>;
}