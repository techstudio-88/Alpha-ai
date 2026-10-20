"use client";
import {useEffect,useState} from 'react';
import {usePathname} from 'next/navigation';
import {Sparkles} from 'lucide-react';
import {Button} from './ui';

export function useMotionPreference(){
  const [enabled,setEnabled]=useState(false);
  useEffect(()=>{
    const media=window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync=()=>setEnabled(!media.matches&&document.documentElement.dataset.motion!=='paused');
    sync();media.addEventListener('change',sync);window.addEventListener('alpha:motion',sync);
    return()=>{media.removeEventListener('change',sync);window.removeEventListener('alpha:motion',sync)};
  },[]);
  return enabled;
}

export function useReveal({ threshold = 0.12, once = true } = {}) {
  const [refVisible, setRefVisible] = useState(false);
  const [node, setNode] = useState(null);
  useEffect(() => {
    if (!node) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce || document.documentElement.dataset.motion === 'paused' || !('IntersectionObserver' in window)) {
      setRefVisible(true);
      return;
    }
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          setRefVisible(true);
          if (once) observer.unobserve(entry.target);
        } else if (!once) setRefVisible(false);
      }
    }, { threshold });
    observer.observe(node);
    return () => observer.disconnect();
  }, [node, threshold, once]);
  return { ref: setNode, revealed: refVisible, className: refVisible ? 'motion-reveal motion-seen' : 'motion-reveal' };
}

export function MotionToggle(){
  const [paused,setPaused]=useState(false);
  useEffect(()=>{const sync=()=>setPaused(document.documentElement.dataset.motion==='paused');sync();window.addEventListener('alpha:motion',sync);return()=>window.removeEventListener('alpha:motion',sync)},[]);
  return <Button variant="ghost" size="icon" aria-label={paused?'Enable animations':'Pause animations'} aria-pressed={paused} onClick={()=>{
    const value=paused?'full':'paused';document.documentElement.dataset.motion=value;
    try{localStorage.setItem('alpha.studio.motion',value)}catch{}
    window.dispatchEvent(new CustomEvent('alpha:motion'));
  }}><Sparkles size={17}/></Button>;
}

export default function MotionRoot(){
  const pathname=usePathname();
  useEffect(()=>{
    const seen=new WeakSet();
    const observer=new IntersectionObserver(entries=>{for(const entry of entries)if(entry.isIntersecting){entry.target.classList.add('motion-seen');observer.unobserve(entry.target)}},{threshold:.08});
    const scan=()=>{
      document.querySelectorAll('.landing-section .section-heading,.how-card,.bento-card,.pricing-card,.before-after,.usecase-panel,.final-cta,.footer-grid>div').forEach((node,i)=>{
        if(seen.has(node))return;seen.add(node);
        node.classList.add('motion-reveal');node.style.setProperty('--reveal-delay',`${Math.min(i%3,2)*75}ms`);
        if(node.getBoundingClientRect().top<window.innerHeight)node.classList.add('motion-seen');else observer.observe(node);
      });
    };
    scan();
    return()=>observer.disconnect();
  },[pathname]);
  return null;
}
