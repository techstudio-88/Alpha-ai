import { notFound } from "next/navigation";

const items={
  opusclip:"Alpha.ai and OpusClip feature comparison",
  vidyo:"Alpha.ai and Vidyo feature comparison",
  capcut:"Alpha.ai and CapCut workflow comparison"
};

export function generateStaticParams(){return Object.keys(items).map(slug=>({slug}));}

export default async function Page({params}){
  const {slug}=await params;
  const title=items[slug];
  if(!title) notFound();
  return <main className="seo-page"><h1>{title}</h1><p>Compare documented workflow capabilities, automation, clipping, captions, editing and publishing features. Verify current product capabilities before choosing a tool.</p><a href="/">Explore Alpha.ai</a></main>;
}