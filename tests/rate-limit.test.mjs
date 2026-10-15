import test from "node:test";
import assert from "node:assert/strict";
import {checkRateLimit,rateLimitResponse} from "../lib/rate-limit.js";

const envNames=["UPSTASH_REDIS_REST_URL","UPSTASH_REDIS_REST_TOKEN"];
async function withEnv(values,run){
  const old=Object.fromEntries(envNames.map(key=>[key,process.env[key]]));
  for(const key of envNames){if(values[key]===undefined)delete process.env[key];else process.env[key]=values[key]}
  const originalFetch=globalThis.fetch;
  try{return await run(originalFetch)}finally{
    globalThis.fetch=originalFetch;
    for(const key of envNames){if(old[key]===undefined)delete process.env[key];else process.env[key]=old[key]}
  }
}

test("rate limiting fails closed with a friendly 503 when Redis is not configured",async()=>{
  await withEnv({},async()=>{
    const result=await checkRateLimit(new Request("https://alpha.test/api",{headers:{"x-forwarded-for":"203.0.113.44"}}),{endpoint:"api",userId:"user-test",plan:"free"});
    assert.equal(result.allowed,false);
    assert.equal(result.unavailable,true);
    const response=rateLimitResponse(result);
    assert.equal(response.status,503);
    assert.ok(response.headers.get("Retry-After"));
    const body=await response.json();
    assert.match(body.errorId,/^[0-9a-f-]{36}$/i);
    assert.doesNotMatch(JSON.stringify(body),/postgres|redis|203\.0\.113\.44|user-test/i);
  });
});

test("rate limiting hashes identifiers and enforces plan-specific user caps with Retry-After",async()=>{
  await withEnv({UPSTASH_REDIS_REST_URL:"https://redis.example.test",UPSTASH_REDIS_REST_TOKEN:"test-token"},async()=>{
    const requests=[];
    globalThis.fetch=async(_url,options)=>{
      const command=JSON.parse(options.body);
      requests.push(command);
      return new Response(JSON.stringify({result:[13,37]}),{status:200,headers:{"content-type":"application/json"}});
    };
    const request=new Request("https://alpha.test/api",{headers:{"x-forwarded-for":"198.51.100.27"}});
    const free=await checkRateLimit(request,{endpoint:"ai_call",userId:"private-user-id",plan:"free"});
    assert.equal(free.allowed,false);
    const blocked=rateLimitResponse(free);
    assert.equal(blocked.status,429);
    assert.equal(blocked.headers.get("Retry-After"),"37");
    const pro=await checkRateLimit(request,{endpoint:"ai_call",userId:"private-user-id",plan:"pro"});
    assert.equal(pro.allowed,true);
    const stored=JSON.stringify(requests);
    assert.doesNotMatch(stored,/private-user-id|198\.51\.100\.27/);
    assert.match(stored,/alpha:rl:ai_call:u:[a-f0-9]{64}/);
    assert.match(stored,/alpha:rl:ai_call:i:[a-f0-9]{64}/);
  });
});
