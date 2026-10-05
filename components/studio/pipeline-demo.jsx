"use client";

import {useEffect,useState} from 'react';
import {Pause,Play,RotateCcw} from 'lucide-react';
import Brand from './brand';
import {Button,Stepper} from './ui';

const transcript='The best ideas start with a question. Not a perfect plan. If you wait until you know everything, you never start.';
const clips=[
  {score:94,title:'A question beats a perfect plan',caption:'START WITH A QUESTION'},
  {score:91,title:'The hidden cost of waiting',caption:'YOU NEVER START'},
  {score:88,title:'Make the first move smaller',caption:'KEEP IT SIMPLE'},
];

export default function PipelineDemo(){
  const [seconds,setSeconds]=useState(0);
  const [playing,setPlaying]=useState(true);
  const [reduced,setReduced]=useState(false);
  useEffect(()=>{
    const media=window.matchMedia('(prefers-reduced-motion: reduce)');
    const update=()=>{const paused=media.matches||document.documentElement.dataset.motion==='paused';setReduced(paused);if(paused){setSeconds(60);setPlaying(false)}};
    update();media.addEventListener('change',update);
    window.addEventListener('alpha:motion',update);
    return()=>{media.removeEventListener('change',update);window.removeEventListener('alpha:motion',update)};
  },[]);
  useEffect(()=>{
    const replay=()=>{if(window.matchMedia('(prefers-reduced-motion: reduce)').matches||document.documentElement.dataset.motion==='paused')return;setSeconds(0);setPlaying(true)};
    window.addEventListener('alpha:demo:restart',replay);
    return()=>window.removeEventListener('alpha:demo:restart',replay);
  },[]);
  useEffect(()=>{
    if(!playing||reduced)return;
    const timer=setInterval(()=>setSeconds(v=>{if(v>=59){setPlaying(false);return 60}return v+1}),1000);
    return()=>clearInterval(timer);
  },[playing,reduced]);
  const stage=Math.min(4,Math.floor(seconds/12));
  const typed=seconds<12?'Importing podcast-ep-24.mp4…':transcript.slice(0,Math.min(transcript.length,(seconds-12)*12));
  return (
    <div className="product-demo" id="product-demo" aria-label="Interactive 60-second sample product demonstration">
      <div className="demo-toolbar">
        <Brand small/><span className="text-muted">SAMPLE WORKSPACE</span>
        <div className="flex gap-1">
          <Button variant="ghost" size="sm" aria-label={playing?'Pause demo':'Play demo'} onClick={()=>{if(seconds===60)setSeconds(0);setPlaying(v=>!v)}} disabled={reduced}>
            {playing?<Pause size={13}/>:<Play size={13}/>}</Button>
          <Button variant="ghost" size="sm" aria-label="Replay demo" onClick={()=>{setSeconds(reduced?60:0);setPlaying(!reduced)}}><RotateCcw size={13}/></Button>
        </div>
      </div>
      <div className="demo-body">
        <div className="demo-project-title"><div><small>PROJECT 024</small><h3>The Long Game</h3></div><span className="status-chip">{stage===4?'Clips ready':'Finding the good parts'}</span></div>
        <Stepper activeIndex={stage} compact/>
        <div className="demo-content">
          <div className="demo-source"><img src="/studio-sample.svg" alt="Illustrated sample podcast footage" width="960" height="540"/><span>48:12 · ORIGINAL</span></div>
          <div className="demo-transcript"><small>TRANSCRIPT · {stage>0?'SPEAKER 01':'SOURCE DETECTED'}</small><p>{stage>1?<><mark>The best ideas start with a question.</mark>{' '}Not a perfect plan. If you wait until you know everything, you never start.</>:typed}</p></div>
        </div>
        <div className="demo-clips">
          {clips.map(clip=>(
            <div className={`demo-clip ${stage<3?'pending':''}`} key={clip.title}>
              <img src="/studio-sample.svg" alt="" width="180" height="240"/>
              <span>{stage>=2?clip.score:'—'} SCORE</span>
              <div className="demo-caption">{stage>=3?clip.caption:'SELECTING MOMENT'}</div>
              <p>{clip.title}</p>
            </div>
          ))}
        </div>
      </div>
      <div className="demo-progress"><i style={{width:`${seconds/60*100}%`}}/></div>
      <div className="demo-footnote"><span>ILLUSTRATIVE DEMO · NOT A LIVE JOB</span><span>{seconds.toString().padStart(2,'0')} / 60 SEC</span></div>
    </div>
  );
}
