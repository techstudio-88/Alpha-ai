"use client";

import {useEffect,useRef,useState} from 'react';
import dynamic from 'next/dynamic';
import {ArrowRight,Check,ChevronDown,Film,Folder,Image,Menu,Play,Upload,Youtube} from 'lucide-react';
import Brand from './brand';
import {MotionToggle,useMotionPreference} from './motion';
import {PLANS} from '../../lib/plans.mjs';
import {Button,ButtonLink,Modal,ScoreRing,Skeleton,Tabs,ThemeToggle} from './ui';
const Demo = dynamic(()=>import('./pipeline-demo'),{ssr:false,loading:()=> <Skeleton className="h-[460px]"/>});

export function MarketingNav() {
  const [open,setOpen]=useState(false);
  const links=[['Product','/#product'],['Use cases','/#use-cases'],['Pricing','/#pricing'],['Blog','/blog']];
  return <div className="landing-nav-wrap"><nav className="landing-nav landing-container" aria-label="Main navigation"><Brand/><div className="landing-links">{links.map(([label,href])=><a key={label} href={href}>{label}</a>)}</div><div className="landing-nav-actions"><span className="hidden sm:inline-flex"><MotionToggle/></span><ThemeToggle/><a href="/studio" className="text-xs text-muted">Sign in</a><ButtonLink href="/studio?mode=signup" size="sm">Start free<ArrowRight size={13}/></ButtonLink><Button className="mobile-menu" size="icon" variant="ghost" aria-label="Open website navigation" onClick={()=>setOpen(true)}><Menu size={18}/></Button></div></nav><Modal open={open} onOpenChange={setOpen} title="Find your next step."><nav aria-label="Mobile website navigation" className="mobile-nav-list">{[...links,['AI editor','/#ai-editor'],['Sign in','/studio'],['Explore sample studio','/studio?demo=1']].map(([label,href])=><a href={href} key={label} onClick={()=>setOpen(false)}>{label}<ArrowRight size={14}/></a>)}</nav><div className="flex gap-3 items-center mt-4 text-xs text-muted"><MotionToggle/>Animation preference</div></Modal></div>;
}
export function LazyDemo() {
  const ref=useRef(null);const [visible,setVisible]=useState(false);
  useEffect(()=>{const observer=new IntersectionObserver(([entry])=>{if(entry.isIntersecting){setVisible(true);observer.disconnect()}},{rootMargin:'100px'});if(ref.current)observer.observe(ref.current);return()=>observer.disconnect()},[]);
  return <div ref={ref} className="min-h-[440px]">{visible?<Demo/>:<Skeleton className="h-[460px]"/>}</div>;
}
export function DemoButton() {return <Button variant="secondary" onClick={()=>{document.getElementById('product-demo')?.scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});window.dispatchEvent(new CustomEvent('alpha:demo:restart'))}}><Play size={15}/>Watch 60-sec demo</Button>}
export function FormatsStrip() {
  return <div className="formats-strip"><span>BRING YOUR OWN FOOTAGE</span>{[[Youtube,'YouTube'],[Folder,'Google Drive'],[Image,'Photos'],[Upload,'MP4 upload'],[Folder,'Dropbox']].map(([Icon,label])=><div key={label}><Icon size={18}/>{label}</div>)}</div>;
}
const usecases={
  Podcasts:{title:'Your best conversation, without the hour-long setup.',description:'Review complete thoughts, not isolated sound bites. Keep the speaker in frame and captions easy to follow.',clip:'The advice I wish I heard in my twenties',score:94,source:'The Long Game · Episode 24',duration:'38 seconds'},
  YouTube:{title:'Keep a good video working after upload day.',description:'Turn an explanation, a useful tip, or a surprising takeaway into its own short. Export it, or schedule to a connected YouTube channel.',clip:'Why doing less helped me build more',score:91,source:'Build in Public · Episode 12',duration:'32 seconds'},
  Courses:{title:'Make the lesson easier to find, and easier to finish.',description:'Pull one practical lesson from a longer session. Give learners enough context, clear captions, and a useful next step.',clip:'The three questions to ask before you start',score:89,source:'Creator Workshop · Lesson 06',duration:'41 seconds'},
  Agencies:{title:'One shared place for the next batch of clips.',description:'Organize client projects in workspaces, review scored moments together, and keep your caption styles consistent.',clip:'A better brief starts with this question',score:93,source:'Studio Notes · Client workshop',duration:'29 seconds'},
};
export function UseCases() {
  const [value,setValue]=useState('Podcasts');const data=usecases[value];
  return <><Tabs value={value} onValueChange={setValue} items={Object.keys(usecases).map(k=>({value:k,label:k}))} label="Creator use cases"/><div className="panel usecase-panel"><div><span className="eyebrow">FOR {value.toUpperCase()}</span><h3>{data.title}</h3><p>{data.description}</p><ButtonLink href="/studio?mode=signup" variant="secondary" className="mt-6">Start with your video<ArrowRight size={14}/></ButtonLink></div><div className="panel p-6"><div className="flex items-center justify-between text-xs text-muted mb-5"><span>ILLUSTRATIVE RESULT</span><span>{data.duration}</span></div><div className="flex items-center gap-4"><ScoreRing score={data.score} size={56}/><h4 className="text-xl">{data.clip}</h4></div><p className="text-xs text-muted mt-4">{data.source}</p></div></div></>;
}
export function BeforeAfter() {
  const motion=useMotionPreference();
  const [style,setStyle]=useState('pop');const [word,setWord]=useState(0);const words=['The','best','ideas','start','with','a','question.'];
  useEffect(()=>{if(!motion)return;const id=setInterval(()=>setWord(v=>(v+1)%words.length),650);return()=>clearInterval(id)},[words.length,motion]);
  return <><div className="screen-toolbar"><p className="text-sm text-muted">Same conversation. A clearer entry point.</p><Tabs value={style} onValueChange={setStyle} label="Sample caption style" items={[{value:'pop',label:'Word pop'},{value:'bold',label:'Bold'},{value:'minimal',label:'Minimal'}]}/></div><div className="before-after"><div className="sample-video"><img src="/studio-sample.svg" alt="Illustrated wide podcast source" width="960" height="540" loading="lazy"/><div><span>The Long Game · Episode 24</span><span className="font-mono text-muted">48:12 · 16:9</span></div></div><div className="sample-video vertical"><img src="/studio-sample.svg" alt="Sample vertical reframing of the same conversation" width="270" height="390" loading="lazy"/><div className={`sample-captions ${style}`}>{words.map((w,i)=><span key={i}>{i===word&&style==='pop'?<mark>{w}</mark>:w}{' '}</span>)}</div><div><span>One complete thought</span><span className="font-mono text-muted">00:38</span></div></div></div><p className="text-xs text-muted mt-4">Illustrated sample. The caption preview demonstrates styles; upload a video to create your own exports.</p></>;
}
export function PricingCards({compact=false,onSelectPlan}) {
  const [annual,setAnnual]=useState(false);
  const plans=[
    {key:'free',name:'Free',price:PLANS.free.monthlyPaise/100,caption:'Start creating at no cost',items:['One workspace','Core clip workflow','Basic exports'],href:'/studio?mode=signup',action:'Start free'},
    {key:'pro',name:'Creator',price:PLANS.pro.monthlyPaise/100,caption:'For individual creators',items:['Up to 3 workspaces','Brand kits and saved styles','Priority clip workflow'],href:'/studio?mode=signup&plan=pro',action:onSelectPlan?'Pay with UPI':'Choose Creator',featured:true},
    {key:'studio',name:'Studio',price:PLANS.studio.monthlyPaise/100,caption:'For teams and growing channels',items:['Up to 10 workspaces','More brand kits','Team workflows'],href:'/studio?mode=signup&plan=studio',action:onSelectPlan?'Pay with UPI':'Choose Studio'}
  ];
  return <><div className="flex items-center justify-between flex-wrap gap-4 mb-6"><p className="text-sm text-muted">Transparent pricing in INR. Yearly billing is priced at 10 months.</p><div className="tabs mb-0" role="group" aria-label="Billing period"><button aria-pressed={!annual} data-state={!annual?'active':'inactive'} onClick={()=>setAnnual(false)}>Monthly</button><button aria-pressed={annual} data-state={annual?'active':'inactive'} onClick={()=>setAnnual(true)}>Yearly · save 2 months</button></div></div><div className="pricing-grid">{plans.map(plan=><article key={plan.key} className={'panel pricing-card ' + (plan.featured?'featured':'')}><div className="flex items-center justify-between"><h3>{plan.name}</h3>{plan.featured&&<span className="status-chip">For regular creators</span>}</div><div><span className="price">₹{plan.price.toLocaleString('en-IN')}<small> / month{annual?' equivalent':''}</small></span>{annual&&plan.price>0&&<p className="text-xs text-muted mt-2">₹{(plan.price*10).toLocaleString('en-IN')} billed yearly</p>}<p className="text-xs text-muted mt-2">{plan.caption}</p></div><ul>{plan.items.map(item=><li key={item}><Check size={15}/>{item}</li>)}</ul>{onSelectPlan&&plan.key!=='free'?<Button onClick={()=>onSelectPlan(plan.key,annual?'yearly':'monthly')} variant={plan.featured?'primary':'secondary'}>{plan.action}<ArrowRight size={14}/></Button>:<ButtonLink href={plan.href} variant={plan.featured?'primary':'secondary'}>{plan.action}<ArrowRight size={14}/></ButtonLink>}</article>)}</div>{!compact&&<div className="table-scroll mt-8" tabIndex={0} role="region" aria-label="Plan comparison"><table className="comparison-table"><caption className="sr-only">Alpha.ai plan comparison</caption><thead><tr><th>Plan</th><th>Price</th><th>Workspaces</th><th>Billing</th></tr></thead><tbody><tr><th scope="row">Free</th><td>₹0</td><td>1</td><td>Free</td></tr><tr><th scope="row">Creator</th><td>₹799/month</td><td>Up to 3</td><td>Monthly or ₹7,990/year</td></tr><tr><th scope="row">Studio</th><td>₹1,499/month</td><td>Up to 10</td><td>Monthly or ₹14,990/year</td></tr></tbody></table></div>}</>;
}
export function FAQ({items}) {return <div className="faq-list">{items.map(([q,a])=><details key={q}><summary>{q}<ChevronDown size={16} className="shrink-0 text-muted"/></summary><p>{a}</p></details>)}</div>}
export function MarketingFooter() {
  return <footer className="landing-footer"><div className="landing-container"><div className="footer-grid"><div><Brand/><p>A focused studio for your long-form footage.</p><p>Keep the context. Make the cut.</p></div>{[['Product',[['Studio','/studio'],['Pricing','/pricing'],['Features','/#features'],['Changelog','/changelog']]],['Resources',[['Blog','/blog'],['API docs','/api-docs'],['Contact','/contact'],['Service status','/performance']]],['Legal',[['Privacy','/privacy'],['Terms','/terms'],['Cookies','/cookies'],['Your content','/terms']]]].map(([heading,links])=><div key={heading}><h3>{heading}</h3>{links.map(([label,url])=><a href={url} key={label}>{label}</a>)}</div>)}</div><div className="footer-bottom"><span>© {new Date().getFullYear()} Alpha.ai</span><span>Made for people with something to say.</span><ThemeToggle/></div></div></footer>;
}
