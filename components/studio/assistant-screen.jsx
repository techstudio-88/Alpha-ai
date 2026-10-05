"use client";
import {useEffect,useRef,useState} from 'react';
import {ArrowRight,Clapperboard,Send,WandSparkles} from 'lucide-react';
import {normalizeEditorDraft,planEditorCommand} from '../../lib/editor-assistant.mjs';
import {SAMPLE,studioApi,useRows,useStudio} from './data';
import {Button,ErrorState,Select,formatTime} from './ui';
import {Heading} from './project-screens';

export default function AssistantScreen(){
  const {workspace,demo,clipId,navigate}=useStudio();
  const clips=useRows('clips','*,projects!inner(workspace_id)');
  const [selected,setSelected]=useState(clipId||'workspace'),[prompt,setPrompt]=useState(''),[messages,setMessages]=useState([]);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[editRequest,setEditRequest]=useState('');
  const request=useRef(null),log=useRef(null);
  const clip=(clips.data||[]).find(c=>c.id===selected);
  useEffect(()=>{request.current?.abort();setBusy(false);setError('');setEditRequest('');setMessages([]);return()=>request.current?.abort()},[workspace.id,selected]);
  useEffect(()=>{log.current?.scrollTo({top:log.current.scrollHeight,behavior:'instant'})},[messages]);
  const quick=clip?['Split it in two parts','Remove captions','Write three stronger titles','Draft a YouTube description']:['What should I work on next?','Help me plan a week of clips','How can I improve my opening hook?'];
  async function ask(e){
    e.preventDefault();const content=prompt.trim();if(!content||busy)return;
    setBusy(true);setError('');setEditRequest('');setMessages(v=>[...v,{role:'user',content}].slice(-40));setPrompt('');
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
  return <><Heading title="AI assistant" description="Bring a clip, a question, or a plan. Get context-aware guidance and take edits into the editor."/>
    <div className="workspace-assistant-grid">
      <section className="panel workspace-assistant-context"><span className="assistant-label"><Clapperboard size={16}/>YOUR CONTEXT</span>
        {clips.error?<ErrorState message={clips.error} onRetry={clips.retry}/>:<Select label="Assistant context" value={selected} onValueChange={setSelected} disabled={clips.loading} options={[{value:'workspace',label:'Entire workspace'},...(clips.data||[]).map(c=>({value:c.id,label:c.title||'Untitled clip'}))]}/>}
        {clip?<><h2>{clip.title}</h2><p className="text-xs text-muted">{formatTime(clip.start_seconds)}–{formatTime(clip.end_seconds)} · selected clip</p><Button onClick={()=>navigate('editor',{project:clip.project_id,clip:clip.id})}>Open manual editor<ArrowRight size={14}/></Button></>:<p className="text-sm text-muted">Choose a clip for focused editing requests, caption changes, titles, or publishing copy.</p>}
        <div className="assistant-quick-actions">{quick.map(q=><Button key={q} size="sm" onClick={()=>setPrompt(q)}>{q}</Button>)}</div>
        <p className="text-xs text-muted">{demo?'Sample responses are illustrative. No real video or account is changed.':'Advice and copy are drafts. Clip edits are reviewed in the editor before rendering.'}</p>
      </section>
      <section className="panel workspace-assistant-chat"><div className="assistant-chat-heading"><WandSparkles size={18}/><h2>Alpha assistant</h2>{messages.length>0&&<Button size="sm" variant="ghost" disabled={busy} onClick={()=>{setMessages([]);setEditRequest('')}}>Clear conversation</Button>}</div>
        <div ref={log} className="workspace-chat-log" role="log" aria-label="Workspace assistant conversation" aria-live="polite">{messages.length?messages.map((m,i)=><div key={i} className={`chat-bubble ${m.role}`}>{m.content}</div>):<div className="assistant-welcome"><WandSparkles size={32}/><h3>Make your next move clearer.</h3><p>Ask about your projects, draft publishing copy, or describe an edit to a selected clip.</p></div>}{busy&&<p className="text-xs text-muted" role="status">Preparing a response…</p>}</div>
        {error&&<p role="alert" className="text-xs text-destructive">{error}</p>}
        {editRequest&&clip&&<Button className="mb-4" onClick={()=>navigate('editor',{project:clip.project_id,clip:clip.id,instruction:editRequest})}>Review edit in the editor<ArrowRight size={14}/></Button>}
        <form onSubmit={ask}><label className="field">Ask the assistant<textarea className="input" value={prompt} onChange={e=>setPrompt(e.target.value)} maxLength={3000} placeholder={clip?'How should I change this clip?':'What would you like to work on?'}/></label><Button type="submit" variant="primary" busy={busy} disabled={!prompt.trim()}><Send size={15}/>Send message</Button></form>
      </section>
    </div></>;
}
