"use client";
import {useEffect,useRef} from 'react';
import {ArrowRight,AudioLines,Captions,Check,Clapperboard,CircleDot,Layers3,MousePointer2,ScanLine,Scissors,Sparkles,Upload,Workflow,Youtube} from 'lucide-react';
import {ButtonLink} from './ui';
import {DemoButton,LazyDemo} from './marketing';

const clamp=(value,min=0,max=1)=>Math.min(max,Math.max(min,value));

function useLandingScene(scrollRef,pointerRef){
  useEffect(()=>{
    const scrollNode=scrollRef.current,pointerNode=pointerRef?.current;
    if(!scrollNode)return;
    const reduced=window.matchMedia('(prefers-reduced-motion: reduce)');
    let raf=0;
    const isPaused=()=>reduced.matches||document.documentElement.dataset.motion==='paused';
    const update=()=>{
      raf=0;
      const rect=scrollNode.getBoundingClientRect();
      const progress=clamp((window.innerHeight*.78-rect.top)/Math.max(1,rect.height*.72));
      scrollNode.style.setProperty('--hero-scroll-progress',progress.toFixed(3));
      scrollNode.style.setProperty('--hero-scroll-y',`${isPaused()?0:-progress*18}px`);
    };
    const onScroll=()=>{if(!raf)raf=window.requestAnimationFrame(update)};
    const onPointerMove=event=>{
      if(!pointerNode||isPaused())return;
      const rect=pointerNode.getBoundingClientRect();
      const x=clamp((event.clientX-rect.left)/Math.max(1,rect.width),0,1)*2-1;
      const y=clamp((event.clientY-rect.top)/Math.max(1,rect.height),0,1)*2-1;
      pointerNode.style.setProperty('--pointer-shift-x',`${x*9}px`);
      pointerNode.style.setProperty('--pointer-shift-y',`${y*7}px`);
      pointerNode.style.setProperty('--pointer-rotate-x',`${y*-2.5}deg`);
      pointerNode.style.setProperty('--pointer-rotate-y',`${x*3.5}deg`);
      pointerNode.style.setProperty('--dock-shift-x',`${x*-3}px`);
      pointerNode.style.setProperty('--dock-shift-y',`${y*-3}px`);
    };
    const resetPointer=()=>{
      if(!pointerNode)return;
      for(const name of ['--pointer-shift-x','--pointer-shift-y','--pointer-rotate-x','--pointer-rotate-y','--dock-shift-x','--dock-shift-y'])pointerNode.style.setProperty(name,'0px');
      pointerNode.style.setProperty('--pointer-rotate-x','0deg');pointerNode.style.setProperty('--pointer-rotate-y','0deg');
    };
    const sync=()=>{if(isPaused())resetPointer();update()};
    window.addEventListener('scroll',onScroll,{passive:true});window.addEventListener('resize',onScroll);
    window.addEventListener('alpha:motion',sync);reduced.addEventListener?.('change',sync);
    pointerNode?.addEventListener('pointermove',onPointerMove);pointerNode?.addEventListener('pointerleave',resetPointer);
    update();
    return()=>{if(raf)window.cancelAnimationFrame(raf);window.removeEventListener('scroll',onScroll);window.removeEventListener('resize',onScroll);window.removeEventListener('alpha:motion',sync);reduced.removeEventListener?.('change',sync);pointerNode?.removeEventListener('pointermove',onPointerMove);pointerNode?.removeEventListener('pointerleave',resetPointer)};
  },[scrollRef,pointerRef]);
}

function useAssemblyMotion(ref){
  useEffect(()=>{
    const node=ref.current;if(!node)return;
    const reduced=window.matchMedia('(prefers-reduced-motion: reduce)');let raf=0;
    const paused=()=>reduced.matches||document.documentElement.dataset.motion==='paused';
    const update=()=>{
      raf=0;const rect=node.getBoundingClientRect();const motionPaused=paused();const progress=motionPaused?1:clamp((window.innerHeight*.78-rect.top)/Math.max(1,rect.height*.72));
      node.style.setProperty('--assembly-progress',progress.toFixed(3));
      node.querySelectorAll('.assembly-piece').forEach(piece=>{
        if(motionPaused){piece.style.transform='none';return}
        const x=Number(piece.dataset.x||0)*(1-progress),y=Number(piece.dataset.y||0)*(1-progress),rotate=Number(piece.dataset.rotate||0)*(1-progress);
        piece.style.transform=`translate3d(${x}px,${y}px,0) rotate(${rotate}deg)`;
      });
      const canvas=node.querySelector('.assembly-canvas'),playhead=node.querySelector('.assembly-playhead');
      if(canvas&&playhead)playhead.style.left=`${32+(canvas.clientWidth-64)*progress}px`;
      node.querySelector('.assembly-label-exploded')?.style.setProperty('opacity',String(1-progress));
      node.querySelector('.assembly-label-assembled')?.style.setProperty('opacity',String(progress));
      node.querySelector('.assembly-glow')?.style.setProperty('opacity',String(.2+progress*.8));
    };
    const onScroll=()=>{if(!raf)raf=window.requestAnimationFrame(update)};
    const sync=()=>update();window.addEventListener('scroll',onScroll,{passive:true});window.addEventListener('resize',onScroll);window.addEventListener('alpha:motion',sync);reduced.addEventListener?.('change',sync);update();
    return()=>{if(raf)window.cancelAnimationFrame(raf);window.removeEventListener('scroll',onScroll);window.removeEventListener('resize',onScroll);window.removeEventListener('alpha:motion',sync);reduced.removeEventListener?.('change',sync)};
  },[ref]);
}

function SourceToClipsVisual() {
  return <div className="hero-source-clips" aria-hidden="true">
    <div className="hero-source-parallax">
    <div className="hero-source-card">
      <div className="hero-source-topline"><span><CircleDot size={10}/>SOURCE</span><small>38:12</small></div>
      <div className="hero-source-art"><div className="hero-source-person"/><i/><i/><i/></div>
      <div className="hero-source-footer"><span>podcast-ep-24.mp4</span><span><AudioLines size={12}/>48 kHz</span></div>
    </div>
    <div className="hero-signal-path"><span className="hero-signal-dot"/><i/><i/><i/><span className="hero-signal-dot"/></div>
    <div className="hero-clip-stack">
      <div className="hero-clip-card hero-clip-back"><div className="hero-clip-frame"><Captions size={15}/></div></div>
      <div className="hero-clip-card hero-clip-middle"><div className="hero-clip-frame"><ScanLine size={15}/></div></div>
      <div className="hero-clip-card hero-clip-front"><div className="hero-clip-frame"><Sparkles size={15}/><span>BEST MOMENT</span></div><div className="hero-clip-copy"><b>Keep the thought.</b><small>00:38 · 9:16</small></div></div>
    </div>
    <span className="hero-float-tag hero-float-tag-one"><Sparkles size={12}/>complete thought</span>
    <span className="hero-float-tag hero-float-tag-two"><Scissors size={12}/>ready to shape</span>
    </div>
  </div>;
}

export default function LandingHero() {
  const sceneRef=useRef(null),stageRef=useRef(null);
  useLandingScene(sceneRef,stageRef);
  return <section ref={sceneRef} className="landing-hero premium-hero">
    <div className="hero-atmosphere" aria-hidden="true"/>
    <div className="hero-copy">
      <span className="hero-kicker"><i/>THE FOCUSED VIDEO STUDIO</span>
      <h1 aria-label="One long video. A week of clips.">
        <span className="word-reveal" style={{'--word-index':0}} aria-hidden="true">One</span>{' '}
        <span className="word-reveal" style={{'--word-index':1}} aria-hidden="true">long</span>{' '}
        <span className="word-reveal" style={{'--word-index':2}} aria-hidden="true">video.</span><br/>
        <span className="gradient">
          <span className="word-reveal" style={{'--word-index':3}} aria-hidden="true">A</span>{' '}
          <span className="word-reveal" style={{'--word-index':4}} aria-hidden="true">week</span>{' '}
          <span className="word-reveal" style={{'--word-index':5}} aria-hidden="true">of</span>{' '}
          <span className="word-reveal" style={{'--word-index':6}} aria-hidden="true">clips.</span>
        </span>
      </h1>
      <p>The conversation is yours. Find the moments worth keeping, make a sharper cut, and give each one a place to go.</p>
      <div className="hero-actions">
        <ButtonLink href="/studio?mode=signup">Start free<ArrowRight size={16}/></ButtonLink>
        <DemoButton/>
      </div>
      <span className="pilot-label"><Check size={14}/>Free pilot access · no checkout required</span>
      <div className="hero-details" aria-label="Studio workflow">
        <span><Upload size={14}/>Your footage</span>
        <span><Scissors size={14}/>Your final cut</span>
        <span><Youtube size={14}/>Your channel</span>
      </div>
    </div>
    <div className="hero-demo-wrap">
      <div className="hero-demo-label"><span>01 / INSIDE ALPHA</span><span>A LITTLE LESS FRICTION.</span></div>
      <div ref={stageRef} className="hero-stage">
        <div className="hero-stage-grid" aria-hidden="true"/>
        <SourceToClipsVisual/>
        <div className="hero-demo-dock">
          <div className="hero-dock-bar"><span><i/>LIVE STUDIO PREVIEW</span><span>TRANSCRIPT · CUT · PUBLISH</span></div>
          <LazyDemo/>
        </div>
      </div>
      <a href="/studio?demo=1" className="hero-explore">Explore the sample studio<ArrowRight size={14}/><span>No sign-in needed</span></a>
    </div>
  </section>;
}

export function WorkflowQuality() {
  return <section className="landing-section premium-workflow" id="workflow">
    <div className="quality-intro"><span className="eyebrow">THE HANDOFF BETWEEN IDEAS</span><h2>Every cut keeps its context.</h2><p>Alpha turns a long recording into a reviewable chain: source, signal, shape, and a clear next step. You stay in the loop at every decision.</p><ButtonLink href="/studio?mode=signup" variant="secondary">Bring in a recording<ArrowRight size={14}/></ButtonLink></div>
    <div className="quality-board" aria-label="Illustration of the Alpha workflow">
      <div className="quality-board-head"><span><Workflow size={14}/>WORKFLOW MAP</span><span>ONE SOURCE · MANY WAYS IN</span></div>
      <div className="quality-flow" aria-hidden="true">
        <div className="quality-node quality-node-source"><span className="quality-node-icon"><Clapperboard size={18}/></span><small>01 / SOURCE</small><b>One recording</b><span>Original stays attached</span></div>
        <div className="quality-connector"><i/><i/><i/></div>
        <div className="quality-node quality-node-signal"><span className="quality-node-icon"><Sparkles size={18}/></span><small>02 / SIGNAL</small><b>Moments with a reason</b><span>Review the complete thought</span></div>
        <div className="quality-connector"><i/><i/><i/></div>
        <div className="quality-node quality-node-shape"><span className="quality-node-icon"><Layers3 size={18}/></span><small>03 / SHAPE</small><b>Ready to make yours</b><span>Frame, caption, and pace</span></div>
      </div>
      <div className="quality-timeline"><span>00:00</span><i/><b><em/>the hook</b><i/><b><em/>the turn</b><i/><b><em/>the takeaway</b><i/><span>38:12</span></div>
    </div>
  </section>;
}

export function ScrollAssembly(){
  const assemblyRef=useRef(null);
  useAssemblyMotion(assemblyRef);
  return <section ref={assemblyRef} className="landing-section assembly-section" id="assembly">
    <div className="assembly-copy"><span className="eyebrow"><MousePointer2 size={12}/>SCROLL TO ASSEMBLE</span><h2>Watch the timeline find its shape.</h2><p>Start with an exploded view of the raw signal. As you scroll, Alpha brings the hook, transcript, captions, and export path into one edit-ready timeline.</p><div className="assembly-steps"><span><b>01</b>Signal</span><span><b>02</b>Structure</span><span><b>03</b>Shape</span></div></div>
    <div className="assembly-stage" aria-label="Animated illustration of a timeline assembling from separate pieces"><div className="assembly-stage-head"><span><Workflow size={13}/>TIMELINE ENGINE</span><span className="assembly-label-exploded">EXPLODED VIEW</span><span className="assembly-label-assembled">ASSEMBLED CUT</span></div><div className="assembly-canvas"><div className="assembly-glow"/><div className="assembly-source-pill"><CircleDot size={11}/>SOURCE · 38:12</div><div className="assembly-lanes"><div className="assembly-piece assembly-lane assembly-lane-video" data-x="-75" data-y="-92" data-rotate="-8"><span className="assembly-piece-label">VIDEO</span><i/><i/><i/><i/><i/><b>podcast-ep-24.mp4</b></div><div className="assembly-piece assembly-lane assembly-lane-speech" data-x="86" data-y="-22" data-rotate="7"><span className="assembly-piece-label">TRANSCRIPT</span><em>the hook</em><em>the turn</em><em>the takeaway</em></div><div className="assembly-piece assembly-lane assembly-lane-captions" data-x="-70" data-y="73" data-rotate="5"><span className="assembly-piece-label">CAPTIONS</span><b>Start with a question.</b><small>WORD-LEVEL TIMING</small></div><div className="assembly-piece assembly-lane assembly-lane-export" data-x="92" data-y="92" data-rotate="-6"><span className="assembly-piece-label">EXPORT</span><span className="assembly-export-chip"><Sparkles size={12}/>9:16 READY</span><span className="assembly-export-chip"><Youtube size={12}/>PUBLISH</span></div></div><div className="assembly-playhead"><i/></div><span className="assembly-time assembly-time-start">00:00</span><span className="assembly-time assembly-time-end">38:12</span></div><div className="assembly-stage-foot"><span><Sparkles size={13}/>Hook-led cut detected</span><span><MousePointer2 size={12}/>Scroll-linked assembly</span></div></div>
  </section>;
}

export function FeatureVisual({kind}) {
  if(kind==='Moments with a reason')return <div className="feature-visual feature-score"><span className="font-mono">94</span><div><b>A clear hook.</b><small>A complete thought.</small><i><em/></i></div></div>;
  if(kind==='Speaker-aware framing')return <div className="feature-visual feature-crop"><div><img src="/studio-sample.svg" width="960" height="540" alt="" loading="lazy"/><i/><span>9:16 / SUBJECT IN FRAME</span></div></div>;
  if(kind==='Word-level captions')return <div className="feature-visual feature-words"><span>Start</span><span>with</span><mark>a question.</mark><small>00:12.840</small></div>;
  if(kind==='Transcript-first review')return <div className="feature-visual feature-text"><span className="text-muted">Speaker 01</span><p>The best ideas <del>usually</del> start with a question.</p><span className="text-xs text-muted">Keep the thought. Lose the detour.</span></div>;
  if(kind==='A publishing calendar')return <div className="feature-visual feature-week">{['MON','TUE','WED','THU','FRI'].map((day,i)=><div key={day}><small>{day}</small><span>{12+i}</span>{[0,2,4].includes(i)&&<i/>}</div>)}</div>;
  return <div className="feature-visual feature-team"><div><span>AM</span><span>JR</span><span>SK</span></div><p>One workspace.<br/><b>The whole picture.</b></p></div>;
}
