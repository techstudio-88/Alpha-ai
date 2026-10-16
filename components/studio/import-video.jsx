"use client";
import {useState} from 'react';
import * as tus from 'tus-js-client';
import {sourceUrl} from '../../lib/video-workflow.mjs';
import {getLocalExportPolicy,readResponseWithinLimit} from '../../lib/local-processing.mjs';
import {supabase} from '../../lib/supabase';
import GoogleDriveBrowser from '../GoogleDriveBrowser';
import GooglePhotosPicker from '../GooglePhotosPicker';
import {useStudio,unwrap} from './data';
import {Button,DropZone,ErrorState,Modal,Tabs} from './ui';

const LOCAL_IMPORT_CAP_BYTES=80*1024*1024;
const LOCAL_AUDIO_CHUNK_SECONDS=300;

async function readVideoDuration(file){
  const objectUrl=URL.createObjectURL(file);
  try{
    return await new Promise((resolve,reject)=>{
      const video=document.createElement('video');
      video.preload='metadata';
      video.onloadedmetadata=()=>Number.isFinite(video.duration)&&video.duration>0?resolve(video.duration):reject(new Error('The browser could not read this video duration.'));
      video.onerror=()=>reject(new Error('This video format could not be inspected in your browser.'));
      video.src=objectUrl;
    });
  }finally{URL.revokeObjectURL(objectUrl)}
}

async function prepareLocalAudioChunks(file,workspaceId,projectId,onProgress){
  const duration=await readVideoDuration(file);
  if(duration>7200)throw new Error('Free local transcription is limited to videos up to 2 hours.');
  let ffmpeg=null;
  const uploadedPaths=[];
  const chunks=[];
  try{
    const [{FFmpeg},{toBlobURL}]=await Promise.all([import('@ffmpeg/ffmpeg'),import('@ffmpeg/util')]);
    ffmpeg=new FFmpeg();
    const baseURL='https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd';
    await ffmpeg.load({
      coreURL:await toBlobURL(baseURL+'/ffmpeg-core.js','text/javascript'),
      wasmURL:await toBlobURL(baseURL+'/ffmpeg-core.wasm','application/wasm')
    });
    await ffmpeg.writeFile('source-video',new Uint8Array(await file.arrayBuffer()));
    const total=Math.ceil(duration/LOCAL_AUDIO_CHUNK_SECONDS);
    for(let index=0;index<total;index++){
      const start=index*LOCAL_AUDIO_CHUNK_SECONDS;
      const length=Math.min(LOCAL_AUDIO_CHUNK_SECONDS,duration-start);
      onProgress?.(index/total);
      const outputName='audio-'+index+'.wav';
      await ffmpeg.exec(['-ss',String(start),'-i','source-video','-t',String(length),'-map','0:a:0','-vn','-ac','1','-ar','16000','-c:a','pcm_s16le',outputName]);
      const audio=await ffmpeg.readFile(outputName);
      if(!audio?.length)throw new Error('Audio extraction returned an empty chunk.');
      const storagePath=workspaceId+'/'+projectId+'/transcription/'+crypto.randomUUID()+'-'+String(index+1).padStart(3,'0')+'.wav';
      const uploaded=await supabase.storage.from('media').upload(storagePath,new Blob([audio],{type:'audio/wav'}),{contentType:'audio/wav',cacheControl:'3600',upsert:false});
      if(uploaded.error)throw uploaded.error;
      uploadedPaths.push(storagePath);
      chunks.push({storagePath,start,length});
      await ffmpeg.deleteFile(outputName).catch(()=>{});
      onProgress?.((index+1)/total);
    }
    await ffmpeg.deleteFile('source-video').catch(()=>{});
    return {duration,chunks};
  }catch(error){
    if(uploadedPaths.length)await supabase.storage.from('media').remove(uploadedPaths).catch(()=>{});
    throw error;
  }finally{if(ffmpeg){try{await ffmpeg.terminate()}catch{}}}
}

export default function ImportVideo({open,onOpenChange,file:initialFile}){
  const {workspace,user,demo,refresh,navigate,notify}=useStudio();
  const [tab,setTab]=useState(initialFile?.tab||'upload');const [busy,setBusy]=useState(false);const [progress,setProgress]=useState(0);const [error,setError]=useState('');const [file,setFile]=useState(typeof initialFile?.name==='string'?initialFile:null);
  async function start(input){
    setBusy(true);setError('');setProgress(0);
    let project;
    let localAudio=null;
    let workerConfigured=false;
    try{
      if(demo){notify('This is a sample workspace. Sign in to import your own footage.');return}
      const isFile=input instanceof File,parsed=isFile?null:sourceUrl(input);
      if(!isFile&&parsed.sourceType==='direct_url'){
        const response=await fetch(parsed.url,{mode:'cors',credentials:'omit',cache:'no-store'});
        const bytes=await readResponseWithinLimit(response,200*1024*1024);
        const remoteUrl=new URL(parsed.url);
        const leaf=decodeURIComponent(remoteUrl.pathname.split('/').filter(Boolean).pop()||'remote-video.mp4').replace(/[^a-z\d._-]/gi,'-').slice(-120);
        const declared=(response.headers.get('content-type')||'').split(';')[0].trim().toLowerCase();
        const ext=/\.(mp4|mov|webm|mkv|m4v)$/i.exec(leaf)?.[1]?.toLowerCase();
        if(!declared.startsWith('video/')&&!ext)throw new Error('The link did not return a recognizable video file.');
        const mime=declared.startsWith('video/')?declared:({mp4:'video/mp4',m4v:'video/x-m4v',mov:'video/quicktime',webm:'video/webm',mkv:'video/x-matroska'}[ext]||'video/mp4');
        const remoteFile=new File([bytes],leaf||'remote-video.mp4',{type:mime});
        setFile(remoteFile);
        return await start(remoteFile);
      }
      const statusResponse=await fetch('/api/worker/status',{cache:'no-store'}).catch(()=>null);
      const workerStatus=await statusResponse?.json().catch(()=>({}));
      workerConfigured=Boolean(statusResponse?.ok&&workerStatus?.configured);
      if(!isFile&&parsed.sourceType!=='direct_url'&&!workerConfigured)throw new Error('This provider link needs a configured media worker. For a free local import, use a direct HTTPS video file URL that permits browser CORS, or upload the video from your device.');
      const localPolicy=getLocalExportPolicy({isMobile:window.matchMedia('(max-width: 760px)').matches,deviceMemory:Number(navigator.deviceMemory)||0,hardwareConcurrency:Number(navigator.hardwareConcurrency)||0});
      const localCap=Math.min(localPolicy.maxBytes,LOCAL_IMPORT_CAP_BYTES);
      if(isFile&&!workerConfigured&&input.size>localCap)throw new Error('No media worker is configured, so this upload will be processed locally. This device has a '+Math.floor(localCap/1048576)+' MB local-processing limit. Choose a smaller video to avoid freezing the browser.');
      if(isFile&&input.size>512*1024*1024)throw new Error('Choose a video under 512 MB. Larger-source support needs a higher worker and storage budget.');
      if(isFile&&!input.type.startsWith('video/')&&!/\.(mp4|mov|webm|mkv|m4v)$/i.test(input.name))throw new Error('Choose an MP4, MOV, WebM, MKV, or M4V video.');
      const name=isFile?input.name.replace(/\.[^.]+$/,''):parsed.sourceType==='youtube'?'YouTube recording':'Imported recording';
      project=unwrap(await supabase.from('projects').insert({workspace_id:workspace.id,owner_id:user.id,name,status:isFile?'uploading':'processing'}).select().single());
      let asset=null;
      if(isFile){
        const path=`${workspace.id}/${project.id}/${crypto.randomUUID()}-${input.name.replace(/[^a-z\d._-]/gi,'-')}`;
        asset=unwrap(await supabase.from('media_assets').insert({workspace_id:workspace.id,project_id:project.id,owner_id:user.id,name:input.name,storage_path:path,mime_type:input.type||'video/mp4',size_bytes:input.size,status:'uploading'}).select().single());
        const {data}=await supabase.auth.getSession();
        const endpoint=process.env.NEXT_PUBLIC_SUPABASE_URL+'/storage/v1/upload/resumable';
        await new Promise((resolve,reject)=>{
          const upload=new tus.Upload(input,{endpoint,retryDelays:[0,2000,5000,10000],headers:{authorization:`Bearer ${data.session.access_token}`,apikey:process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY},chunkSize:6*1024*1024,metadata:{bucketName:'media',objectName:path,contentType:input.type||'video/mp4',cacheControl:'3600'},removeFingerprintOnSuccess:true,onError:()=>reject(new Error('Upload interrupted. Check your connection and retry.')),onProgress:(sent,total)=>setProgress(Math.round(sent/total*90)),onSuccess:resolve});
          upload.findPreviousUploads().then(previous=>{if(previous[0])upload.resumeFromPreviousUpload(previous[0]);upload.start()}).catch(reject);
        });
        unwrap(await supabase.from('media_assets').update({status:'uploaded'}).eq('id',asset.id));
        unwrap(await supabase.from('videos').insert({project_id:project.id,media_asset_id:asset.id,title:name,status:'ready'}));
        if(!workerConfigured){
          setProgress(90);
          localAudio=await prepareLocalAudioChunks(input,workspace.id,project.id,value=>setProgress(90+Math.round(value*8)));
        }
      }
      const source=unwrap(await supabase.from('project_sources').insert({workspace_id:workspace.id,project_id:project.id,source_type:isFile?'upload':parsed.sourceType,source_url:parsed?.url||null,file_name:isFile?input.name:null,status:localAudio?'processing':'queued'}).select().single());
      let transcript=null;
      if(localAudio)transcript=unwrap(await supabase.from('transcripts').insert({media_asset_id:asset.id,status:'processing',provider:'browser-whisper-local'}).select().single());
      const payload={workspaceId:workspace.id,projectId:project.id,sourceId:source.id,mediaAssetId:asset?.id||null,requestedBy:user.id,sourceType:isFile?'upload':parsed.sourceType,url:parsed?.url||null,preferencesRequired:!localAudio,...(localAudio?{localOnly:true,localAnalysis:'heuristic',durationSeconds:localAudio.duration,transcriptId:transcript.id,transcribeChunk:0,transcriptionChunks:localAudio.chunks}: {})};
      // Local mode uses browser FFmpeg + Whisper and never queues work to an absent server.
      const job=unwrap(await supabase.from('processing_jobs').insert({workspace_id:workspace.id,project_id:project.id,job_type:'ingest',status:localAudio?'awaiting_transcription':'awaiting_preferences',progress:localAudio?8:0,current_stage:localAudio?'transcription':null,payload}).select().single());
      notify(localAudio?'Upload saved. Transcribing on this device with the free browser model.':'Source uploaded. Let’s tailor the cut before processing.');
      await supabase.from('projects').update({status:'processing'}).eq('id',project.id);
      setProgress(100);refresh();onOpenChange(false);navigate('chat',{project:project.id,job:job.id,afterUpload:localAudio?undefined:'1'});
    }catch(err){setError(err.message);if(project)await supabase.from('projects').update({status:'upload_failed'}).eq('id',project.id)}finally{setBusy(false)}
  }
  const imported=result=>{refresh();onOpenChange(false);notify('Source added. Processing is queued.');navigate('chat',{project:result.projectId,job:result.jobId})};
  return <Modal open={open} onOpenChange={value=>{if(!busy)onOpenChange(value)}} title="Bring your next recording." description="Upload a video or choose an authorized source. You keep ownership of your footage."><Tabs value={tab} onValueChange={setTab} label="Video import source" items={[{value:'upload',label:'Upload / link'},{value:'drive',label:'Drive'},{value:'photos',label:'Photos'}]}/>{error&&<div className="mb-4"><ErrorState message={error} onRetry={()=>setError('')}/></div>}{tab==='upload'&&<><DropZone compact initialUrl={typeof initialFile==='string'?initialFile:''} onFile={selected=>setFile(selected)} onLink={start} busy={busy}/>{file&&<div className="flex items-center justify-between gap-3 mt-5 text-xs"><span className="truncate text-muted">{file.name} · {Math.round(file.size/1048576)} MB</span><Button variant="primary" size="sm" busy={busy} onClick={()=>start(file)}>Upload video</Button></div>}</>}{tab==='drive'&&(demo?<p className="text-muted text-sm">Sign in to choose files from your Google Drive. Sample projects stay local.</p>:<GoogleDriveBrowser workspaceId={workspace.id} userId={user.id} onImported={imported} onError={setError}/>)}{tab==='photos'&&(demo?<p className="text-muted text-sm">Sign in to open the authorized Google Photos picker.</p>:<GooglePhotosPicker workspaceId={workspace.id} userId={user.id} onImported={imported} onError={setError}/>)}{busy&&<div className="mt-5" role="status"><progress max="100" value={progress} className="w-full"/><p className="text-xs text-muted mt-2">{progress<90?`Uploading ${progress}%`:progress<99?'Preparing local transcription audio…':'Saving your project…'}</p></div>}<p className="text-xs text-muted mt-5">Import only content you own or have permission to use. The server verifies source access and download limits.</p></Modal>;
}
