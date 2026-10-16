"use client";
import {useEffect,useRef,useState} from 'react';
import {ArrowRight,Check,Clapperboard,Film,MessageCircle,Send,WandSparkles} from 'lucide-react';
import {normalizeEditorDraft,planEditorCommand} from '../../lib/editor-assistant.mjs';
import {SAMPLE,studioApi,useRows,useStudio} from './data';
import {Button,ErrorState,ScreenSkeleton,Select,formatTime} from './ui';
import {Heading} from './project-screens';

const DEFAULT_BRIEF={captions:true,captionStyle:'pop',broll:false,transition:'cut'};
function formatSchedule(value,timezone='Asia/Kolkata'){try{return new Intl.DateTimeFormat('en-IN',{dateStyle:'medium',timeStyle:'short',timeZone:timezone}).format(new Date(value))}catch{return 'Scheduled time pending'}}

function OptionButton({active,children,onClick,disabled}){
  return <button type="button" className={`brief-option ${active?'active':''}`} aria-pressed={active} onClick={onClick} disabled={disabled}>
    <span className="brief-option-icon">{active?<Check size={14}/>:null}</span>{children}
  </button>;
}

function ProcessingBrief({preferences,setPreferences,onStart,busy}){
  return <section className="panel processing-brief" aria-labelledby="processing-brief-title">
    <div className="brief-heading"><span className="assistant-label"><MessageCircle size={15}/>A QUICK CREATIVE BRIEF</span><span className="brief-step">Optional · 30 sec</span></div>
    <h2 id="processing-brief-title">How should Alpha shape this cut?</h2>
    <p className="text-sm text-muted">Answer only what matters. Alpha will preserve the source, find complete thoughts, and avoid adding effects you did not ask for.</p>
    <div className="brief-question"><div><b>Should captions be added?</b><span>Word-timed captions are burned into each first render.</span></div><div className="brief-options"><OptionButton active={preferences.captions} onClick={()=>setPreferences(v=>({...v,captions:true}))}>Yes, captions</OptionButton><OptionButton active={!preferences.captions} onClick={()=>setPreferences(v=>({...v,captions:false}))}>No captions</OptionButton></div></div>
    {preferences.captions&&<div className="brief-question brief-question-sub"><div><b>Caption energy</b><span>Change this later in the editor.</span></div><div className="brief-options"><OptionButton active={preferences.captionStyle==='pop'} onClick={()=>setPreferences(v=>({...v,captionStyle:'pop'}))}>Word pop</OptionButton><OptionButton active={preferences.captionStyle==='bold'} onClick={()=>setPreferences(v=>({...v,captionStyle:'bold'}))}>Bold</OptionButton><OptionButton active={preferences.captionStyle==='minimal'} onClick={()=>setPreferences(v=>({...v,captionStyle:'minimal'}))}>Minimal</OptionButton></div></div>}
    <div className="brief-question"><div><b>Should Alpha suggest B-roll?</b><span>Suggestions are a plan for review; stock footage is never inserted without your approval.</span></div><div className="brief-options"><OptionButton active={preferences.broll} onClick={()=>setPreferences(v=>({...v,broll:true}))}>Suggest moments</OptionButton><OptionButton active={!preferences.broll} onClick={()=>setPreferences(v=>({...v,broll:false}))}>Keep it clean</OptionButton></div></div>
    <div className="brief-question"><div><b>Transitions</b><span>Clean cuts are the default. Nothing flashy is automatic.</span></div><div className="brief-options"><OptionButton active={preferences.transition==='cut'} onClick={()=>setPreferences(v=>({...v,transition:'cut'}))}>Clean cuts</OptionButton><OptionButton active={preferences.transition==='fade'} onClick={()=>setPreferences(v=>({...v,transition:'fade'}))}>Soft fades</OptionButton></div></div>
    <div className="brief-footer"><span className="text-xs text-muted">You can change captions, pacing, framing, and cuts in Editor.</span><Button variant="primary" onClick={onStart} busy={busy}>Start processing<ArrowRight size={15}/></Button></div>
  </section>;
}

export default function AssistantScreen(){
  const {workspace,demo,clipId,projectId,jobId,afterUpload,navigate,notify}=useStudio();
  const clips=useRows('clips','*,projects!inner(workspace_id)');
  const jobs=useRows('processing_jobs','id,project_id,status,progress,current_stage,error,payload',{projectId,poll:Boolean(jobId)});
  const pendingParts=useRows('pending_processing_parts','id,parent_job_id,part_number,start_seconds,end_seconds,usage_date,timezone,scheduled_for,status',{projectId,poll:Boolean(jobId)});
  const [selected,setSelected]=useState(clipId||'workspace'),[prompt,setPrompt]=useState(''),[messages,setMessages]=useState([]);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[editRequest,setEditRequest]=useState('');
  const [preferences,setPreferences]=useState(DEFAULT_BRIEF),[briefBusy,setBriefBusy]=useState(false);
  const [quotaAction,setQuotaAction]=useState(''),[dismissedQuotaPlanJob,setDismissedQuotaPlanJob]=useState('');
  const request=useRef(null),log=useRef(null);
  const clip=(clips.data||[]).find(c=>c.id===selected);
  const activeJob=(jobs.data||[]).find(job=>job.id===jobId)||(jobs.data||[])[0];
  const needsBrief=Boolean(afterUpload&&jobId&&activeJob?.status==='awaiting_preferences');
  const quotaPlan=activeJob?.payload?.videoQuotaPlan;
  const showQuotaPlan=Boolean(quotaPlan?.split&&Number(quotaPlan.pendingParts)>0&&dismissedQuotaPlanJob!==activeJob?.id);
  const scheduledParts=(pendingParts.data||[]).filter(part=>part.parent_job_id===activeJob?.id&&part.status==='pending');

  useEffect(()=>{request.current?.abort();setBusy(false);setError('');setEditRequest('');setMessages([]);return()=>request.current?.abort()},[workspace.id,selected]);
  useEffect(()=>{if(needsBrief)setMessages([{role:'assistant',content:'Your video is uploaded and safe. Before I start processing, tell me what matters for this cut. You can use the defaults and change everything later in Editor.'}])},[needsBrief]);
  useEffect(()=>{log.current?.scrollTo({top:log.current.scrollHeight,behavior:'instant'})},[messages]);
  const quick=clip?['Split it in two parts','Remove captions','Write three stronger titles','Draft a YouTube description']:['What should I work on next?','Help me plan a week of clips','How can I improve my opening hook?'];
  async function startProcessing(){
    if(!jobId||!projectId)return;
    setBriefBusy(true);setError('');
    try{
      const result=await studioApi('/api/processing-preferences',{body:{workspaceId:workspace.id,projectId,jobId,preferences}});
      if(result.warning)notify(result.warning);
      else notify('Processing started. Alpha is finding the strongest complete moments.');
      navigate('project',{project:projectId});
    }catch(err){setError(err.message)}finally{setBriefBusy(false)}
  }
  async function decidePendingPart(partId,action){
    setQuotaAction(partId+':'+action);
    try{
      await studioApi('/api/pending-parts',{body:{workspaceId:workspace.id,partId,action}});
      pendingParts.retry();
      notify(action==='approve'?'Part approved. It will start at its scheduled time.':'Part declined.');
    }catch(err){notify(err.message||'Could not update the pending part.')}
    finally{setQuotaAction('')}
  }
  function applyBriefFromText(content){
    const lower=content.toLowerCase();
    const next={
      ...preferences,
      ...(lower.includes('no caption')||lower.includes('without caption')?{captions:false}:{}),
      ...(lower.includes('caption')&&!lower.includes('no caption')?{captions:true}:{}),
      ...(lower.includes('b-roll')||lower.includes('b roll')?{broll:true}:{}),
      ...(lower.includes('fade')?{transition:'fade'}:{}),
    };
    setPreferences(next);
    const brollText=next.broll?' I’ll suggest B-roll placement ideas for review, but I won’t insert stock footage automatically.':'';
    setMessages(v=>[...v,{role:'assistant',content:`Got it — ${next.captions?'captions stay on':'I’ll leave captions off'}${brollText} Clean cuts remain the default. Use the brief controls when you’re ready to start.`}].slice(-40));
  }
  async function ask(e){
    e.preventDefault();const content=prompt.trim();if(!content||busy)return;
    setBusy(true);setError('');setEditRequest('');setMessages(v=>[...v,{role:'user',content}].slice(-40));setPrompt('');
    if(needsBrief){applyBriefFromText(content);setBusy(false);return}
    const controller=new AbortController();request.current=controller;
    try{
      let text;
      const command=clip?planEditorCommand(content,normalizeEditorDraft({...clip.ai_spec,start:clip.start_seconds,end:clip.end_seconds,title:clip.title,captionStyle:clip.caption_config?.style||'pop'},Number(clip.end_seconds)),demo?SAMPLE.transcript_words:[]):null;
      if(command){text=command.summary+' Open the editor to review and apply this plan.';setEditRequest(content)}
      else if(demo)text=clip?`Sample guidance for “${clip.title}”: lead with the question, keep a complete thought, and finish with one actionable takeaway. For actual transcript-aware titles and descriptions, upload your own video and ask again.`:'Sample guidance: choose one source project, review its strongest moments, and use the editor to prepare two short clips. Live recommendations use your own workspace context after sign-in.';
      else{
        const result=await studioApi('/api/assistant',{body:{workspaceId:workspace.id,prompt:content,history:messages.slice(-6),...(clip?{clipId:clip.id}:{})},signal:AbortSignal.any([controller.signal,AbortSignal.timeout(25000)])});
        text=result.text;
      }
      if(!controller.signal.aborted)setMessages(v=>[...v,{role:'assistant',content:text}].slice(-40));
    }catch(err){if(!controller.signal.aborted)setError(err.message)}finally{if(!controller.signal.aborted)setBusy(false)}
  }
  if(jobs.loading&&afterUpload&&!activeJob)return <><Heading title="Your video is ready for direction" description="One optional conversation before Alpha starts the pipeline."/><ScreenSkeleton/></>;
  return <><Heading title={needsBrief?'Your video is ready for direction':'AI assistant'} description={needsBrief?'Tell Alpha what to preserve. It will not apply effects or B-roll without your say.':'Bring a clip, a question, or a plan. Get context-aware guidance and take edits into the editor.'}/>
    {needsBrief&&<ProcessingBrief preferences={preferences} setPreferences={setPreferences} onStart={startProcessing} busy={briefBusy}/>}
    {showQuotaPlan&&<section className="panel" role="dialog" aria-label="Daily video processing schedule">
      <div className="assistant-chat-heading"><WandSparkles size={18}/><h2>Your video processing schedule</h2><Button size="sm" variant="ghost" onClick={()=>setDismissedQuotaPlanJob(activeJob.id)}>Dismiss</Button></div>
      <p className="text-sm text-muted">This source is longer than the remaining daily video-minute allowance. The original is stored once; each part is processed separately. Unapproved parts expire after 48 hours.</p>
      <div className="brief-question"><div><b>Part 1 · {Math.max(1,Math.round((Number(quotaPlan.partEndSeconds)-Number(quotaPlan.partStartSeconds))/60))} min</b><span>{quotaPlan.deferCurrent?'Scheduled for '+formatSchedule(quotaPlan.scheduledFor,quotaPlan.timezone):'Starting now'}</span></div></div>
      {pendingParts.loading&&scheduledParts.length===0&&<p className="text-sm text-muted">Preparing the later-part schedule…</p>}
      {scheduledParts.map(part=><div key={part.id} className="brief-question">
        <div><b>Part {part.part_number} · {Math.max(1,Math.round((Number(part.end_seconds)-Number(part.start_seconds))/60))} min</b><span>{formatSchedule(part.scheduled_for,part.timezone)} · Awaiting your approval</span></div>
        <div className="brief-options">
          <Button size="sm" variant="primary" disabled={Boolean(quotaAction)} busy={quotaAction===part.id+':approve'} onClick={()=>decidePendingPart(part.id,'approve')}>Approve</Button>
          <Button size="sm" variant="ghost" disabled={Boolean(quotaAction)} busy={quotaAction===part.id+':decline'} onClick={()=>decidePendingPart(part.id,'decline')}>Decline</Button>
        </div>
      </div>)}
      <p className="text-xs text-muted">You can also reschedule approved parts from the Pending page.</p>
    </section>}
    <div className="workspace-assistant-grid">
      <section className="panel workspace-assistant-context"><span className="assistant-label"><Clapperboard size={16}/>{needsBrief?'PROCESSING CONTEXT':'YOUR CONTEXT'}</span>
        {clips.error?<ErrorState message={clips.error} onRetry={clips.retry}/>:<Select label="Assistant context" value={selected} onValueChange={setSelected} disabled={clips.loading} options={[{value:'workspace',label:'Entire workspace'},...(clips.data||[]).map(c=>({value:c.id,label:c.title||'Untitled clip'}))]}/>}
        {needsBrief?<><div className="context-source-icon"><Film size={22}/></div><h2>Processing brief</h2><p className="text-sm text-muted">The upload is complete. Start processing above when the choices feel right. Alpha will look for complete thoughts and a compelling opening.</p></>:clip?<><h2>{clip.title}</h2><p className="text-xs text-muted">{formatTime(clip.start_seconds)}–{formatTime(clip.end_seconds)} · selected clip</p><Button onClick={()=>navigate('editor',{project:clip.project_id,clip:clip.id})}>Open manual editor<ArrowRight size={14}/></Button></>:<p className="text-sm text-muted">Choose a clip for focused editing requests, caption changes, titles, or publishing copy.</p>}
        {!needsBrief&&<div className="assistant-quick-actions">{quick.map(q=><Button key={q} size="sm" onClick={()=>setPrompt(q)}>{q}</Button>)}</div>}
        <p className="text-xs text-muted">{demo?'Sample responses are illustrative. No real video or account is changed.':'Advice and copy are drafts. Clip edits are reviewed in the editor before rendering.'}</p>
      </section>
      <section className="panel workspace-assistant-chat"><div className="assistant-chat-heading"><WandSparkles size={18}/><h2>{needsBrief?'Alpha processing chat':'Alpha assistant'}</h2>{messages.length>0&&<Button size="sm" variant="ghost" disabled={busy||needsBrief} onClick={()=>{setMessages([]);setEditRequest('')}}>Clear conversation</Button>}</div>
        <div ref={log} className="workspace-chat-log" role="log" aria-label="Workspace assistant conversation" aria-live="polite">{messages.length?messages.map((m,i)=><div key={i} className={`chat-bubble ${m.role}`}>{m.content}</div>):<div className="assistant-welcome"><WandSparkles size={32}/><h3>Make your next move clearer.</h3><p>Ask about your projects, draft publishing copy, or describe an edit to a selected clip.</p></div>}{busy&&<p className="text-xs text-muted" role="status">Preparing a response…</p>}</div>
        {error&&<p role="alert" className="text-xs text-destructive">{error}</p>}
        {needsBrief&&<div className="chat-suggestion-row"><button type="button" onClick={()=>setPrompt('Keep captions and use clean cuts')}>Keep the defaults</button><button type="button" onClick={()=>setPrompt('No captions, please')}>No captions</button><button type="button" onClick={()=>setPrompt('Suggest B-roll moments')}>Suggest B-roll</button></div>}
        {editRequest&&clip&&<Button className="mb-4" onClick={()=>navigate('editor',{project:clip.project_id,clip:clip.id,instruction:editRequest})}>Review edit in the editor<ArrowRight size={14}/></Button>}
        <form onSubmit={ask}><label className="field">{needsBrief?'Tell me what you want, or use the choices above':'Ask the assistant'}<textarea className="input" value={prompt} onChange={e=>setPrompt(e.target.value)} maxLength={3000} placeholder={needsBrief?'Example: captions on, no B-roll, keep it clean…':clip?'How should I change this clip?':'What would you like to work on?'}/></label><Button type="submit" variant="primary" busy={busy} disabled={!prompt.trim()}><Send size={15}/>Send message</Button></form>
      </section>
    </div></>;
}
