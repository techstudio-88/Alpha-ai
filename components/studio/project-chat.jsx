"use client";
import {useEffect,useRef,useState} from 'react';
import {ArrowRight,Check,Clapperboard,Download,Film,MessageSquare,Plus,RefreshCw,Scissors,Settings2,Sparkles} from 'lucide-react';
import {supabase} from '../../lib/supabase';
import {normalizePreferences,relevantQuestions} from '../../lib/chat-brief.mjs';
import {studioApi,useClipSources,useRows,useStudio} from './data';
import {Button,EmptyState,Modal,ScreenSkeleton,formatTime} from './ui';

export default function ProjectChat(){
  const {workspace,user,demo,projectId,jobId,navigate,openImport,notify}=useStudio();
  const projects=useRows('projects'),jobs=useRows('processing_jobs','*',{projectId,poll:!!projectId});
  const clips=useRows('clips','*,projects!inner(workspace_id),clip_versions(*),clip_scores(*)',{projectId,poll:!!projectId});
  const assets=useRows('media_assets','id,name,duration_seconds,metadata',{projectId,poll:!!projectId});
  const copy=useRows('clip_repurpose_assets');
  const project=projects.data?.find(p=>p.id===projectId),job=jobId?jobs.data?.find(j=>j.id===jobId):jobs.data?.[0],asset=assets.data?.[0];
  const sourceUrls=useClipSources(projectId?clips.data||[]:[]);
  const saved=user.user_metadata?.alphaClipPreferences||{};
  const [answers,setAnswers]=useState(saved),[preferences,setPreferences]=useState(()=>normalizePreferences(saved));
  const [usage,setUsage]=useState(null),[phase,setPhase]=useState('creation'),[questionOpen,setQuestionOpen]=useState(false),[upgradeOpen,setUpgradeOpen]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[exported,setExported]=useState(false);
  const hydrated=useRef('');
  useEffect(()=>{
    if(demo||!workspace?.id)return;
    studioApi(`/api/usage?workspace_id=${encodeURIComponent(workspace.id)}`).then(setUsage).catch(()=>setUsage(null));
  },[demo,workspace?.id,job?.status]);
  useEffect(()=>{
    if(!job?.id||hydrated.current===job.id)return;
    hydrated.current=job.id;setAnswers({...saved,...job.payload?.preferences});setPreferences(normalizePreferences({...saved,...job.payload?.preferences}));
    if(job.status==='awaiting_preferences')setQuestionOpen(true);
  },[job?.id,job?.status]);
  useEffect(()=>{
    if(job?.status==='completed')clips.retry();
  },[job?.id,job?.status,clips.retry]);
   const readyClips=(clips.data||[]).filter(c=>demo||['local-transcript-analysis','gemini-transcript-analysis'].includes(c.ai_spec?.source)||c.clip_versions?.some(v=>v.render_status==='ready'&&v.storage_path));
  const transcriptSuggestions=readyClips.some(c=>['local-transcript-analysis','gemini-transcript-analysis'].includes(c.ai_spec?.source));
  const geminiSuggestions=readyClips.some(c=>c.ai_spec?.source==='gemini-transcript-analysis');
  const hasSpeech=job?.payload?.transcriptId?true:asset?.metadata?.has_audio===false?false:null;
  const questions=relevantQuestions({duration:asset?.duration_seconds,hasSpeech,speakers:Number(asset?.metadata?.speaker_count)||0,answered:answers,phase});
   const question=questions[0],waiting=job?.status==='awaiting_preferences';
  async function start(){
    if(!job||busy)return;
    if(usage?.upgradeRequired){setUpgradeOpen(true);return}
    setBusy(true);setError('');
    try{
       if(!demo){const result=await studioApi('/api/processing-preferences',{body:{workspaceId:workspace.id,projectId,jobId:job.id,preferences}});if(result.warning)notify(result.warning);await supabase.auth.updateUser({data:{alphaClipPreferences:preferences}}).catch(()=>{})}
      setQuestionOpen(false);jobs.retry();notify('Your processing job is saved. Progress and clips will appear in this chat.');
    }catch(err){setError(err.message)}finally{setBusy(false)}
  }
  async function retry(){setBusy(true);setError('');try{if(!demo)await studioApi('/api/processing-jobs/action',{body:{workspaceId:workspace.id,jobId:job.id,action:'retry'}});jobs.retry()}catch(err){setError(err.message)}finally{setBusy(false)}}
  async function download(){
    setBusy(true);setError('');
    try{
      if(demo){notify('Sample clips are illustrations. Upload your video to export real files.');return}
      const {data}=await supabase.auth.getSession();
      const response=await fetch('/api/exports',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${data.session?.access_token||''}`},body:JSON.stringify({workspace_id:workspace.id,project_id:projectId,...preferences}),signal:AbortSignal.timeout(120000)});
      if(!response.ok){const body=await response.json().catch(()=>({}));throw new Error(body.error||'Export could not finish. No source files were changed.')}
      const result=await response.json(),a=document.createElement('a');a.href=result.url;a.download=result.filename;a.rel='noopener';document.body.appendChild(a);a.click();a.remove();setExported(true);setQuestionOpen(false);
    }catch(err){setError(err.message)}finally{setBusy(false)}
  }
  const select=value=>{setPreferences(p=>({...p,[question.id]:value}));setAnswers(a=>({...a,[question.id]:value}))};
  if(projectId&&projects.loading&&!project)return <ScreenSkeleton/>;
  return <div className="video-chat-shell">
    <aside className="video-chat-history"><Button onClick={()=>openImport()}><Plus size={15}/>New video chat</Button><span className="eyebrow">YOUR VIDEO CONVERSATIONS</span>{projects.data?.map(p=><button key={p.id} className={p.id===projectId?'active':''} onClick={()=>navigate('chat',{project:p.id})}><MessageSquare size={14}/><span>{p.name}<small>{p.status.replaceAll('_',' ')}</small></span></button>)}</aside>
    <section className="video-chat-main"><header><div><span className="eyebrow">ALPHA · VIDEO CHAT</span><h1>{project?.name||'What will you create today?'}</h1></div><Button size="sm" onClick={()=>openImport()}><Plus size={14}/>Upload</Button></header>
      <div className="video-chat-conversation" aria-label="Video conversation">
        {!projectId?<EmptyState icon={Sparkles} title="One video. One conversation." description="Upload your recording. Answer only the relevant choices, review your clips here, and export a ready-to-post package." action={<Button variant="primary" onClick={()=>openImport()}>Upload a video<ArrowRight size={15}/></Button>}/>:<>
          <div className="video-chat-message user"><Film size={20}/><div><b>{asset?.name||project?.name}</b><p>Original source kept in your private workspace.</p></div></div>
          <div className="video-chat-message"><Sparkles size={20}/><div><b>Alpha</b><p>{waiting?'Your upload is saved. I’ll find complete moments and keep effects off. Review the relevant choices, or continue with the defaults.':'Your video, processing updates, and finished clips stay in this conversation.'}</p>{waiting&&<div className="flex gap-2 mt-4 flex-wrap"><Button size="sm" onClick={()=>{setPhase('creation');setQuestionOpen(true)}}><Settings2 size={13}/>Review choices</Button><Button size="sm" variant="primary" busy={busy} onClick={start}>Use defaults & start</Button></div>}</div></div>
          {job&&!waiting&&<div className="video-chat-progress" role="status"><div><b>{job.status==='completed'?'Processing complete':job.status==='failed'?'Processing needs attention':String(job.current_stage||job.status).replaceAll('_',' ')}</b><span>{job.progress||0}%</span></div><progress max="100" value={job.progress||0}/>{job.status==='awaiting_transcription'&&<p>Keep this tab open for browser transcription.</p>}{job.error&&<p>{job.error}</p>}{job.status==='failed'&&<Button size="sm" busy={busy} onClick={retry}><RefreshCw size={13}/>Retry from checkpoint</Button>}</div>}
          {readyClips.length>0&&<div className="video-chat-message"><Clapperboard size={20}/><div className="min-w-0 flex-1"><h2>{readyClips.length} {demo?'sample moments':transcriptSuggestions?'clip suggestions to review':'clips ready to review'}</h2><p>{geminiSuggestions?'Gemini analyzed transcript content and timestamps; it did not inspect video frames. Open a suggestion in the editor to preview the source range.':transcriptSuggestions?'Free local transcript scoring suggests these moments; scores are heuristic, not Gemini-generated. Open a suggestion in the editor to preview the source range.':'Preview the video first. Open the details below each clip for available posting copy.'}</p><div className="video-chat-results">{readyClips.map((clip,i)=>{const metadata=copy.data?.find(a=>a.clip_id===clip.id);return <article key={clip.id}>
            {['local-transcript-analysis','gemini-transcript-analysis'].includes(clip.ai_spec?.source)?<div className="rounded-xl border p-4 text-sm text-muted">{clip.ai_spec?.source==='gemini-transcript-analysis'?'Gemini transcript suggestion':'Local transcript suggestion'} · {clip.score??0}/100 {clip.ai_spec?.source==='gemini-transcript-analysis'?'score':'heuristic score'}<br/>Open the editor to preview this range from your original video.</div>:sourceUrls[clip.id]?<video src={sourceUrls[clip.id]} controls playsInline preload="metadata" aria-label={clip.title}/>:<img src="/studio-sample.svg" alt="Illustrative sample, not an exported video"/>}
            <div className="video-chat-result-copy"><small>CLIP {String(i+1).padStart(2,'0')} · {formatTime(clip.end_seconds-clip.start_seconds)}</small><h3>{clip.title}</h3><p>{clip.ai_spec?.reason||clip.clip_scores?.[0]?.reason}</p><Button size="sm" onClick={()=>navigate('editor',{project:projectId,clip:clip.id})}><Scissors size={13}/>Edit this clip</Button><details><summary>Title, captions & posting copy</summary><p><b>Title:</b> {metadata?.title||clip.title}</p>{metadata?.caption&&<p><b>Caption:</b> {metadata.caption}</p>}{metadata?.social_copy?.youtube&&<p><b>YouTube:</b> {metadata.social_copy.youtube}</p>}{metadata?.social_copy?.instagram&&<p><b>Instagram:</b> {metadata.social_copy.instagram}</p>}{metadata?.hashtags?.length>0&&<p>{metadata.hashtags.join(' ')}</p>}{!metadata&&<p>Posting copy has not been generated for this clip yet.</p>}</details></div>
          </article>})}</div><Button variant="primary" className="mt-5" onClick={()=>{setPhase('export');setQuestionOpen(true)}}><Download size={15}/>Review export options</Button>{exported&&<p role="status">ZIP downloaded. Verify all files before publishing. Promotion rewards require a reviewed claim; downloads alone do not earn tokens.</p>}</div></div>}
          {job?.status==='completed'&&!readyClips.length&&<p className="text-muted text-sm">No ready clips were returned. Your source is preserved; review the processing details before retrying.</p>}
        </>}
        {(error||jobs.error||clips.error)&&<p className="text-destructive text-sm" role="alert">{error||jobs.error||clips.error}</p>}
      </div>
      <footer><span>Source → relevant choices → clips → export. No mandatory custom answers.{usage&&<b className="ml-2">{usage.availableTokens} tokens left today</b>}</span><Button size="sm" variant="ghost" onClick={()=>{jobs.retry();clips.retry();copy.retry()}}><RefreshCw size={13}/>Refresh</Button></footer>
    </section>
    <Modal open={questionOpen} onOpenChange={setQuestionOpen} title={question?.title||(phase==='export'?'Your export package':'Ready to find the moments?')} description={question?.description||'Review these defaults. You can change the edit later; your original stays intact.'}>
      {question?<><div className="video-question-options">{question.options.map(option=><button key={String(option.value)} onClick={()=>select(option.value)}><span>{option.label}</span><ArrowRight size={15}/></button>)}</div><Button className="mt-5" variant="ghost" onClick={()=>select(preferences[question.id])}>Use recommended default</Button></>:<><dl className="video-chat-summary"><dt>Platforms</dt><dd>{preferences.platform}</dd><dt>Captions</dt><dd>{preferences.captions?'On':'Off'}</dd><dt>Clips</dt><dd>{preferences.clipCount==='auto'?'Best complete moments':`Up to ${preferences.clipCount}`}</dd>{phase==='export'&&<><dt>Folders</dt><dd>{preferences.naming==='numbered'?'Clip_01, Clip_02…':'Clip titles'}</dd></>}</dl><Button variant="primary" className="w-full mt-5" onClick={phase==='export'?download:start} busy={busy}><Check size={15}/>{phase==='export'?'Download ZIP':'Confirm & start processing'}</Button></>}
      {error&&<p role="alert" className="text-destructive text-sm mt-3">{error}</p>}
    </Modal>
    <Modal open={upgradeOpen} onOpenChange={setUpgradeOpen} title="You’ve used today’s free allowance." description="Alpha gives eligible accounts 100 tokens per day. Approved promotion rewards can add bonus tokens; they are never granted from an unverified claim."><p className="text-sm text-muted">Wait for tomorrow’s reset or review the planned upgrade options. Failed jobs do not silently charge another token.</p><Button className="w-full mt-5" variant="primary" onClick={()=>{setUpgradeOpen(false);navigate('settings')}}>Review account options</Button></Modal>
  </div>;
}
