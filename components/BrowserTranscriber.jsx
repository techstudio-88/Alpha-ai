"use client";
import {useEffect,useRef,useState} from "react";
import {supabase} from "../lib/supabase";

export default function BrowserTranscriber({workspace}){
  const running=useRef(false);
  const [state,setState]=useState(null);
  useEffect(()=>{
    if(!workspace||!supabase)return;
    let alive=true;
    const worker=new Worker(new URL("../workers/transcriber.worker.js",import.meta.url),{type:"module"});
    async function processJob(job){
      if(running.current)return;
      running.current=true;
      const payload=job.payload||{},chunks=Array.isArray(payload.transcriptionChunks)?payload.transcriptionChunks:[];
      const next=Math.max(0,Number(payload.transcribeChunk||0));
      try{
        if(!chunks.length||next>=chunks.length){running.current=false;return}
        for(let i=next;i<chunks.length;i++){
          if(!alive)break;
          const chunk=chunks[i];
          setState({jobId:job.id,index:i,total:chunks.length,progress:0});
          const signed=await supabase.storage.from("media").createSignedUrl(chunk.storagePath,600);
          if(signed.error)throw signed.error;
          const result=await new Promise((resolve,reject)=>{
            const handler=e=>{
              if(e.data?.index!==i)return;
              if(e.data.type==="progress")setState({jobId:job.id,index:i,total:chunks.length,progress:e.data.value});
              if(e.data.type==="done"){worker.removeEventListener("message",handler);resolve(e.data.segments||[])}
              if(e.data.type==="error"){worker.removeEventListener("message",handler);reject(new Error(e.data.error))}
            };
            worker.addEventListener("message",handler);
            worker.postMessage({url:signed.data.signedUrl,index:i});
          });
          const startMs=Math.round(Number(chunk.start)*1000),endMs=Math.round((Number(chunk.start)+Number(chunk.length))*1000);
          const existing=await supabase.from("transcript_segments").select("id").eq("transcript_id",payload.transcriptId).gte("start_ms",startMs).lt("start_ms",endMs).limit(1);
          if(existing.error)throw existing.error;
          if(!(existing.data||[]).length&&result.length){
            const rows=result.map(s=>({transcript_id:payload.transcriptId,start_ms:Math.round((s.start+Number(chunk.start))*1000),end_ms:Math.round((s.end+Number(chunk.start))*1000),text:s.text,speaker:null,confidence:null}));
            const ins=await supabase.from("transcript_segments").insert(rows);
            if(ins.error)throw ins.error;
          }
          const textRows=await supabase.from("transcript_segments").select("text,start_ms,end_ms").eq("transcript_id",payload.transcriptId).order("start_ms",{ascending:true});
          if(textRows.error)throw textRows.error;
          const completed=i+1>=chunks.length;
          const tr=await supabase.from("transcripts").update({text:(textRows.data||[]).map(x=>x.text).join(" "),language:"auto",status:completed?"completed":"processing"}).eq("id",payload.transcriptId);
          if(tr.error)throw tr.error;
          await supabase.storage.from("media").remove([chunk.storagePath]).catch(()=>{});
          const nextPayload={...payload,transcriptId:payload.transcriptId,transcribeChunk:i+1,transcriptionChunks:chunks};
          const j=await supabase.from("processing_jobs").update({status:completed?"queued":"awaiting_transcription",progress:completed?62:43+Math.round(((i+1)/chunks.length)*19),error:null,payload:nextPayload}).eq("id",job.id);
          if(j.error)throw j.error;
          if(completed)setState({jobId:job.id,index:chunks.length,total:chunks.length,progress:100,done:true});
        }
      }catch(error){if(alive)setState({jobId:job.id,error:error?.message||"Browser transcription failed."})}
      finally{running.current=false}
    }
    async function scan(){
      if(running.current||!alive)return;
      const r=await supabase.from("processing_jobs").select("id,payload,status").eq("workspace_id",workspace.id).eq("status","awaiting_transcription").order("created_at",{ascending:true}).limit(1);
      if(!r.error&&r.data?.[0])processJob(r.data[0]);
    }
    scan();
    const timer=setInterval(scan,5000);
    return()=>{alive=false;clearInterval(timer);worker.terminate()};
  },[workspace]);
  if(!state)return null;
  return <div className="browserTranscriberNotice"><b>{state.error?"Transcription needs attention":state.done?"Transcription complete":"Transcribing in this browser"}</b>{state.error?<span>{state.error}</span>:<span>{state.done?"Finishing AI clip analysis…":"Audio chunk "+Math.min(state.index+1,state.total)+" of "+state.total+(state.progress?" · "+state.progress+"%":"")}</span>}</div>;
}