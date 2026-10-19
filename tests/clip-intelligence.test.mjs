import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimateClipCountRange } from '../lib/clip-intelligence.mjs';

test('clip yield estimate is grounded in source duration and never exceeds worker cap', () => {
  assert.equal(estimateClipCountRange(16), '1 clip');
  assert.equal(estimateClipCountRange(20 * 60), '6 to 8 clips');
  assert.equal(estimateClipCountRange(60 * 60), '8 clips');
});

test('clip yield estimate handles missing or invalid durations without inventing a long source', () => {
  assert.equal(estimateClipCountRange(0), '1 clip');
  assert.equal(estimateClipCountRange(Number.NaN), '1 clip');
});
