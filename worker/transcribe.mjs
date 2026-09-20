import fs from "node:fs";
import { WaveFile } from "wavefile";
import { pipeline } from "@huggingface/transformers";

const audio=process.argv[2];
const model=process.argv[3]||"onnx-community/whisper-tiny";
if(!audio) throw new Error("Audio path is required.");

const wav=new WaveFile(fs.readFileSync(audio));
wav.toBitDepth("32f");
wav.toSampleRate(16000);
let samples=wav.getSamples();
if(Array.isArray(samples)) samples=samples[0];
const transcriber=await pipeline("automatic-speech-recognition",model,{dtype:"q4"});
const result=await transcriber(samples,{chunk_length_s:15,stride_length_s:3,return_timestamps:true});
const chunks=Array.isArray(result?.chunks)?result.chunks:[];
const segments=chunks.map(x=>{
  const t=x.timestamp||[0,0];
  return {start:Number(t[0]||0),end:Number(t[1]||t[0]||0),text:String(x.text||"").trim()};
}).filter(x=>x.text&&x.end>x.start);
process.stdout.write(JSON.stringify(segments));
