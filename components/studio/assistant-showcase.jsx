"use client";
import {useState} from 'react';
import {ArrowRight,Check,Scissors,WandSparkles} from 'lucide-react';
import {planEditorCommand} from '../../lib/editor-assistant.mjs';
import {Button,ButtonLink,formatTime} from './ui';

const base={start:0,end:38,title:'A question beats a perfect plan',aspect:'9:16',speed:1,zoom:1,effect:'none',transition:'cut',autoReframe:true,captionStyle:'pop',captionColor:'#ffffff',cutRanges:[],captionOverrides:{}};
const suggestions=['Split it in two parts','Remove captions','Make captions bold'];
export default function AssistantShowcase(){
  const [request,setRequest]=useState(suggestions[0]);
  const plan=planEditorCommand(request,base);
  return <section className="landing-section assistant-showcase" id="ai-editor">
    <div className="section-heading"><span className="eyebrow">YOU DIRECT. THE STUDIO DOES THE DETAILS.</span><h2>An editor you can talk to.<br/><span className="accent-copy">And take over anytime.</span></h2><p>Choose a clip. Describe the change. Review the plan, fine-tune it by hand, and render when it feels right.</p></div>
    <div className="assistant-showcase-grid panel">
      <div className="showcase-chat"><span className="assistant-label"><WandSparkles size={16}/>ALPHA ASSISTANT <small>INTERACTIVE SAMPLE</small></span><h3>What would you change?</h3><div className="showcase-suggestions">{suggestions.map(s=><Button key={s} size="sm" variant={s===request?'primary':'secondary'} onClick={()=>setRequest(s)}>{s}</Button>)}</div><div className="chat-bubble user" key={request}>{request}</div><div className="chat-bubble assistant" key={'reply:'+request}><Check size={15}/><p>{plan.summary}</p></div><ButtonLink href="/studio?demo=1&view=editor&project=11111111-1111-4111-8111-111111111111&clip=clip-0" variant="ghost" className="justify-start px-0">Try the hands-on editor<ArrowRight size={14}/></ButtonLink></div>
      <div className="showcase-result" key={'result:'+request}><div className="flex justify-between text-xs text-muted"><span>YOUR EDIT PLAN</span><span>{plan.parts.length} {plan.parts.length===1?'clip':'clips'}</span></div><div className="showcase-parts">{plan.parts.map((part,i)=><div className="showcase-clip" key={i}><img src="/studio-sample.svg" width="270" height="390" alt="Illustrated clip preview" loading="lazy"/>{part.captionStyle!=='none'&&<span className={`showcase-caption ${part.captionStyle}`}>Start with<br/><mark>a question.</mark></span>}<span className="showcase-time">{formatTime(part.start)} — {formatTime(part.end)}</span></div>)}</div><div className="showcase-edit-track"><Scissors size={14}/>{plan.parts.map((part,i)=><span key={i} style={{flex:part.end-part.start}}>Part {i+1} · {Math.round(part.end-part.start)}s</span>)}</div><p className="text-xs text-muted">This sample changes a plan, not a real video. Your own edits become MP4s after rendering.</p></div>
    </div>
  </section>;
}
