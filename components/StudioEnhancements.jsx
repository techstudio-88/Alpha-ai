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

const timeAgo=value=>{
  const ms=Date.now()-new Date(value).getTime();
  if(!Number.isFinite(ms)||ms<0)return "now";
  const s=Math.floor(ms/1000);
  if(s<60)return s+"s";
  const m=Math.floor(s/60);
  if(m<60)return m+"m";
  const h=Math.floor(m/60);
  if(h<24)return h+"h";
  return Math.floor(h/24)+"d";
};

export default function StudioEnhancements(){
  const [session,setSession]=useState(null),[palette,setPalette]=useState(false),[query,setQuery]=useState(""),[activity,setActivity]=useState(false);
  const [notifications,setNotifications]=useState([]),[events,setEvents]=useState([]);
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

  useEffect(()=>{
    let alive=true;
    async function loadActivity(){
      if(!session?.user?.id)return;
      const [{data:notes},{data:evs}]=await Promise.all([
        supabase.from("notifications").select("id,title,message,read_at,created_at").eq("user_id",session.user.id).order("created_at",{ascending:false}).limit(12),
        supabase.from("product_events").select("id,event_name,metadata,created_at").eq("user_id",session.user.id).order("created_at",{ascending:false}).limit(12)
      ]);
      if(!alive)return;
      setNotifications(notes||[]);
      setEvents(evs||[]);
    }
    loadActivity();
    return()=>{alive=false};
  },[session?.user?.id]);

  if(!session)return null;

  const go=name=>{
    if(name==="Schedule")window.dispatchEvent(new CustomEvent("alpha:navigate",{detail:"calendar"}));
    else if(name==="AI Assistant")window.dispatchEvent(new CustomEvent("alpha:navigate",{detail:"assistant"}));
    else if(name==="Open editor")window.dispatchEvent(new CustomEvent("alpha:navigate",{detail:"editor"}));
    else window.dispatchEvent(new CustomEvent("alpha:upload"));
    setPalette(false);
  };
  const filtered=actions.filter(([n,d])=>(n+" "+d).toLowerCase().includes(query.toLowerCase()));
  const activityItems=[
    ...notifications.map(n=>({id:"n-"+n.id,title:n.title||"Notification",detail:n.message||"Workspace notification",created_at:n.created_at,type:"notification"})),
    ...events.map(e=>({id:"e-"+e.id,title:e.event_name||"Workspace event",detail:e.metadata?.description||e.metadata?.action||"Product activity",created_at:e.created_at,type:"event"}))
  ].sort((a,b)=>new Date(b.created_at)-new Date(a.created_at)).slice(0,10);
  const unread=notifications.filter(n=>!n.read_at).length;

  return <>
    <div className="alphaStudioCommandBar">
      <div className="alphaStudioLive"><i/><span>Studio live</span><small>Workspace synced</small></div>
      <button className="alphaStudioSearch" onClick={()=>setPalette(true)}><Search size={15}/><span>Search workspace, clips, commands…</span><kbd>⌘K</kbd></button>
      <div className="alphaStudioTools">
        <button onClick={()=>window.dispatchEvent(new CustomEvent("alpha:upload"))}><Upload size={15}/><span>Import</span></button>
        <button onClick={()=>setActivity(v=>!v)} className={activity?"active":""} aria-label="Open activity"><Bell size={15}/>{unread>0&&<b className="alphaNotificationCount">{unread>99?"99+":unread}</b>}</button>
      </div>
    </div>
    <div className="alphaStudioContextRail" aria-hidden="true">
      <div><Activity size={14}/><span>LIVE</span></div><i/><i/><i/><i/>
    </div>
    {activity&&<div className="alphaActivityPopover">
      <div><div><small>ACTIVITY CENTER</small><b>Workspace activity</b></div><button onClick={()=>setActivity(false)}><X size={16}/></button></div>
      {activityItems.length?activityItems.map(item=><section key={item.id}><span className={"alphaActivityDot "+(item.type==="event"?"purple":"")}/><div><b>{item.title}</b><small>{item.detail}</small></div><em>{timeAgo(item.created_at)}</em></section>):<div className="alphaActivityEmpty"><Activity size={18}/><span>No workspace activity yet.</span></div>}
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
