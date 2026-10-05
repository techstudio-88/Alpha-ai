import {problem} from './workflow-server';

export async function requireWorkerCapability(capability) {
  const worker = (process.env.MEDIA_WORKER_URL || 'https://alpha-ai-media-worker.onrender.com').replace(/\/$/,'');
  try {
    const response = await fetch(worker + '/health', {cache:'no-store',signal:AbortSignal.timeout(10000)});
    const health = await response.json();
    if (response.ok && health.capabilities?.includes(capability)) return;
  } catch {}
  throw problem('The media worker is updating. Please retry shortly; your source and saved versions are safe.',503);
}
