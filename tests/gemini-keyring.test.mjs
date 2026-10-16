import test from "node:test";
import assert from "node:assert/strict";
import {createGeminiKeyRing,readGeminiKeys} from "../worker/gemini-keyring.js";

test("Gemini key pool supports legacy and rotated server-side variables without duplicates",()=>{
  const keys=readGeminiKeys({
    GEMINI_API_KEY:"legacy",
    GEMINI_API_KEY_1:"one",
    GEMINI_API_KEY_2:"two",
    GEMINI_API_KEY_3:"one",
    GEMINI_API_KEYS:"three, four"
  });
  assert.deepEqual(keys.map(item=>item.key),["legacy","one","two","three","four"]);
  assert.equal(keys[0].label,"GEMINI_API_KEY");
  assert.equal(keys[1].label,"GEMINI_API_KEY_1");
});

test("Gemini key ring round-robins and handles an empty configuration",()=>{
  const ring=createGeminiKeyRing({GEMINI_API_KEY_1:"one",GEMINI_API_KEY_2:"two"});
  assert.equal(ring.current().key,"one");
  assert.equal(ring.next().key,"one");
  assert.equal(ring.next().key,"two");
  assert.equal(ring.next().key,"one");
  assert.equal(createGeminiKeyRing({}).next(),null);
});

test("Gemini key cooldown skips throttled keys until the pool is exhausted",()=>{
  const ring=createGeminiKeyRing({GEMINI_API_KEY_1:"one",GEMINI_API_KEY_2:"two"});
  ring.markUnavailable("GEMINI_API_KEY_1",120000,1000);
  assert.equal(ring.next(1001).key,"two");
  ring.markUnavailable("GEMINI_API_KEY_2",60000,1000);
  assert.equal(ring.next(1001).label,"GEMINI_API_KEY_2");
});
