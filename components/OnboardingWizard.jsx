"use client";
import{useState}from"react";
import{ArrowRight,ChevronRight,ShieldCheck}from"lucide-react";
import{supabase}from"../lib/supabase";

export default function OnboardingWizard({user,workspace,onComplete}){
  const[step,setStep]=useState(0);
  const[name,setName]=useState((workspace?.name||"").replace(/'s Workspace$/,"")||"My Workspace");
  const[role,setRole]=useState("Creator");
  const[format,setFormat]=useState("Vertical 9:16");
  const[brand,setBrand]=useState("Keep it clean");
  const[busy,setBusy]=useState(false);
  const[error,setError]=useState("");

  const steps=[
    {key:"Workspace",title:"Name your workspace",sub:"This is the home for your projects, videos, clips and publishing pipeline."},
    {key:"Profile",title:"Tell Alpha.ai what you create",sub:"A little context helps organize your workspace. Nothing is locked in."},
    {key:"Output",title:"Choose your default format",sub:"We'll use this as the starting point when you create clips."},
    {key:"Brand",title:"Set your editing direction",sub:"Start simple. You can add a full brand kit later."}
  ];
  const current=steps[step];

  const finish=async()=>{
    if(step===0&&!name.trim()){setError("Give your workspace a name.");return}
    if(step<steps.length-1){setError("");setStep(step+1);return}
    setBusy(true);setError("");
    try{
      const preferences={role,format,brand,completed_at:new Date().toISOString()};const{error:e1}=await supabase.from("workspaces").update({name:name.trim()+"'s Workspace",metadata:{...(workspace?.metadata||{}),onboarding:preferences}}).eq("id",workspace.id);
      if(e1)throw e1;
      await supabase.from("profiles").update({full_name:user.user_metadata?.full_name||name.trim()}).eq("id",user.id);
      localStorage.setItem("alpha:onboarded:"+user.id,"1");
      localStorage.setItem("alpha:preferences:"+user.id,JSON.stringify(preferences));
      onComplete({...workspace,name:name.trim()+"'s Workspace"});
    }catch(e){setError(e?.message||"Could not save workspace details.")}finally{setBusy(false)}
  };

  return <div className="onboardingBackdrop">
    <div className="onboardingCard">
      <div className="onboardingTop">
        <div>
          <div className="eyebrow">WELCOME TO ALPHA.AI</div>
          <div className="onboardingProgress">{steps.map((s,i)=><span key={s.key} className={i<=step?"on":""}/>)}</div>
        </div>
        <span className="onboardingCount">{step+1} / {steps.length}</span>
      </div>

      <div className="onboardingSlide" key={step}>
        <div className="onboardingIcon"><span>{String(step+1).padStart(2,"0")}</span></div>
        <div className="onboardingCopy"><b>{current.key}</b><h2>{current.title}</h2><p>{current.sub}</p></div>
        <div className="onboardingBody">
          {step===0&&<><label className="onboardLabel">Workspace name<input className="onboardInput" autoFocus value={name} onChange={e=>setName(e.target.value)} placeholder="e.g. Techstudio Content"/></label><div className="onboardHint"><span>✓</span>You can change this later in Settings.</div></>}
          {step===1&&<div className="onboardChoices">{["Creator","Agency","Podcast team","Marketing team","Business"].map(x=><button type="button" key={x} className={role===x?"choice selected":"choice"} onClick={()=>setRole(x)}>{x}<ChevronRight size={15}/></button>)}</div>}
          {step===2&&<div className="onboardChoices">{["Vertical 9:16","Square 1:1","Landscape 16:9"].map(x=><button type="button" key={x} className={format===x?"choice selected":"choice"} onClick={()=>setFormat(x)}>{x}<span>{format===x?"Selected":"Set default"}</span></button>)}</div>}
          {step===3&&<div className="onboardChoices">{["Keep it clean","Bold captions","Minimal captions","High-energy"].map(x=><button type="button" key={x} className={brand===x?"choice selected":"choice"} onClick={()=>setBrand(x)}>{x}<span>{brand===x?"Selected":"Choose"}</span></button>)}</div>}
        </div>
      </div>

      {error&&<div className="message onboardError">{error}</div>}
      <div className="onboardingFooter">
        <button className="onboardBack" disabled={step===0||busy} onClick={()=>setStep(step-1)}>Back</button>
        <button className="btn primary onboardNext" disabled={busy} onClick={finish}>{busy?"Saving…":step===steps.length-1?"Enter Alpha.ai":"Next"}<ArrowRight size={16}/></button>
      </div>
      <div className="onboardingPrivacy"><ShieldCheck size={14}/>Workspace settings stay private to your account.</div>
    </div>
  </div>
}
