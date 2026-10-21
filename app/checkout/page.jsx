"use client";

import {useEffect,useState} from "react";
import Link from "next/link";
import {useRouter} from "next/navigation";
import {supabase} from "../../lib/supabase";

const money = (paise) => new Intl.NumberFormat("en-IN",{style:"currency",currency:"INR",maximumFractionDigits:2}).format(Number(paise||0)/100);

export default function CheckoutPage(){
  const router=useRouter();
  const [plan,setPlan]=useState("pro");
  const [interval,setInterval]=useState("monthly");
  const [session,setSession]=useState(null);
  const [workspace,setWorkspace]=useState(null);
  const [order,setOrder]=useState(null);
  const [upiUri,setUpiUri]=useState("");
  const [utr,setUtr]=useState("");
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");
  useEffect(()=>{
    const params=new URLSearchParams(window.location.search);
    setPlan(params.get("plan")==="studio"?"studio":"pro");
    setInterval(params.get("interval")==="yearly"?"yearly":"monthly");
    let alive=true;
    (async()=>{
      if(!supabase){if(alive)setMessage("Sign-in service is unavailable. Please try again later.");return;}
      const {data}=await supabase.auth.getSession();
      if(!data.session){if(alive)setMessage("Sign in to purchase a plan.");return;}
      if(!alive)return;
      setSession(data.session);
      const {data:workspaces,error}=await supabase.from("workspaces").select("id,name").eq("owner_id",data.session.user.id).limit(1);
      if(!alive)return;
      if(error){setMessage("We couldn't load your workspace. Refresh and try again.");return;}
      if(!workspaces?.length){setMessage("Create your workspace in Studio before purchasing.");return;}
      setWorkspace(workspaces[0]);
    })();
    return()=>{alive=false};
  },[]);
  async function createOrder(){
    if(!session||!workspace)return;
    setBusy(true);setMessage("");
    try{
      const {data:refreshed}=await supabase.auth.refreshSession();
      const token=refreshed?.session?.access_token||session.access_token;
      const response=await fetch("/api/billing/upi/orders",{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+token},body:JSON.stringify({workspace_id:workspace.id,plan,billing_interval:interval})});
      const data=await response.json();
      if(!response.ok)throw new Error(data.error||"Unable to create payment order.");
      setOrder(data.order);setUpiUri(data.upi_uri);
    }catch(error){setMessage(error.message||"Unable to create payment order.");}
    finally{setBusy(false);}
  }
  async function submitUtr(){
    if(!order||!session||!workspace)return;
    setBusy(true);setMessage("");
    try{
      const response=await fetch("/api/billing/upi/submit",{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+session.access_token},body:JSON.stringify({order_id:order.id,workspace_id:workspace.id,utr:utr.trim()})});
      const data=await response.json();
      if(!response.ok)throw new Error(data.error||"Could not submit UTR.");
      setMessage("Payment reference submitted. Access will be enabled after payment verification.");
    }catch(error){setMessage(error.message||"Could not submit payment reference.");}
    finally{setBusy(false);}
  }
  const label=plan==="studio"?"Studio":"Creator";
  return <main className="seo-page" style={{maxWidth:760,margin:"0 auto",padding:"48px 20px"}}>
    <Link href="/pricing" style={{textDecoration:"underline"}}>← Back to pricing</Link>
    <p style={{marginTop:28,fontSize:12,letterSpacing:2}}>ALPHA.AI SECURE CHECKOUT</p>
    <h1 style={{fontSize:"clamp(30px,5vw,44px)",marginTop:8}}>Subscribe to {label}</h1>
    <p style={{marginTop:10}}>UPI checkout · INR · Payment is manually verified before access is activated.</p>
    {!order?<section style={{marginTop:28,padding:24,border:"1px solid var(--border)",borderRadius:20}}>
      <h2 style={{fontSize:22}}>Your plan</h2>
      <div style={{display:"flex",gap:12,flexWrap:"wrap",marginTop:16}}>
        <button onClick={()=>setPlan("pro")} aria-pressed={plan==="pro"}>Creator / Pro</button>
        <button onClick={()=>setPlan("studio")} aria-pressed={plan==="studio"}>Studio</button>
      </div>
      <div style={{display:"flex",gap:12,flexWrap:"wrap",marginTop:12}}>
        <button onClick={()=>setInterval("monthly")} aria-pressed={interval==="monthly"}>Monthly</button>
        <button onClick={()=>setInterval("yearly")} aria-pressed={interval==="yearly"}>Yearly</button>
      </div>
      <p style={{fontSize:30,fontWeight:700,marginTop:22}}>{plan==="pro"?(interval==="monthly"?"₹499 / month":"₹4,999 / year"):(interval==="monthly"?"₹1,499 / month":"₹14,999 / year")}</p>
      <p style={{fontSize:13,marginTop:8}}>Workspace: {workspace?.name||"Loading workspace…"}</p>
      <button disabled={!session||!workspace||busy} onClick={createOrder} style={{marginTop:20,padding:"12px 18px",borderRadius:12,fontWeight:700,background:"var(--foreground)",color:"var(--background)",opacity:busy?.65:1}}>{busy?"Creating order…":"Create UPI payment"}</button>
      {!session&&<p style={{marginTop:14}}> <Link href="/studio" style={{textDecoration:"underline"}}>Sign in to continue</Link></p>}
    </section>:<section style={{marginTop:28,padding:24,border:"1px solid var(--border)",borderRadius:20}}>
      <p style={{fontSize:13}}>Order reference: <strong>{order.reference}</strong></p>
      <p style={{fontSize:30,fontWeight:700,marginTop:8}}>{money(order.amount_paise)}</p>
      <p style={{marginTop:8}}>Open your UPI app and scan this QR, or use the UPI link.</p>
      <div style={{display:"flex",justifyContent:"center",padding:16,marginTop:12}}><img width="260" height="260" alt="UPI payment QR code" src={"https://api.qrserver.com/v1/create-qr-code/?size=260x260&data="+encodeURIComponent(upiUri)}/></div>
      <a href={upiUri} style={{display:"inline-block",textDecoration:"underline",marginTop:8}}>Open UPI app</a>
      <p style={{fontSize:12,marginTop:12}}>After paying, enter the 12-digit UTR / bank reference below. Do not submit until the payment succeeds in your UPI app.</p>
      <form onSubmit={e=>{e.preventDefault();submitUtr()}} style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:14}}>
        <input value={utr} onChange={e=>setUtr(e.target.value.replace(/\D/g,"").slice(0,12))} inputMode="numeric" pattern="\d{12}" minLength={12} maxLength={12} placeholder="12-digit UTR" required aria-label="12-digit UTR" style={{padding:12,border:"1px solid var(--border)",borderRadius:10,flex:"1 1 200px",background:"transparent"}}/>
        <button disabled={busy||utr.length!==12} style={{padding:"12px 16px",borderRadius:10,fontWeight:700,background:"var(--foreground)",color:"var(--background)"}}>{busy?"Submitting…":"Submit payment reference"}</button>
      </form>
      <p style={{fontSize:12,marginTop:14}}>This is manual UPI checkout, not automatic recurring Autopay. Your plan remains pending until an administrator verifies payment.</p>
    </section>}
    {message&&<p role="status" style={{marginTop:18,padding:12,borderRadius:10,border:"1px solid var(--border)"}}>{message}</p>}
  </main>;
}
