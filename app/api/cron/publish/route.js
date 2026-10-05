import {cronAuthorized} from '../../../../lib/cron-auth.mjs';
export const runtime='nodejs';
export async function GET(request){
  if(!cronAuthorized(request))return new Response('Unauthorized',{status:401});
  // The worker owns publishing claims and streaming. This cron only wakes it.
  const worker=process.env.MEDIA_WORKER_URL||'https://alpha-ai-media-worker.onrender.com';
  const response=await fetch(worker.replace(/\/$/,'')+'/health',{signal:AbortSignal.timeout(10000),cache:'no-store'}).catch(()=>null);
  return Response.json({queued:true,publisher:'media-worker',workerAwake:Boolean(response?.ok)},{status:202});
}
