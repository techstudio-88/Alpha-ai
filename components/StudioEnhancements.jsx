"use client";

import {useEffect,useState} from "react";
import {Bell,Command,Search,Sparkles,Activity,Upload,Scissors,CalendarDays,ChevronRight,X} from "lucide-react";
import {supabase} from "../lib/supabase";

const actions=[
  ["Upload media","Start a new ingest",Upload],
  ["Open editor","Jump into the studio editor",Scissors],
  ["Schedule","Open publishing calendar",CalendarDays],
  ["AI Assistant","Ask Alpha to help",Sparkles]
];

export default function StudioEnhancements(){
  const [session,setSession]=useState(null),[palette,setPalette]=useState(false),[query,setQuery]=useState(""),[activity,setActivity]=useState(false);
  useEffect(()=>{
    let alive=true;
    supabase.auth.getSession().then(({data})=>alive&&setSession(data.session));
    const {data:{subscription}}=supabase.auth.onAuthStateChange((_e,s)=>setSession(s));
    const key=e=>{
      if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==="k"){e.preventDefault();setPalette(v=>!v)}
      if(e.key==="Escape"){setPalette(false);setActivity(false)}
    };
    window.addEventListener("keydown",key);
    return()=>{alive=false;subscription.unsubscribe();window.removeEventListener("keydown",key)};
  },[]);
  if(!session)return null;
  const go=(name)=>{
    const map={"Upload media":"alpha:upload","Open editor":"alpha:open-editor","Schedule":"alpha:navigate","AI Assistant":"alpha:navigate"};
    if(name==="Schedule")window.dispatchEvent(new CustomEvent("alpha:navigate",{detail:"calendar"}));
    else if(name==="AI Assistant")window.dispatchEvent(new CustomEvent("alpha:navigate",{detail:"assistant"}));
    else window.dispatchEvent(new CustomEvent(map[name]||name));
    setPalette(false);
  };
  const filtered=actions.filter(([n,d])=>(n+" "+d).toLowerCase().includes(query.toLowerCase()));
  return <>
    <div className="alphaStudioCommandBar">
      <div className="alphaStudioLive"><i/><span>Studio live</span><small>Workspace synced</small></div>
      <button className="alphaStudioSearch" onClick={()=>setPalette(true)}><Search size={15}/><span>Search workspace, clips, commands…</span><kbd>⌘K</kbd></button>
      <div className="alphaStudioTools">
        <button onClick={()=>window.dispatchEvent(new CustomEvent("alpha:upload"))}><Upload size={15}/><span>Import</span></button>
        <button onClick={()=>setActivity(v=>!v)} className={activity?"active":""}><Bell size={15}/><i/></button>
      </div>
    </div>
    <div className="alphaStudioContextRail" aria-hidden="true">
      <div><Activity size={14}/><span>LIVE</span></div><i/><i/><i/><i/>
    </div>
    {activity&&<div className="alphaActivityPopover">
      <div><div><small>ACTIVITY CENTER</small><b>Workspace activity</b></div><button onClick={()=>setActivity(false)}><X size={16}/></button></div>
      <section><span className="alphaActivityDot"/><div><b>Workspace ready</b><small>All studio services are connected</small></div><em>now</em></section>
      <section><span className="alphaActivityDot purple"/><div><b>AI pipeline available</b><small>Import a source to begin analysis</small></div><em>ready</em></section>
      <button className="alphaActivityFooter" onClick={()=>setActivity(false)}>Close activity <ChevronRight size={14}/></button>
    </div>}
    {palette&&<div className="alphaCommandBackdrop" onClick={()=>setPalette(false)}>
      <div className="alphaCommandPalette" onClick={e=>e.stopPropagation()}>
        <div className="alphaCommandInput"><Command size={16}/><input autoFocus value={query} onChange={e=>setQuery(e.target.value)} placeholder="What do you want to do?"/><kbd>ESC</kbd></div>
        <div className="alphaCommandSection"><small>QUICK ACTIONS</small>{filtered.map(([n,d,I])=><button key={n} onClick={()=>go(n)}><span className="alphaCommandIcon"><I size={15}/></span><span><b>{n}</b><em>{d}</em></span><ChevronRight size={15}/></button>)}</div>
        {!filtered.length&&<div className="alphaCommandEmpty"><Sparkles size={18}/><span>No command matches that search.</span></div>}
      </div>
    </div>}
  </>;
}
