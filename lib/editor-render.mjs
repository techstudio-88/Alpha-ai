import {randomUUID} from 'node:crypto';
import {allPages} from './video-workflow.mjs';
import {normalizeEditorDraft} from './editor-assistant.mjs';

const failure=(message,status=400)=>Object.assign(new Error(message),{status});
const data=result=>{if(result.error)throw failure(result.error.message,500);return result.data};

export async function enqueueEditorRender({admin,user,token,body,asset,requireCapability,wake}) {
  const {workspaceId,projectId,mediaAssetId,clipId}=body;
  let sourceClip=null;
  if(clipId){
    sourceClip=data(await admin.from('clips').select('id,start_seconds,end_seconds').eq('id',clipId).eq('project_id',projectId).eq('media_asset_id',mediaAssetId).maybeSingle());
    if(!sourceClip)throw failure('Clip does not belong to this video.',404);
    const pending=data(await admin.from('processing_jobs').select('id').eq('workspace_id',workspaceId).or(`payload->>clipId.eq.${sourceClip.id},payload->>sourceClipId.eq.${sourceClip.id}`).in('status',['queued','processing']).limit(1));
    if(pending.length)throw failure('This clip already has a render in progress.',409);
  }
  const inputs=body.parts??[body];
  if(!Array.isArray(inputs)||!inputs.length||inputs.length>8)throw failure('Choose between one and eight output clips.');
  const drafts=inputs.map(input=>normalizeEditorDraft(input,Number(asset.duration_seconds)));
  if(body.parts&&sourceClip&&drafts.some(d=>d.start<Number(sourceClip.start_seconds)||d.end>Number(sourceClip.end_seconds)))
    throw failure('Split parts must stay inside the selected source clip.');
  if(drafts.some(d=>Object.keys(d.captionOverrides).length)){
    const transcript=data(await admin.from('transcripts').select('id').eq('media_asset_id',asset.id).order('created_at',{ascending:false}).limit(1))[0];
    if(!transcript)throw failure('Caption corrections need a completed word-timed transcript.',409);
    const words=await allPages(async(offset,size)=>data(await admin.from('transcript_words').select('id').eq('transcript_id',transcript.id).order('id').range(offset,offset+size-1)));
    for(const draft of drafts)normalizeEditorDraft(draft,Number(asset.duration_seconds),words);
    await requireCapability('caption-corrections');
  }
  if(drafts.some(d=>d.cutRanges.length))await requireCapability('transcript-cuts');
  if(body.parts)await requireCapability('editor-batch-render');
  const payloads=drafts.map(d=>({operation:'render_edit',workspaceId,projectId,mediaAssetId,requestedBy:user.id,
    clipId:body.parts?null:clipId||null,sourceClipId:clipId||null,newClipId:body.parts||!clipId?randomUUID():null,
    startSeconds:d.start,endSeconds:d.end,title:d.title,aspect:d.aspect,speed:d.speed,zoom:d.zoom,effect:d.effect,
    transition:d.transition,reframe:d.autoReframe,captions:d.captionStyle!=='none',captionStyle:d.captionStyle==='none'?'pop':d.captionStyle,
    captionColor:d.captionColor,captionOverrides:d.captionOverrides,cutRanges:d.cutRanges,
    aiPrompt:body.parts?'':String(body.aiPrompt||'').slice(0,6000)}));
  // One insert keeps a multi-part render request all-or-nothing in the durable queue.
  const jobs=data(await admin.from('processing_jobs').insert(payloads.map(payload=>({workspace_id:workspaceId,project_id:projectId,job_type:'render_edit',status:'queued',progress:0,payload}))).select('id'));
  // A single wake starts the canonical DB queue; all parts are already persisted.
  const warning=await wake({...payloads[0],jobId:jobs[0].id},token);
  return {jobId:jobs[0].id,jobIds:jobs.map(job=>job.id),warning};
}
