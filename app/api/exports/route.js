import {authorizeWorkflow,checked,problem,workflowError} from '../../../lib/workflow-server';
import {createZip} from '../../../lib/zip-export.mjs';

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

// Fallback 1x1 black JPEG header if thumbnail is unavailable
const FALLBACK_JPEG=Buffer.from([
  0xff,0xd8,0xff,0xe0,0x00,0x10,0x4a,0x46,0x49,0x46,0x00,0x01,0x01,0x01,0x00,0x48,0x00,0x48,0x00,0x00,
  0xff,0xdb,0x00,0x43,0x00,0x08,0x06,0x06,0x07,0x06,0x05,0x08,0x07,0x07,0x07,0x09,0x09,0x08,0x0a,0x0c,
  0x14,0x0d,0x0c,0x0b,0x0b,0x0c,0x19,0x12,0x13,0x0f,0x14,0x1d,0x1a,0x1f,0x1e,0x1d,0x1a,0x1c,0x1c,0x20,
  0x24,0x2e,0x27,0x20,0x22,0x2c,0x23,0x1c,0x1c,0x28,0x37,0x29,0x2c,0x30,0x31,0x34,0x34,0x34,0x1f,0x27,
  0x39,0x3d,0x38,0x32,0x3c,0x2e,0x33,0x34,0x32,0xff,0xc0,0x00,0x0b,0x08,0x00,0x01,0x00,0x01,0x01,0x01,
  0x11,0x00,0xff,0xc4,0x00,0x1f,0x00,0x00,0x01,0x05,0x01,0x01,0x01,0x01,0x01,0x01,0x00,0x00,0x00,0x00,
  0x00,0x00,0x00,0x00,0x01,0x02,0x03,0x04,0x05,0x06,0x07,0x08,0x09,0x0a,0x0b,0xff,0xda,0x00,0x08,0x01,
  0x01,0x00,0x00,0x3f,0x00,0xbf,0x80,0xff,0xd9
]);

function buildYoutubeDoc(clip,copy,promoCode){
  const title=clean(copy?.title||clip.title||'Untitled clip');
  const description=clean(copy?.social_copy?.youtube||copy?.caption||'');
  const tags=(copy?.hashtags||[]).map(t=>clean(t).replace(/^#/,'')).filter(Boolean);
  const lines=[
    `# YouTube Shorts: ${title}`,
    '',
    '## Primary Metadata',
    `- Title: ${title}`,
    `- Character Count: ${title.length}/100`,
    `- Format: 9:16 Vertical Short`,
    '',
    '## Description',
    description||'No description generated yet.',
    '',
    '## Tags & Keywords',
    tags.length?tags.join(', '):'alpha-ai, shorts, viral',
    '',
    '## Variations',
    `1. ${title} (Hook Variant)`,
    `2. Why You Must Know: ${title}`,
    `3. The Real Truth Behind ${title}`,
    '',
    '## Posting Checklist',
    '- Preview clip.mp4 and verify audio sync and subtitles.',
    '- Ensure vertical 9:16 aspect ratio.',
    '- Paste title and description into YouTube Studio / mobile app.',
  ];
  if(promoCode)lines.push('','## Promotion Code','',promoCode);
  return lines.join('\n');
}

function buildInstaDoc(clip,copy,promoCode){
  const caption=clean(copy?.social_copy?.instagram||copy?.caption||'');
  const tags=(copy?.hashtags||[]).map(t=>t.startsWith('#')?t:`#${t}`).filter(Boolean);
  const lines=[
    `# Instagram Reel: ${clean(copy?.title||clip.title||'Alpha Clip')}`,
    '',
    '## Caption',
    caption||'Check out this moment from the full video! Link in bio.',
    '',
    `## Character Count: ${(caption||'').length}/2200`,
    '',
    '## Hashtags',
    tags.length?tags.join(' '):'#reels #viral #shorts #alphaai',
    '',
    '## Hook Variations',
    `1. Stop scrolling: ${clean(copy?.hook||clip.title||'')}`,
    `2. Did you know this?`,
    `3. Wait for the end...`,
    '',
    '## Reel Specs',
    '- Dimensions: 1080x1920 (9:16)',
    '- Audio: Original Audio / Trending sound overlay',
    '- Cover: Select thumbnail.jpg as video cover',
  ];
  if(promoCode)lines.push('','## Promotion Code','',promoCode);
  return lines.join('\n');
}

export async function GET(request){
  try{
    const url=new URL(request.url),workspaceId=url.searchParams.get('workspace_id');
    const {admin}=await authorizeWorkflow(request,workspaceId);
    const {data:archives,error}=await admin.from('export_archives').select('*').eq('workspace_id',workspaceId).order('created_at',{ascending:false}).limit(50);
    if(error)throw error;
    const items=[];
    for(const arch of archives||[]){
      const signed=await admin.storage.from('media').createSignedUrl(arch.storage_path,3600,{download:arch.filename}).catch(()=>null);
      items.push({
        ...arch,
        downloadUrl:signed?.data?.signedUrl||null,
        isExpired:new Date(arch.expires_at).getTime()<=Date.now()
      });
    }
    return Response.json({ok:true,archives:items},{headers:{'Cache-Control':'no-store'}});
  }catch(error){return workflowError(error)}
}

export async function POST(request){
  try{
    const body=await request.json(),workspaceId=body.workspace_id||body.workspaceId,projectId=body.project_id||body.projectId;
    const {admin,user}=await authorizeWorkflow(request,workspaceId);
    const project=checked(await admin.from('projects').select('id,name').eq('id',projectId).eq('workspace_id',workspaceId).maybeSingle());
    if(!project)throw problem('Project not found.',404);
    const member=checked(await admin.from('workspace_members').select('role,can_export').eq('workspace_id',workspaceId).eq('user_id',user.id).single());
    if(member.can_export!==true)throw problem('You do not have permission to export this workspace.',403);

    // Cache check: if a non-expired archive exists and regeneration is not requested
    if(!body.regenerate && !body.clip_id){
      const {data:existing}=await admin.from('export_archives').select('*').eq('project_id',projectId).gt('expires_at',new Date().toISOString()).order('created_at',{ascending:false}).limit(1).maybeSingle();
      if(existing?.storage_path){
        const signed=await admin.storage.from('media').createSignedUrl(existing.storage_path,3600,{download:existing.filename}).catch(()=>null);
        if(signed?.data?.signedUrl){
          await admin.from('export_archives').update({download_count:Number(existing.download_count||0)+1,last_downloaded_at:new Date().toISOString()}).eq('id',existing.id).catch(()=>{});
          return Response.json({
            url:signed.data.signedUrl,
            filename:existing.filename,
            clipCount:existing.clip_count,
            fileSize:existing.file_size_bytes,
            cached:true,
            expiresAt:existing.expires_at,
          },{headers:{'Cache-Control':'private, no-store'}});
        }
      }
    }

    let clips=checked(await admin.from('clips').select('id,title,project_id,media_asset_id,start_seconds,end_seconds,clip_versions(*),media_assets(metadata)').eq('project_id',projectId).order('created_at').limit(40)).filter(latest);
    if(body.clip_id)clips=clips.filter(clip=>clip.id===body.clip_id);
    if(!clips.length)throw problem('No rendered clips are ready to export.',409);

    const copies=checked(await admin.from('clip_repurpose_assets').select('*').in('clip_id',clips.map(c=>c.id)));
    const projectName=safeName(project.name.replace(/\.[^.]+$/,''));
    const root=`${projectName}_Alpha_Clips`;
    const promoCode=`ALPHA-${user.id.replaceAll('-','').slice(0,10).toUpperCase()}`;
    const files=[];
    let total=0;

    const add=(name,data)=>{
      const bytes=Buffer.isBuffer(data)?data:Buffer.from(data);
      total+=bytes.length;
      if(total>LIMIT)throw problem('This package exceeds 100 MB. Export fewer clips at once.',413);
      files.push({name:`${root}/${name}`,data:bytes});
    };

    // Strict 4-file structure per clip:
    // 1. clip.mp4
    // 2. thumbnail.jpg
    // 3. youtube.md
    // 4. insta.md
    for(const [i,clip] of clips.entries()){
      const version=latest(clip),copy=copies.find(item=>item.clip_id===clip.id);
      const folder=`Clip_${String(i+1).padStart(2,'0')}_${safeName(clip.title)}`;

      // 1. clip.mp4
      add(`${folder}/clip.mp4`,await boundedDownload(admin,version.storage_path,workspaceId,LIMIT-total));

      // 2. thumbnail.jpg
      const thumbPath=version.edit_data?.thumbnail_storage_path||clip.media_assets?.metadata?.thumbnail_storage_path;
      let thumbData=FALLBACK_JPEG;
      if(thumbPath){
        try{thumbData=await boundedDownload(admin,thumbPath,workspaceId,LIMIT-total)}catch{}
      }
      add(`${folder}/thumbnail.jpg`,thumbData);

      // 3. youtube.md
      add(`${folder}/youtube.md`,buildYoutubeDoc(clip,copy,promoCode));

      // 4. insta.md
      add(`${folder}/insta.md`,buildInstaDoc(clip,copy,promoCode));
    }

    const archive=createZip(files);
    const storagePath=`${workspaceId}/${project.id}/exports/${crypto.randomUUID()}/${root}.zip`;
    checked(await admin.storage.from('media').upload(storagePath,archive,{contentType:'application/zip',upsert:false}));

    const expiresAt=new Date(Date.now()+7*24*60*60*1000).toISOString();
    const signed=checked(await admin.storage.from('media').createSignedUrl(storagePath,3600,{download:root+'.zip'}));

    // Save to export_archives table
    await admin.from('export_archives').insert({
      workspace_id:workspaceId,
      project_id:projectId,
      user_id:user.id,
      storage_path:storagePath,
      filename:root+'.zip',
      file_size_bytes:archive.length,
      clip_count:clips.length,
      expires_at:expiresAt,
      download_count:1,
      last_downloaded_at:new Date().toISOString()
    }).catch(err=>console.warn('export archive tracking failed:',err.message));

    await admin.rpc('record_daily_usage',{p_workspace_id:workspaceId,p_user_id:user.id,p_usage_date:new Date().toISOString().slice(0,10),p_export_count:1}).then(result=>{if(result.error)console.warn('export usage accounting failed:',result.error.message)});

    return Response.json({
      url:signed.signedUrl,
      filename:root+'.zip',
      clipCount:clips.length,
      fileCount:files.length,
      fileSize:archive.length,
      expiresAt,
      expiresIn:3600
    },{headers:{'Cache-Control':'private, no-store'}});
  }catch(error){return workflowError(error)}
}
