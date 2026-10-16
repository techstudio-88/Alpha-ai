import test from "node:test";
import assert from "node:assert/strict";
import { createTrimArguments, getLocalExportPolicy, readResponseWithinLimit } from "../lib/local-processing.mjs";

test("local export is disabled on mobile in the desktop-first rollout", () => {
  const policy = getLocalExportPolicy({ isMobile: true });
  assert.equal(policy.allowed, false);
  assert.match(policy.reason, /desktop/i);
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
  assert.deepEqual(args.slice(0, 5), ["-ss", "2.5", "-i", "input.mp4", "-t"]);
  assert.equal(args[5], "6");
  assert.equal(args.at(-1), "output.mp4");
});

test("source reader enforces size limits before and during download", async () => {
  const tooLarge = new Response(new Uint8Array(4), { headers: { "content-length": "4" } });
  await assert.rejects(readResponseWithinLimit(tooLarge, 3), /exceeds the safe local-export limit/i);

  const response = new Response(new Uint8Array([1, 2, 3]));
  assert.deepEqual([...await readResponseWithinLimit(response, 3)], [1, 2, 3]);
});
