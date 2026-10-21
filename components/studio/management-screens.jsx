"use client";

import {useEffect,useRef,useState} from 'react';
import {Archive,AlertTriangle,CalendarDays,Check,CheckCircle2,ChevronLeft,ChevronRight,Clock,Copy,Download,Film,Folder,Instagram,KeyRound,Link2,Plus,RefreshCw,Scissors,Share2,Sparkles,TrendingUp,Upload,Users,X,Youtube} from 'lucide-react';
import {supabase} from '../../lib/supabase';
import {studioApi,unwrap,useResource,useRows,useStudio} from './data';
import {Button,ButtonLink,Calendar,EmptyState,ErrorState,Input,Modal,ScreenSkeleton,Select,Tabs} from './ui';
import {Heading,Status} from './project-screens';
import {PricingCards} from './marketing';

export function PublishScreen(){
  const {workspace,demo,clipId,notify,navigate,refresh,state}=useStudio();
  const jobs=useRows('publish_jobs');
  const connections=useRows('publish_connections','id,platform,status,created_at');
  const clips=useRows('clips','id,title,status,projects!inner(workspace_id)');
  const now=new Date();
  const [month,setMonth]=useState(new Date(now.getFullYear(),now.getMonth(),1));
  const [day,setDay]=useState(now.getDate());
  const [modal,setModal]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [platform,setPlatform]=useState('youtube');
  const [selected,setSelected]=useState(clipId||'');
  const [title,setTitle]=useState('');
  const [description,setDescription]=useState('');
  const [date,setDate]=useState('');
  const [privacy,setPrivacy]=useState('private');
  const [samplePosts,setSamplePosts]=useState([]);

  // Requirement 7 connectors modals
  const [connectModal,setConnectModal]=useState(false);
  const [disclaimerModal,setDisclaimerModal]=useState(false);
  const [confirmModal,setConfirmModal]=useState(false);

  const rows=state==='empty'?[]:[...new Map([...(jobs.data||[]),...samplePosts].map(post=>[post.id,post])).values()];
  const hasConnectedAccounts=(connections.data||[]).some(c=>c.status==='connected');

  useEffect(()=>{
    if(connections.loading)return;
    if(!hasConnectedAccounts&&!demo){
      setConnectModal(true);
    }
  },[connections.loading,hasConnectedAccounts,demo]);

  useEffect(()=>{
    if(clipId){
      setSelected(clipId);
      const c=clips.data?.find(x=>x.id===clipId);
      if(c){
        setTitle(c.title||'');
        setConfirmModal(true);
      }
    }
  },[clipId,clips.data]);

  useEffect(()=>{
    const c=clips.data?.find(c=>c.id===selected);
    if(c&&!title)setTitle(c.title||'');
  },[selected,clips.data,title]);

  async function connectPlatform(plat){
    try{
      if(demo)return notify(`Sample channel only. Sign in to authorize your ${plat} account.`);
      setBusy(true);
      const response=await studioApi(`/api/publish/connect?platform=${plat}&workspace_id=${encodeURIComponent(workspace.id)}`,{method:'POST'});
      if(response.url)window.location.href=response.url;
    }catch(err){
      setError(err.message);
    }finally{
      setBusy(false);
    }
  }

  async function schedule(e){
    e.preventDefault();setError('');setBusy(true);
    try{
      const post={workspace_id:workspace.id,clip_id:selected,platform,title,description,privacy,scheduled_for:new Date(date).toISOString()};
      if(new Date(date)<=new Date())throw new Error('Choose a time in the future.');
      if(demo)setSamplePosts(v=>[...v,{id:crypto.randomUUID(),clip_id:selected,platform,status:'queued',scheduled_for:post.scheduled_for,metadata:{title,description,privacy}}]);
      else await studioApi('/api/publish',{body:post});
      jobs.retry();refresh();setModal(false);notify(demo?'Sample post scheduled in this session.':`Your ${platform==='youtube'?'YouTube':'Instagram'} clip is queued.`);
    }catch(err){setError(err.message)}finally{setBusy(false)}
  }

  async function reschedule(id,target){
    const post=rows.find(p=>p.id===id);if(!post||post.status!=='queued')return notify('Only queued posts can be rescheduled.');
    const when=new Date(post.scheduled_for);target.setHours(when.getHours(),when.getMinutes());
    if(target<=new Date())return notify('Choose a date in the future.');
    try{if(demo){setSamplePosts(v=>[...v.filter(p=>p.id!==id),{...post,scheduled_for:target.toISOString()}]);notify('Sample post rescheduled.');return}
      unwrap(await supabase.from('publish_jobs').update({scheduled_for:target.toISOString()}).eq('workspace_id',workspace.id).eq('id',id).eq('status','queued'));jobs.retry();notify('Post rescheduled.');
    }catch(err){setError(err.message)}
  }

  async function retry(post){
    try{if(demo)return notify('This sample demonstrates a publishing retry.');unwrap(await supabase.from('publish_jobs').update({status:'queued',error:null,scheduled_for:new Date().toISOString()}).eq('id',post.id).eq('workspace_id',workspace.id).eq('status','failed'));jobs.retry();notify('Post queued for another attempt.')}catch(err){setError(err.message)}
  }

  if(jobs.error||connections.error||clips.error)return <ErrorState message={jobs.error||connections.error||clips.error} onRetry={()=>{jobs.retry();connections.retry();clips.retry()}}/>;
  if(jobs.loading)return <ScreenSkeleton/>;

  const ytConn=(connections.data||[]).find(c=>c.platform==='youtube'&&c.status==='connected');
  const igConn=(connections.data||[]).find(c=>c.platform==='instagram'&&c.status==='connected');

  return <>
    <Heading title="Publish" description="A considered schedule across YouTube Shorts and Instagram Reels." action={<Button variant="primary" disabled={!clips.data?.length} onClick={()=>setModal(true)}><Plus size={15}/>Schedule a clip</Button>}/>
    {error&&<div className="mb-6"><ErrorState message={error} onRetry={()=>setError('')}/></div>}
    <div className="screen-toolbar">
      <div className="flex gap-3 items-center flex-wrap">
        <div className="flex items-center gap-2 border border-border/70 rounded-md px-3 py-1.5 bg-panel">
          <Youtube size={16} className={ytConn?'text-red-500':'text-muted'}/>
          <span className="text-xs font-medium">{ytConn?'YouTube connected':'YouTube disconnected'}</span>
          <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={()=>connectPlatform('youtube')}>{ytConn?'Manage':'Connect'}</Button>
        </div>
        <div className="flex items-center gap-2 border border-border/70 rounded-md px-3 py-1.5 bg-panel">
          <Instagram size={16} className={igConn?'text-pink-500':'text-muted'}/>
          <span className="text-xs font-medium">{igConn?'Instagram connected':'Instagram disconnected'}</span>
          <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={()=>connectPlatform('instagram')}>{igConn?'Manage':'Connect'}</Button>
        </div>
      </div>
    </div>
    <div className="screen-toolbar">
      <h2 className="text-xl">{month.toLocaleDateString(undefined,{month:'long',year:'numeric'})}</h2>
      <div className="flex gap-2">
        <Button size="icon" aria-label="Previous month" onClick={()=>setMonth(new Date(month.getFullYear(),month.getMonth()-1,1))}><ChevronLeft size={15}/></Button>
        <Button onClick={()=>setMonth(new Date(now.getFullYear(),now.getMonth(),1))}>Today</Button>
        <Button size="icon" aria-label="Next month" onClick={()=>setMonth(new Date(month.getFullYear(),month.getMonth()+1,1))}><ChevronRight size={15}/></Button>
      </div>
    </div>
    <div className="publish-layout">
      <Calendar month={month} items={rows} selectedDay={day} onDay={setDay} onReschedule={reschedule}/>
      <section className="panel queue-list">
        <h2>Publishing queue</h2>
        {rows.length?rows.map(post=><article className="queue-item" key={post.id}>
          <div className="flex items-center gap-2 text-xs text-muted mb-1">
            {post.platform==='instagram'?<Instagram size={13} className="text-pink-500"/>:<Youtube size={13} className="text-red-500"/>}
            <span>{post.platform==='instagram'?'Instagram Reel':'YouTube Short'}</span>
          </div>
          <h3>{post.metadata?.title||clips.data?.find(c=>c.id===post.clip_id)?.title||'Clip publication'}</h3>
          <p>{new Date(post.scheduled_for).toLocaleString()}</p>
          <div className="flex items-center justify-between mt-3 gap-2">
            <Status value={post.status}/>
            {post.status==='failed'&&<Button size="sm" onClick={()=>retry(post)}>Retry</Button>}
          </div>
          {post.error&&<p className="text-destructive mt-2 text-xs">{post.error}</p>}
        </article>):<EmptyState icon={CalendarDays} title="A little room to plan." description="Schedule a rendered clip to start your calendar." action={<Button onClick={()=>navigate('clips')}>Choose a clip</Button>}/>}
      </section>
    </div>

    {/* Connectors First-Open Modal */}
    <Modal open={connectModal} onOpenChange={setConnectModal} title="Connect your social accounts" description="Alpha AI publishes directly to YouTube Shorts and Instagram Reels with verified platform confirmation.">
      <div className="space-y-4 my-2">
        <div className="flex items-center justify-between p-3.5 border border-border/70 rounded-lg bg-panel">
          <div className="flex items-center gap-3">
            <Youtube size={22} className="text-red-500"/>
            <div>
              <p className="font-semibold text-sm">YouTube</p>
              <p className="text-xs text-muted">Publish vertical YouTube Shorts</p>
            </div>
          </div>
          <Button size="sm" variant="primary" onClick={()=>connectPlatform('youtube')}>Connect</Button>
        </div>
        <div className="flex items-center justify-between p-3.5 border border-border/70 rounded-lg bg-panel">
          <div className="flex items-center gap-3">
            <Instagram size={22} className="text-pink-500"/>
            <div>
              <p className="font-semibold text-sm">Instagram</p>
              <p className="text-xs text-muted">Publish 9:16 Instagram Reels</p>
            </div>
          </div>
          <Button size="sm" variant="primary" onClick={()=>connectPlatform('instagram')}>Connect</Button>
        </div>
      </div>
      <div className="pt-3 border-t border-border/50 text-center">
        <button className="text-xs text-muted hover:text-foreground underline underline-offset-4" onClick={()=>{setConnectModal(false);setDisclaimerModal(true)}}>
          Continue without connectors
        </button>
      </div>
    </Modal>

    {/* Disclaimer Modal */}
    <Modal open={disclaimerModal} onOpenChange={setDisclaimerModal} title="Notice: Manual Posting Required" description="Without connected social accounts, nothing can be automatically published by Alpha AI. You can still export 4-file ZIP packages with ready-to-post video and copy to publish manually.">
      <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-md text-xs text-amber-200 mb-4 flex gap-2">
        <AlertTriangle size={16} className="shrink-0 text-amber-400"/>
        <span>Automatic scheduling, auto-publish triggers, and direct video uploads require active platform connectors.</span>
      </div>
      <div className="flex gap-2 justify-end">
        <Button variant="ghost" onClick={()=>setDisclaimerModal(false)}>Okay</Button>
        <Button variant="primary" onClick={()=>{setDisclaimerModal(false);setConnectModal(true)}}>Continue to connectors</Button>
      </div>
    </Modal>

    {/* Confirmation Popup before Opening Publish Form */}
    <Modal open={confirmModal} onOpenChange={setConfirmModal} title="Confirm publish details" description="Verify your clip title and metadata before opening the scheduling calendar.">
      <div className="space-y-3 py-2">
        <div className="p-3 bg-panel rounded border border-border text-sm">
          <span className="text-xs text-muted block mb-1">Target clip</span>
          <b>{title||'Selected Clip'}</b>
        </div>
      </div>
      <div className="flex gap-2 justify-end pt-2">
        <Button variant="ghost" onClick={()=>setConfirmModal(false)}>Cancel</Button>
        <Button variant="primary" onClick={()=>{setConfirmModal(false);setModal(true)}}>Proceed to publish</Button>
      </div>
    </Modal>

    {/* Main Schedule Modal */}
    <Modal open={modal} onOpenChange={setModal} title="Give this clip a time and place." description="Review platform video specs and privacy settings before scheduling.">
      <form onSubmit={schedule} className="space-y-4">
        <Select label="Destination platform" value={platform} onValueChange={setPlatform} options={[{value:'youtube',label:'YouTube Shorts'},{value:'instagram',label:'Instagram Reels'}]}/>
        <Select label="Clip" value={selected||undefined} onValueChange={setSelected} options={(clips.data||[]).map(c=>({value:c.id,label:c.title||'Untitled clip'}))}/>
        <Input label="Title" maxLength={100} value={title} onChange={e=>setTitle(e.target.value)} required/>
        <label className="field">Description & captions<textarea className="input" maxLength={platform==='youtube'?5000:2200} value={description} onChange={e=>setDescription(e.target.value)} placeholder="Add relevant hashtags and posting copy."/></label>
        <Input label="Publish time (local timezone)" type="datetime-local" value={date} onChange={e=>setDate(e.target.value)} required/>
        <Select label="Privacy" value={privacy} onValueChange={setPrivacy} options={[{value:'private',label:'Private'},{value:'unlisted',label:'Unlisted'},{value:'public',label:'Public'}]}/>
        {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
        <Button type="submit" variant="primary" className="w-full" busy={busy} disabled={!selected||(!hasConnectedAccounts&&!demo)}>Schedule clip</Button>
      </form>
    </Modal>
  </>;
}

// Requirement 6: SEO Page
export function SeoScreen(){
  const {workspace,demo,notify,clipId,navigate}=useStudio();
  const clips=useRows('clips','id,title,project_id,media_asset_id,start_seconds,end_seconds,score');
  const [activeClipId,setActiveClipId]=useState(clipId||'');
  const [data,setData]=useState(null);
  const [loading,setLoading]=useState(false);
  const [saving,setSaving]=useState(false);
  const [limits,setLimits]=useState({titleRegenerations:{remaining:3,max:3,display:'3 of 3 left'},coverRotations:{remaining:1,max:1,display:'1 of 1 left'}});

  const activeClip=(clips.data||[]).find(c=>c.id===activeClipId)||(clips.data||[])[0];

  useEffect(()=>{
    if(clips.data?.length&&!activeClipId){
      setActiveClipId(clips.data[0].id);
    }
  },[clips.data,activeClipId]);

  useEffect(()=>{
    if(!activeClip?.id)return;
    setLoading(true);
    studioApi(`/api/clips/${activeClip.id}/repurpose`)
      .then(res=>{
        setData(res.asset||{
          title:activeClip.title||'',
          hook:'',
          caption:'',
          social_copy:{youtube:'',instagram:''},
          hashtags:[]
        });
        if(res.limits)setLimits(res.limits);
      })
      .catch(()=>{})
      .finally(()=>setLoading(false));
  },[activeClip?.id]);

  // Debounced autosave
  const saveTimer=useRef(null);
  function handleChange(field,value){
    setData(prev=>{
      const next={...prev,[field]:value};
      if(saveTimer.current)clearTimeout(saveTimer.current);
      saveTimer.current=setTimeout(()=>{
        setSaving(true);
        studioApi(`/api/clips/${activeClip.id}/repurpose`,{method:'PATCH',body:next})
          .then(()=>setSaving(false))
          .catch(()=>setSaving(false));
      },800);
      return next;
    });
  }

  function handleNestedChange(parent,field,value){
    setData(prev=>{
      const next={...prev,[parent]:{...(prev[parent]||{}),[field]:value}};
      if(saveTimer.current)clearTimeout(saveTimer.current);
      saveTimer.current=setTimeout(()=>{
        setSaving(true);
        studioApi(`/api/clips/${activeClip.id}/repurpose`,{method:'PATCH',body:next})
          .then(()=>setSaving(false))
          .catch(()=>setSaving(false));
      },800);
      return next;
    });
  }

  async function regenerate(feature='title_regeneration'){
    if(limits.titleRegenerations.remaining<=0&&feature==='title_regeneration'){
      notify('You have reached today’s limit of 3 title regenerations on the Free plan.');
      return;
    }
    setLoading(true);
    try{
      const res=await studioApi(`/api/clips/${activeClip.id}/repurpose`,{method:'POST',body:{feature}});
      if(res.asset)setData(res.asset);
      if(res.message)notify(`Regenerated! (${res.message})`);
      const updated=await studioApi(`/api/clips/${activeClip.id}/repurpose`);
      if(updated.limits)setLimits(updated.limits);
    }catch(err){
      notify(err.message);
    }finally{
      setLoading(false);
    }
  }

  async function copyToClipboard(text,label){
    await navigator.clipboard.writeText(text);
    notify(`${label} copied to clipboard!`);
  }

  const ytTitle=data?.title||activeClip?.title||'';
  const ytDesc=data?.social_copy?.youtube||data?.caption||'';
  const igCaption=data?.social_copy?.instagram||data?.caption||'';
  const hashtags=(data?.hashtags||[]).map(t=>t.startsWith('#')?t:`#${t}`).join(' ');

  return <div className="seo-screen-layout flex gap-6">
    {/* Left Slidebar: Clip Switcher */}
    <aside className="w-64 shrink-0 panel p-4 space-y-3">
      <div className="flex items-center justify-between pb-2 border-b border-border/50">
        <h3 className="text-xs font-bold tracking-wider text-muted">PROJECT CLIPS</h3>
        <span className="text-xs text-muted font-mono">{clips.data?.length||0}</span>
      </div>
      <div className="space-y-1 max-h-[calc(100vh-280px)] overflow-y-auto">
        {(clips.data||[]).map((c,i)=>(
          <button
            key={c.id}
            onClick={()=>{setActiveClipId(c.id);navigate('seo',{clip:c.id})}}
            className={`w-full text-left p-2.5 rounded-md text-xs transition-colors flex items-center justify-between gap-2 ${c.id===activeClip?.id?'bg-accent/15 text-foreground font-semibold border border-accent/30':'hover:bg-raised text-muted'}`}
          >
            <span className="truncate">Clip {String(i+1).padStart(2,'0')}: {c.title||'Untitled'}</span>
            <span className="text-[10px] font-mono shrink-0 px-1.5 py-0.5 rounded bg-black/40 text-accent">Score {Math.round(c.score||90)}</span>
          </button>
        ))}
      </div>
    </aside>

    {/* Main SEO Editor */}
    <div className="flex-1 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3 pb-3 border-b border-border/50">
        <div>
          <span className="eyebrow">SEO & SOCIAL REPURPOSING</span>
          <h1 className="text-xl font-bold">{activeClip?.title||'Select a Clip'}</h1>
          <span className="text-xs text-muted">{saving?'Autosaving...':'Changes saved automatically'}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted bg-panel px-2.5 py-1 rounded border border-border/60">
            Regenerations: <b className="text-foreground">{limits.titleRegenerations.display}</b>
          </span>
          <Button size="sm" variant="primary" busy={loading} onClick={()=>regenerate('title_regeneration')}>
            <Sparkles size={13}/>Regenerate Copy
          </Button>
        </div>
      </div>

      {loading?<ScreenSkeleton/>:<>
        {/* YouTube Section */}
        <section className="panel p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Youtube size={18} className="text-red-500"/>
              <h2 className="text-base font-semibold">YouTube Shorts Optimization</h2>
            </div>
            <Button size="sm" variant="ghost" onClick={()=>copyToClipboard(`${ytTitle}\n\n${ytDesc}\n\n${hashtags}`,'YouTube Copy')}>
              <Copy size={13}/>Copy All YouTube Copy
            </Button>
          </div>
          <div>
            <div className="flex justify-between items-center text-xs mb-1">
              <label className="font-medium">Video Title</label>
              <span className={`font-mono text-[11px] ${ytTitle.length>100?'text-destructive font-bold':'text-muted'}`}>{ytTitle.length}/100 chars</span>
            </div>
            <input className="input" maxLength={100} value={ytTitle} onChange={e=>handleChange('title',e.target.value)} placeholder="Engaging hook-first title..."/>
          </div>
          <div>
            <div className="flex justify-between items-center text-xs mb-1">
              <label className="font-medium">Description & Context</label>
              <span className="font-mono text-[11px] text-muted">{ytDesc.length}/5,000 chars</span>
            </div>
            <textarea className="input min-h-[90px]" maxLength={5000} value={ytDesc} onChange={e=>handleNestedChange('social_copy','youtube',e.target.value)} placeholder="Description explaining the moment and driving viewer engagement..."/>
          </div>
          <div className="pt-2">
            <span className="text-xs text-muted block mb-2">Suggested Keywords:</span>
            <div className="flex gap-1.5 flex-wrap">
              {['#shorts','#viral','#podcast','#alphaai','#reels','#creator'].map(kw=>(
                <button key={kw} className="text-[11px] px-2 py-0.5 rounded bg-panel border border-border/70 hover:border-accent text-muted hover:text-foreground" onClick={()=>handleNestedChange('social_copy','youtube',`${ytDesc} ${kw}`)}>
                  {kw}
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* Instagram Section */}
        <section className="panel p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Instagram size={18} className="text-pink-500"/>
              <h2 className="text-base font-semibold">Instagram Reels Optimization</h2>
            </div>
            <Button size="sm" variant="ghost" onClick={()=>copyToClipboard(`${igCaption}\n\n${hashtags}`,'Instagram Copy')}>
              <Copy size={13}/>Copy All Instagram Copy
            </Button>
          </div>
          <div>
            <div className="flex justify-between items-center text-xs mb-1">
              <label className="font-medium">Reel Caption</label>
              <span className={`font-mono text-[11px] ${igCaption.length>2200?'text-destructive font-bold':'text-muted'}`}>{igCaption.length}/2,200 chars</span>
            </div>
            <textarea className="input min-h-[100px]" maxLength={2200} value={igCaption} onChange={e=>handleNestedChange('social_copy','instagram',e.target.value)} placeholder="Write an engaging Instagram caption..."/>
          </div>
          <div>
            <label className="font-medium text-xs block mb-1">Hashtags</label>
            <input className="input" value={hashtags} onChange={e=>handleChange('hashtags',e.target.value.split(/\s+/).filter(Boolean))} placeholder="#reels #shorts #viral"/>
          </div>
        </section>
      </>}
    </div>
  </div>;
}

// Requirement 8: Stuff Tab (Exports & Archive Manager)
export function StuffScreen(){
  const {workspace,demo,notify,navigate}=useStudio();
  const archives=useRows('export_archives','*',undefined,{poll:true});
  const projects=useRows('projects');
  const [downloading,setDownloading]=useState('');

  async function handleDownload(arch){
    setDownloading(arch.id);
    try{
      const response=await studioApi(`/api/exports?workspace_id=${encodeURIComponent(workspace.id)}`);
      const target=response.archives?.find(a=>a.id===arch.id);
      if(!target?.downloadUrl)throw new Error('Signed download URL could not be refreshed.');
      const a=document.createElement('a');
      a.href=target.downloadUrl;
      a.download=target.filename;
      a.rel='noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
      notify('Export archive downloaded.');
    }catch(err){
      notify(err.message);
    }finally{
      setDownloading('');
    }
  }

  async function regenerateArchive(projectId){
    try{
      notify('Generating fresh ZIP export package...');
      const response=await studioApi('/api/exports',{method:'POST',body:{workspace_id:workspace.id,project_id:projectId,regenerate:true}});
      if(response.url){
        window.location.href=response.url;
        archives.retry();
      }
    }catch(err){
      notify(err.message);
    }
  }

  return <div className="stuff-screen space-y-6">
    <Heading title="Stuff" description="All finished projects, generated 4-file ZIP packages, download history, and storage retention tracking." action={<Button variant="ghost" onClick={archives.retry}><RefreshCw size={14}/>Refresh</Button>}/>

    <div className="panel p-5">
      <div className="flex items-center justify-between pb-3 mb-4 border-b border-border/50">
        <div>
          <h2 className="text-base font-semibold">ZIP Export Archives (7-Day Retention)</h2>
          <p className="text-xs text-muted">Each ZIP contains 4 files per clip: clip.mp4 (watermarked on Free), thumbnail.jpg, youtube.md, and insta.md.</p>
        </div>
      </div>

      {archives.loading?<ScreenSkeleton/>:(archives.data||[]).length===0?<EmptyState icon={Archive} title="No ZIP exports yet." description="Export clips from Studio to download or cache your multi-platform packages." action={<Button variant="primary" onClick={()=>navigate('studio')}>Open Studio</Button>}/>:
      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>Archive</th>
              <th>Project</th>
              <th>Clips</th>
              <th>Size</th>
              <th>Expires At</th>
              <th>Downloads</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {(archives.data||[]).map(arch=>{
              const proj=projects.data?.find(p=>p.id===arch.project_id);
              const isExpired=new Date(arch.expires_at).getTime()<=Date.now();
              return <tr key={arch.id}>
                <td>
                  <div className="flex items-center gap-2">
                    <Archive size={16} className="text-accent shrink-0"/>
                    <span className="font-mono text-xs">{arch.filename}</span>
                  </div>
                </td>
                <td>{proj?.name||'Video Project'}</td>
                <td>{arch.clip_count||0}</td>
                <td>{arch.file_size_bytes?`${(Number(arch.file_size_bytes)/(1024*1024)).toFixed(1)} MB`:'—'}</td>
                <td>
                  <span className={`text-xs ${isExpired?'text-destructive font-semibold':'text-muted'}`}>
                    {new Date(arch.expires_at).toLocaleDateString()} {isExpired?'(Expired)':''}
                  </span>
                </td>
                <td>{arch.download_count||1}</td>
                <td>
                  <div className="flex gap-2">
                    <Button size="sm" variant="secondary" busy={downloading===arch.id} disabled={isExpired} onClick={()=>handleDownload(arch)}>
                      <Download size={13}/>Download
                    </Button>
                    <Button size="sm" variant="ghost" onClick={()=>regenerateArchive(arch.project_id)}>
                      Regenerate
                    </Button>
                  </div>
                </td>
              </tr>;
            })}
          </tbody>
        </table>
      </div>}
    </div>
  </div>;
}

function Chart({title,points,suffix=''}){
  const max=Math.max(1,...points.map(p=>p.value));const total=points.at(-1)?.value||0;
  return <section className="panel chart-panel"><h2>{title}</h2><p><strong className="text-foreground text-2xl font-mono">{total.toLocaleString(undefined,{maximumFractionDigits:1})}{suffix}</strong><span className="block mt-1">Latest recorded daily snapshot</span></p><svg role="img" aria-label={`${title} across ${points.length} recorded days`} viewBox="0 0 300 140"><path d="M0 125H300M0 65H300M0 5H300" stroke="var(--border)" fill="none"/>{points.map((p,i)=><rect key={i} x={i/Math.max(1,points.length)*300+4} y={125-p.value/max*110} width={Math.max(3,300/Math.max(1,points.length)-10)} height={p.value/max*110} rx="3" fill="var(--accent)"><title>{p.day}: {p.value}{suffix}</title></rect>)}</svg></section>;
}

export function InsightsScreen(){
  const {navigate,state}=useStudio();const performance=useRows('content_performance','*',{order:'captured_at'});
  const rows=state==='empty'?[]:performance.data||[];
  if(performance.loading)return <ScreenSkeleton/>;if(performance.error)return <ErrorState message={performance.error} onRetry={performance.retry}/>;
  const latest=new Map();for(const p of rows)if(!latest.has(p.clip_id))latest.set(p.clip_id,p);
  const days=new Map();for(const p of rows){const day=new Date(p.captured_at).toLocaleDateString();if(!days.has(day))days.set(day,[]);const entries=days.get(day);if(!entries.some(e=>e.clip_id===p.clip_id))entries.push(p)}
  const points=[...days].reverse().slice(-14).map(([day,entries])=>({day,views:entries.reduce((sum,p)=>sum+(Number(p.views)||0),0),retention:entries.reduce((sum,p)=>sum+(Number(p.retention)||0),0)/entries.length,engagement:entries.reduce((sum,p)=>sum+(Number(p.likes)||0)+(Number(p.comments)||0)+(Number(p.shares)||0),0)}));
  return <><Heading title="Insights" description="Learn from the results, not a promise of them." action={<Button size="sm" onClick={performance.retry}><RefreshCw size={14}/>Refresh</Button>}/>{!rows.length?<EmptyState icon={TrendingUp} title="Your first results are still ahead." description="Published performance snapshots will appear here when they are synced. We don’t invent views or engagement." action={<Button variant="primary" onClick={()=>navigate('publish')}>Open publishing</Button>}/>:<><div className="chart-grid mb-8">{[['Views','views',''],['Average retention','retention','%'],['Engagement','engagement','']].map(([title,key,suffix])=><Chart key={key} title={title} suffix={suffix} points={points.map(p=>({day:p.day,value:p[key]}))}/>)}</div><div className="panel table-scroll" tabIndex={0} role="region" aria-label="Clip performance table"><table className="data-table"><caption className="sr-only">Latest performance snapshot per clip</caption><thead><tr><th>Clip</th><th>Views</th><th>Retention</th><th>Likes</th><th>Comments</th><th>Captured</th></tr></thead><tbody>{[...latest.values()].map(p=><tr key={p.id}><td>{p.title||p.platform+' clip'}</td><td>{Number(p.views||0).toLocaleString()}</td><td>{p.retention??'—'}%</td><td>{p.likes||0}</td><td>{p.comments||0}</td><td>{new Date(p.captured_at).toLocaleDateString()}</td></tr>)}</tbody></table></div></>}</>;
}

export function BrandScreen(){
  const {workspace,demo,notify}=useStudio();const resource=useRows('brand_kit_profiles');const [activeKitId,setActiveKitId]=useState('');
  const [kit,setKit]=useState({name:'My studio',primary_color:'#C6F432',secondary_color:'#FFFFFF',font_family:'Inter',caption_style:'pop',intro_text:'',outro_text:'',logo_path:''}),[busy,setBusy]=useState(false),[error,setError]=useState(''),[logo,setLogo]=useState('');
  useEffect(()=>{if(activeKitId==='new'||!resource.data?.length)return;const selected=resource.data.find(row=>row.id===activeKitId)||resource.data[0];setKit(selected);if(selected.id!==activeKitId)setActiveKitId(selected.id)},[resource.data,activeKitId]);
  async function save(e){e.preventDefault();setError('');setBusy(true);try{if(!demo){const row={workspace_id:workspace.id,name:kit.name,primary_color:kit.primary_color,secondary_color:kit.secondary_color,font_family:kit.font_family,caption_style:kit.caption_style,intro_text:kit.intro_text,outro_text:kit.outro_text,logo_path:kit.logo_path,settings:kit.settings||{}};if(kit.id){unwrap(await supabase.from('brand_kit_profiles').update(row).eq('id',kit.id).eq('workspace_id',workspace.id))}else{const created=unwrap(await supabase.from('brand_kit_profiles').insert(row).select('*').single());setKit(created);setActiveKitId(created.id)}}notify(demo?'Brand preview saved in this sample session.':'Workspace brand preferences saved.');resource.retry()}catch(err){setError(err.message)}finally{setBusy(false)}}
  async function uploadLogo(file){if(!file)return;setError('');if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>2*1024*1024)return setError('Choose a PNG, JPEG, or WebP logo under 2 MB.');const local=URL.createObjectURL(file);setLogo(local);if(demo)return;try{const path=`${workspace.id}/brand/${crypto.randomUUID()}.${file.name.split('.').pop()}`;const {error}=await supabase.storage.from('media').upload(path,file);if(error)throw error;setKit(k=>({...k,logo_path:path}))}catch(err){setError(err.message)}}
  if(resource.loading)return <ScreenSkeleton/>;if(resource.error)return <ErrorState message={resource.error} onRetry={resource.retry}/>;
  return <><Heading title="Brand kits" description="Create and switch between workspace brand profiles." action={<Button onClick={()=>{setKit({name:'New brand kit',primary_color:'#6D5EF5',secondary_color:'#FFFFFF',font_family:'Inter',caption_style:'pop',intro_text:'',outro_text:'',logo_path:'',settings:{}});setActiveKitId('new')}}><Plus size={14}/>New kit</Button>}/>{(resource.data||[]).length>0&&<div className="mb-5 max-w-sm"><Select label="Active brand kit" value={activeKitId||resource.data[0]?.id||''} onValueChange={id=>{setActiveKitId(id);setKit(resource.data.find(row=>row.id===id)||kit)}} options={resource.data.map(row=>({value:row.id,label:row.name}))}/></div>}{error&&<div className="mb-6"><ErrorState message={error} onRetry={()=>setError('')}/></div>}<div className="brand-layout"><form className="panel p-6 space-y-5" onSubmit={save}><Input label="Kit name" value={kit.name||''} onChange={e=>setKit({...kit,name:e.target.value})} required/><label className="field">Workspace logo<input className="input" type="file" accept="image/png,image/jpeg,image/webp" onChange={e=>uploadLogo(e.target.files[0])}/></label><div className="grid grid-cols-2 gap-4"><Input label="Primary colour" type="color" value={kit.primary_color||'#C6F432'} onChange={e=>setKit({...kit,primary_color:e.target.value})}/><Input label="Caption colour" type="color" value={kit.secondary_color||'#FFFFFF'} onChange={e=>setKit({...kit,secondary_color:e.target.value})}/></div><Select label="Caption font preference" value={kit.font_family||'Inter'} onValueChange={v=>setKit({...kit,font_family:v})} options={['Inter','Geist','Arial'].map(v=>({value:v,label:v}))}/><Select label="Caption preset" value={['pop','bold','minimal'].includes(kit.caption_style)?kit.caption_style:'pop'} onValueChange={v=>setKit({...kit,caption_style:v})} options={[{value:'pop',label:'Word pop'},{value:'bold',label:'Bold'},{value:'minimal',label:'Minimal'}]}/><Input label="Watermark text" value={kit.settings?.watermark?.text||''} onChange={e=>setKit({...kit,settings:{...(kit.settings||{}),watermark:{...(kit.settings?.watermark||{}),text:e.target.value}}})}/><Select label="Watermark position" value={kit.settings?.watermark?.position||'bottom-right'} onValueChange={v=>setKit({...kit,settings:{...(kit.settings||{}),watermark:{...(kit.settings?.watermark||{}),position:v}}})} options={[{value:'top-left',label:'Top left'},{value:'top-right',label:'Top right'},{value:'bottom-left',label:'Bottom left'},{value:'bottom-right',label:'Bottom right'},{value:'center',label:'Center'}]}/><Input label="Watermark opacity (0.1–1)" type="number" min="0.1" max="1" step="0.05" value={kit.settings?.watermark?.opacity??0.75} onChange={e=>setKit({...kit,settings:{...(kit.settings||{}),watermark:{...(kit.settings?.watermark||{}),opacity:Number(e.target.value)}}})}/><Input label="Intro copy (saved preference)" value={kit.intro_text||''} onChange={e=>setKit({...kit,intro_text:e.target.value})}/><Input label="Outro copy (saved preference)" value={kit.outro_text||''} onChange={e=>setKit({...kit,outro_text:e.target.value})}/><p className="text-xs text-muted">Caption style and colour can be applied in the editor. Automated logo, intro/outro, and custom-font insertion are not implemented in the worker yet.</p><Button variant="primary" type="submit" busy={busy}>Save brand kit</Button></form><div className="panel brand-preview"><div><p className="eyebrow mb-4">LIVE STYLE PREVIEW</p><div className="sample-video vertical"><img src="/studio-sample.svg" alt="Sample clip with your brand caption preference" width="270" height="390"/>{logo&&<img src={logo} alt="Your uploaded logo" className="absolute top-3 right-3 !w-12 !h-12 !aspect-square !object-contain"/>}<div className="sample-captions" style={{color:kit.secondary_color,fontFamily:kit.font_family}}><span>Start with </span><mark style={{background:kit.primary_color}}>a question.</mark></div><div><span>{kit.name}</span><span>Sample</span></div></div></div></div></div></>;
}

function UpiBillingPanel({workspace,demo,notify}) {
  const [plan,setPlan]=useState("pro"),[interval,setInterval]=useState("monthly"),[utr,setUtr]=useState(""),[order,setOrder]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState("");
  async function request(path,body) {
    const {data:{session}}=await supabase.auth.getSession();
    if(!session?.access_token)throw new Error("Your session expired. Sign in again.");
    const response=await fetch(path,{method:"POST",headers:{"content-type":"application/json",authorization:"Bearer "+session.access_token},body:JSON.stringify(body)});
    const result=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(result.error||"Request failed. Try again.");
    return result;
  }
  async function createOrder(e) {
    e.preventDefault();setBusy(true);setError("");
    try { if(demo)throw new Error("UPI checkout is unavailable in the sample workspace."); const result=await request("/api/billing/upi/orders",{workspace_id:workspace.id,plan,billing_interval:interval});setOrder({...result.order,upi_uri:result.upi_uri});setUtr(""); }
    catch(err){setError(err.message)} finally{setBusy(false)}
  }
  async function submitUtr(e) {
    e.preventDefault();if(!order)return;setBusy(true);setError("");
    try { await request("/api/billing/upi/submit",{order_id:order.id,workspace_id:workspace.id,utr});setOrder(o=>({...o,status:"submitted"}));notify("UTR submitted. Your plan activates after payment review."); }
    catch(err){setError(err.message)} finally{setBusy(false)}
  }
  return <div className="space-y-6">
    <div className="panel p-5"><span className="eyebrow">MANUAL UPI CHECKOUT</span><h3 className="text-xl mt-2">Upgrade your workspace</h3><p className="text-sm text-muted mt-2">Pay from your UPI app, submit the 12-digit UTR, and wait for an admin to verify the payment. A submitted UTR does not activate a plan automatically.</p>
      <form onSubmit={createOrder} className="grid gap-4 mt-5">
        <Select label="Plan" value={plan} onValueChange={setPlan} options={[{value:"pro",label:"Pro"},{value:"studio",label:"Studio"}]}/>
        <Select label="Billing interval" value={interval} onValueChange={setInterval} options={[{value:"monthly",label:"Monthly"},{value:"yearly",label:"Yearly"}]}/>
        <Button type="submit" variant="primary" busy={busy}>Create UPI payment order</Button>
      </form>
    </div>
    {error&&<ErrorState message={error} onRetry={()=>setError("")}/>}
    {order&&<div className="panel p-5 space-y-4"><div className="flex items-start justify-between gap-4"><div><span className="eyebrow">PAYMENT ORDER</span><h3 className="text-lg mt-2">{order.plan.toUpperCase()} · {order.billing_interval}</h3><p className="font-mono text-sm mt-2">{order.reference}</p><p className="text-sm text-muted mt-2">₹{(Number(order.amount_paise)/100).toFixed(2)} · expires {new Date(order.expires_at).toLocaleString()}</p></div><span className="text-xs rounded-full border px-3 py-1">{order.status}</span></div>
      {order.upi_uri&&<a className="inline-flex items-center justify-center rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-semibold" href={order.upi_uri}>Pay with UPI app</a>}
      {order.status==="pending"&&<form onSubmit={submitUtr} className="space-y-4"><Input label="12-digit UTR / bank reference" value={utr} onChange={e=>setUtr(e.target.value.replace(/\D/g,"").slice(0,12))} inputMode="numeric" minLength={12} maxLength={12} required/><Button type="submit" busy={busy} disabled={utr.length!==12}>Submit UTR for review</Button></form>}
      {order.status==="submitted"&&<p className="text-sm text-muted">Payment submitted for review. Do not submit another order for the same payment.</p>}
    </div>}
  </div>;
}

export function SettingsScreen(){
  const {user,workspace,demo,notify,state,refreshWorkspace}=useStudio();const [tab,setTab]=useState('profile'),[busy,setBusy]=useState(false),[error,setError]=useState(''),[name,setName]=useState(user.user_metadata?.full_name||''),[workspaceName,setWorkspaceName]=useState(workspace.name);
  const members=useRows('workspace_members','user_id,role,created_at');
  const connections=useRows('publish_connections','id,platform,status,created_at');
  const keys=useResource(async()=>demo?[]:(await studioApi('/api/v1/keys?workspace_id='+encodeURIComponent(workspace.id))).keys,[workspace.id,demo]);
  const [keyName,setKeyName]=useState(''),[newKey,setNewKey]=useState(''),[keyOpen,setKeyOpen]=useState(false);
  async function save(e){e.preventDefault();setError('');setBusy(true);try{if(!demo){if(tab==='profile'){const {error}=await supabase.auth.updateUser({data:{full_name:name}});if(error)throw error}else {const changed=unwrap(await supabase.from('workspaces').update({name:workspaceName}).eq('id',workspace.id).select('id'));if(!changed.length)throw new Error('You do not have permission to rename this workspace.');refreshWorkspace()}}notify(demo?'Sample preferences saved for this preview.':'Your settings are saved.')}catch(err){setError(err.message)}finally{setBusy(false)}}
  async function createKey(e){e.preventDefault();setBusy(true);setError('');try{if(demo)return notify('API credentials are not created in the sample workspace.');const result=await studioApi('/api/v1/keys',{body:{workspace_id:workspace.id,name:keyName}});setNewKey(result.key);keys.retry()}catch(err){setError(err.message)}finally{setBusy(false)}}
  async function revoke(id){try{await studioApi('/api/v1/keys',{method:'DELETE',body:{id}});keys.retry();notify('API key revoked.')}catch(err){setError(err.message)}}
  const resource=tab==='members'?members:tab==='integrations'?connections:tab==='keys'?keys:null;
  const tabs=[['profile','Profile'],['workspace','Workspace'],['members','Members & roles'],['keys','API keys'],['integrations','Integrations'],['billing','Billing'],['danger','Danger zone']];
  return <><Heading title="Settings" description="A workspace that fits the way you work."/><div className="settings-layout"><nav className="settings-nav" aria-label="Settings sections">{tabs.map(([id,label])=><button key={id} className={tab===id?'active':''} aria-current={tab===id?'page':undefined} onClick={()=>{setTab(id);setError('')}}>{label}</button>)}</nav><section className="panel settings-panel"><h2>{tabs.find(([id])=>id===tab)?.[1]}</h2>{error&&<div className="mb-5"><ErrorState message={error} onRetry={()=>setError('')}/></div>}{resource?.loading?<ScreenSkeleton/>:resource?.error?<ErrorState message={resource.error} onRetry={resource.retry}/>:<>
    {tab==='profile'&&<form onSubmit={save}><Input label="Full name" value={name} onChange={e=>setName(e.target.value)} required/><Input label="Email" type="email" value={user.email||''} disabled/><Button type="submit" variant="primary" busy={busy} className="self-start">Save profile</Button><Button className="self-start" onClick={async()=>{if(demo)return notify('Sign in to manage your real password.');const {error}=await supabase.auth.resetPasswordForEmail(user.email,{redirectTo:window.location.origin+'/auth/update-password'});if(error)setError(error.message);else notify('Password reset sent. Check your inbox.')}}>Send password reset</Button></form>}
    {tab==='workspace'&&<form onSubmit={save}><Input label="Workspace name" value={workspaceName} onChange={e=>setWorkspaceName(e.target.value)} required/><p className="text-xs text-muted">Changes are subject to your workspace role and database permissions.</p><Button type="submit" variant="primary" busy={busy} className="self-start">Save workspace</Button></form>}
    {tab==='members'&&((members.data||[]).length&&state!=='empty'?<><div className="table-scroll"><table className="data-table"><thead><tr><th>Member</th><th>Role</th><th>Joined</th></tr></thead><tbody>{members.data.map(m=><tr key={m.user_id}><td>{m.user_id===user.id?user.user_metadata?.full_name||'You':`Member ${m.user_id.slice(0,8)}`}</td><td>{m.role}</td><td>{new Date(m.created_at).toLocaleDateString()}</td></tr>)}</tbody></table></div><p className="text-xs text-muted mt-5">Membership is read from your workspace. Invitation delivery and role-management workflows need an administrative integration.</p></>:<EmptyState icon={Users} title="A place for your team." description="Workspace members appear here when they are added."/>)}
    {tab==='keys'&&<><p className="text-sm text-muted mb-5">Read project clips from your own tools. Keys are shown once when created; existing secrets are never returned.</p><Button size="sm" onClick={()=>{setNewKey('');setKeyOpen(true)}}><Plus size={14}/>Create API key</Button>{(keys.data||[]).length?keys.data.map(k=><div key={k.id} className="flex gap-4 justify-between items-center border-b py-4"><div><b className="text-sm">{k.name}</b><p className="font-mono text-xs text-muted mt-1">{k.key_prefix}… · {k.revoked_at?'Revoked':'Active'}</p></div><Button size="sm" variant="danger" onClick={()=>revoke(k.id)} disabled={!!k.revoked_at}>Revoke</Button></div>):<EmptyState icon={KeyRound} title="No API keys yet." description="Create a key when you’re ready to connect your own tools."/>}<ButtonLink href="/api-docs" variant="ghost" className="mt-4">Read API documentation</ButtonLink></>}
    {tab==='integrations'&&<><div className="flex gap-4 items-center border-b pb-5"><Youtube size={24}/><div className="flex-1"><h3 className="text-base">YouTube</h3><p className="text-xs text-muted mt-1">{connections.data?.find(c=>c.platform==='youtube')?.status||'Not connected'}</p></div><Button size="sm" onClick={()=>window.location.href=demo?'/studio?demo=1&view=publish':'/studio?view=publish'}>Manage</Button></div><div className="flex gap-4 items-center border-b py-5"><Instagram size={24}/><div className="flex-1"><h3 className="text-base">Instagram</h3><p className="text-xs text-muted mt-1">{connections.data?.find(c=>c.platform==='instagram')?.status||'Not connected'}</p></div><Button size="sm" onClick={()=>window.location.href=demo?'/studio?demo=1&view=publish':'/studio?view=publish'}>Manage</Button></div>{['Google Drive','Google Photos'].map(source=><div key={source} className="border-b py-5"><h3 className="text-base">{source}</h3><p className="text-xs text-muted mt-2">Authorize selected files in the import picker. Source credentials are not displayed here.</p></div>)}<p className="text-xs text-muted mt-5">Other publishing destinations are not connected. Export MP4 files for those platforms.</p></>}
    {tab==='billing'&&<><UpiBillingPanel workspace={workspace} demo={demo} notify={notify}/><div className="mt-6"><PricingCards compact/></div></>}
    {tab==='danger'&&<><div className="border border-destructive/30 rounded-card p-5"><h3 className="text-base text-destructive">Delete your account and data</h3><p className="text-sm text-muted mt-3 mb-5">A complete deletion needs to cover shared workspace ownership, source storage, and connected services. Use a data-deletion request while that cleanup workflow is being completed.</p><ButtonLink href="/contact" variant="danger">Request data deletion</ButtonLink></div></>}
    </>}</section></div><Modal open={keyOpen} onOpenChange={v=>{setKeyOpen(v);if(!v)setNewKey('')}} title={newKey?'Save your new key securely.':'Create an API key'} description={newKey?'This value is shown only once. Closing this dialog clears it from the screen.':'A key grants access to the project-clips API for this workspace.'}>{newKey?<><input className="input font-mono text-xs" type="password" value={newKey} readOnly aria-label="New API key"/><Button className="mt-4" onClick={async()=>{await navigator.clipboard.writeText(newKey);notify('Key copied. Keep it private.')}}><Copy size={14}/>Copy key</Button></>:<form onSubmit={createKey} className="space-y-5"><Input label="Key name" value={keyName} onChange={e=>setKeyName(e.target.value)} required/><Button variant="primary" type="submit" busy={busy}>Create key</Button>{error&&<p role="alert" className="text-destructive text-sm">{error}</p>}</form>}</Modal></>;
}
