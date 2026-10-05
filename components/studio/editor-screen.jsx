"use client";

import {useEffect,useReducer,useRef,useState} from 'react';
import {ArrowLeft,Check,History,Pause,Play,Redo2,Save,Scissors,Undo2,WandSparkles} from 'lucide-react';
import {supabase} from '../../lib/supabase';
import {allPages,retainedRanges} from '../../lib/video-workflow.mjs';
import {editedDuration,editorHistory,normalizeEditorDraft,planEditorCommand,splitEditorDraft} from '../../lib/editor-assistant.mjs';
import {SAMPLE,studioApi,unwrap,useResource,useStudio} from './data';
import {Button,EmptyState,ErrorState,Input,Modal,ScreenSkeleton,Select,Tabs,Timeline,formatTime} from './ui';
import {Heading} from './project-screens';

const initial=normalizeEditorDraft({start:0,end:38},38);
const initialHistory={present:{draft:initial,parts:[],activePart:-1},past:[],future:[]};
const quickCommands=['Split it in two parts','Remove captions','Make captions bold','Make it vertical'];

export default function EditorScreen(){
  const {demo,workspace,projectId,clipId,navigate,notify,revision,state,refresh,editorPrompt}=useStudio();
  const video=useRef(null),currentState=useRef(null),request=useRef(null);
  const [history,dispatch]=useReducer(editorHistory,initialHistory);
  const {draft,parts,activePart}=history.present;
  const [current,setCurrent]=useState(0),[playing,setPlaying]=useState(false),[safeZone,setSafeZone]=useState(true),[tab,setTab]=useState(editorPrompt?'ai':'captions');
  const [query,setQuery]=useState(''),[selectedWord,setSelectedWord]=useState(null),[correction,setCorrection]=useState('');
  const [historyOpen,setHistoryOpen]=useState(false),[submitting,setSubmitting]=useState(false),[jobs,setJobs]=useState([]),[error,setError]=useState('');
  const [prompt,setPrompt]=useState(editorPrompt||''),[planning,setPlanning]=useState(false),[plan,setPlan]=useState(null),[messages,setMessages]=useState([]),[saved,setSaved]=useState('');
  const draftKey=`alpha.studio.draft:${workspace.id}:${clipId||projectId}`;
  const editor=useResource(async()=>{
    if(demo)return {clip:SAMPLE.clips.find(c=>c.id===clipId)||SAMPLE.clips[0],asset:SAMPLE.media_assets[0],words:SAMPLE.transcript_words,segments:[],versions:SAMPLE.clip_versions,src:''};
    if(!projectId)return null;
    const clip=clipId?unwrap(await supabase.from('clips').select('*').eq('id',clipId).eq('project_id',projectId).maybeSingle()):null;
    if(clipId&&!clip?.id)throw new Error('This clip could not be found in the selected project.');
    let q=supabase.from('media_assets').select('*').eq('workspace_id',workspace.id).eq('project_id',projectId);
    if(clip?.media_asset_id)q=q.eq('id',clip.media_asset_id);
    const asset=unwrap(await q.order('created_at',{ascending:false}).limit(1))[0];
    if(!asset?.storage_path)throw new Error('The original source is not stored. Re-import this video to edit it.');
    const tr=unwrap(await supabase.from('transcripts').select('id').eq('media_asset_id',asset.id).order('created_at',{ascending:false}).limit(1))[0];
    const words=tr?await allPages(async(offset,size)=>unwrap(await supabase.from('transcript_words').select('id,word,start_ms,end_ms').eq('transcript_id',tr.id).order('start_ms').order('id').range(offset,offset+size-1))):[];
    const segments=tr?unwrap(await supabase.from('transcript_segments').select('start_ms,end_ms,speaker').eq('transcript_id',tr.id).order('start_ms').limit(1000)):[];
    const versions=clip?unwrap(await supabase.from('clip_versions').select('id,version,created_at,storage_path,edit_data,render_status').eq('clip_id',clip.id).order('version',{ascending:false})):[];
    const signed=await supabase.storage.from('media').createSignedUrl(asset.storage_path,3600);if(signed.error)throw signed.error;
    return {clip,asset,words,segments,versions,src:signed.data.signedUrl};
  },[projectId,clipId,workspace.id,demo,revision]);
  const data=editor.data,words=data?.words||[],duration=Number(data?.asset?.duration_seconds)||38;
  const pending=jobs.some(j=>!['completed','failed','cancelled'].includes(j.status)),rendering=submitting||pending;

  useEffect(()=>{
    if(!data)return;
    let stored={};if(!demo){try{stored=JSON.parse(localStorage.getItem(draftKey)||'{}')}catch{}}
    const spec=data.clip?.ai_spec||{};
    const base={...spec,start:Number(data.clip?.start_seconds)||0,end:Math.min(duration,Number(data.clip?.end_seconds)||Math.min(45,duration)),title:data.clip?.title||'Edited clip',captionStyle:data.clip?.caption_config?.style||spec.captionStyle||'pop',captionColor:data.clip?.caption_config?.color||spec.captionColor||'#ffffff'};
    let value;
    try{
      const draft=normalizeEditorDraft({...base,...(stored.draft||stored)},duration,words);
      const parts=(stored.parts||[]).slice(0,8).map(p=>normalizeEditorDraft(p,duration,words));
      const activePart=parts.length?Math.min(parts.length-1,Math.max(0,Number(stored.activePart)||0)):-1;
      value={draft:activePart>=0?parts[activePart]:draft,parts,activePart};
    }catch{value={draft:normalizeEditorDraft(base,duration,words),parts:[],activePart:-1}}
    dispatch({type:'reset',value});setCurrent(value.draft.start);setPlaying(false);setSelectedWord(null);setPlan(null);
    setSaved(stored.draft?'Restored device draft':'');
  },[data,draftKey,demo,duration]);

  useEffect(()=>{
    const word=words.find(w=>w.id===selectedWord);
    setCorrection(word?draft.captionOverrides[word.id]??word.word:'');
  },[selectedWord,draft.captionOverrides,data]);
  useEffect(()=>{if(video.current)video.current.playbackRate=draft.speed},[draft.speed]);
  useEffect(()=>{
    if(!demo||!playing)return;
    const timer=setInterval(()=>setCurrent(time=>{
      const next=time+.1*draft.speed,cut=draft.cutRanges.find(c=>next>=c.start&&next<c.end);
      if(next>=draft.end){setPlaying(false);return draft.end}
      return cut?cut.end:Math.max(draft.start,next);
    }),100);return()=>clearInterval(timer);
  },[demo,playing,draft]);
  useEffect(()=>{
    if(!data||demo||(!history.past.length&&!history.future.length))return;
    setSaved('Saving…');const timer=setTimeout(()=>{
      try{localStorage.setItem(draftKey,JSON.stringify({version:2,...history.present}));setSaved('Draft saved on this device')}catch{setSaved('Use Save draft to retry')}
    },1200);return()=>clearTimeout(timer);
  },[history.present,history.past.length,history.future.length,data,demo,draftKey]);
  const jobKey=jobs.map(j=>j.id).join(',');
  useEffect(()=>{
    if(!jobKey||demo)return;
    let alive=true,timer;
    const poll=async()=>{
      try{
        const rows=unwrap(await supabase.from('processing_jobs').select('id,status,error,progress').in('id',jobKey.split(',')));
        if(!alive)return;
        setJobs(rows);
        if(rows.length&&rows.every(j=>['completed','failed','cancelled'].includes(j.status))){
          const failures=rows.filter(j=>j.status!=='completed');
          if(failures.length)setError(failures.map(j=>j.error||'A render was cancelled.').join(' '));
          else notify(rows.length>1?'Your split clips are ready. Open the clip library to review them.':'Your new clip version is ready.');
          refresh();return;
        }
      }catch{if(alive)setError('Progress is temporarily unavailable. Your render jobs are saved and will continue.')}
      if(alive)timer=setTimeout(poll,3000);
    };
    timer=setTimeout(poll,3000);return()=>{alive=false;clearTimeout(timer)};
  },[jobKey,demo,notify,refresh]);
  useEffect(()=>()=>request.current?.abort(),[]);
  useEffect(()=>{
    const onKey=e=>{
      if(e.target instanceof HTMLElement&&e.target.closest('input,textarea,select,button,[contenteditable="true"]'))return;
      if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='z'){e.preventDefault();dispatch({type:e.shiftKey?'redo':'undo'});}
      else if(e.code==='Space'){e.preventDefault();currentState.current?.togglePlay();}
    };
    window.addEventListener('keydown',onKey);return()=>window.removeEventListener('keydown',onKey);
  },[]);

  function seek(time){const t=Math.max(0,Math.min(duration,time));setCurrent(t);if(video.current)video.current.currentTime=t;}
  function togglePlay(){
    if(current<draft.start||current>=draft.end)seek(draft.start);
    if(demo){setPlaying(v=>!v);return}
    if(!video.current)return;
    if(playing){video.current.pause();setPlaying(false)}else video.current.play().then(()=>setPlaying(true)).catch(()=>setError('The preview could not play. Try loading the source again.'));
  }
  currentState.current={present:history.present,togglePlay};
  function change(patch){
    try{
      const candidate={...draft,...patch};
      if(patch.start!=null||patch.end!=null)candidate.cutRanges=draft.cutRanges.map(c=>({start:Math.max(c.start,candidate.start),end:Math.min(c.end,candidate.end)})).filter(c=>c.end>c.start);
      const next=normalizeEditorDraft(candidate,duration,words);
      dispatch({type:'edit',value:{...history.present,draft:next,parts:activePart>=0?parts.map((p,i)=>i===activePart?next:p):parts}});
      setPlan(null);setSaved('Unsaved changes');setError('');
    }catch(err){setError(err.message)}
  }
  function applyParts(proposed){
    try{
      const next=proposed.map(p=>normalizeEditorDraft(p,duration,words));
      let output=parts.length?[...parts]:[];
      if(activePart>=0)output.splice(activePart,1,...next);else if(next.length>1)output=next;
      if(output.length>8)throw new Error('Render at most eight split clips at once.');
      const index=output.length?Math.max(0,activePart):-1;
      dispatch({type:'edit',value:{draft:output.length?output[index]:next[0],parts:output,activePart:index}});
      seek(next[0].start);setPlan(null);setSaved('Unsaved changes');setError('');
    }catch(err){setError(err.message)}
  }
  function split(at){try{applyParts(splitEditorDraft(draft,at));notify('Two clip parts added to your draft. Review them before rendering.')}catch(err){setError(err.message)}}
  function save(){
    if(demo){setSaved('Sample draft updated');return notify('Sample draft updated in this preview.')}
    try{localStorage.setItem(draftKey,JSON.stringify({version:2,...history.present}));setSaved('Draft saved on this device');notify('Draft saved on this device. Rendering creates shared versions.')}catch{setError('This browser could not save the draft.')}
  }
  function removeWord(){
    const word=words.find(w=>w.id===selectedWord);if(!word)return;
    const start=Math.max(draft.start,word.start_ms/1000),end=Math.min(draft.end,word.end_ms/1000);
    const exists=draft.cutRanges.some(c=>c.start<=start&&c.end>=end);
    change({cutRanges:exists?draft.cutRanges.filter(c=>!(c.start<=start&&c.end>=end)):[...draft.cutRanges,{start,end}]});
  }
  async function ask(e){
    e?.preventDefault();const content=prompt.trim();if(!content||planning)return;
    setPlanning(true);setError('');setPlan(null);
    const before=JSON.stringify(history.present);setMessages(v=>[...v,{role:'user',content}].slice(-20));
    try{
      let result=planEditorCommand(content,draft,words);
      if(!result){
        if(demo)throw new Error('The sample supports concrete split, caption, aspect and speed commands. Content-aware Gemini edits are available with your own uploaded video.');
        request.current?.abort();request.current=new AbortController();
        result=await studioApi('/api/editor/assistant',{body:{workspaceId:workspace.id,projectId,mediaAssetId:data.asset.id,clipId:data.clip?.id,prompt:content,draft},signal:AbortSignal.any([request.current.signal,AbortSignal.timeout(25000)])});
      }
      if(before!==JSON.stringify(currentState.current.present))throw new Error('Your selection changed while planning. Ask again for the current draft.');
      setPlan(result);setMessages(v=>[...v,{role:'assistant',content:result.summary}].slice(-20));setPrompt('');
    }catch(err){setError(err.message)}finally{setPlanning(false)}
  }
  async function render(){
    setError('');if(demo){save();notify('Sample draft saved. Sign in to render your own source video.');return}
    setSubmitting(true);
    try{
      const outputs=parts.length?parts:[draft];
      outputs.forEach(d=>normalizeEditorDraft(d,duration,words));
      const result=await studioApi('/api/editor/render',{body:{workspaceId:workspace.id,projectId,mediaAssetId:data.asset.id,clipId:data.clip?.id,...draft,startSeconds:draft.start,endSeconds:draft.end,captions:draft.captionStyle!=='none',...(parts.length?{parts:outputs}:{})}});
      setJobs((result.jobIds||[result.jobId]).map(id=>({id,status:'queued',progress:0})));save();
      notify(result.warning||`${outputs.length>1?outputs.length+' clips':'Your clip'} queued for rendering.`);
    }catch(err){setError(err.message)}finally{setSubmitting(false)}
  }
  const removedWord=w=>draft.cutRanges.some(c=>w.start_ms/1000>=c.start&&w.end_ms/1000<=c.end);
  const activeWord=words.find(w=>current*1000>=w.start_ms&&current*1000<w.end_ms&&!removedWord(w));
  const visibleWords=words.filter(w=>w.start_ms>=draft.start*1000&&w.end_ms<=draft.end*1000&&(!query||String(draft.captionOverrides[w.id]??w.word).toLowerCase().includes(query.toLowerCase())));
  const captionWords=words.filter(w=>w.end_ms>draft.start*1000&&w.start_ms<draft.end*1000&&!removedWord(w));
  const activeIndex=captionWords.findIndex(w=>w.id===activeWord?.id);
  const previewWords=draft.captionStyle==='pop'?(activeWord?[activeWord]:captionWords.slice(0,1)):captionWords.slice(Math.max(0,Math.floor(Math.max(0,activeIndex)/7)*7),Math.max(0,Math.floor(Math.max(0,activeIndex)/7)*7)+7);
  const filters={none:'none',cinematic:'contrast(1.1) saturate(.8)',warm:'sepia(.18) saturate(1.15)',cool:'hue-rotate(12deg)',mono:'grayscale(1)',vibrant:'saturate(1.4)'};
  if(editor.loading)return <ScreenSkeleton/>;
  if(editor.error)return <ErrorState message={editor.error} onRetry={editor.retry}/>;
  if(!data||state==='empty')return <><Heading title="Editor" description="A transcript, a preview, and an assistant that works with your selection."/><EmptyState icon={Scissors} title="Choose a moment to work on." description="Open a clip from your library, or start with a source project." action={<Button onClick={()=>navigate('clips')}>Open clip library</Button>}/></>;
  return <>
    <Button size="sm" variant="ghost" className="mb-4" onClick={()=>navigate('project',{project:projectId||data.clip.project_id})}><ArrowLeft size={14}/>Back to project</Button>
    <Heading title={data.clip?.title||'Edit your source'} description="Edit by hand or describe the change. Both work on the same reversible draft." action={<div className="editor-actions"><Button size="icon" onClick={()=>dispatch({type:'undo'})} disabled={!history.past.length} aria-label="Undo edit"><Undo2 size={15}/></Button><Button size="icon" onClick={()=>dispatch({type:'redo'})} disabled={!history.future.length} aria-label="Redo edit"><Redo2 size={15}/></Button><Button size="sm" onClick={()=>setHistoryOpen(true)} aria-label="Open version history"><History size={14}/><span className="hidden sm:inline">Versions</span></Button><Button size="sm" onClick={save}><Save size={14}/>Save draft</Button><Button size="sm" variant="primary" busy={rendering} onClick={render}>{rendering?'Rendering…':parts.length?`Render ${parts.length} clips`:'Render clip'}</Button></div>}/>
    <div className="editor-status"><span>{saved||'Original source preserved'}</span><span>{editedDuration(draft).toFixed(1)}s output · {draft.aspect}{parts.length?` · Part ${activePart+1} of ${parts.length}`:''}</span></div>
    {error&&<div className="editor-alert" role="alert"><span>{error}</span><Button size="sm" variant="ghost" onClick={()=>setError('')}>Dismiss</Button></div>}
    {jobs.length>0&&<div className="render-progress panel" role="status">{jobs.map((job,i)=><div key={job.id}><span>{jobs.length>1?`Part ${i+1}`:'Clip'} · {job.status}</span><progress aria-label={`Render ${i+1} progress`} max="100" value={job.progress||0}/><span>{job.progress||0}%</span></div>)}{!pending&&<Button size="sm" onClick={()=>navigate('clips',{project:projectId})}>Review rendered clips</Button>}</div>}
    {parts.length>0&&<section className="editor-parts" aria-label="Split clip parts">{parts.map((part,i)=><Button key={i} variant={activePart===i?'primary':'secondary'} aria-pressed={activePart===i} onClick={()=>{dispatch({type:'edit',value:{...history.present,draft:part,activePart:i}});seek(part.start);setPlan(null)}}>Part {i+1}<span>{formatTime(part.start)}–{formatTime(part.end)}</span></Button>)}</section>}
    <div className="editor-grid">
      <section className="panel editor-transcript"><h2>Transcript</h2><Input label="Find a word" placeholder="Search the transcript…" value={query} onChange={e=>setQuery(e.target.value)}/><div className="flex items-center justify-between mt-4 gap-2"><Button size="sm" disabled={!selectedWord} onClick={removeWord}><Scissors size={12}/>{words.find(w=>w.id===selectedWord)&&removedWord(words.find(w=>w.id===selectedWord))?'Restore word':'Remove word'}</Button>{draft.cutRanges.length>0&&<button className="text-xs text-muted underline" onClick={()=>change({cutRanges:[]})}>Reset cuts</button>}</div>
        {words.length?<div className="transcript-words"><span className="transcript-speaker">{data.segments.find(s=>current*1000>=s.start_ms&&current*1000<=s.end_ms)?.speaker||'Speaker'}</span>{visibleWords.map(w=><button key={w.id} className={`${w.id===activeWord?.id?'current':''} ${removedWord(w)?'removed':''}`} aria-pressed={selectedWord===w.id} title={Object.hasOwn(draft.captionOverrides,w.id)?`Original: ${w.word}`:undefined} onClick={()=>{setSelectedWord(w.id);seek(w.start_ms/1000)}}>{draft.captionOverrides[w.id]??w.word}</button>)}</div>:<p className="text-xs text-muted mt-5">Timed words appear when transcription completes. Manual trimming is available now.</p>}
        {selectedWord&&<div className="caption-correction"><Input label="Caption word" value={correction} maxLength={80} onChange={e=>setCorrection(e.target.value)}/><Button size="sm" disabled={!correction.trim()} onClick={()=>change({captionOverrides:{...draft.captionOverrides,[selectedWord]:correction}})}>Apply caption text</Button><p className="text-xs text-muted">Changes captions only. Spoken audio and the source transcript stay intact.</p></div>}
      </section>
      <section className="editor-preview"><div className="editor-preview-stage"><div className={`editor-canvas ${safeZone?'show-safe-zone':''}`} style={{aspectRatio:draft.aspect.replace(':','/')}}>
        {demo?<img src="/studio-sample.svg" alt="Illustrated sample clip preview" width="960" height="540" style={{transform:`scale(${draft.zoom})`,filter:filters[draft.effect]}}/>:<video ref={video} src={data.src} playsInline preload="metadata" aria-label="Source video preview" style={{transform:`scale(${draft.zoom})`,filter:filters[draft.effect]}} onLoadedMetadata={()=>{video.current.currentTime=draft.start;video.current.playbackRate=draft.speed}} onPlay={()=>setPlaying(true)} onPause={()=>setPlaying(false)} onTimeUpdate={()=>{let time=video.current.currentTime;const cut=draft.cutRanges.find(c=>time>=c.start&&time<c.end);if(cut){time=cut.end;video.current.currentTime=time}if(time>=draft.end){video.current.pause();time=draft.end}setCurrent(time)}}/>}
        {draft.captionStyle!=='none'&&<div className={`editor-caption-preview ${draft.captionStyle}`} style={{color:draft.captionColor}} aria-label="Caption preview">{previewWords.map(w=><span key={w.id} className={w.id===activeWord?.id?'active':''}>{draft.captionOverrides[w.id]??w.word}{' '}</span>)}</div>}
        {safeZone&&<div className="editor-safe-zone" aria-hidden="true"/>}
      </div></div><div className="editor-playback"><Button size="icon" variant="ghost" aria-label={playing?'Pause video':'Play video'} onClick={togglePlay}>{playing?<Pause size={18}/>:<Play size={18}/>}</Button><span>{formatTime(current)} / {formatTime(duration)}</span><label><input type="checkbox" checked={safeZone} onChange={e=>setSafeZone(e.target.checked)}/>Safe zones</label></div><p className="text-xs text-muted px-4">Caption and centered framing preview. AI speaker framing and final encoding are applied during rendering.</p></section>
      <section className="panel editor-inspector"><Tabs value={tab} onValueChange={setTab} label="Editor controls" items={[{value:'captions',label:'Captions'},{value:'framing',label:'Framing'},{value:'speed',label:'Speed / zoom'},{value:'ai',label:'AI assistant'}]}/>
        {tab==='captions'&&<div className="editor-controls"><Select label="Caption style" value={draft.captionStyle} onValueChange={captionStyle=>change({captionStyle})} options={[{value:'pop',label:'Word pop'},{value:'bold',label:'Bold'},{value:'minimal',label:'Minimal'},{value:'none',label:'No captions'}]}/><Input label="Caption color" type="color" value={draft.captionColor} onChange={e=>change({captionColor:e.target.value})}/><p className="text-xs text-muted">Click a transcript word to correct its caption text. Removing a word cuts that speech from the exported video.</p></div>}
        {tab==='framing'&&<div className="editor-controls"><Select label="Aspect ratio" value={draft.aspect} onValueChange={aspect=>change({aspect})} options={[{value:'9:16',label:'9:16 · Vertical'},{value:'16:9',label:'16:9 · Landscape'},{value:'1:1',label:'1:1 · Square'}]}/><label className="text-xs flex items-center gap-2"><input type="checkbox" checked={draft.autoReframe} onChange={e=>change({autoReframe:e.target.checked})}/>AI speaker framing</label><Select label="Color effect" value={draft.effect} onValueChange={effect=>change({effect})} options={['none','cinematic','warm','cool','mono','vibrant'].map(value=>({value,label:value[0].toUpperCase()+value.slice(1)}))}/><Select label="Edge transition" value={draft.transition} onValueChange={transition=>change({transition})} options={[{value:'cut',label:'Cut'},{value:'fade',label:'Fade'},{value:'dip',label:'Dip to black'}]}/></div>}
        {tab==='speed'&&<div className="editor-controls"><Input label="Playback speed" type="number" min="0.5" max="2" step="0.1" value={draft.speed} onChange={e=>change({speed:Number(e.target.value)})}/><Input label="Zoom" type="range" min="1" max="1.4" step="0.01" value={draft.zoom} onChange={e=>change({zoom:Number(e.target.value)})}/><p className="text-xs text-muted">Audio, cuts and caption timing follow the selected playback speed.</p></div>}
        {tab==='ai'&&<div className="editor-assistant"><span className="assistant-label"><WandSparkles size={15}/>EDIT THIS SELECTION</span><p className="text-xs text-muted">{formatTime(draft.start)}–{formatTime(draft.end)} · common commands run instantly; content-aware requests use Gemini.</p><div className="assistant-quick-actions">{quickCommands.map(command=><Button key={command} size="sm" onClick={()=>setPrompt(command)}>{command}</Button>)}</div><div className="editor-chat" role="log" aria-label="Editor assistant conversation" aria-live="polite">{messages.map((m,i)=><div key={i} className={`chat-bubble ${m.role}`}>{m.content}</div>)}</div><form onSubmit={ask}><label className="field">What should change?<textarea className="input" value={prompt} onChange={e=>setPrompt(e.target.value)} maxLength={3000} placeholder={'Split it in two parts, remove captions, or replace "question" with "idea"…'}/></label><Button type="submit" variant="primary" busy={planning} disabled={!prompt.trim()}><WandSparkles size={14}/>{planning?'Preparing plan…':'Prepare edit plan'}</Button></form>{plan&&<div className="assistant-plan" role="region" aria-label="Proposed edit plan"><b>{plan.parts.length} {plan.parts.length===1?'clip':'clips'} · {plan.engine==='gemini'?'Gemini plan':'Quick command'}</b>{plan.parts.map((p,i)=><p key={i}>{plan.parts.length>1?`Part ${i+1} · `:''}{formatTime(p.start)}–{formatTime(p.end)} · {p.captionStyle==='none'?'No captions':p.captionStyle+' captions'}</p>)}<Button size="sm" onClick={()=>applyParts(plan.parts)}><Check size={14}/>Apply to draft</Button><span className="text-xs text-muted">Undo anytime. Rendering is a separate step.</span></div>}</div>}
      </section>
    </div>
    <section className="editor-timeline"><div className="editor-range-controls"><Input label="Clip start (seconds)" type="number" min="0" max={duration} step="0.01" value={draft.start} onChange={e=>change({start:Number(e.target.value)})}/><Input label="Clip end (seconds)" type="number" min="0.25" max={duration} step="0.01" value={draft.end} onChange={e=>change({end:Number(e.target.value)})}/><Button size="sm" onClick={()=>change({start:current})}>Set in point</Button><Button size="sm" onClick={()=>change({end:current})}>Set out point</Button><Button size="sm" disabled={current<=draft.start+.25||current>=draft.end-.25} onClick={()=>split(current)}><Scissors size={14}/>Split at playhead</Button><Button size="sm" onClick={()=>split()}>Split in half</Button></div><Timeline duration={duration} current={current} onSeek={seek} words={words.map(w=>({...w,word:draft.captionOverrides[w.id]??w.word}))} cuts={draft.cutRanges}/><p className="text-xs text-muted mt-3">Space to play · Ctrl/Cmd Z to undo · Ctrl/Cmd Shift Z to redo · speech bars reflect transcript timing.</p></section>
    <Modal open={historyOpen} onOpenChange={setHistoryOpen} title="Version history" description="Restore settings to a draft without changing an existing export.">{data.versions.length?data.versions.map(v=><div key={v.id} className="border-b py-4"><b>Version {v.version}</b><p className="text-xs text-muted mt-1">{v.render_status} · {new Date(v.created_at).toLocaleString()}</p><Button className="mt-3" size="sm" onClick={()=>{const edit=v.edit_data||{};try{const restored=normalizeEditorDraft({...draft,...edit,start:edit.source_start??draft.start,end:edit.source_end??draft.end},duration,words);dispatch({type:'edit',value:{draft:restored,parts:[],activePart:-1}});seek(restored.start);setHistoryOpen(false);setPlan(null)}catch(err){setError(err.message)}}}>Restore settings</Button></div>):<p className="text-sm text-muted">Rendered versions appear here after your first export.</p>}</Modal>
  </>;
}
