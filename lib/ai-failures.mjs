// Never return raw provider responses: they may contain credentials or request content.
export function aiFailure(error){
  const status=Number(error?.status||error?.statusCode||error?.response?.status);
  const message=String(error?.message||'');
  if(status===429||/RESOURCE_EXHAUSTED|quota|rate.?limit/i.test(message))return {status:429,code:'AI_QUOTA',error:'The AI provider is at its quota. Wait for the quota to reset or increase the project’s authorized quota. Your draft is preserved.'};
  if(status===401||status===403||/api.?key|PERMISSION_DENIED/i.test(message))return {status:503,code:'AI_CONFIGURATION',error:'The worker’s AI credentials need attention. Your draft is preserved; the owner must check the Gemini configuration.'};
  if(error?.name==='TimeoutError'||error?.name==='AbortError'||/timeout|timed out/i.test(message))return {status:504,code:'AI_TIMEOUT',error:'The AI plan took too long. Try a shorter selection; your draft is preserved.'};
  if(status===503||/fetch failed|ECONNREFUSED|ENOTFOUND/i.test(message))return {status:503,code:'WORKER_UNAVAILABLE',error:'The media worker is unavailable. Your source and draft are preserved. Retry after the worker is healthy.'};
  return {status:502,code:'AI_INVALID_PLAN',error:'The AI returned a plan that could not be validated. Try a simpler instruction. Your draft is preserved.'};
}
