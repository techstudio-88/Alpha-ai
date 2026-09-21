"use client";
import{useEffect,useState}from"react";
const KEY="alpha.consent.v1";
export default function ConsentBanner({supabase}){
 const[show,setShow]=useState(false),[busy,setBusy]=useState(false);
 useEffect(()=>{try{setShow(localStorage.getItem(KEY)!=="accepted")}catch{setShow(true)}},[]);
 const save=async(granted)=>{
  if(busy)return;setBusy(true);
  try{const{data:{session}}=await supabase.auth.getSession();if(!session?.access_token)throw new Error("Authentication required.");
   for(const type of["terms","privacy","cookies"]){const r=await fetch("/api/consent",{method:"POST",headers:{authorization:"Bearer "+session.access_token,"content-type":"application/json"},body:JSON.stringify({consentType:type,granted})});if(!r.ok)throw new Error("Could not save consent.");}
   localStorage.setItem(KEY,granted?"accepted":"declined");setShow(false);
  }catch(e){alert(e.message||"Could not save consent.")}finally{setBusy(false)}
 };
 if(!show)return null;
 return <div className="alphaConsentOverlay"><div className="alphaConsentCard"><div className="eyebrow">YOUR PRIVACY</div><h3>Before you continue</h3><p>Alpha.ai uses necessary cookies for sign-in and secure app operation. We record your Terms, Privacy and cookie decision with the policy version. We do not collect raw browser cookies or unrelated browsing activity.</p><div className="alphaConsentLinks"><button type="button" onClick={()=>alert("Terms: you are responsible for media and instructions you submit and for having the rights to process them. AI-generated output should be reviewed before publishing.")}>Terms</button><button type="button" onClick={()=>alert("Privacy: Alpha.ai processes account, workspace, project, media, transcript and application-activity information needed to operate the service. Raw browser cookies and unrelated browsing history are not intentionally collected.")}>Privacy</button><button type="button" onClick={()=>alert("Cookies: necessary browser storage/cookies may support authentication, session continuity and security. The consent system records the decision and policy version, not raw cookie values.")}>Cookies</button></div><div className="alphaConsentActions"><button className="btn" disabled={busy} onClick={()=>save(false)}>Decline optional use</button><button className="btn primary" disabled={busy} onClick={()=>save(true)}>Agree & continue</button></div></div></div>;
}
