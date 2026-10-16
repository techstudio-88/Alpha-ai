import {problem} from './workflow-server';

export async function requireWorkerCapability(capability) {
  const worker = String(process.env.MEDIA_WORKER_URL || '').replace(/\/$/,'');
  if (!worker) throw problem('This feature needs a media worker, but no worker endpoint is configured. Use local trim export for basic editing.',503);
  try {
    const response = await fetch(worker + '/health', {cache:'no-store',signal:AbortSignal.timeout(10000)});
    const health = await response.json();
    if (response.ok && health.capabilities?.includes(capability)) return;
  } catch {}
  throw problem('The media worker is unavailable. This feature needs a configured worker; basic local trim export remains available.',503);
}
