"use client";
import {useEffect} from 'react';
import {useRouter} from 'next/navigation';
export default function SiteBootstrap(){
  const router=useRouter();
  useEffect(()=>{
    if('serviceWorker' in navigator)navigator.serviceWorker.register('/sw.js').catch(()=>{});
    // Preserve old bookmarks and callbacks without loading the archived app.
    if(window.location.pathname!=='/')return;
    const params=new URLSearchParams(window.location.search);
    if(params.has('view')||params.has('code'))router.replace('/studio?'+params.toString());
  },[router]);
  return null;
}
