export const PLANS = Object.freeze({
  free: Object.freeze({ key: 'free', name: 'Free', monthlyPaise: 0, workspaceLimit: 1, brandKitLimit: 1 }),
  pro: Object.freeze({ key: 'pro', name: 'Creator', monthlyPaise: 79900, workspaceLimit: 3, brandKitLimit: 3 }),
  studio: Object.freeze({ key: 'studio', name: 'Studio', monthlyPaise: 149900, workspaceLimit: 10, brandKitLimit: 10 }),
});
export function planAmount(plan, interval = 'monthly') {
  const selected = PLANS[plan];
  if (!selected || plan === 'free') throw new Error('Choose a paid plan to create a UPI order.');
  if (!['monthly', 'yearly'].includes(interval)) throw new Error('Choose a valid billing interval.');
  return selected.monthlyPaise * (interval === 'yearly' ? 10 : 1);
}
export function upiLink({ vpa, payeeName, amountPaise, reference, note }) {
  if (!vpa || !payeeName || !Number.isSafeInteger(Number(amountPaise)) || Number(amountPaise) <= 0 || !reference) throw new Error('UPI payment is not configured. Please contact support.');
  const params = new URLSearchParams({ pa: vpa, pn: payeeName, am: (Number(amountPaise) / 100).toFixed(2), cu: 'INR', tr: reference, tn: String(note || 'Alpha.ai plan').slice(0, 80) });
  return 'upi://pay?' + params.toString();
}
