import { pipeline } from "@huggingface/transformers";
let transcriberPromise=null;
function decodePcm16Wav(buffer){
  const view=new DataView(buffer);
  if(view.getUint32(0,false)!==0x52494646||view.getUint32(8,false)!==0x57415645)throw new Error("Invalid WAV audio.");
  let offset=12,channels=1,sampleRate=16000,bits=16,dataOffset=-1,dataSize=0;
  while(offset+8<=view.byteLength){
    const id=view.getUint32(offset,false),size=view.getUint32(offset+4,true);offset+=8;
    if(id===0x666d7420){
      const format=view.getUint16(offset,true);channels=view.getUint16(offset+2,true);sampleRate=view.getUint32(offset+4,true);bits=view.getUint16(offset+14,true);
      if(format!==1||bits!==16)throw new Error("Only PCM16 WAV chunks are supported.");
    }else if(id===0x64617461){dataOffset=offset;dataSize=size;break}
    offset+=size+(size%2);
  }
  if(dataOffset<0)throw new Error("WAV data chunk not found.");
  const frames=Math.floor(dataSize/(channels*2)),out=new Float32Array(frames);
  for(let i=0;i<frames;i++){let sum=0;for(let ch=0;ch<channels;ch++)sum+=view.getInt16(dataOffset+(i*channels+ch)*2,true)/32768;out[i]=sum/channels}
  return {samples:out,sampleRate};
}
async function getTranscriber(){
  if(!transcriberPromise)transcriberPromise=pipeline("automatic-speech-recognition","onnx-community/whisper-tiny",{dtype:"q4"});
  return transcriberPromise;
}
self.onmessage=async event=>{
  const {url,index}=event.data||{};
  try{
    if(!url)throw new Error("Audio chunk URL is required.");
    self.postMessage({type:"progress",index,value:10});
    const response=await fetch(url);
    if(!response.ok)throw new Error("Could not download transcription audio.");
    const buffer=await response.arrayBuffer();
    self.postMessage({type:"progress",index,value:25});
    const {samples,sampleRate}=decodePcm16Wav(buffer);
    if(sampleRate!==16000)throw new Error("Unexpected transcription sample rate.");
    const transcriber=await getTranscriber();
    self.postMessage({type:"progress",index,value:45});
    const result=await transcriber(samples,{chunk_length_s:15,stride_length_s:3,return_timestamps:true});
    const chunks=Array.isArray(result?.chunks)?result.chunks:[];
    const segments=chunks.map(x=>{const t=x.timestamp||[0,0];return {start:Number(t[0]||0),end:Number(t[1]||t[0]||0),text:String(x.text||"").trim()}}).filter(x=>x.text&&x.end>x.start);
    self.postMessage({type:"done",index,segments});
  }catch(error){self.postMessage({type:"error",index,error:error?.message||"Browser transcription failed."})}
};