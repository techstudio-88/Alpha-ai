import test from 'node:test';
import assert from 'node:assert/strict';
import { planAmount, upiLink } from '../lib/plans.mjs';
test('plan prices are server-defined and yearly billing is ten monthly payments', () => {
  assert.equal(planAmount('pro', 'monthly'), 79900); assert.equal(planAmount('pro', 'yearly'), 799000);
  assert.equal(planAmount('studio', 'monthly'), 149900); assert.equal(planAmount('studio', 'yearly'), 1499000);
  assert.throws(() => planAmount('free', 'monthly')); assert.throws(() => planAmount('pro', 'weekly'));
});
test('UPI link includes INR amount and order reference', () => {
  const url = new URL(upiLink({ vpa: 'merchant@example', payeeName: 'Alpha.ai', amountPaise: 79900, reference: 'ALPHA-TEST', note: 'Creator monthly' }));
  assert.equal(url.protocol, 'upi:'); assert.equal(url.searchParams.get('pa'), 'merchant@example'); assert.equal(url.searchParams.get('am'), '799.00');
  assert.equal(url.searchParams.get('cu'), 'INR'); assert.equal(url.searchParams.get('tr'), 'ALPHA-TEST');
  assert.throws(() => upiLink({ vpa: '', payeeName: 'Alpha.ai', amountPaise: 79900, reference: 'ALPHA-TEST' }));
});
