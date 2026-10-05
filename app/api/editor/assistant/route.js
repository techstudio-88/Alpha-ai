import {authorizeWorkflow,checked,mediaContext,problem,workflowError} from '../../../../lib/workflow-server';
import {allPages} from '../../../../lib/video-workflow.mjs';
import {normalizeEditorDraft,planEditorCommand} from '../../../../lib/editor-assistant.mjs';
import {requireWorkerCapability} from '../../../../lib/worker-capabilities';
export const runtime='nodejs';
export const maxDuration=30;
export async function POST(request){
  try{
    const body=await request.json();
    const {admin}=await authorizeWorkflow(request,body.workspaceId);
    const {asset}=await mediaContext(admin,body.workspaceId,body.projectId,body.mediaAssetId);
    const prompt=String(body.prompt||'').trim();
    if(!prompt||prompt.length>3000)throw problem('Describe the change in 1–3,000 characters.');
    if(body.clipId){
      const clip=checked(await admin.from('clips').select('id').eq('id',body.clipId).eq('project_id',body.projectId).eq('media_asset_id',asset.id).maybeSingle());
      if(!clip)throw problem('Selected clip does not belong to this video.',404);
    }
    const transcript=checked(await admin.from('transcripts').select('id').eq('media_asset_id',asset.id).order('created_at',{ascending:false}).limit(1))[0];
    const words=transcript?await allPages(async(offset,size)=>checked(await admin.from('transcript_words').select('id,word,start_ms,end_ms').eq('transcript_id',transcript.id).order('start_ms').order('id').range(offset,offset+size-1))):[];
    const draft=normalizeEditorDraft(body.draft||{},Number(asset.duration_seconds),words);
    const command=planEditorCommand(prompt,draft,words);
    if(command)return Response.json(command);
    const selected=words.filter(w=>w.start_ms>=draft.start*1000&&w.end_ms<=draft.end*1000);
    if(!selected.length)throw problem('Wait for the timed transcript before requesting content-aware edits.',409);
    if(selected.length>1800)throw problem('Choose a shorter clip for interactive AI editing. Long-video analysis runs in the project pipeline.',409);
    await requireWorkerCapability('editor-assistant');
    const worker=(process.env.MEDIA_WORKER_URL||'https://alpha-ai-media-worker.onrender.com').replace(/\/$/,'');
    const response=await fetch(worker+'/editor/plan',{method:'POST',headers:{'content-type':'application/json','x-worker-secret':process.env.MEDIA_WORKER_SECRET||''},body:JSON.stringify({prompt,words:selected,draft,duration:Number(asset.duration_seconds)}),signal:AbortSignal.timeout(23000)});
    const result=await response.json().catch(()=>({}));
    if(!response.ok)throw problem(response.status===400&&typeof result.error==='string'?result.error.slice(0,1000):'The AI editor could not prepare a plan. Your draft is preserved; try again.',response.status===400?400:503);
    if(!Array.isArray(result.clips)||result.clips.length!==1)throw problem('The AI editor returned an invalid selected-clip plan.',502);
    const edit=result.clips[0];
    const cutRanges=draft.cutRanges.map(c=>({start:Math.max(c.start,edit.startSeconds),end:Math.min(c.end,edit.endSeconds)})).filter(c=>c.end>c.start);
    const part=normalizeEditorDraft({...draft,...edit,start:edit.startSeconds,end:edit.endSeconds,cutRanges},Number(asset.duration_seconds),words);
    if(part.start<draft.start||part.end>draft.end)throw problem('The AI editor selected a range outside this clip.',502);
    return Response.json({summary:String(result.summary||'Your proposed edit is ready.').slice(0,2000),parts:[part],engine:'gemini'});
  }catch(error){return workflowError(error)}
}
