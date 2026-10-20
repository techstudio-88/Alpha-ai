import test from 'node:test';
import assert from 'node:assert/strict';
import { clipLimitForDuration, estimateClipCountRange, maxClipDurationForPacing } from '../lib/clip-estimate.mjs';

test('clip estimates handle unknown and long source durations', () => {
  assert.equal(estimateClipCountRange(undefined), 'Calculating…');
  assert.equal(estimateClipCountRange(25 * 60), '6–10 clips');
  assert.equal(estimateClipCountRange(25 * 60, { clipCount: '3' }), 3);
});

test('worker limits respect explicit counts and pacing', () => {
  assert.equal(clipLimitForDuration(25 * 60, { clipCount: '3' }), 3);
  assert.equal(clipLimitForDuration(25 * 60), 8);
  assert.equal(maxClipDurationForPacing('tight'), 30);
  assert.equal(maxClipDurationForPacing('auto'), 45);
  assert.equal(maxClipDurationForPacing('story'), 60);
  assert.equal(maxClipDurationForPacing('unknown'), 45);
});
