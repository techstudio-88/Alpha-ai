import test from "node:test";
import assert from "node:assert/strict";
import { generateLocalClipCandidates } from "../lib/local-analysis.mjs";

test("local clip analysis creates bounded, scored, non-duplicate candidates from transcript words", () => {
  const words = [];
  const text = "Why is this important? The truth is you should never ignore the simple mistake because it changes everything. Here is the best solution and the reason it works. Imagine the result when you learn this important lesson and remember the real problem. ";
  let time = 0;
  for (let repeat = 0; repeat < 8; repeat++) {
    for (const token of text.trim().split(/\s+/)) {
      words.push({ word: token, start_ms: Math.round(time * 1000), end_ms: Math.round((time + 0.32) * 1000) });
      time += 0.36;
    }
    time += 0.15;
  }
  const clips = generateLocalClipCandidates(words, time, 6);
  assert.ok(clips.length > 0);
  assert.ok(clips.length <= 6);
  assert.ok(clips.every(clip => clip.score >= 0 && clip.score <= 100));
  assert.ok(clips.every(clip => clip.endSeconds > clip.startSeconds));
  assert.ok(clips.every(clip => clip.analysisType === "local-heuristic"));
  assert.ok(clips.every(clip => clip.title.length > 0 && clip.reason.length > 0));
});

test("local clip analysis handles empty or unusable transcripts safely", () => {
  assert.deepEqual(generateLocalClipCandidates([]), []);
  assert.deepEqual(generateLocalClipCandidates([{ word: "noise", start_ms: 0, end_ms: 0 }]), []);
});
