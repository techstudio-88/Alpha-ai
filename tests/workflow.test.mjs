import test from "node:test";
import assert from "node:assert/strict";
import {allPages,captionEvents,sourceUrl,validateEdit,retainedRanges,youtubeVideoUrl} from "../lib/video-workflow.mjs";
import {planTranscript} from "../worker/chat.js";

test("long-form transcript reads past Supabase's row cap",async()=>{
  const rows=Array.from({length:12417},(_,i)=>({id:i}));
  const result=await allPages((offset,size)=>Promise.resolve(rows.slice(offset,offset+size)));
  assert.equal(result.length,12417);assert.equal(result.at(-1).id,12416);
});
test("source parsing keeps signed URL parameters and identifies supported providers",()=>{
  assert.equal(sourceUrl("https://youtu.be/abc").sourceType,"youtube");
  assert.equal(sourceUrl("https://drive.google.com/file/d/abc/view").sourceType,"google_drive");
  assert.equal(sourceUrl("https://cdn.example.com/movie.mp4?token=secret").url,"https://cdn.example.com/movie.mp4?token=secret");
  for(const value of ["http://example.com/v.mp4","https://127.0.0.1/v.mp4","https://user:pass@example.com/v.mp4","https://localhost/a"])assert.throws(()=>sourceUrl(value));
});
test('YouTube downloads only accept canonical video identifiers, not arbitrary redirect pages',()=>{
  assert.equal(youtubeVideoUrl('https://youtu.be/dQw4w9WgXcQ?t=20'),'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.equal(youtubeVideoUrl('https://www.youtube.com/shorts/dQw4w9WgXcQ'),'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  for(const url of ['https://www.youtube.com/redirect?q=https://localhost','https://youtube.com/watch?v=invalid','https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ'])assert.throws(()=>youtubeVideoUrl(url));
});
test("invalid AI boundaries are rejected rather than invented or silently clamped",()=>{
  const words=[{word:"hello",start_ms:60000,end_ms:60500},{word:"world",start_ms:60500,end_ms:61000}];
  assert.equal(validateEdit({a:0,b:1},words,90).startSeconds,60);
  for(const spec of [{a:-1,b:1},{a:0,b:99},{a:.5,b:1},{a:1,b:0}])assert.throws(()=>validateEdit(spec,words,90));
});
test("captions follow trim boundaries and playback speed",()=>{
  assert.deepEqual(captionEvents([{word:"hello",start_ms:9500,end_ms:10500},{word:"world",start_ms:11000,end_ms:14000}],10,12,2),[
    {word:"hello",start:0,end:.25},{word:"world",start:.5,end:1}
  ]);
});
test('transcript cuts preserve retained media and compress caption timestamps',()=>{
  const cuts=[{start:11,end:12},{start:11.5,end:13}];
  assert.deepEqual(retainedRanges(10,15,cuts),[{start:10,end:11},{start:13,end:15}]);
  assert.deepEqual(captionEvents([{word:'keep',start_ms:13000,end_ms:14000},{word:'remove',start_ms:11500,end_ms:12000}],10,15,2,cuts),[{word:'keep',start:.5,end:1}]);
  assert.throws(()=>retainedRanges(10,15,[{start:9,end:11}]));
  assert.throws(()=>retainedRanges(10,15,[{start:10,end:15}]));
});
test("planner analyzes the end of a long transcript before global selection",async()=>{
  const words=Array.from({length:4100},(_,i)=>({word:`word${i}`,start_ms:i*400,end_ms:i*400+350}));
  let calls=0;const windows=[];
  const plan=await planTranscript({words,duration:1640,prompt:"One useful short",history:[],onProgress:(i,n)=>windows.push([i,n]),
    generate:async prompt=>{
      calls++;
      // Model contract fixture: this test checks window coverage/validation, not AI quality.
      if(prompt.includes("ENTIRE video"))return {summary:"Selected",clips:[{a:3440,b:3450,title:"End"}]};
      const match=prompt.match(/TRANSCRIPT:\n(\d+)/),a=Number(match[1]);
      return {summary:"Candidate",clips:[{a,b:a+10,title:"Candidate"}]};
    }});
  assert.equal(calls,4);assert.deepEqual(windows,[[0,3],[1,3],[2,3]]);assert.equal(plan.clips[0].startSeconds,1376);
});
test("unsupported instructions fail without a fabricated result",async()=>{
  await assert.rejects(planTranscript({words:[{word:"real",start_ms:0,end_ms:1000}],duration:1,prompt:"Add music",history:[],onProgress:()=>{},
    generate:async()=>({unsupportedReason:"Adding music is not supported",clips:[]})}),error=>error.unsupported===true&&/not supported/.test(error.message));
});
