import test from "node:test";
import assert from "node:assert/strict";
import {classifyWorkerFailure} from "../worker/retry-policy.js";

test("provider outages pause with backoff without consuming retry budget",()=>{
  const result=classifyWorkerFailure("429 RESOURCE_EXHAUSTED",3,{now:1000});
  assert.equal(result.providerUnavailable,true);
  assert.equal(result.retryCount,3);
  assert.equal(result.terminal,false);
  assert.equal(result.nextRetryAt,new Date(121000).toISOString());
});

test("genuine AI-chat failures are terminal and eligible for refund",()=>{
  const result=classifyWorkerFailure("Invalid media context",{value:1},{sessionBound:true,operation:"ai_chat_plan",now:1000});
  assert.equal(result.providerUnavailable,false);
  assert.equal(result.terminal,true);
  assert.equal(result.nextRetryAt,null);
});

test("ordinary worker jobs use bounded exponential retries and then terminate",()=>{
  const retry=classifyWorkerFailure("ffmpeg exited",1,{now:1000});
  assert.equal(retry.terminal,false);
  assert.equal(retry.retryCount,2);
  assert.equal(retry.nextRetryAt,new Date(61000).toISOString());
  const terminal=classifyWorkerFailure("ffmpeg exited",4,{now:1000});
  assert.equal(terminal.terminal,true);
  assert.equal(terminal.retryCount,5);
});
