"use client";
import{useEffect,useMemo,useState}from"react";
import{ArrowLeft,Download,ShieldCheck,UserRound,Trash2,RefreshCw,Lock,Check,Activity,Search,UserPlus,Bell,FileText}from"lucide-react";
import{supabase}from"../../lib/supabase";

function CloudLoader(){return <div className="authLoading"><span>Loading admin workspace…</span></div>}

export default function AdminPage(){
 const[user,setUser]=useState(null),[workspace,setWorkspace]=useState(null),[membership,setMembership]=useState(null),[members,setMembers]=useState([]),[profiles,setProfiles]=useState({}),[control,setControl]=useState(null),[loading,setLoading]=useState(true),[busy,setBusy]=useState(""),[message,setMessage]=useState("");
 const isOwner=membership?.role==="owner";
 const[userQuery,setUserQuery]=useState(""),[grantEmail,setGrantEmail]=useState(""),[grantRole,setGrantRole]=useState("viewer"),[notifyUserId,setNotifyUserId]=useState(""),[notifyTitle,setNotifyTitle]=useState(""),[notifyMessage,setNotifyMessage]=useState(""),[ccBusy,setCcBusy]=useState(""),[ccMessage,setCcMessage]=useState("");
 const canExport=Boolean(isOwner||membership?.can_export);

 async function load(){
  setLoading(true);setMessage("");
  const{data:{session}}=await supabase.auth.getSession();
  if(!session?.user){window.location.href="/";return}
  setUser(session.user);
  const controlResponse=await fetch("/api/control-center",{headers:{Authorization:"Bearer "+session.access_token}});
  const controlBody=await controlResponse.json().catch(()=>({}));
  if(!controlResponse.ok){setMessage(controlBody.error||"Control center access denied.");setLoading(false);return}
  setControl(controlBody);
  const{data:w,error:we}=await supabase.rpc("ensure_my_workspace");
  if(we||!w){setMessage(we?.message||"Unable to load your workspace.");setLoading(false);return}
  setWorkspace(w);
  const{data:m,error:me}=await supabase.from("workspace_members").select("workspace_id,user_id,role,can_export,created_at").eq("workspace_id",w.id).order("created_at",{ascending:true});
  if(me){setMessage(me.message);setLoading(false);return}
  const list=m||[];setMembers(list);
  const ids=list.map(x=>x.user_id);
  if(ids.length){const{data:p}=await supabase.from("profiles").select("id,full_name,avatar_url").in("id",ids);setProfiles(Object.fromEntries((p||[]).map(x=>[x.id,x])));}
  const mine=list.find(x=>x.user_id===session.user.id);setMembership(mine||null);setLoading(false);
 }
 useEffect(()=>{load()},[]);
 const controlAction=async(action,body={})=>{const{data:{session}}=await supabase.auth.getSession();if(!session?.access_token)throw new Error("Authentication expired.");const r=await fetch("/api/control-center",{method:"POST",headers:{"content-type":"application/json",authorization:"Bearer "+session.access_token},body:JSON.stringify({action,...body})});const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||"Control Center action failed.");return j};
 const grantAccess=async()=>{const email=grantEmail.trim().toLowerCase();if(!email){setCcMessage("Enter an email address.");return}setCcBusy("grant");try{const j=await controlAction("grant_access",{email,role:grantRole});setCcMessage(j.invited?"Access granted and invitation sent.":"Access granted.");setGrantEmail("");await load()}catch(e){setCcMessage(e.message)}finally{setCcBusy("")}};
 const revokeAccess=async email=>{if(email===user?.email){setCcMessage("You cannot revoke your own control-center access.");return}if(!window.confirm("Revoke control-center access for "+email+"?"))return;setCcBusy(email);try{await controlAction("revoke_access",{email});setCcMessage("Access revoked.");await load()}catch(e){setCcMessage(e.message)}finally{setCcBusy("")}};
 const sendNotification=async()=>{if(!notifyUserId||!notifyMessage.trim()){setCcMessage("Choose a recipient and write a message.");return}setCcBusy("notify");try{await controlAction("notify",{userId:notifyUserId,title:notifyTitle.trim()||"Alpha.ai notification",message:notifyMessage.trim()});setCcMessage("Notification sent.");setNotifyTitle("");setNotifyMessage("")}catch(e){setCcMessage(e.message)}finally{setCcBusy("")}};
 const filteredUsers=(control?.users||[]).filter(u=>{const q=userQuery.trim().toLowerCase();return !q||(u.email||"").toLowerCase().includes(q)||(u.profile?.full_name||"").toLowerCase().includes(q)}).slice(0,30);

 const exportCsv=async()=>{
  if(!workspace||!canExport)return;
  setBusy("export");setMessage("");
  const[pr,sr,jr]=await Promise.all([
   supabase.from("projects").select("*").eq("workspace_id",workspace.id).order("created_at",{ascending:false}),
   supabase.from("project_sources").select("*").eq("workspace_id",workspace.id).order("created_at",{ascending:false}),
   supabase.from("processing_jobs").select("*").eq("workspace_id",workspace.id).order("created_at",{ascending:false})
  ]);
  const ids=(pr.data||[]).map(x=>x.id);let cr={data:[]};if(ids.length)cr=await supabase.from("clips").select("*").in("project_id",ids).order("created_at",{ascending:false});
  const rows=[["record_type","id","name","status","source_type","source_url","project_id","title","score","created_at"]];
  (pr.data||[]).forEach(x=>rows.push(["project",x.id,x.name||"",x.status||"","","","", "", "",x.created_at||""]));
  (sr.data||[]).forEach(x=>rows.push(["source",x.id,x.file_name||"",x.status||"",x.source_type||"",x.source_url||"",x.project_id||"","","",x.created_at||""]));
  (jr.data||[]).forEach(x=>rows.push(["processing_job",x.id,"",x.status||"","","",x.project_id||"","","",x.created_at||""]));
  (cr.data||[]).forEach(x=>rows.push(["clip",x.id,"",x.status||"","","",x.project_id||"",x.title||"",x.score??"",x.created_at||""]));
  const csv=rows.map(row=>row.map(v=>'"'+String(v??"").replace(/"/g,'""')+'"').join(",")).join("\n");
  const blob=new Blob([csv],{type:"text/csv;charset=utf-8"}),url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download="alpha-workspace-"+new Date().toISOString().slice(0,10)+".csv";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  setMessage("Workspace CSV exported.");setBusy("");await load();
 };
 const toggleExport=async(member)=>{
  if(!isOwner||member.user_id===workspace.owner_id)return;
  setBusy(member.user_id);const{error}=await supabase.from("workspace_members").update({can_export:!member.can_export}).eq("workspace_id",workspace.id).eq("user_id",member.user_id);
  if(error)setMessage(error.message);else setMessage("Export permission updated.");
  setBusy("");await load();
 };
 const removeMember=async(member)=>{
  if(!isOwner||member.user_id===workspace.owner_id)return;
  if(!window.confirm("Remove this user's access to the workspace?"))return;
  setBusy("remove-"+member.user_id);const{error}=await supabase.from("workspace_members").delete().eq("workspace_id",workspace.id).eq("user_id",member.user_id);
  if(error)setMessage(error.message);else setMessage("Workspace access removed.");
  setBusy("");await load();
 };
 if(loading)return <CloudLoader/>;
 if(!membership)return <div className="authLoading"><ShieldCheck size={24}/><span>{message||"Control center access denied."}</span><button className="btn" onClick={()=>window.location.href="/"}>Back to Alpha.ai</button></div>;
 return <div className="app"><aside className="side"><div className="brand"><i className="mark"/><span>Alpha.ai</span></div><div className="nav"><button onClick={()=>window.location.href="/"}><ArrowLeft size={17}/><span>Back to workspace</span></button><button className="active"><ShieldCheck size={17}/><span>Admin</span></button></div><div className="workspaceMini">{workspace.name}</div></aside><main className="main"><div className="top"><div><div className="eyebrow">PRIVATE ADMIN AREA</div><h1>Workspace control</h1><div className="muted">Manage sensitive workspace actions and who is allowed to use them.</div></div><button className="btn" onClick={load}><RefreshCw size={15}/> Refresh</button></div>{message&&<div className="message">{message}</div>}<div className="grid"><div className="card s8"><div className="eyebrow">PRIVILEGED DATA</div><h2>Workspace export</h2><p className="muted">CSV export contains workspace projects, sources, processing jobs and clips. It is intentionally not shown in normal user Settings.</p>{canExport?<button className="btn primary" disabled={busy==="export"} onClick={exportCsv}><Download size={16}/>{busy==="export"?"Preparing CSV…":"Download workspace CSV"}</button>:<div className="message"><Lock size={15}/> You do not have export permission.</div>}</div><div className="card s4"><div className="eyebrow">YOUR ACCESS</div><h3>{membership.role}</h3><p className="muted">{canExport?"You can export workspace data.":"Export is not enabled for your account."}</p></div><div className="card s12"><div className="top" style={{marginBottom:16}}><div><div className="eyebrow">ACTIVITY & CONSENT AUDIT</div><h2>Recent user activity</h2><p className="muted">Authenticated workspace activity and recorded policy consent, visible only inside the private control center.</p></div><span className="status">{(control?.events||[]).length} events · {(control?.consents||[]).length} consent records</span></div><div className="moduleList">{(control?.events||[]).slice(0,20).map(e=><div className="moduleRow" key={e.id}><div className="moduleRowIcon"><Activity size={18}/></div><div className="moduleRowMain"><b>{e.action}</b><span>{e.user_email||e.user_id||"Unknown user"}{e.workspace_name?` · ${e.workspace_name}`:""}</span></div><span className="muted">{new Date(e.created_at).toLocaleString()}</span></div>)}</div><div className="moduleList" style={{marginTop:18}}>{(control?.consents||[]).slice(0,12).map(e=><div className="moduleRow" key={e.id}><div className="moduleRowIcon"><Lock size={18}/></div><div className="moduleRowMain"><b>{e.consent_type} · {e.granted?"Granted":"Declined"}</b><span>{e.user_id} · policy {e.policy_version||"current"} · {e.source||"app"}</span></div><span className="muted">{new Date(e.created_at).toLocaleString()}</span></div>)}</div></div><div className="card s12"><div className="top" style={{marginBottom:16}}><div><div className="eyebrow">ACCESS CONTROL</div><h2>Workspace members</h2><p className="muted">Only the workspace owner can change these permissions.</p></div><span className="status">{members.length} member{members.length===1?"":"s"}</span></div><div className="moduleList">{members.map(m=>{const p=profiles[m.user_id];const owner=m.user_id===workspace.owner_id;return <div className="moduleRow" key={m.user_id}><div className="moduleRowIcon"><UserRound size={18}/></div><div className="moduleRowMain"><b>{p?.full_name||m.user_id.slice(0,8)+"…"}</b><span>{m.role}{owner?" · workspace owner":""}</span></div><span className={m.can_export?"status":"muted"}>{m.can_export?<><Check size={13}/> Export allowed</>:"Export blocked"}</span>{isOwner&&!owner&&<><button className="outlineBtn" disabled={busy===m.user_id} onClick={()=>toggleExport(m)}>{m.can_export?"Revoke export":"Allow export"}</button><button className="outlineBtn" disabled={busy==="remove-"+m.user_id} onClick={()=>removeMember(m)} title="Remove workspace access"><Trash2 size={15}/></button></>}</div>})}</div><div className="card s12"><div className="top" style={{marginBottom:16}}><div><div className="eyebrow">CONTROL CENTER TEAM</div><h2>Admin access</h2><p className="muted">Grant or revoke access to this private area.</p></div><span className="status">{(control?.members||[]).filter(x=>x.active).length} active</span></div><div className="urlImport"><input placeholder="name@company.com" value={grantEmail} onChange={e=>setGrantEmail(e.target.value)}/><select value={grantRole} onChange={e=>setGrantRole(e.target.value)}><option value="viewer">Viewer</option><option value="admin">Admin</option></select><button className="btn primary" disabled={ccBusy==="grant"} onClick={grantAccess}><UserPlus size={15}/>Grant access</button></div>{ccMessage&&<div className="message">{ccMessage}</div>}<div className="moduleList">{(control?.members||[]).map(m=><div className="moduleRow" key={m.id}><div className="moduleRowIcon"><ShieldCheck size={18}/></div><div className="moduleRowMain"><b>{m.email}</b><span>{m.role}{m.email===user?.email?" · you":""}{!m.active?" · revoked":""}</span></div>{m.active&&m.email!==user?.email&&<button className="outlineBtn" disabled={ccBusy===m.email} onClick={()=>revokeAccess(m.email)}><Trash2 size={15}/>Revoke</button>}</div>)}</div></div>
<div className="card s12"><div className="top" style={{marginBottom:16}}><div><div className="eyebrow">ALL USERS</div><h2>User search</h2><p className="muted">Search signed-up Alpha.ai users and select one for notification.</p></div><span className="status">{(control?.users||[]).length} users</span></div><div className="searchBox"><Search size={16}/><input value={userQuery} onChange={e=>setUserQuery(e.target.value)} placeholder="Search by email or name…"/></div><div className="moduleList">{filteredUsers.map(u=><div className="moduleRow" key={u.id}><div className="moduleRowIcon"><UserRound size={18}/></div><div className="moduleRowMain"><b>{u.profile?.full_name||u.email}</b><span>{u.email} · {u.workspaces?.length||0} owned workspace{u.workspaces?.length===1?"":"s"}</span></div><button className="outlineBtn" onClick={()=>setNotifyUserId(u.id)}><Bell size={14}/>Notify</button></div>)}</div></div>
<div className="card s12"><div className="eyebrow">NOTIFICATIONS</div><h2>Send in-app notification</h2><div className="urlImport"><input placeholder="Recipient user id" value={notifyUserId} onChange={e=>setNotifyUserId(e.target.value)}/><input placeholder="Title" value={notifyTitle} onChange={e=>setNotifyTitle(e.target.value)}/></div><textarea className="assistantInput" placeholder="Message" value={notifyMessage} onChange={e=>setNotifyMessage(e.target.value)}/><button className="btn primary" disabled={ccBusy==="notify"} onClick={sendNotification}><Bell size={15}/>Send notification</button></div>
<div className="card s12"><div className="top" style={{marginBottom:16}}><div><div className="eyebrow">AUDIT LOG</div><h2>Control Center actions</h2></div><span className="status">{(control?.audit||[]).length} entries</span></div><div className="moduleList">{(control?.audit||[]).slice(0,30).map(a=><div className="moduleRow" key={a.id}><div className="moduleRowIcon"><FileText size={18}/></div><div className="moduleRowMain"><b>{a.action}</b><span>{JSON.stringify(a.metadata||{})}</span></div><span className="muted">{new Date(a.created_at).toLocaleString()}</span></div>)}</div></div>
</div></div></main></div>;
}
