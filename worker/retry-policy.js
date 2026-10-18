export function classifyWorkerFailure(message, currentRetryCount = 0, {sessionBound = false, operation = "", now = Date.now(), maxRetries = 5} = {}) {
  const text = String(message || "");
  const providerUnavailable = /429|403|401|503|UNAVAILABLE|RESOURCE_EXHAUSTED|quota|API key|temporar|timeout|ECONNRESET|EAI_AGAIN|network/i.test(text);
  const retryCount = providerUnavailable ? Number(currentRetryCount || 0) : Number(currentRetryCount || 0) + 1;
  const terminal = !providerUnavailable && ((Boolean(sessionBound) && operation !== "render_edit") || retryCount >= maxRetries);
  const delayMs = Math.min(15 * 60 * 1000, providerUnavailable ? 120000 : 15000 * Math.pow(2, Math.min(retryCount, 5)));
  return {
    providerUnavailable,
    retryCount,
    terminal,
    nextRetryAt: terminal ? null : new Date(now + delayMs).toISOString()
  };
}
