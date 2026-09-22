"use client";
import { useEffect } from "react";

export default function ClarityAnalytics(){
  useEffect(()=>{
    const id=process.env.NEXT_PUBLIC_CLARITY_ID;
    if(!id||window.__alphaClarityLoaded)return;
    window.__alphaClarityLoaded=true;
    window.clarity=window.clarity||function(){(window.clarity.q=window.clarity.q||[]).push(arguments)};
    const s=document.createElement("script");
    s.async=true;
    s.src="https://www.clarity.ms/tag/"+encodeURIComponent(id);
    s.referrerPolicy="no-referrer-when-downgrade";
    document.head.appendChild(s);
  },[]);
  return null;
}
