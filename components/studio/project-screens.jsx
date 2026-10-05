"use client";

import {useEffect,useState} from 'react';
import {ArrowLeft,ArrowRight,Check,Clock,Film,Folder,Plus,RefreshCw,Upload,Youtube} from 'lucide-react';
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
  return <button className="panel project-card" onClick={()=>navigate('project',{project:project.id})}><div className="project-thumbnail">{preview.data?<img src={preview.data} alt="" loading="lazy" width="480" height="270"/>:<Film size={28}/>}</div><div className="project-card-copy"><h3>{project.name}</h3><div className="project-meta"><Status value={project.status}/><span>{new Date(project.created_at).toLocaleDateString(undefined,{month:'short',day:'numeric'})}</span></div></div></button>;
}
export function HomeScreen({projects}){
  const {openImport,navigate,user,state}=useStudio();const [onboarding,setOnboarding]=useState(true);
  if(projects.error)return <ErrorState message={projects.error} onRetry={projects.retry}/>;
  const rows=state==='empty'?[]:projects.data||[];
  return <><Heading title={`Make something worth sharing${user.user_metadata?.full_name?', '+user.user_metadata.full_name.split(' ')[0]:''}.`} description="One recording. A handful of good ideas."/>{onboarding&&rows.length===0&&<Onboarding onDismiss={()=>setOnboarding(false)}/>}<DropZone onFile={file=>openImport(file)} onLink={url=>openImport(url)}/><div className="source-options"><Button size="sm" variant="ghost" onClick={()=>openImport()}><Upload size={14}/>Upload</Button><Button size="sm" variant="ghost" onClick={()=>openImport()}><Youtube size={14}/>YouTube link</Button><Button size="sm" variant="ghost" onClick={()=>openImport({tab:'drive'})}><Folder size={14}/>Google Drive</Button><Button size="sm" variant="ghost" onClick={()=>openImport({tab:'photos'})}><Film size={14}/>Photos</Button></div><div className="section-label"><h2>Recent projects</h2><Button variant="ghost" size="sm" onClick={()=>navigate('projects')}>All projects<ArrowRight size={13}/></Button></div>{projects.loading?<ScreenSkeleton/>:rows.length?<div className="project-grid">{rows.slice(0,6).map(p=><ProjectCard key={p.id} project={p}/>)}</div>:<EmptyState title="Your first story starts here." description="Upload a recording or paste a supported video link. This space will become your project library." action={<Button variant="primary" onClick={()=>openImport()}><Plus size={15}/>Create a project</Button>}/>}</>;
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
  return <><Button variant="ghost" size="sm" className="mb-5" onClick={()=>navigate('projects')}><ArrowLeft size={14}/>Projects</Button><Heading title={project.name} description="Import → transcribe → find moments → render → review." action={<Status value={project.status}/>}/><Stepper stages={stages.data||[]} job={job}/><div className="screen-toolbar mt-4"><p className="text-xs text-muted" role="status">{job?.status==='completed'?'Your moments are ready for review.':job?.status==='awaiting_transcription'?'This workspace uses browser transcription. Keep the studio open to continue.':chunks?`Transcribing ${job.payload.transcribeChunk||0} of ${chunks} chunks`:(job?.current_stage||'Waiting for the worker').replaceAll('_',' ')}</p><div className="flex gap-2">{job?.status==='failed'&&<Button size="sm" onClick={()=>jobAction('retry')} busy={actionBusy}><RefreshCw size={13}/>Retry job</Button>}{['processing','queued','awaiting_transcription','transcribing'].includes(job?.status)&&<Button size="sm" onClick={()=>jobAction('cancel')} busy={actionBusy}>Cancel job</Button>}<Button size="sm" onClick={jobs.retry}><RefreshCw size={13}/>Refresh</Button></div></div>{job?.error&&<div className="mb-6"><ErrorState message={job.error} onRetry={()=>jobAction('retry')}/></div>}<ClipsScreen projectId={projectId} embedded/></>;
}
export function ClipsScreen({projectId,embedded=false}){
  const {demo,navigate,openImport,notify,state}=useStudio();
  const clips=useRows('clips','*,projects!inner(workspace_id),clip_versions(id,version,storage_path,render_status,edit_data),clip_scores(*)',{projectId,poll:!!projectId});
  const [query,setQuery]=useState(''),[sort,setSort]=useState('score'),[selected,setSelected]=useState([]),[approved,setApproved]=useState([]),[focus,setFocus]=useState(0);
  const rows=(state==='empty'?[]:clips.data||[]).filter(c=>(c.title||'').toLowerCase().includes(query.toLowerCase())).sort((a,b)=>sort==='score'?(b.score||0)-(a.score||0):new Date(b.created_at)-new Date(a.created_at));
  const sources=useClipSources(rows);
  const edit=clip=>navigate('editor',{project:clip.project_id,clip:clip.id});
  const publish=clip=>navigate('publish',{clip:clip.id});
  async function approve(ids){
    try{if(!demo)unwrap(await supabase.from('clips').update({status:'approved'}).in('id',ids));setApproved(v=>[...v,...ids]);notify(`${ids.length} clip${ids.length===1?'':'s'} approved${demo?' in this sample session':''}.`)}catch(error){notify(error.message)}
  }
  useEffect(()=>{const key=e=>{
    if(e.metaKey||e.ctrlKey||e.altKey||e.target.closest('input,textarea,select,[contenteditable]')||document.querySelector('[role="dialog"]'))return;
    const c=rows[focus];if(!c)return;
    if(e.key.toLowerCase()==='j'){e.preventDefault();setFocus(v=>Math.min(rows.length-1,v+1))}
    if(e.key.toLowerCase()==='k'){e.preventDefault();setFocus(v=>Math.max(0,v-1))}
    if(e.key.toLowerCase()==='a')approve([c.id]);if(e.key.toLowerCase()==='e')edit(c);if(e.key.toLowerCase()==='p')publish(c);
  };window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key)},[rows,focus,demo]);
  if(clips.error)return <ErrorState message={clips.error} onRetry={clips.retry}/>;
  return <>{!embedded&&<Heading title="Clips" description="Review the strongest ideas. Give each one a place to go." action={<Button onClick={()=>openImport()}><Plus size={15}/>Import video</Button>}/>}<div className="screen-toolbar"><div className="flex gap-4 items-center flex-wrap"><Input label="Find a moment" placeholder="Search clips…" value={query} onChange={e=>setQuery(e.target.value)} className="max-w-xs"/><Select label="Sort clips" value={sort} onValueChange={setSort} options={[{value:'score',label:'Highest score'},{value:'recent',label:'Most recent'}]}/></div><p className="text-xs text-muted">J / K navigate · A approve · E edit · P publish</p></div>{selected.length>0&&<div className="bulk-bar"><span>{selected.length} clips selected</span><div className="flex gap-2"><Button size="sm" onClick={()=>approve(selected)}>Approve selected</Button><Button size="sm" onClick={()=>setSelected([])}>Clear</Button></div></div>}{clips.loading&&!clips.data?<ScreenSkeleton/>:rows.length?<div className="clip-grid">{rows.map((clip,i)=><ClipCard key={clip.id} clip={{...clip,status:approved.includes(clip.id)?'approved':clip.status}} src={sources[clip.id]} selected={selected.includes(clip.id)} onSelect={()=>setSelected(v=>v.includes(clip.id)?v.filter(id=>id!==clip.id):[...v,clip.id])} focused={focus===i} onEdit={()=>edit(clip)} onPublish={()=>publish(clip)} onApprove={()=>approve([clip.id])}/>)}</div>:<EmptyState icon={Film} title={query?'No matching moments.':projectId?'Your clips will land here.':'A library of your best moments.'} description={query?'Try another phrase.':'Finished renders appear here with their scores and review actions.'} action={<Button onClick={()=>query?setQuery(''):openImport()}>{query?'Clear search':'Import a recording'}</Button>}/>}</>;
}
