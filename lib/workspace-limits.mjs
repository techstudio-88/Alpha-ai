export const WORKSPACE_LIMITS = Object.freeze({ free: 1, pro: 3, studio: 10 });
const PLAN_RANK = Object.freeze({ free: 0, pro: 1, studio: 2 });
export function highestWorkspacePlan(plans = []) {
  return plans.reduce((highest, plan) => (PLAN_RANK[plan] ?? -1) > (PLAN_RANK[highest] ?? -1) ? plan : highest, 'free');
}
export function workspaceLimitForPlan(plan) { return WORKSPACE_LIMITS[plan] || WORKSPACE_LIMITS.free; }
export function workspaceLimitError(plan, count) {
  if (Number(count) < workspaceLimitForPlan(plan)) return null;
  if (plan === 'free') return 'Upgrade to Creator to add more workspaces.';
  if (plan === 'pro') return 'Your Creator plan allows up to 3 workspaces. Upgrade to Studio to add more.';
  return 'Your Studio plan allows up to 10 workspaces.';
}
