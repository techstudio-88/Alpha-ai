"use client";
import{useEffect,useState}from"react";
import{FileText,ShieldCheck,Cookie,X}from"lucide-react";
const KEY="alpha.consent.v2";
export default function ConsentBanner({supabase}){
 const[show,setShow]=useState(false),[busy,setBusy]=useState(false),[doc,setDoc]=useState(null);
 useEffect(()=>{try{setShow(!localStorage.getItem(KEY))}catch{setShow(true)}},[]);
 const save=async(granted)=>{
  if(busy)return;setBusy(true);
  try{
   if(supabase){const{data:{session}}=await supabase.auth.getSession();if(session?.access_token){for(const type of["terms","privacy","cookies"]){const value=type==="cookies"?granted:true;const r=await fetch("/api/consent",{method:"POST",headers:{authorization:"Bearer "+session.access_token,"content-type":"application/json"},body:JSON.stringify({consentType:type,granted:value})});if(!r.ok)throw new Error("Could not save consent.")}}}
   localStorage.setItem(KEY,granted?"accepted":"necessary");setShow(false);
  }catch(e){setDoc({type:"error",title:"Consent could not be saved",body:e.message||"Could not save consent."})}finally{setBusy(false)}
 };
 if(!show)return null;
 return <div className="alphaConsentOverlay"><div className="alphaConsentCard"><div className="eyebrow">YOUR PRIVACY</div><h3>Before you continue</h3><p>Alpha.ai uses necessary browser storage for sign-in, session continuity and security. We record your policy decision and do not intentionally collect unrelated browsing activity.</p><div className="alphaConsentLinks"><a href="/terms"><FileText size={14}/> Terms</a><a href="/privacy"><ShieldCheck size={14}/> Privacy</a><button type="button" onClick={()=>setDoc({type:"cookies",title:"Cookies",body:"Necessary browser storage may support authentication, session continuity and security. The consent system records the decision, not raw cookie values."})}><Cookie size={14}/> Cookies</button></div><div className="alphaConsentActions"><button className="btn" disabled={busy} onClick={()=>save(false)}>Use necessary cookies only</button><button className="btn primary" disabled={busy} onClick={()=>save(true)}>Agree & continue</button></div></div>{doc&&<div className="modal" onClick={()=>setDoc(null)}><div className="modalCard" onClick={e=>e.stopPropagation()}><button className="close" onClick={()=>setDoc(null)}><X size={18}/></button><div className="eyebrow">ALPHA.AI POLICY</div><h2>{doc.title}</h2><p className="muted">{doc.body}</p><button className="btn primary" onClick={()=>setDoc(null)}>Close</button></div></div>}</div>;
}