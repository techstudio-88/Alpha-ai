"use client";

import {useEffect,useId,useRef,useState} from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import * as SelectPrimitive from '@radix-ui/react-select';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import {cva} from 'class-variance-authority';
import {clsx} from 'clsx';
import {twMerge} from 'tailwind-merge';
import {AlertCircle,ArrowRight,Check,ChevronDown,Download,Film,Loader2,Moon,Play,RefreshCw,Sun,Upload,X} from 'lucide-react';

export const cn = (...values) => twMerge(clsx(values));
const buttons = cva('inline-flex items-center justify-center gap-2 rounded-control border px-4 py-2.5 text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-45 min-h-10', {
  variants:{variant:{primary:'border-transparent bg-accent text-accent-foreground hover:bg-[#d2fa60]',secondary:'border-border bg-panel text-foreground hover:bg-raised',ghost:'border-transparent text-muted hover:bg-raised hover:text-foreground',danger:'border-destructive/30 text-destructive hover:bg-destructive/10'},size:{default:'',sm:'min-h-8 px-3 py-1.5 text-xs',icon:'size-10 p-0'}},
  defaultVariants:{variant:'secondary',size:'default'},
});
export function Button({className,variant,size,busy,disabled,children,type='button',...props}) {
  return <button type={type} className={cn(buttons({variant,size}),className)} disabled={busy||disabled} {...props}>{busy&&<Loader2 size={15} className="animate-spin"/>}{children}</button>;
}
export function ButtonLink({className,variant='primary',size,children,...props}) {
  return <a className={cn(buttons({variant,size}),className)} {...props}>{children}</a>;
}
export function Input({label,error,className,id,...props}) {
  const uid=useId(); const field=id||uid;
  return <label htmlFor={field} className={cn('field',className)}>{label&&<span>{label}</span>}<input id={field} className="input" aria-invalid={Boolean(error)} aria-describedby={error?field+'-error':undefined} {...props}/>{error&&<small id={field+'-error'} className="text-destructive">{error}</small>}</label>;
}
export function Select({label,value,onValueChange,options,disabled}) {
  const id=useId();
  return <div className="field">{label&&<label htmlFor={id}>{label}</label>}<SelectPrimitive.Root value={value} onValueChange={onValueChange} disabled={disabled}><SelectPrimitive.Trigger id={id} aria-label={label} className="input flex items-center justify-between gap-2"><SelectPrimitive.Value/><ChevronDown size={14}/></SelectPrimitive.Trigger><SelectPrimitive.Portal><SelectPrimitive.Content position="popper" className="select-content" sideOffset={4}><SelectPrimitive.Viewport>{options.map(o=><SelectPrimitive.Item key={o.value} value={o.value} className="select-item"><SelectPrimitive.ItemText>{o.label}</SelectPrimitive.ItemText><SelectPrimitive.ItemIndicator><Check size={14}/></SelectPrimitive.ItemIndicator></SelectPrimitive.Item>)}</SelectPrimitive.Viewport></SelectPrimitive.Content></SelectPrimitive.Portal></SelectPrimitive.Root></div>;
}
export function Tabs({value,onValueChange,items,label='Sections',children}) {
  return <TabsPrimitive.Root value={value} onValueChange={onValueChange}><TabsPrimitive.List aria-label={label} className="tabs">{items.map(item=><TabsPrimitive.Trigger key={item.value} value={item.value}>{item.label}</TabsPrimitive.Trigger>)}</TabsPrimitive.List>{children||items.map(item=><TabsPrimitive.Content key={item.value} value={item.value}>{item.content}</TabsPrimitive.Content>)}</TabsPrimitive.Root>;
}
export function Modal({open,onOpenChange,title,description,children,className}) {
  return <Dialog.Root open={open} onOpenChange={onOpenChange}><Dialog.Portal><Dialog.Overlay className="dialog-overlay"/><Dialog.Content className={cn('dialog-content',className)}><div className="flex items-start justify-between gap-4"><div><Dialog.Title className="text-xl font-display font-semibold">{title}</Dialog.Title><Dialog.Description className={cn('mt-2 text-sm text-muted',!description&&'sr-only')}>{description||title}</Dialog.Description></div><Dialog.Close asChild><Button size="icon" variant="ghost" aria-label="Close dialog"><X size={18}/></Button></Dialog.Close></div><div className="mt-6">{children}</div></Dialog.Content></Dialog.Portal></Dialog.Root>;
}
export function Toast({message,onClose}) {
  useEffect(()=>{if(!message)return;const timer=setTimeout(onClose,6500);return()=>clearTimeout(timer)},[message,onClose]);
  return message?<div className="toast" role="status"><Check size={16}/><span>{message}</span><Button variant="ghost" size="icon" aria-label="Dismiss notification" onClick={onClose}><X size={15}/></Button></div>:null;
}
export function Skeleton({className,...props}) {return <div className={cn('skeleton',className)} aria-hidden="true" {...props}/>}
export function ScreenSkeleton() {return <div role="status" aria-label="Loading workspace" aria-busy="true" className="space-y-6"><Skeleton className="h-8 w-56"/><Skeleton className="h-36"/><div className="project-grid">{[0,1,2].map(i=><Skeleton key={i} className="h-64"/>)}</div></div>}
export function EmptyState({icon:Icon=Film,title,description,action}) {return <div className="empty-state"><span className="empty-icon"><Icon size={24}/></span><h2>{title}</h2><p>{description}</p>{action}</div>}
export function ErrorState({message,onRetry}) {return <div className="error-state" role="alert"><AlertCircle size={20}/><div><h2>Something needs attention</h2><p>{message||'We could not load this screen. Please try again.'}</p></div><Button onClick={onRetry}><RefreshCw size={14}/>Retry</Button></div>}
export function ScoreRing({score,size=44}) {
  const value=Number.isFinite(Number(score))?Math.round(Math.max(0,Math.min(100,Number(score)))):0;
  return <span role="img" className="score-ring" style={{width:size,height:size}} aria-label={`Moment score ${value} out of 100`}><svg viewBox="0 0 44 44" aria-hidden="true"><circle cx="22" cy="22" r="19" className="score-track"/><circle cx="22" cy="22" r="19" className="score-fill" strokeDasharray={`${value*1.194} 119.4`}/></svg><b>{value}</b></span>;
}
export const PIPELINE=[['media_inspection','Import'],['transcription','Transcribe'],['clip_scoring','Find moments'],['clip_render','Render'],['completed','Ready']];
export function Stepper({stages=[],job,activeIndex,compact=false}) {
  const stageMap={audio_extraction:'transcription',speaker_detection:'clip_scoring',topic_segmentation:'clip_scoring',reframing:'clip_render',export:'clip_render'};
  const active=activeIndex??(job?.status==='completed'?4:Math.max(0,PIPELINE.findIndex(([key])=>key===(stageMap[job?.current_stage]||job?.current_stage))));
  const find=(key)=>stages.find(s=>s.stage_key===key);
  return <ol className={cn('pipeline-stepper',compact&&'compact')} aria-label="Video processing pipeline" tabIndex={0}>{PIPELINE.map(([key,label],i)=>{
    const stage=find(key),done=stage?.status==='completed'||i<active||job?.status==='completed';
    const current=i===active&&!done;
    return <li key={key} className={cn(done&&'done',current&&'current')} aria-current={current?'step':undefined}><span className="step-node">{done?<Check size={13}/>:i+1}</span><div><b>{label}</b>{!compact&&<small>{stage?.error?'Needs attention':done?'Complete':current?(job?.status==='awaiting_transcription'?'Keep this tab open':stage?.metadata?.activity||`${stage?.progress??job?.progress??0}%`):'Waiting'}</small>}</div></li>;
  })}</ol>;
}
export function DropZone({onFile,onLink,busy=false,compact=false,initialUrl=''}) {
  const input=useRef(null);const [drag,setDrag]=useState(false);const [url,setUrl]=useState(initialUrl);
  return <section className={cn('drop-zone',drag&&'dragging',compact&&'compact')} onDragOver={e=>{e.preventDefault();setDrag(true)}} onDragLeave={()=>setDrag(false)} onDrop={e=>{e.preventDefault();setDrag(false);if(!busy&&e.dataTransfer.files[0])onFile?.(e.dataTransfer.files[0])}} aria-label="Import a video"><span className="drop-icon"><Upload size={24}/></span><h2>Drop a video or paste a link</h2><p>Your next week of clips starts here.</p><input ref={input} type="file" accept="video/*,.mov,.mkv" hidden onChange={e=>{if(e.target.files[0])onFile?.(e.target.files[0]);e.target.value=''}}/><div className="drop-actions"><Button onClick={()=>input.current?.click()} disabled={busy}><Upload size={15}/>Choose video</Button><span>MP4, MOV, WebM · up to 512 MB</span></div><form className="drop-link" onSubmit={e=>{e.preventDefault();if(url.trim())onLink?.(url)}}><label className="sr-only" htmlFor="import-video-url">Public HTTPS video URL</label><input id="import-video-url" type="url" placeholder="Paste a YouTube or video link…" value={url} onChange={e=>setUrl(e.target.value)} required/><Button type="submit" size="icon" variant="primary" disabled={busy||!url} aria-label="Import link"><ArrowRight size={17}/></Button></form></section>;
}
export function ClipCard({clip,src,selected,onSelect,onEdit,onPublish,onApprove,focused=false}) {
  const video=useRef(null); const [playing,setPlaying]=useState(false);const [why,setWhy]=useState(false);
  const score=clip.score??clip.clip_scores?.[0]?.score;
  const latest=[...(clip.clip_versions||[])].sort((a,b)=>b.version-a.version).find(v=>v.render_status==='ready');
  const aspect=latest?.edit_data?.aspect||clip.ai_spec?.aspect||'9:16';
  const exportUrl=src?new URL(src):null;
  if(exportUrl)exportUrl.searchParams.set('download',(clip.title||'Alpha-ai-clip').replace(/[^\w .-]/g,'').slice(0,80)+'.mp4');
  const play=()=>video.current?.play().then(()=>setPlaying(true)).catch(()=>{});
  return <article className={cn('clip-card',selected&&'selected',focused&&'review-focused')}>
    <div className="clip-poster" onMouseEnter={()=>{if(src&&!window.matchMedia('(prefers-reduced-motion: reduce)').matches)play()}} onMouseLeave={()=>{video.current?.pause();setPlaying(false)}}>
      {src?<video ref={video} src={src} muted playsInline preload="metadata" aria-label={clip.title}/>:clip.thumbnail?<img src={clip.thumbnail} alt="Illustrated sample clip" className="h-full w-full object-cover object-[65%_center]" loading="lazy"/>:<div className="clip-no-preview"><Film size={28}/><span>Preview unavailable</span></div>}
      {onSelect&&<label className="clip-check"><input type="checkbox" checked={selected||false} onChange={onSelect} aria-label={`Select ${clip.title}`}/></label>}
      <span className="clip-duration">{Math.round((clip.end_seconds||0)-(clip.start_seconds||0))}s · {aspect}</span>
      {src&&<Button size="icon" variant="secondary" className="clip-play" aria-label={playing?'Pause preview':'Play preview'} onClick={()=>{if(playing){video.current?.pause();setPlaying(false)}else play()}}><Play size={15}/></Button>}
    </div>
    <div className="clip-copy">
      <div className="flex items-start gap-3"><ScoreRing score={score}/><div className="min-w-0"><h3>{clip.title||'Untitled moment'}</h3><button className="text-xs text-muted underline underline-offset-4" onClick={()=>setWhy(v=>!v)} aria-expanded={why}>Why this clip?</button></div></div>
      {why&&<p className="clip-reason">{clip.clip_scores?.[0]?.reason||clip.reason||'A score is an editorial signal, not a guarantee of views.'}</p>}
      <div className="clip-card-actions"><Button size="sm" onClick={onApprove} disabled={!onApprove}>{clip.status==='approved'?<Check size={13}/>:null}Approve</Button><Button size="sm" onClick={onEdit}>Edit</Button><Button size="sm" variant="primary" onClick={onPublish}>Publish</Button></div>
      {exportUrl&&<a className="clip-export" href={exportUrl.toString()} download><Download size={13}/>Download MP4</a>}
    </div>
  </article>;
}
export function Timeline({duration,current,onSeek,words=[],cuts=[]}) {
  const safeDuration=Math.max(1,duration||1);
  return <div className="timeline"><div className="timeline-ruler">{[0,.25,.5,.75,1].map(t=><span key={t}>{formatTime(t*safeDuration)}</span>)}</div><svg viewBox="0 0 1000 48" preserveAspectRatio="none" className="timeline-speech" role="img" aria-label="Speech activity derived from timed transcript words, not an audio amplitude waveform"><path d="M0 24H1000" stroke="var(--border)"/>{words.filter(w=>w.start_ms<safeDuration*1000).slice(0,1000).map((w,i)=>{const x=w.start_ms/safeDuration, width=Math.max(1,(w.end_ms-w.start_ms)/safeDuration),height=12+Math.min(25,String(w.word).length*3);return <rect key={w.id||i} x={x} y={(48-height)/2} width={width} height={height} rx="1" fill={current*1000>=w.start_ms&&current*1000<w.end_ms?'var(--accent)':'var(--subtle)'}/>})}{cuts.map((cut,i)=><path key={i} d={`M${cut.start/safeDuration*1000} 0V48`} stroke="var(--destructive)" strokeWidth="2"/>)}</svg><input aria-label="Seek video timeline" type="range" min="0" max={safeDuration} step=".01" value={Math.min(current,safeDuration)} onChange={e=>onSeek(Number(e.target.value))}/><div className="timeline-track">{words.slice(0,100).map((w,i)=><button key={w.id||i} className={current*1000>=w.start_ms&&current*1000<w.end_ms?'active':''} onClick={()=>onSeek(w.start_ms/1000)}>{w.word}</button>)}{!words.length&&<span>Timed caption words appear here after transcription.</span>}</div>{cuts.length>0&&<div className="text-xs text-muted mt-2">{cuts.length} cut markers</div>}</div>;
}
export function Calendar({month,items=[],onDay,onReschedule,selectedDay}) {
  const year=month.getFullYear(),m=month.getMonth(),start=new Date(year,m,1).getDay(),days=new Date(year,m+1,0).getDate();
  return <div className="calendar"><div className="calendar-week">{['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d=><span key={d}>{d}</span>)}</div><div className="calendar-grid">{Array.from({length:Math.ceil((start+days)/7)*7},(_,i)=>{
    const day=i-start+1,date=new Date(year,m,day),valid=day>0&&day<=days;
    const posts=items.filter(p=>new Date(p.scheduled_for).toDateString()===date.toDateString());
    return <div key={i} className={cn('calendar-day',!valid&&'outside',selectedDay===day&&'selected')} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();const id=e.dataTransfer.getData('text/plain');if(valid&&id)onReschedule?.(id,date)}}>{valid&&<><button onClick={()=>onDay?.(day)} aria-label={`${date.toLocaleDateString()}, ${posts.length} scheduled posts`}>{day}</button>{posts.slice(0,2).map(p=><button draggable={Boolean(onReschedule)} onDragStart={e=>e.dataTransfer.setData('text/plain',p.id)} onClick={()=>onDay?.(day)} key={p.id} className="calendar-post">{p.metadata?.title||'YouTube clip'}</button>)}{posts.length>2&&<small>+{posts.length-2} more</small>}</>}</div>;
  })}</div></div>;
}
export function ThemeToggle() {
  const [theme,setTheme]=useState('dark');
  useEffect(()=>{const sync=()=>setTheme(document.documentElement.dataset.theme||'dark');sync();window.addEventListener('alpha:theme',sync);return()=>window.removeEventListener('alpha:theme',sync)},[]);
  const change=()=>{const next=theme==='dark'?'light':'dark';setTheme(next);document.documentElement.dataset.theme=next;try{localStorage.setItem('alpha.studio.theme',next)}catch{}window.dispatchEvent(new CustomEvent('alpha:theme'))};
  return <Button variant="ghost" size="icon" onClick={change} aria-label={`Switch to ${theme==='dark'?'light':'dark'} theme`}>{theme==='dark'?<Sun size={17}/>:<Moon size={17}/>}</Button>;
}
export function formatTime(seconds=0) {const n=Math.max(0,Math.floor(Number(seconds)||0));return `${Math.floor(n/60).toString().padStart(2,'0')}:${(n%60).toString().padStart(2,'0')}`}
