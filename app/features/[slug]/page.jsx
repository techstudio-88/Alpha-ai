import { notFound } from "next/navigation";

const items={
  clipping:["AI video clipping","Find strong moments automatically and turn long videos into short clips."],
  captions:["AI captions","Generate timed captions for short-form video."],
  editor:["AI editor","Refine clips with automated editing instructions."],
  repurposing:["Video repurposing","Turn one source into multiple social-ready assets."]
};

export function generateStaticParams(){return Object.keys(items).map(slug=>({slug}));}

export default async function Page({params}){
  const {slug}=await params;
  const x=items[slug];
  if(!x) notFound();
  return <main className="seo-page"><h1>{x[0]}</h1><p>{x[1]}</p><a href="/">Open Alpha.ai</a></main>;
}