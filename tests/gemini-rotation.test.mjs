import test from "node:test";
import assert from "node:assert/strict";
import {
  generateGeminiWithRotation,
  uploadGeminiFileWithRotation,
  restoreGeminiKeyHealth
} from "../worker/chat.js";

const names=["GEMINI_API_KEY","GEMINI_API_KEY_1","GEMINI_API_KEY_2","GEMINI_API_KEY_3","GEMINI_API_KEY_4","GEMINI_API_KEY_5","GEMINI_API_KEYS"];
function withKeys(run){
  const previous=Object.fromEntries(names.map(name=>[name,process.env[name]]));
  names.forEach((name,index)=>{process.env[name]=index===0?"phase1-primary":index===1?"phase1-key-one":index===2?"phase1-key-two":index===3?"phase1-key-three":index===4?"phase1-key-four":index===5?"phase1-key-five":""});
  restoreGeminiKeyHealth(names.slice(0,6).map((_,i)=>({key_label:i===0?"GEMINI_API_KEY":i===1?"GEMINI_API_KEY_1":"GEMINI_API_KEY_"+i,is_available:true,cooldown_until:null,success_count:0,failure_count:0,rate_limit_count:0})));
  return Promise.resolve().then(run).finally(()=>{for(const name of names){if(previous[name]===undefined)delete process.env[name];else process.env[name]=previous[name]}});
}

test("Gemini generation rotates after quota errors and records key health without exposing keys",async()=>{
  await withKeys(async()=>{
    const tried=[],health=[];
    const result=await generateGeminiWithRotation({
      primaryKey:process.env.GEMINI_API_KEY,model:"test",contents:"safe test",attemptsPerKey:1,
      onHealth:async row=>health.push(row),
      createClient:({apiKey})=>({models:{generateContent:async()=>{tried.push(apiKey);if(apiKey==="phase1-key-one")throw Object.assign(new Error("quota exhausted"),{status:429});return {text:"ok"}}}})
    });
    assert.equal(result.text,"ok");
    assert.deepEqual(tried,["phase1-key-one","phase1-primary"]);
    assert.ok(health.some(row=>row.keyLabel==="GEMINI_API_KEY_1"&&row.rateLimitCount===1));
    assert.ok(health.every(row=>!JSON.stringify(row).includes("phase1-primary")));
  });
});

test("Gemini file upload rotates keys and pauses safely when every provider fails",async()=>{
  await withKeys(async()=>{
    const tried=[];
    const uploaded=await uploadGeminiFileWithRotation("/tmp/phase1-test.mp4","video/mp4",async()=>{},({apiKey})=>({
      files:{upload:async()=>{tried.push(apiKey);if(apiKey==="phase1-key-one")throw Object.assign(new Error("quota exhausted"),{status:429});return {name:"files/test",uri:"https://example.invalid/file",mimeType:"video/mp4"}}}
    }));
    assert.equal(uploaded.file.name,"files/test");
    assert.deepEqual(tried,["phase1-key-one","phase1-primary"]);
    restoreGeminiKeyHealth(names.slice(0,6).map((_,i)=>({key_label:i===0?"GEMINI_API_KEY":i===1?"GEMINI_API_KEY_1":"GEMINI_API_KEY_"+i,is_available:true,cooldown_until:null,success_count:0,failure_count:0,rate_limit_count:0})));
    await assert.rejects(
      generateGeminiWithRotation({
        primaryKey:process.env.GEMINI_API_KEY,model:"test",contents:"safe test",attemptsPerKey:1,
        createClient:()=>({models:{generateContent:async()=>{throw Object.assign(new Error("temporarily unavailable"),{status:503})}}})
      }),
      error=>error.retryableProviderUnavailable===true&&Number(error.retryAfterMs)>0
    );
  });
});
