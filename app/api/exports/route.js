import {authorizeWorkflow,checked,problem,workflowError} from '../../../lib/workflow-server';
import {allPages,captionEvents} from '../../../lib/video-workflow.mjs';
import {normalizePreferences} from '../../../lib/chat-brief.mjs';
import {createZip} from '../../../lib/zip-export.mjs';
import {UUID} from '../../../lib/video-workflow.mjs';
import {checkRateLimit,rateLimitResponse,resolveWorkspacePlan} from '../../../lib/rate-limit';

export const runtime='nodejs';
export const maxDuration=60;
const LIMIT=100*1024*1024;
const safeName=value=>String(value||'Video').normalize('NFKC').replace(/[^\p{L}\p{N}_. -]/gu,'-').replace(/^\.+|\.+$/g,'').slice(0,80)||'Video';
const clean=value=>String(value||'').replace(/\x00/g,'').slice(0,10000);
const latest=clip=>[...(clip.clip_versions||[])].filter(v=>v.render_status==='ready'&&v.storage_path).sort((a,b)=>b.version-a.version)[0];

async function boundedDownload(admin,path,workspaceId,budget){
  if(typeof path!=='string'||!path.startsWith(workspaceId+'/')||path.split('/').some(p=>p==='..'||p==='.'))throw problem('Invalid workspace export asset.',403);
  const signed=checked(await admin.storage.from('media').createSignedUrl(path,120));
  const response=await fetch(signed.signedUrl,{signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw problem('A rendered file could not be downloaded. Retry after refreshing the clip.',502);
  if(Number(response.headers.get('content-length'))>budget)throw problem('This package exceeds 100 MB. Export fewer clips at once.',413);
  const reader=response.body.getReader(),chunks=[];let bytes=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>budget)throw problem('This package exceeds 100 MB. Export fewer clips at once.',413);chunks.push(Buffer.from(value))}}
  catch(error){await reader.cancel().catch(()=>{});throw error}finally{reader.releaseLock()}
  return Buffer.concat(chunks);
}
const stamp=value=>{const ms=Math.max(0,Math.round(value*1000));return `${String(Math.floor(ms/3600000)).padStart(2,'0')}:${String(Math.floor(ms%3600000/60000)).padStart(2,'0')}:${String(Math.floor(ms%60000/1000)).padStart(2,'0')},${String(ms%1000).padStart(3,'0')}`};
async function subtitles(admin,clip,version){
  const transcript=checked(await admin.from('transcripts').select('id').eq('media_asset_id',clip.media_asset_id).eq('status','completed').order('created_at',{ascending:false}).limit(1).maybeSingle());
  if(!transcript?.id)return null;
  const edit=version.edit_data||{},start=Number(edit.source_start??clip.start_seconds),end=Number(edit.source_end??clip.end_seconds);
  const words=await allPages(async(offset,size)=>checked(await admin.from('transcript_words').select('id,word,start_ms,end_ms').eq('transcript_id',transcript.id).lt('start_ms',end*1000).gt('end_ms',start*1000).order('start_ms').order('id').range(offset,offset+size-1)));
  const events=captionEvents(words,start,end,Number(edit.speed)||1,edit.cutRanges||[],edit.captionOverrides||{});
  return events.length?events.map((event,i)=>`${i+1}\n${stamp(event.start)} --> ${stamp(event.end)}\n${clean(event.word)}\n`).join('\n'):null;
}
function readme(clip,copy,platform,promoCode){
  const content=copy?.social_copy?.[platform]||copy?.caption;
  const lines=[`# ${clean(copy?.title||clip.title)}`,'',`Platform: ${platform==='youtube'?'YouTube Shorts':'Instagram Reels'}`];
  if(content)lines.push('',platform==='youtube'?'## Description':'## Caption','',clean(content));
  if(copy?.hashtags?.length)lines.push('','## Hashtags','',copy.hashtags.map(clean).join(' '));
   lines.push('','## Posting checklist','','- Preview clip.mp4 and review subtitle timing.','- Confirm rights to the video, audio, and images.','- Upload the video, paste the relevant copy, and review platform privacy settings.');
   if(promoCode)lines.push('','## Optional Alpha promotion','','If you choose to support Alpha.ai, add this code to the caption, title, description, or profile bio where the platform allows it:','',promoCode,'','Submit the public post URL in Alpha.ai Promotion verification after publishing. Rewards are reviewed manually and are not automatic.');
  return lines.join('\n');
}
export async function POST(request){
  try{
    const body=await request.json(),workspaceId=body.workspace_id||body.workspaceId,projectId=body.project_id||body.projectId;
    if(!UUID.test(projectId||''))throw problem('A valid project is required.');
    if(body.clip_id&&!UUID.test(body.clip_id))throw problem('A valid clip is required.');
    const {admin,user}=await authorizeWorkflow(request,workspaceId);
    const plan=await resolveWorkspacePlan(admin,workspaceId);
    const rate=await checkRateLimit(request,{endpoint:'api',userId:user.id,plan});
    const blocked=rateLimitResponse(rate);if(blocked)return blocked;
    const project=checked(await admin.from('projects').select('id,name').eq('id',projectId).eq('workspace_id',workspaceId).maybeSingle());
    if(!project)throw problem('Project not found.',404);
    const member=checked(await admin.from('workspace_members').select('role,can_export').eq('workspace_id',workspaceId).eq('user_id',user.id).single());
    if(member.can_export!==true)throw problem('You do not have permission to export this workspace.',403);
    let clips=checked(await admin.from('clips').select('id,title,project_id,media_asset_id,start_seconds,end_seconds,clip_versions(*),media_assets(metadata)').eq('project_id',projectId).order('created_at').limit(40)).filter(latest);
    if(body.clip_id)clips=clips.filter(clip=>clip.id===body.clip_id);
    if(!clips.length)throw problem('No rendered clips are ready to export.',409);
    const preferences=normalizePreferences(body);
    const copies=preferences.includeCopy?checked(await admin.from('clip_repurpose_assets').select('*').in('clip_id',clips.map(c=>c.id))):[];
     const root=safeName(project.name.replace(/\.[^.]+$/,''))+'_Alpha_Clips',promoCode=`ALPHA-${user.id.replaceAll('-','').slice(0,10).toUpperCase()}`,files=[];let total=0;
    const add=(name,data)=>{const bytes=Buffer.isBuffer(data)?data:Buffer.from(data);total+=bytes.length;if(total>LIMIT)throw problem('This package exceeds 100 MB. Export fewer clips at once.',413);files.push({name:`${root}/${name}`,data:bytes})};
    for(const [i,clip] of clips.entries()){
      const version=latest(clip),copy=copies.find(item=>item.clip_id===clip.id);
      const folder=`Clip_${String(i+1).padStart(2,'0')}${preferences.naming==='title'?'_'+safeName(clip.title):''}`;
      add(`${folder}/clip.mp4`,await boundedDownload(admin,version.storage_path,workspaceId,LIMIT-total));
       if(preferences.includeCopy){for(const platform of preferences.platform==='both'?['youtube','instagram']:[preferences.platform])add(`${folder}/${platform}_readme.md`,readme(clip,copy,platform,promoCode))}
      if(preferences.includeCaptions){const srt=await subtitles(admin,clip,version);if(srt)add(`${folder}/captions.srt`,srt)}
      // Only the cover generated for this exact version is included; a source thumbnail is not a clip cover.
      if(preferences.includeThumbnail){const path=version.edit_data?.thumbnail_storage_path||clip.media_assets?.metadata?.thumbnail_storage_path;if(path)add(`${folder}/thumbnail.${path.endsWith('.png')?'png':'jpg'}`,await boundedDownload(admin,path,workspaceId,LIMIT-total))}
    }
    const archive=createZip(files);
    // Vercel responses have a small body limit. Store the private ZIP and return a short-lived URL, not a huge response body.
    const storagePath=`${workspaceId}/${project.id}/exports/${crypto.randomUUID()}/${root}.zip`;
    checked(await admin.storage.from('media').upload(storagePath,archive,{contentType:'application/zip',upsert:false}));
    const signed=checked(await admin.storage.from('media').createSignedUrl(storagePath,300,{download:root+'.zip'}));
    await admin.rpc('record_daily_usage',{p_workspace_id:workspaceId,p_user_id:user.id,p_usage_date:new Date().toISOString().slice(0,10),p_export_count:1}).then(result=>{if(result.error)console.warn('export_usage_accounting_failed')});
    return Response.json({url:signed.signedUrl,filename:root+'.zip',clipCount:clips.length,fileCount:files.length,expiresIn:300},{headers:{'Cache-Control':'private, no-store'}});
  }catch(error){return workflowError(error)}
}
