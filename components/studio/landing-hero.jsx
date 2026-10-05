import {ArrowRight,Check,Scissors,Upload,Youtube} from 'lucide-react';
import {ButtonLink} from './ui';
import {DemoButton,LazyDemo} from './marketing';

export default function LandingHero() {
  return <section className="landing-hero">
    <div className="hero-copy">
      <span className="hero-kicker"><i/>THE FOCUSED VIDEO STUDIO</span>
      <h1>One long video.<br/>A week of clips.</h1>
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
      <LazyDemo/>
      <a href="/studio?demo=1" className="hero-explore">Explore the sample studio<ArrowRight size={14}/><span>No sign-in needed</span></a>
    </div>
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
