"use client";
import {useEffect,useRef} from "react";
import {usePathname} from "next/navigation";
import {brainPoints,bulbPoints,globePoints,scatterPoints} from "./brain-shapes.mjs";
const PALETTE=["#f5c518","#ffd84d","#8b5cf6","#c4b5fd","#ffffff","#34d399","#38bdf8"];
const SHAPES=["brain","scatter","bulb","globe"];
const OFF=[/^\/adminishere/,/^\/hq-/];
const SOFT=[/^\/studio/];
export default function BrainBackground(){
 const cv=useRef(null),path=usePathname()||"/",off=OFF.some(r=>r.test(path)),soft=SOFT.some(r=>r.test(path));
 useEffect(()=>{
  const c=cv.current;if(!c||off)return;
  const root=document.documentElement;root.dataset.brain=soft?"soft":"on";
  const reduce=matchMedia("(prefers-reduced-motion: reduce)").matches||root.dataset.motion==="paused";
  const mobile=matchMedia("(max-width: 760px)").matches,N=Math.round((mobile?1300:3400)*(soft?.48:1)),dpr=Math.min(devicePixelRatio||1,2),ctx=c.getContext("2d");
  const T={brain:brainPoints(N),scatter:scatterPoints(N),bulb:bulbPoints(N),globe:globePoints(N)};
  const col=new Uint8Array(N),size=new Float32Array(N),rot=new Float32Array(N),spin=new Float32Array(N),delay=new Float32Array(N),persp=new Float32Array(N),proj=new Float32Array(N*2);
  for(let i=0;i<N;i++){const y=T.brain[i*3+1],h=(y+1)/2+(Math.random()-.5)*.5;col[i]=h>.62?(Math.random()<.7?0:1):h>.3?(Math.random()<.6?2:3):Math.floor(Math.random()*7);size[i]=.5+Math.random();rot[i]=Math.random()*6.28;spin[i]=(Math.random()-.5)*.04;delay[i]=Math.random()*.35}
  let w=0,h=0,prog=0,target=0,yaw=.4,mx=0,my=0,raf=0,run=!document.hidden,last=0,slow=0;
  const resize=()=>{w=c.width=Math.round(innerWidth*dpr);h=c.height=Math.round(innerHeight*dpr)};
  const onScroll=()=>{target=Math.max(0,Math.min(1,scrollY/Math.max(1,document.documentElement.scrollHeight-innerHeight)))};
  const onMove=e=>{mx=e.clientX/innerWidth-.5;my=e.clientY/innerHeight-.5};
  const ease=t=>t<.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2;
  function frame(t){if(!run)return;raf=requestAnimationFrame(frame);const dt=Math.min(50,t-last||16);last=t;slow=dt>28?slow+1:Math.max(0,slow-1);const draw=slow>40?Math.floor(N*.55):N;prog+=(target-prog)*Math.min(1,dt/300);
   const u=prog*3,a=Math.min(2,Math.floor(u)),f=Math.max(0,Math.min(1,((u-a)-.22)/.56)),A=T[SHAPES[a]],B=T[SHAPES[a+1]];
   if(!reduce)yaw+=dt*.00022+mx*.00025*dt;const cy=Math.cos(yaw),sy=Math.sin(yaw),pitch=-.12+my*.12,cp=Math.cos(pitch),sp=Math.sin(pitch),S=Math.min(w,h*1.1)*(mobile?.42:.34),cx=w*(mobile?.5:.68),cyy=h*(mobile?.42:.5);
   ctx.clearRect(0,0,w,h);for(let i=0;i<draw;i++){const k=ease(Math.max(0,Math.min(1,(f-delay[i]*.6)/(1-delay[i]*.6)))),j=i*3;let x=A[j]+(B[j]-A[j])*k,y=A[j+1]+(B[j+1]-A[j+1])*k,z=A[j+2]+(B[j+2]-A[j+2])*k;if(f>0&&f<1){const q=Math.sin(k*Math.PI)*.12;x+=Math.sin(t*.002+i)*q;y+=Math.cos(t*.0017+i*1.3)*q}const rx=x*cy+z*sy,rz=-x*sy+z*cy,ry=y*cp-rz*sp,rz2=y*sp+rz*cp,p=1/(1+rz2*.18);proj[i*2]=cx+rx*S*p;proj[i*2+1]=cyy-ry*S*p;persp[i]=p}
   ctx.lineWidth=1.1*dpr;ctx.globalAlpha=soft?.42:.8;for(let ci=0;ci<PALETTE.length;ci++){ctx.strokeStyle=PALETTE[ci];ctx.beginPath();for(let i=0;i<draw;i++){if(col[i]!==ci)continue;const px=proj[i*2],py=proj[i*2+1],r=(1.8+size[i]*2.8)*dpr*persp[i],an=rot[i]+t*spin[i]*.06;ctx.moveTo(px+Math.cos(an)*r,py+Math.sin(an)*r);ctx.lineTo(px+Math.cos(an+2.094)*r,py+Math.sin(an+2.094)*r);ctx.lineTo(px+Math.cos(an+4.188)*r,py+Math.sin(an+4.188)*r);ctx.closePath()}ctx.stroke()}
  }
  const visibility=()=>{run=!document.hidden;cancelAnimationFrame(raf);if(run){last=0;raf=requestAnimationFrame(frame)}};
  const observer=new ResizeObserver(onScroll);observer.observe(document.body);resize();onScroll();prog=target;document.addEventListener("visibilitychange",visibility);addEventListener("scroll",onScroll,{passive:true});addEventListener("resize",resize);addEventListener("pointermove",onMove,{passive:true});raf=requestAnimationFrame(frame);
  return()=>{run=false;cancelAnimationFrame(raf);observer.disconnect();document.removeEventListener("visibilitychange",visibility);removeEventListener("scroll",onScroll);removeEventListener("resize",resize);removeEventListener("pointermove",onMove);delete root.dataset.brain};
 },[off,soft]);
 if(off)return null;
 return <canvas ref={cv} aria-hidden="true" style={{position:"fixed",inset:0,width:"100vw",height:"100dvh",zIndex:0,pointerEvents:"none"}}/>;
}