import { pipeline } from "@huggingface/transformers";

const model=(process.env.WHISPER_MODEL&&process.env.WHISPER_MODEL.includes("/"))
  ? process.env.WHISPER_MODEL
  : "onnx-community/whisper-tiny";

console.log("Preloading Whisper model:",model);
await pipeline("automatic-speech-recognition",model,{dtype:"q4"});
console.log("Whisper model preload complete.");
