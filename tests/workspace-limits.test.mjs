import test from 'node:test';
import assert from 'node:assert/strict';
import { highestWorkspacePlan, workspaceLimitError, workspaceLimitForPlan } from '../lib/workspace-limits.mjs';
test('workspace limit uses the highest entitlement plan', () => {
  assert.equal(highestWorkspacePlan(['free', 'pro', 'studio', 'free']), 'studio');
  assert.equal(highestWorkspacePlan(['free', 'pro']), 'pro');
  assert.equal(highestWorkspacePlan([]), 'free');
});
test('workspace creation is capped by the server-side plan', () => {
  assert.equal(workspaceLimitForPlan('free'), 1); assert.equal(workspaceLimitForPlan('pro'), 3); assert.equal(workspaceLimitForPlan('studio'), 10);
  assert.equal(workspaceLimitError('free', 0), null); assert.match(workspaceLimitError('free', 1), /Upgrade to Creator/);
  assert.equal(workspaceLimitError('pro', 2), null); assert.match(workspaceLimitError('pro', 3), /Upgrade to Studio/);
  assert.equal(workspaceLimitError('studio', 9), null); assert.match(workspaceLimitError('studio', 10), /up to 10/);
});
