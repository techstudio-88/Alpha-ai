import {lookup} from "node:dns/promises";
import {pipeline} from "node:stream/promises";
import {createWriteStream} from "node:fs";
import {sourceUrl} from "../lib/video-workflow.mjs";

export async function publicDownload(value,out){
  let url=sourceUrl(value).url;
  for(let redirect=0;redirect<6;redirect++){
    const host=new URL(url).hostname;
    const addresses=await lookup(host,{all:true});
    if(!addresses.length||addresses.some(({address})=>{
      if(address.includes(":"))return !/^[23][\da-f]{3}:/i.test(address);
      const [a,b]=address.split(".").map(Number);
      return a===0||a===10||a===127||a>=224||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&b===168)||(a===100&&b>=64&&b<=127);
    }))throw new Error("The video URL resolves to a non-public network address.");
    const response=await fetch(url,{redirect:"manual",signal:AbortSignal.timeout(30*60*1000)});
    if([301,302,303,307,308].includes(response.status)){
      await response.body?.cancel();
      const location=response.headers.get("location");if(!location)throw new Error("Video redirect has no destination.");
      url=sourceUrl(new URL(location,url).toString()).url;continue;
    }
    if(!response.ok)throw new Error(`Video download failed (HTTP ${response.status}). Check that the link is public and downloadable.`);
    if(!response.body)throw new Error("Video source returned an empty response.");
    await pipeline(response.body,createWriteStream(out));return;
  }
  throw new Error("Video source redirected too many times.");
}
