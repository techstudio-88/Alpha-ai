"use client";

import {useEffect,useState} from 'react';
import {ArrowLeft,ArrowRight,Check,Clock,Film,Folder,PartyPopper,Plus,RefreshCw,Sparkles,Upload,Youtube,TrendingUp} from 'lucide-react';
import {supabase} from '../../lib/supabase';
import {SAMPLE,studioApi,unwrap,useClipSources,useResource,useRows,useStudio} from './data';
import {Button,ClipCard,DropZone,EmptyState,ErrorState,Input,ScreenSkeleton,Select,Stepper} from './ui';

export function Heading({title,description,action}){return <div className="screen-heading"><div><h1>{title}</h1>{description&&<p>{description}</p>}</div>{action}</div>}
export function Status({value}){return <span className={`status-chip ${value||'draft'}`}><i className="size-1.5 rounded-full bg-current"/>{String(value||'draft').replaceAll('_',' ')}</span>}
function ProjectCard({project}){
  const {navigate,demo}=useStudio();
  const preview=useResource(async()=>{
    if(demo)return project.thumbnail;
    const row=unwrap(await supabase.from('media_assets').select('metadata').eq('project_id',project.id).order('created_at',{ascending:false}).limit(1));
    const path=row[0]?.metadata?.thumbnail_storage_path;
    if(!path)return null;
    const {data}=await supabase.storage.from('media').createSignedUrl(path,900);return data?.signedUrl;
  },[project.id,demo]);
  return <button className="panel project-card" onClick={()=>navigate('studio',{project:project.id})}><div className="project-thumbnail">{preview.data?<img src={preview.data} alt="" loading="lazy" width="480" height="270"/>:<Film size={28}/>}</div><div className="project-card-copy"><h3>{project.name}</h3><div className="project-meta"><Status value={project.status}/><span>{new Date(project.created_at).toLocaleDateString(undefined,{month:'short',day:'numeric'})}</span></div></div></button>;
}
export function HomeScreen({projects}){
  const {openImport,navigate,user,state}=useStudio();
  const [customizing,setCustomizing]=useState(false);
  const [layout,setLayout]=useState([{id:'upload',span:2,visible:true},{id:'overview',span:1,visible:true},{id:'recent',span:2,visible:true},{id:'quick',span:1,visible:true}]);
  const [dragging,setDragging]=useState(null);
  useEffect(()=>{try{const saved=localStorage.getItem('alpha-home-dashboard-v1');if(saved){const parsed=JSON.parse(saved);if(Array.isArray(parsed)&&parsed.every(x=>x.id&&typeof x.visible==='boolean'))setLayout(parsed)}}catch{}},[]);
  const saveLayout=next=>{setLayout(next);try{localStorage.setItem('alpha-home-dashboard-v1',JSON.stringify(next))}catch{}};
  const move=(from,to)=>{if(!from||from===to)return;const next=[...layout],a=next.findIndex(x=>x.id===from),b=next.findIndex(x=>x.id===to);if(a<0||b<0)return;const item=next.splice(a,1)[0];next.splice(b,0,item);saveLayout(next);setDragging(null)};
  const toggle=id=>saveLayout(layout.map(x=>x.id===id?{...x,visible:!x.visible}:x));
  const resize=id=>saveLayout(layout.map(x=>x.id===id?{...x,span:x.span===1?2:1}:x));
  if(projects.error)return <ErrorState message={projects.error} onRetry={projects.retry}/>;
  const rows=state==='empty'?[]:projects.data||[];
  const widget=(id,content)=> <section key={id} className={'home-widget '+(layout.find(x=>x.id===id)?.span===2?'home-widget-wide':'home-widget-compact')+(dragging===id?' is-dragging':'')} draggable={customizing} onDragStart={e=>{setDragging(id);e.dataTransfer.setData('text/plain',id)}} onDragOver={e=>{if(customizing)e.preventDefault()}} onDrop={e=>{e.preventDefault();move(e.dataTransfer.getData('text/plain')||dragging,id)}} onDragEnd={()=>setDragging(null)}>{customizing&&<div className="home-widget-tools"><span>⠿ Drag to move</span><button onClick={()=>resize(id)}>{layout.find(x=>x.id===id)?.span===2?'Make compact':'Make wide'}</button><button onClick={()=>toggle(id)}>Hide</button></div>}{content}</section>;
  return <div className="home-dashboard">
    <header className="home-dashboard-header"><div><span className="home-eyebrow">YOUR CREATOR SPACE</span><h1>Good things start here{user.user_metadata?.full_name?', '+user.user_metadata.full_name.split(' ')[0]:''}.</h1><p>Your video workspace, arranged your way.</p></div><div className="home-dashboard-actions"><Button variant="secondary" onClick={()=>setCustomizing(!customizing)}>{customizing?'Finish editing':'Customize dashboard'}</Button><Button variant="primary" onClick={()=>openImport()}><Plus size={15}/> New video</Button></div></header>
    {customizing&&<div className="home-customize-note"><Sparkles size={16}/> Drag cards to reorder, change their width, or hide cards. Your layout is saved on this device.</div>}
    <div className="home-widget-grid">{layout.filter(x=>x.visible).map(item=>{
      if(item.id==='upload')return widget('upload',<><div className="home-upload-heading"><div className="home-widget-icon"><Upload size={20}/></div><div><h2>Bring your next video to life</h2><p>Upload a recording or paste a supported video link to start making clips.</p></div></div><DropZone onFile={file=>openImport(file)} onLink={url=>openImport(url)}/><div className="home-source-options"><Button size="sm" variant="ghost" onClick={()=>openImport()}><Upload size={14}/> Upload from device</Button><Button size="sm" variant="ghost" onClick={()=>openImport()}><Youtube size={14}/> YouTube link</Button><Button size="sm" variant="ghost" onClick={()=>openImport({tab:'drive'})}><Folder size={14}/> Google Drive</Button><Button size="sm" variant="ghost" onClick={()=>openImport({tab:'photos'})}><Film size={14}/> Photos</Button></div></>);
      if(item.id==='overview')return widget('overview',<><div className="home-widget-title"><span className="home-widget-icon"><TrendingUp size={19}/></span><h2>Workspace overview</h2></div><div className="home-stat-number">{rows.length}</div><p className="home-stat-label">Projects in your workspace</p><div className="home-stat-foot">Your creative space is ready</div><button className="home-text-link" onClick={()=>navigate('projects')}>View all projects <ArrowRight size={14}/></button></>);
      if(item.id==='recent')return widget('recent',<><div className="home-widget-title"><span><h2>Recent projects</h2><p>Pick up where you left off.</p></span><Button variant="ghost" size="sm" onClick={()=>navigate('projects')}>All projects <ArrowRight size={13}/></Button></div>{projects.loading?<ScreenSkeleton/>:rows.length?<div className="home-recent-grid">{rows.slice(0,4).map(p=><ProjectCard key={p.id} project={p}/>)}</div>:<div className="home-empty-inline"><span className="home-widget-icon"><Film size={20}/></span><div><strong>Your first project is waiting</strong><p>Upload a video above and your projects will appear here.</p></div></div>}</>);
      return widget('quick',<><div className="home-widget-title"><span className="home-widget-icon"><Sparkles size={19}/></span><h2>Quick actions</h2></div><button className="home-quick-action" onClick={()=>openImport()}><span className="home-quick-icon"><Upload size={16}/></span><span><strong>Upload a video</strong><small>Start a new project</small></span><ArrowRight size={15}/></button><button className="home-quick-action" onClick={()=>navigate('studio')}><span className="home-quick-icon"><Sparkles size={16}/></span><span><strong>Open AI Studio</strong><small>Turn footage into clips</small></span><ArrowRight size={15}/></button><button className="home-quick-action" onClick={()=>navigate('clips')}><span className="home-quick-icon"><Film size={16}/></span><span><strong>Browse clips</strong><small>Review your best moments</small></span><ArrowRight size={15}/></button></>);
    })}</div>
  </div>;
}
export function Onboarding({onDismiss}){
  const {openImport,navigate}=useStudio();
  return <section className="panel onboarding-checklist" aria-label="Getting started checklist"><div><h2>Your first three steps.</h2><p>A quick path from recording to ready.</p></div><button onClick={()=>openImport()}><span className="step-node">1</span>Connect a source</button><button onClick={()=>navigate('projects')}><span className="step-node">2</span>Process your first video</button><button onClick={()=>navigate('publish')}><span className="step-node">3</span>Publish your first clip</button><Button variant="ghost" size="sm" onClick={onDismiss}>Dismiss</Button></section>;
}
export function ProjectsScreen({resource}){
  const {openImport,state}=useStudio();const [query,setQuery]=useState('');
  if(resource.error)return <ErrorState message={resource.error} onRetry={resource.retry}/>;
  const rows=(state==='empty'?[]:resource.data||[]).filter(p=>p.name.toLowerCase().includes(query.toLowerCase()));
  return <><Heading title="Projects" description="Every source, every version, one place." action={<Button variant="primary" onClick={()=>openImport()}><Plus size={15}/>New project</Button>}/><div className="screen-toolbar"><Input label="Find a project" placeholder="Search by name…" value={query} onChange={e=>setQuery(e.target.value)} className="max-w-xs"/><Button onClick={resource.retry} size="sm"><RefreshCw size={14}/>Refresh</Button></div>{resource.loading?<ScreenSkeleton/>:rows.length?<div className="project-grid">{rows.map(p=><ProjectCard key={p.id} project={p}/>)}</div>:<EmptyState icon={Folder} title={query?'No matching projects.':'A clear space for your next recording.'} description={query?'Try another project name.':'Bring a video in to start building your clip library.'} action={<Button onClick={()=>query?setQuery(''):openImport()}>{query?'Clear search':'Import a video'}</Button>}/>}</>;
}
export function ProjectScreen({projectId,projects}){
  const {demo,navigate,workspace,refresh,notify}=useStudio();const [actionBusy,setActionBusy]=useState(false);
  const project=projects.find(p=>p.id===projectId);
  const jobs=useRows('processing_jobs','*',{projectId,poll:true});
  const job=jobs.data?.[0];
  const stages=useResource(async()=>{
    if(demo)return project?.status==='processing'?SAMPLE.processing_stages.map(s=>({...s,status:s.stage_key==='media_inspection'?'completed':s.stage_key==='transcription'?'running':'queued',progress:s.stage_key==='transcription'?32:s.progress})):SAMPLE.processing_stages;
    if(!job)return [];
    return unwrap(await supabase.from('processing_stages').select('stage_key,status,progress,error,metadata').eq('job_id',job.id));
  },[job?.id,job?.progress,project?.status,demo]);
  async function jobAction(action){
    setActionBusy(true);
    try{if(demo){notify(`${action==='retry'?'Retry':'Cancel'} is shown here as a sample action.`);return}
      await studioApi('/api/processing-jobs/action',{body:{workspaceId:workspace.id,jobId:job.id,action}});jobs.retry();refresh();notify(action==='retry'?'Your job is queued again.':'Cancellation requested. The worker will stop at its next checkpoint.');
    }catch(error){notify(error.message)}finally{setActionBusy(false)}
  }
  if(jobs.loading&&!jobs.data)return <ScreenSkeleton/>;
  if(jobs.error||stages.error)return <ErrorState message={jobs.error||stages.error} onRetry={()=>{jobs.retry();stages.retry()}}/>;
  if(!projectId||!project)return <EmptyState icon={Folder} title="Choose a project first." description="Open a project to see its pipeline and the moments it produced." action={<Button onClick={()=>navigate('projects')}>Browse projects</Button>}/>;
  const chunks=job?.payload?.transcriptionTotalChunks||job?.payload?.transcriptionChunks?.length;
  const completed=job?.status==='completed';
  return <><Button variant="ghost" size="sm" className="mb-5" onClick={()=>navigate('projects')}><ArrowLeft size={14}/>Projects</Button><Heading title={project.name} description="Import → transcribe → find moments → render → review." action={<Status value={project.status}/>}/><Stepper stages={stages.data||[]} job={job}/><div className="screen-toolbar mt-4"><p className="text-xs text-muted" role="status">{completed?'Your moments are ready for review.':job?.status==='awaiting_transcription'?'This workspace uses browser transcription. Keep the studio open to continue.':chunks?`Transcribing ${job.payload.transcribeChunk||0} of ${chunks} chunks`:(job?.current_stage||'Waiting for the worker').replaceAll('_',' ')}</p><div className="flex gap-2">{job?.status==='failed'&&<Button size="sm" onClick={()=>jobAction('retry')} busy={actionBusy}><RefreshCw size={13}/>Retry job</Button>}{['processing','queued','awaiting_transcription','transcribing'].includes(job?.status)&&<Button size="sm" onClick={()=>jobAction('cancel')} busy={actionBusy}>Cancel job</Button>}<Button size="sm" onClick={jobs.retry}><RefreshCw size={13}/>Refresh</Button></div></div>{job?.error&&<div className="mb-6"><ErrorState message={job.error} onRetry={()=>jobAction('retry')}/></div>}{completed&&<CompletionBanner projectId={projectId} preferences={job?.payload?.preferences}/>} <ClipsScreen projectId={projectId} embedded/></>;
}
function CompletionBanner({projectId,preferences}){
  const {navigate}=useStudio();
  return <section className="panel render-complete" aria-labelledby="render-complete-title"><div className="complete-confetti" aria-hidden="true"><i/><i/><i/><i/></div><span className="complete-icon"><PartyPopper size={23}/></span><div><span className="eyebrow"><Sparkles size={11}/>PIPELINE COMPLETE</span><h2 id="render-complete-title">Your first batch is ready.</h2><p>Alpha found the strongest complete thoughts and shaped them for short-form{preferences?.captions===false?'':' with captions ready for review'}.</p></div><div className="complete-actions"><Button size="sm" variant="primary" onClick={()=>navigate('clips',{project:projectId})}>Review clips<ArrowRight size={14}/></Button><Button size="sm" onClick={()=>navigate('assistant',{project:projectId})}>Ask Alpha</Button></div></section>;
}

export function ClipsScreen({projectId,embedded=false}){
  const {demo,navigate,openImport,notify,state,workspace}=useStudio();
  const clips=useRows('clips','*,projects!inner(workspace_id),clip_versions(id,version,storage_path,render_status,edit_data),clip_scores(*)',{projectId,poll:!!projectId});
  const [query,setQuery]=useState(''),[sort,setSort]=useState('score'),[selected,setSelected]=useState([]),[approved,setApproved]=useState([]),[focus,setFocus]=useState(0),[batchBusy,setBatchBusy]=useState(false);
  const rows=(state==='empty'?[]:clips.data||[]).filter(c=>(c.title||'').toLowerCase().includes(query.toLowerCase())).sort((a,b)=>sort==='score'?(b.score||0)-(a.score||0):new Date(b.created_at)-new Date(a.created_at));
  const sources=useClipSources(rows);
  const edit=clip=>navigate('editor',{project:clip.project_id,clip:clip.id});
  const publish=clip=>navigate('publish',{clip:clip.id});
  const schedule=clip=>navigate('publish',{clip:clip.id,schedule:'1'});
  const seo=clip=>navigate('seo',{clip:clip.id,project:clip.project_id});

  async function approve(ids){
    try{if(!demo)unwrap(await supabase.from('clips').update({status:'approved'}).in('id',ids));setApproved(v=>[...v,...ids]);notify(`${ids.length} clip${ids.length===1?'':'s'} approved${demo?' in this sample session':''}.`)}catch(error){notify(error.message)}
  }

  async function deleteClips(ids){
    if(!ids.length)return;
    if(!window.confirm(`Are you sure you want to delete ${ids.length} clip${ids.length===1?'':'s'}?`))return;
    setBatchBusy(true);
    try{
      if(!demo){
        unwrap(await supabase.from('clips').delete().in('id',ids));
      }
      setSelected(v=>v.filter(id=>!ids.includes(id)));
      clips.retry();
      notify(`${ids.length} clip${ids.length===1?'':'s'} deleted.`);
    }catch(err){
      notify(err.message);
    }finally{
      setBatchBusy(false);
    }
  }

  async function batchExport(ids){
    if(!ids.length)return;
    setBatchBusy(true);
    try{
      notify(`Generating ZIP for ${ids.length} selected clips...`);
      const response=await studioApi('/api/exports',{
        method:'POST',
        body:{workspace_id:workspace.id,project_id:projectId,clipIds:ids}
      });
      if(response?.url){
        const a=document.createElement('a');
        a.href=response.url;
        a.download=response.filename||'alpha-ai-clips.zip';
        a.rel='noopener';
        document.body.appendChild(a);
        a.click();
        a.remove();
        notify('ZIP package downloaded successfully.');
      }
    }catch(err){
      notify(err.message);
    }finally{
      setBatchBusy(false);
    }
  }

  function batchPublish(ids){
    if(!ids.length)return;
    if(ids.length===1){
      navigate('publish',{clip:ids[0]});
    }else{
      navigate('publish',{clip:ids[0],batch:ids.join(',')});
    }
  }

  useEffect(()=>{const key=e=>{
    if(e.metaKey||e.ctrlKey||e.altKey||e.target.closest('input,textarea,select,[contenteditable]')||document.querySelector('[role="dialog"]'))return;
    const c=rows[focus];if(!c)return;
    if(e.key.toLowerCase()==='j'){e.preventDefault();setFocus(v=>Math.min(rows.length-1,v+1))}
    if(e.key.toLowerCase()==='k'){e.preventDefault();setFocus(v=>Math.max(0,v-1))}
    if(e.key.toLowerCase()==='a')approve([c.id]);if(e.key.toLowerCase()==='e')edit(c);if(e.key.toLowerCase()==='p')publish(c);
  };window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key)},[rows,focus,demo]);

  if(clips.error)return <ErrorState message={clips.error} onRetry={clips.retry}/>;
  return <>{!embedded&&<Heading title="Clips" description="Review the strongest ideas. Give each one a place to go." action={<Button onClick={()=>openImport()}><Plus size={15}/>Import video</Button>}/>}
    <div className="screen-toolbar">
      <div className="flex gap-4 items-center flex-wrap">
        <Input label="Find a moment" placeholder="Search clips…" value={query} onChange={e=>setQuery(e.target.value)} className="max-w-xs"/>
        <Select label="Sort clips" value={sort} onValueChange={setSort} options={[{value:'score',label:'Highest score'},{value:'recent',label:'Most recent'}]}/>
      </div>
      <p className="text-xs text-muted">J / K navigate · A approve · E edit · P publish</p>
    </div>
    {selected.length>0&&<div className="bulk-bar flex items-center justify-between gap-3 flex-wrap">
      <span className="font-medium text-xs">{selected.length} clips selected</span>
      <div className="flex gap-2 flex-wrap">
        <Button size="sm" variant="primary" busy={batchBusy} onClick={()=>batchExport(selected)}>Batch Export (ZIP)</Button>
        <Button size="sm" variant="secondary" onClick={()=>batchPublish(selected)}>Batch Publish</Button>
        <Button size="sm" variant="danger" busy={batchBusy} onClick={()=>deleteClips(selected)}>Batch Delete</Button>
        <Button size="sm" variant="ghost" onClick={()=>approve(selected)}>Approve</Button>
        <Button size="sm" variant="ghost" onClick={()=>setSelected([])}>Clear</Button>
      </div>
    </div>}
    {clips.loading&&!clips.data?<ScreenSkeleton/>:rows.length?<div className="clip-grid">
      {rows.map((clip,i)=><ClipCard
        key={clip.id}
        clip={{...clip,status:approved.includes(clip.id)?'approved':clip.status}}
        src={sources[clip.id]}
        selected={selected.includes(clip.id)}
        onSelect={()=>setSelected(v=>v.includes(clip.id)?v.filter(id=>id!==clip.id):[...v,clip.id])}
        focused={focus===i}
        onEdit={()=>edit(clip)}
        onPublish={()=>publish(clip)}
        onSchedule={()=>schedule(clip)}
        onSeo={()=>seo(clip)}
        onDelete={()=>deleteClips([clip.id])}
        onApprove={()=>approve([clip.id])}
      />)}
    </div>:<EmptyState icon={Film} title={query?'No matching moments.':projectId?'Your clips will land here.':'A library of your best moments.'} description={query?'Try another phrase.':'Finished renders appear here with their scores and review actions.'} action={<Button onClick={()=>query?setQuery(''):openImport()}>{query?'Clear search':'Import a recording'}</Button>}/>}
  </>;
}
