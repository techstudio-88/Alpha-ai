"use client";
import{useEffect,useMemo,useRef,useState}from"react";
import{FolderOpen,Search,Video,FileVideo,Loader2,Check,ArrowRight,RefreshCw}from"lucide-react";
import{supabase}from"../lib/supabase";

const CLIENT_ID=process.env.NEXT_PUBLIC_GOOGLE_DRIVE_CLIENT_ID||"";
const SCOPE="https://www.googleapis.com/auth/drive.file";

export default function GoogleDriveBrowser({workspaceId,userId,onImported,onError}){
 const[token,setToken]=useState("");const[files,setFiles]=useState([]);const[q,setQ]=useState("");const[selected,setSelected]=useState(null);const[loading,setLoading]=useState(false);const[importing,setImporting]=useState(false);const[ready,setReady]=useState(false);const tokenClient=useRef(null);
 useEffect(()=>{if(!CLIENT_ID)return;let s=document.querySelector('script[src="https://accounts.google.com/gsi/client"]');if(!s){s=document.createElement("script");s.src="https://accounts.google.com/gsi/client";s.async=true;s.defer=true;s.onload=()=>setReady(true);document.head.appendChild(s)}else setReady(true)},[]);
 useEffect(()=>{if(ready&&window.google?.accounts?.oauth2){tokenClient.current=window.google.accounts.oauth2.initTokenClient({client_id:CLIENT_ID,scope:SCOPE,prompt:"consent",callback:()=>{}})}},[ready]);
 const authorize=()=>{if(!CLIENT_ID)return onError?.("Google Drive is not configured. Add NEXT_PUBLIC_GOOGLE_DRIVE_CLIENT_ID in Vercel.");if(!tokenClient.current)return onError?.("Google authorization is still loading.");tokenClient.current.callback=async r=>{if(r.error)return onError?.("Google authorization was not completed.");setToken(r.access_token);await loadFiles(r.access_token)};tokenClient.current.requestAccessToken({prompt:token?"":"consent"})};
 const loadFiles=async t=>{setLoading(true);try{const params=new URLSearchParams({pageSize:"100",orderBy:"modifiedTime desc",fields:"files(id,name,mimeType,size,modifiedTime,thumbnailLink,capabilities,webViewLink),nextPageToken",q:"trashed=false and mimeType contains 'video/'"});const r=await fetch("https://www.googleapis.com/drive/v3/files?"+params,{headers:{Authorization:"Bearer "+t}});const d=await r.json();if(!r.ok)throw new Error(d.error?.message||"Unable to list Google Drive files.");setFiles(d.files||[])}catch(e){onError?.(e.message)}finally{setLoading(false)}};
 const filtered=useMemo(()=>{const x=q.trim().toLowerCase();return x?files.filter(f=>f.name.toLowerCase().includes(x)):files},[files,q]);
 const importFile=async()=>{if(!selected||!token)return;setImporting(true);try{const{data:{session}}=await supabase.auth.getSession();const r=await fetch("/api/google-drive/import",{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+(session?.access_token||"")},body:JSON.stringify({accessToken:token,file:selected,workspaceId,userId})});const d=await r.json();if(!r.ok)throw new Error(d.error||"Google Drive import failed.");onImported?.(d)}catch(e){onError?.(e.message)}finally{setImporting(false)}};
 if(!CLIENT_ID)return <div className="driveBrowser"><div className="driveSetup"><FolderOpen size={24}/><h3>Connect Google Drive</h3><p>Add your Google OAuth web client ID to enable the secure Drive picker.</p></div></div>;
 return <div className="driveBrowser">
  {!token?<div className="driveConnect"><div className="driveLogo"><FolderOpen size={26}/></div><h3>Import from Google Drive</h3><p>Authorize Alpha.ai to access only Drive files you choose. No broad Drive access is requested.</p><button className="btn primary" onClick={authorize} disabled={!ready}><FolderOpen size={16}/> {ready?"Connect Google Drive":"Loading Google…"} <ArrowRight size={15}/></button></div>:
  <><div className="driveToolbar"><div className="driveSearch"><Search size={16}/><input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search video files…"/></div><button className="btn" onClick={()=>loadFiles(token)} disabled={loading}><RefreshCw size={15}/> Refresh</button></div>
  <div className="driveMeta"><span>{files.length} video files available</span><span>Scope: drive.file</span></div>
  <div className="driveFiles">{loading?<div className="driveEmpty"><Loader2 className="spin" size={22}/> Loading Drive files…</div>:filtered.length?filtered.map(f=><button key={f.id} className={"driveFile "+(selected?.id===f.id?"selected":"")} onClick={()=>setSelected(f)}><div className="driveFileIcon"><FileVideo size={20}/></div><div><b>{f.name}</b><small>{f.mimeType} · {f.size?Math.round(Number(f.size)/1048576)+" MB":"size unavailable"}</small></div>{selected?.id===f.id&&<Check size={18}/>}</button>):<div className="driveEmpty"><Video size={22}/> No video files found.</div>}</div>
  <div className="driveFooter"><span>{selected?<>Selected: <b>{selected.name}</b></>:"Select a video to import."}</span><button className="btn primary" disabled={!selected||importing} onClick={importFile}>{importing?<><Loader2 className="spin" size={15}/> Importing…</>:<>Import video <ArrowRight size={15}/></>}</button></div></>}
 </div>
}
