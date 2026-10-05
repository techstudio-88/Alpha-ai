"use client";

import {useCallback,useEffect,useState} from 'react';
import {useRouter,useSearchParams} from 'next/navigation';
import Link from 'next/link';
import {Bell,CalendarDays,Clapperboard,Folder,Home,LogOut,Menu,PanelLeftClose,PanelLeftOpen,Palette,Search,Settings,TrendingUp,User} from 'lucide-react';
import {supabase} from '../../lib/supabase';
import BrowserTranscriber from '../BrowserTranscriber';
import Brand from './brand';
import AuthScreen from './auth-screen';
import ImportVideo from './import-video';
import {StudioContext,studioApi,useResource,useRows,useStudio} from './data';
import {Button,EmptyState,ErrorState,Modal,ScreenSkeleton,Select,ThemeToggle,Toast} from './ui';
import {HomeScreen,ProjectsScreen,ClipsScreen,ProjectScreen} from './project-screens';
import EditorScreen from './editor-screen';
import {PublishScreen,InsightsScreen,BrandScreen,SettingsScreen} from './management-screens';
import {PricingCards} from './marketing';

export const NAV=[['home','Home',Home],['projects','Projects',Folder],['clips','Clips',Clapperboard],['publish','Publish',CalendarDays],['insights','Insights',TrendingUp],['brand','Brand kit',Palette],['settings','Settings',Settings]];
const aliases={dashboard:'home',calendar:'publish',analytics:'insights',brandkit:'brand'};

export default function StudioApp() {
  const params=useSearchParams(),router=useRouter(),demo=params.get('demo')==='1';
  const [user,setUser]=useState(null),[ready,setReady]=useState(false),[authError,setAuthError]=useState('');
  const [revision,setRevision]=useState(0),[selectedWorkspace,setSelectedWorkspace]=useState('');
  const [message,setMessage]=useState(''),[importOpen,setImportOpen]=useState(false),[importFile,setImportFile]=useState(null);
  const view=aliases[params.get('view')]||params.get('view')||'home';
  useEffect(()=>{
    if(demo||!supabase){setReady(true);return}
    let alive=true;
    const timeout=setTimeout(()=>{if(alive){setAuthError('Your session could not be restored. Check your connection and retry.');setReady(true)}},12000);
    (async()=>{
      try {
        const url=new URL(window.location.href),code=url.searchParams.get('code');
        // detectSessionInUrl owns the PKCE exchange; a second exchange reuses a one-time code.
        const response=await supabase.auth.getSession();
        if(response.error||(code&&!response.data?.session))throw new Error('Sign-in incomplete.');
        if(alive){setUser(response.data?.session?.user||null);setReady(true);setAuthError('')}
        if(code){for(const key of ['code','sb_flow_id','error','error_description'])url.searchParams.delete(key);window.history.replaceState({},'',url)}
      }catch{if(alive){setAuthError('Sign-in could not finish. Please retry from the same browser.');setReady(true)}}
      finally{clearTimeout(timeout)}
    })();
    const {data}=supabase.auth.onAuthStateChange((_event,session)=>{
      if(alive){setUser(session?.user||null);setReady(true);if(session)setAuthError('')}
    });
    return()=>{alive=false;clearTimeout(timeout);data.subscription.unsubscribe()};
  },[demo]);
  const bootstrap=useResource(async()=>{
    if(demo)return {workspace:{id:'sample-workspace',name:'The Long Game',role:'owner'},workspaces:[{id:'sample-workspace',name:'The Long Game',role:'owner'}]};
    if(!user)return null;
    const result=await studioApi('/api/workspace/bootstrap',{body:{}});
    const list=await studioApi('/api/workspaces');
    const workspaces=list.workspaces?.length?list.workspaces:[result.workspace];
    return {workspace:workspaces.find(w=>w.id===selectedWorkspace)||result.workspace||workspaces[0],workspaces};
  },[user?.id,demo,selectedWorkspace]);
  const refresh=useCallback(()=>setRevision(v=>v+1),[]);
  const notify=useCallback(text=>setMessage(text),[]);
  const clearToast=useCallback(()=>setMessage(''),[]);
  const navigate=useCallback((next,options={})=>{
    const search=new URLSearchParams();
    if(demo)search.set('demo','1');if(next!=='home')search.set('view',next);
    Object.entries(options).forEach(([key,value])=>{if(value)search.set(key,value)});
    router.push('/studio'+(search.size?'?'+search:''));
  },[demo,router]);
  const context={
    demo,user:demo?{id:'sample-user',email:'alex@thelonggame.studio',user_metadata:{full_name:'Alex Morgan'}}:user,
    workspace:bootstrap.data?.workspace,workspaces:bootstrap.data?.workspaces||[],revision,refresh,
    refreshWorkspace:bootstrap.retry,notify,navigate,view,projectId:params.get('project'),clipId:params.get('clip'),
    state:demo?params.get('state'):null,selectWorkspace:setSelectedWorkspace,
    openImport:file=>{setImportFile(file||null);setImportOpen(true)},
  };
  if(!ready)return <main id="main-content" className="studio-content"><ScreenSkeleton/></main>;
  if(authError&&!demo)return <main id="main-content" className="landing-container py-16"><ErrorState message={authError} onRetry={()=>window.location.href='/studio'}/></main>;
  if(!user&&!demo)return <AuthScreen mode={params.get('mode')||'signin'}/>;
  if(bootstrap.error)return <main id="main-content" className="studio-content"><ErrorState message={bootstrap.error} onRetry={bootstrap.retry}/><Button className="mt-4" onClick={()=>supabase?.auth.signOut()}>Sign out</Button></main>;
  if(bootstrap.loading||!context.workspace)return <main id="main-content" className="studio-content"><ScreenSkeleton/></main>;
  return <StudioContext.Provider value={context}>
    <StudioWorkspace/>
    {importOpen&&<ImportVideo key={importFile?.name||'import'} file={importFile} open={importOpen} onOpenChange={setImportOpen}/>}
    <Toast message={message} onClose={clearToast}/>
  </StudioContext.Provider>;
}

function StudioWorkspace() {
  const {view,workspace,workspaces,user,demo,navigate,projectId,clipId,state,selectWorkspace}=useStudio();
  const [command,setCommand]=useState(false),[query,setQuery]=useState(''),[mobile,setMobile]=useState(false);
  const [notifications,setNotifications]=useState(false),[upgrade,setUpgrade]=useState(false),[account,setAccount]=useState(false),[collapsed,setCollapsed]=useState(false);
  const projects=useRows('projects');
  const usage=useRows('media_assets','id,duration_seconds');
  const activity=useRows('processing_jobs','id,project_id,status,progress,current_stage,error,created_at',{poll:true});
  useEffect(()=>{
    document.documentElement.dataset.studioSidebar=collapsed?'collapsed':'expanded';
    return()=>{delete document.documentElement.dataset.studioSidebar};
  },[collapsed]);
  useEffect(()=>{
    const onKey=e=>{if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'){e.preventDefault();setCommand(v=>!v)}};
    window.addEventListener('keydown',onKey);return()=>window.removeEventListener('keydown',onKey);
  },[]);
  const minutes=Math.round((usage.data||[]).reduce((sum,a)=>sum+(Number(a.duration_seconds)||0),0)/60*10)/10;
  const link=id=>{const p=new URLSearchParams();if(demo)p.set('demo','1');if(id!=='home')p.set('view',id);return '/studio'+(p.size?'?'+p:'')};
  const navItems=NAV.map(([id,label,Icon])=><Link key={id} href={link(id)} className={view===id?'active':''} aria-label={label} title={label} aria-current={view===id?'page':undefined} onClick={()=>setMobile(false)}><Icon size={17}/><span>{label}</span></Link>);
  const workspaceSelect=<Select label="Workspace" value={workspace.id} onValueChange={selectWorkspace} options={workspaces.map(w=>({value:w.id,label:w.name}))}/>;
  let screen;
  if(state==='loading')screen=<ScreenSkeleton/>;
  else if(state==='error')screen=<ErrorState message="This sample shows how a failed request is presented. Retry returns to the normal studio." onRetry={()=>navigate(view,{project:projectId,clip:clipId})}/>;
  else if(view==='home')screen=<HomeScreen projects={projects}/>;
  else if(view==='projects')screen=<ProjectsScreen resource={projects}/>;
  else if(view==='project')screen=projects.loading?<ScreenSkeleton/>:projects.error?<ErrorState message={projects.error} onRetry={projects.retry}/>:<ProjectScreen projects={projects.data||[]} projectId={projectId}/>;
  else if(view==='clips')screen=<ClipsScreen/>;
  else if(view==='editor')screen=<EditorScreen/>;
  else if(view==='publish')screen=<PublishScreen/>;
  else if(view==='insights')screen=<InsightsScreen/>;
  else if(view==='brand')screen=<BrandScreen/>;
  else if(view==='settings')screen=<SettingsScreen/>;
  else screen=<EmptyState title="This view moved." description="Choose a project or a section from the sidebar." action={<Button onClick={()=>navigate('home')}>Back home</Button>}/>;
  return <div className="studio-shell">
    <aside className="studio-sidebar">
      <Brand/>
      <nav aria-label="Studio navigation">{navItems}</nav>
      <div className="sidebar-bottom">
        {workspaceSelect}
        <div className="usage-meter"><strong>{usage.error?'—':`${minutes} min`}</strong><span className="block mt-1">Source media in this workspace</span><span className="block mt-1">Pilot access · billing not connected</span></div>
        <Button size="sm" className="w-full" onClick={()=>setUpgrade(true)} aria-label="View planned upgrades">View planned upgrades</Button>
      </div>
    </aside>
    <div className="min-w-0">
      <header className="studio-topbar">
        <div className="flex items-center gap-3 min-w-0">
          <Button className="mobile-menu" size="icon" variant="ghost" aria-label="Open studio navigation" onClick={()=>setMobile(true)}><Menu size={20}/></Button>
          <Button className="sidebar-collapse" size="icon" variant="ghost" aria-label={collapsed?'Expand studio sidebar':'Collapse studio sidebar'} aria-expanded={!collapsed} onClick={()=>setCollapsed(v=>!v)}>{collapsed?<PanelLeftOpen size={18}/>:<PanelLeftClose size={18}/>}</Button>
          <span className="text-xs text-muted truncate">{workspace.name}</span>{demo&&<span className="status-chip">Sample</span>}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button className="studio-search" onClick={()=>setCommand(true)} aria-label="Search workspace, Command K"><Search size={15}/><span>Search workspace</span><kbd>⌘ K</kbd></button>
          <ThemeToggle/>
          <Button variant="ghost" size="icon" aria-label="View notifications" onClick={()=>setNotifications(true)}><Bell size={17}/></Button>
          <Button variant="secondary" size="icon" aria-label="Open account menu" onClick={()=>setAccount(true)}><span className="text-xs">{(user.user_metadata?.full_name||user.email||'A').slice(0,1).toUpperCase()}</span></Button>
        </div>
      </header>
      {demo&&<div className="border-b px-6 py-2 text-xs text-muted flex justify-between flex-wrap gap-2"><span>Sample workspace · example content · changes stay in this session</span><a href="/studio?mode=signup" className="underline">Create your own workspace</a></div>}
      <main id="main-content" className="studio-content">{screen}</main>
    </div>
    {!demo&&<BrowserTranscriber workspace={workspace}/>}
    <Modal open={mobile} onOpenChange={setMobile} title="Your studio">
      <nav className="mobile-nav-list" aria-label="Mobile studio navigation">{navItems}</nav>
      <div className="mt-6">{workspaceSelect}<p className="text-xs text-muted mt-3">{minutes} source minutes · pilot access</p></div>
    </Modal>
    <Modal open={command} onOpenChange={setCommand} title="Jump to anything" description="Search views and projects. Use Command K or Ctrl K from anywhere.">
      <label className="sr-only" htmlFor="command-search">Search views and projects</label><input id="command-search" className="input" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search projects, clips, settings…"/>
      <div className="flex flex-col gap-1 mt-4">
        {NAV.filter(([,label])=>label.toLowerCase().includes(query.toLowerCase())).map(([id,label,Icon])=><Button key={id} variant="ghost" className="justify-start" onClick={()=>{setCommand(false);navigate(id)}}><Icon size={16}/>{label}</Button>)}
        {(projects.data||[]).filter(p=>p.name.toLowerCase().includes(query.toLowerCase())).map(p=><Button key={p.id} variant="ghost" className="justify-start" onClick={()=>{setCommand(false);navigate('project',{project:p.id})}}><Folder size={16}/>{p.name}</Button>)}
      </div>
    </Modal>
    <Modal open={notifications} onOpenChange={setNotifications} title="Pipeline activity" description="Current job status in this workspace.">
      {activity.loading?<ScreenSkeleton/>:activity.error?<ErrorState message={activity.error} onRetry={activity.retry}/>:(activity.data||[]).length?activity.data.map(job=><button key={job.id} className="block w-full text-left border-b py-4" onClick={()=>{setNotifications(false);navigate('project',{project:job.project_id})}}><b className="text-sm">{projects.data?.find(p=>p.id===job.project_id)?.name||'Video project'}</b><p className="text-xs text-muted mt-1">{job.status} · {job.progress}%</p></button>):<EmptyState icon={Bell} title="You’re all caught up." description="Processing activity will appear here after your first import."/>}
    </Modal>
    <Modal open={account} onOpenChange={setAccount} title={user.user_metadata?.full_name||'Your account'} description={user.email}>
      <Button variant="ghost" className="w-full justify-start" onClick={()=>{setAccount(false);navigate('settings')}}><User size={16}/>Profile and workspace</Button>
      <Button variant="ghost" className="w-full justify-start" onClick={async()=>{if(demo)window.location.href='/';else{await supabase.auth.signOut();window.location.href='/studio'}}}><LogOut size={16}/>{demo?'Leave sample':'Sign out'}</Button>
    </Modal>
    <Modal open={upgrade} onOpenChange={setUpgrade} title="Choose your next step" description="Paid plans are proposed and unavailable for checkout today." className="max-w-[1080px] w-[calc(100%-32px)]"><PricingCards compact/></Modal>
  </div>;
}
