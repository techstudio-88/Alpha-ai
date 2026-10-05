import {authorizeWorkflow,checked,problem,workflowError} from '../../../lib/workflow-server';
export const runtime='nodejs';
export const maxDuration=30;
export async function POST(request){
  try{
    const body=await request.json();
    const {admin}=await authorizeWorkflow(request,body.workspaceId);
    const prompt=String(body.prompt||'').trim();
    if(!prompt||prompt.length>3000)throw problem('Ask a question in 1–3,000 characters.');
    const projects=checked(await admin.from('projects').select('id,name,status').eq('workspace_id',body.workspaceId).order('created_at',{ascending:false}).limit(30));
    let selectedClip=null,transcript=[];
    if(body.clipId){
      selectedClip=checked(await admin.from('clips').select('id,title,project_id,media_asset_id,start_seconds,end_seconds,ai_spec,caption_config,projects!inner(workspace_id)').eq('id',body.clipId).eq('projects.workspace_id',body.workspaceId).maybeSingle());
      if(!selectedClip)throw problem('This clip is not in the selected workspace.',404);
      const tr=checked(await admin.from('transcripts').select('id').eq('media_asset_id',selectedClip.media_asset_id).order('created_at',{ascending:false}).limit(1))[0];
      if(tr)transcript=checked(await admin.from('transcript_words').select('word,start_ms,end_ms').eq('transcript_id',tr.id).gte('start_ms',selectedClip.start_seconds*1000).lte('end_ms',selectedClip.end_seconds*1000).order('start_ms').limit(800));
    }
    const clips=projects.length?checked(await admin.from('clips').select('id,title,status,start_seconds,end_seconds,project_id').in('project_id',projects.map(p=>p.id)).order('created_at',{ascending:false}).limit(20)):[];
    const history=(Array.isArray(body.history)?body.history:[]).slice(-6).filter(m=>['user','assistant'].includes(m?.role)).map(m=>({role:m.role,content:String(m.content||'').slice(0,700)}));
    const selection=selectedClip?{id:selectedClip.id,title:selectedClip.title,start:selectedClip.start_seconds,end:selectedClip.end_seconds,aspect:selectedClip.ai_spec?.aspect,captionStyle:selectedClip.caption_config?.style}:null;
    const context=JSON.stringify({selectedClip:selection,transcript:transcript.map(w=>w.word).join(' ').slice(0,4500),previousConversation:history,
      projects:projects.slice(0,12).map(p=>({...p,name:String(p.name).slice(0,100)})),clips:clips.slice(0,10).map(c=>({...c,title:String(c.title).slice(0,100)})),
      task:'Provide advice or draft copy. Editing actions are previewed and applied in the clip editor; never claim changes or publishing have been performed.'}).slice(0,12000);
    const worker=(process.env.MEDIA_WORKER_URL||'https://alpha-ai-media-worker.onrender.com').replace(/\/$/,'');
    const response=await fetch(worker+'/assistant',{method:'POST',headers:{'content-type':'application/json','x-worker-secret':process.env.MEDIA_WORKER_SECRET||''},body:JSON.stringify({prompt,context}),signal:AbortSignal.timeout(20000)});
    if(!response.ok)throw problem('The assistant is temporarily unavailable. Try again after the media worker wakes.',503);
    const result=await response.json();
    return Response.json({text:String(result.text||'').slice(0,16000)});
  }catch(error){return workflowError(error)}
}
