import test from "node:test";
import assert from "node:assert/strict";
import {
  createCaptionSrt,
  createLocalExportArguments,
  createTrimArguments,
  getLocalExportPolicy,
  readResponseWithinLimit
} from "../lib/local-processing.mjs";

test("local export is enabled on mobile with conservative memory caps", () => {
  const mobile = getLocalExportPolicy({ isMobile: true });
  assert.equal(mobile.allowed, true);
  assert.equal(mobile.maxBytes, 20 * 1024 * 1024);
  assert.match(mobile.reason, /mobile local export is enabled/i);
  assert.equal(getLocalExportPolicy({ isMobile: true, deviceMemory: 2, hardwareConcurrency: 2 }).maxBytes, 12 * 1024 * 1024);
  assert.equal(getLocalExportPolicy({ isMobile: true, deviceMemory: 8, hardwareConcurrency: 8 }).maxBytes, 48 * 1024 * 1024);
});

test("local export applies conservative limits for unknown and low-resource desktops", () => {
  assert.equal(getLocalExportPolicy().maxBytes, 80 * 1024 * 1024);
  assert.equal(getLocalExportPolicy({ deviceMemory: 2, hardwareConcurrency: 2 }).maxBytes, 48 * 1024 * 1024);
  assert.equal(getLocalExportPolicy({ deviceMemory: 8, hardwareConcurrency: 8 }).maxBytes, 200 * 1024 * 1024);
});

test("trim arguments reject invalid ranges and create a bounded MP4 trim", () => {
  assert.throws(() => createTrimArguments(10, 10), /valid clip range/i);
  assert.throws(() => createTrimArguments(-1, 10), /valid clip range/i);
  const args = createTrimArguments(2.5, 8.5);
  assert.ok(args.includes("-ss"));
  assert.ok(args.includes("2.5"));
  assert.ok(args.includes("6"));
  assert.equal(args.at(-1), "output.mp4");
});

test("local export arguments include aspect, effects, speed, transitions and captions when available", () => {
  const args = createLocalExportArguments(2, 12, {
    aspect: "16:9",
    zoom: 1.1,
    speed: 1.25,
    effect: "cinematic",
    transition: "fade",
    captions: true,
    hasCaptions: true,
    captionStyle: "bold",
    captionColor: "#aabbcc"
  });
  const joined = args.join(" ");
  assert.match(joined, /1920:1080/);
  assert.match(joined, /contrast=1\.12/);
  assert.match(joined, /setpts=PTS\/1\.25/);
  assert.match(joined, /subtitles=captions\.srt/);
  assert.match(joined, /afade=t=in/);
  assert.equal(args.at(-1), "output.mp4");
  assert.throws(() => createLocalExportArguments(0, 1, { speed: 3 }), /between 0\.5× and 2×/);
});

test("caption SRT clips and groups word timestamps relative to the selected range", () => {
  const srt = createCaptionSrt([
    { start_ms: 1000, end_ms: 1200, word: "Hello" },
    { start_ms: 1250, end_ms: 1500, word: "there" },
    { start_ms: 8000, end_ms: 8400, word: "outside" }
  ], 1, 5);
  assert.match(srt, /00:00:00,000 --> 00:00:00,500/);
  assert.match(srt, /Hello there/);
  assert.doesNotMatch(srt, /outside/);
});

test("source reader enforces size limits before and during download", async () => {
  const tooLarge = new Response(new Uint8Array(4), { headers: { "content-length": "4" } });
  await assert.rejects(readResponseWithinLimit(tooLarge, 3), /exceeds the safe local-export limit/i);

  const response = new Response(new Uint8Array([1, 2, 3]));
  assert.deepEqual([...await readResponseWithinLimit(response, 3)], [1, 2, 3]);
});
