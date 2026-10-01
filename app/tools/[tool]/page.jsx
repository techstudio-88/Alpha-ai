import { notFound } from "next/navigation";
import ToolClient from "./ToolClient";

const names={
  "ai-hook-generator":"Hook Generator",
  "shorts-title-generator":"Shorts Title Generator",
  "caption-generator":"Caption Generator",
  "clip-ideas-generator":"Clip Ideas Generator",
  "podcast-to-shorts-planner":"Podcast to Shorts Planner"
};
const map={
  "ai-hook-generator":"hook",
  "shorts-title-generator":"title",
  "caption-generator":"caption",
  "clip-ideas-generator":"ideas",
  "podcast-to-shorts-planner":"podcast"
};

export function generateStaticParams(){return Object.keys(map).map(tool=>({tool}));}

export default async function Page({params}){
  const {tool}=await params;
  if(!map[tool]) notFound();
  return <ToolClient tool={tool} names={names}/>;
}