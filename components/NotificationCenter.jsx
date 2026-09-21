"use client";
import{useEffect,useState}from"react";
import{Bell,Check,ChevronRight}from"lucide-react";

export default function NotificationCenter({supabase,workspaceId,userId}){
 const[items,setItems]=useState([]),[open,setOpen]=useState(false),[busy,setBusy]=useState(false);
 const load=async()=>{
  if(!supabase||!workspaceId||!userId)return;
  const{data}=await supabase.from("notifications").select("id,title,message,read_at,created_at").eq("workspace_id",workspaceId).eq("user_id",userId).order("created_at",{ascending:false}).limit(25);
  setItems(data||[]);
 };
 useEffect(()=>{load();const channel=supabase?.channel("alpha-notifications-"+userId).on("postgres_changes",{event:"*",schema:"public",table:"notifications",filter:"user_id=eq."+userId},load).subscribe();return()=>{if(channel)supabase.removeChannel(channel)}},[supabase,workspaceId,userId]);
 const unread=items.filter(x=>!x.read_at).length;
 const markAll=async()=>{
  if(!unread||busy)return;
  setBusy(true);
  await supabase.from("notifications").update({read_at:new Date().toISOString()}).eq("workspace_id",workspaceId).eq("user_id",userId).is("read_at",null);
  await load();setBusy(false);
 };
 return <div className="alphaNotificationCenter">
  <button className="alphaNotificationButton" aria-label="Notifications" onClick={()=>setOpen(v=>!v)}><Bell size={18}/>{unread>0&&<span>{unread>9?"9+":unread}</span>}</button>
  {open&&<div className="alphaNotificationPanel">
   <div className="alphaNotificationHead"><div><b>Notifications</b><small>{unread?unread+" unread":"You're all caught up"}</small></div><button onClick={markAll} disabled={!unread||busy}><Check size={14}/> Mark read</button></div>
   <div className="alphaNotificationList">{items.length?items.map(n=><button className={"alphaNotificationItem "+(!n.read_at?"unread":"")} key={n.id} onClick={async()=>{if(!n.read_at)await supabase.from("notifications").update({read_at:new Date().toISOString()}).eq("id",n.id);await load()}}><div><b>{n.title}</b><p>{n.message}</p><small>{new Date(n.created_at).toLocaleString()}</small></div><ChevronRight size={15}/></button>):<div className="alphaNotificationEmpty">No notifications yet.</div>}</div>
  </div>}
 </div>;
}
