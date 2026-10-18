"use client";
import {useState,useRef} from 'react';
import * as tus from 'tus-js-client';
import {sourceUrl} from '../../lib/video-workflow.mjs';
import {supabase} from '../../lib/supabase';
import GoogleDriveBrowser from '../GoogleDriveBrowser';
import GooglePhotosPicker from '../GooglePhotosPicker';
import {useStudio,unwrap} from './data';
import {Button,DropZone,ErrorState,Modal,Tabs} from './ui';

export default function ImportVideo({open,onOpenChange,file:initialFile}){
  const {workspace,user,demo,refresh,navigate,notify}=useStudio();
  const [tab,setTab]=useState(initialFile?.tab||'upload');
  const [busy,setBusy]=useState(false);
  const [progress,setProgress]=useState(0);
  const [speed,setSpeed]=useState('0.0');
  const [eta,setEta]=useState(0);
  const [error,setError]=useState('');
  const [file,setFile]=useState(typeof initialFile?.name==='string'?initialFile:null);
  const uploadRef=useRef(null);

  function cancelUpload(){
    if(uploadRef.current){
      uploadRef.current.abort();
      uploadRef.current=null;
    }
    setBusy(false);
    setProgress(0);
    notify('Upload cancelled.');
  }

  async function start(input){
    if(!input)return;
    setBusy(true);setError('');setProgress(0);setSpeed('0.0');setEta(0);
    let project;
    try{
      if(demo){notify('This is a sample workspace. Sign in to import your own footage.');setBusy(false);return}
      const isFile=input instanceof File,parsed=isFile?null:sourceUrl(input);
      if(isFile&&input.size>512*1024*1024)throw new Error('Choose a video under 512 MB. Larger-source support needs a higher worker and storage budget.');
      if(isFile&&!input.type.startsWith('video/')&&!/\.(mp4|mov|webm|mkv)$/i.test(input.name))throw new Error('Choose an MP4, MOV, WebM, or MKV video.');
      const name=isFile?input.name.replace(/\.[^.]+$/,''):parsed.sourceType==='youtube'?'YouTube recording':'Imported recording';
      project=unwrap(await supabase.from('projects').insert({workspace_id:workspace.id,owner_id:user.id,name,status:isFile?'uploading':'processing'}).select().single());
      let asset=null;
      if(isFile){
        const path=`${workspace.id}/${project.id}/${crypto.randomUUID()}-${input.name.replace(/[^a-z\d._-]/gi,'-')}`;
        asset=unwrap(await supabase.from('media_assets').insert({workspace_id:workspace.id,project_id:project.id,owner_id:user.id,name:input.name,storage_path:path,mime_type:input.type||'video/mp4',size_bytes:input.size,status:'uploading'}).select().single());
        const {data}=await supabase.auth.getSession();
        const endpoint=process.env.NEXT_PUBLIC_SUPABASE_URL+'/storage/v1/upload/resumable';
        const startTime=Date.now();

        await new Promise((resolve,reject)=>{
          const upload=new tus.Upload(input,{
            endpoint,
            retryDelays:[0,2000,5000,10000],
            headers:{authorization:`Bearer ${data.session.access_token}`,apikey:process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY},
            chunkSize:6*1024*1024,
            metadata:{bucketName:'media',objectName:path,contentType:input.type||'video/mp4',cacheControl:'3600'},
            removeFingerprintOnSuccess:true,
            onError:()=>reject(new Error('Upload interrupted. Check your connection and retry.')),
            onProgress:(sent,total)=>{
              const percent=Math.round((sent/total)*90);
              setProgress(percent);
              const elapsedSec=Math.max(0.1,(Date.now()-startTime)/1000);
              const mbSent=sent/(1024*1024);
              const currentSpeed=mbSent/elapsedSec;
              setSpeed(currentSpeed.toFixed(1));
              const remainingBytes=Math.max(0,total-sent);
              const remainingSec=currentSpeed>0?Math.round((remainingBytes/(1024*1024))/currentSpeed):0;
              setEta(remainingSec);
            },
            onSuccess:resolve
          });
          uploadRef.current=upload;
          upload.findPreviousUploads().then(previous=>{if(previous[0])upload.resumeFromPreviousUpload(previous[0]);upload.start()}).catch(reject);
        });
        uploadRef.current=null;
        unwrap(await supabase.from('media_assets').update({status:'uploaded'}).eq('id',asset.id));
        unwrap(await supabase.from('videos').insert({project_id:project.id,media_asset_id:asset.id,title:name,status:'ready'}));
      }
      const source=unwrap(await supabase.from('project_sources').insert({workspace_id:workspace.id,project_id:project.id,source_type:isFile?'upload':parsed.sourceType,source_url:parsed?.url||null,file_name:isFile?input.name:null,status:'queued'}).select().single());
      const payload={workspaceId:workspace.id,projectId:project.id,sourceId:source.id,mediaAssetId:asset?.id||null,requestedBy:user.id,sourceType:isFile?'upload':parsed.sourceType,url:parsed?.url||null,preferencesRequired:true};
      const job=unwrap(await supabase.from('processing_jobs').insert({workspace_id:workspace.id,project_id:project.id,job_type:'ingest',status:'awaiting_preferences',progress:0,payload}).select().single());
      notify('Source uploaded. Let’s configure your clips in Studio.');
      await supabase.from('projects').update({status:'processing'}).eq('id',project.id);
      setProgress(100);refresh();onOpenChange(false);
      navigate('studio',{project:project.id,job:job.id,afterUpload:'1'});
    }catch(err){
      setError(err.message);
      if(project)await supabase.from('projects').update({status:'upload_failed'}).eq('id',project.id).catch(()=>{});
    }finally{
      setBusy(false);
      uploadRef.current=null;
    }
  }

  const imported=result=>{refresh();onOpenChange(false);notify('Source added. Processing is queued.');navigate('studio',{project:result.projectId,job:result.jobId,afterUpload:'1'})};

  return <Modal open={open} onOpenChange={value=>{if(!busy)onOpenChange(value)}} title="Bring your next recording." description="Upload a video or choose an authorized source. Auto-starts instantly upon selection.">
    <Tabs value={tab} onValueChange={setTab} label="Video import source" items={[{value:'upload',label:'Upload / link'},{value:'drive',label:'Drive'},{value:'photos',label:'Photos'}]}/>
    {error&&<div className="mb-4"><ErrorState message={error} onRetry={()=>setError('')}/></div>}
    {tab==='upload'&&<>
      <DropZone compact initialUrl={typeof initialFile==='string'?initialFile:''} onFile={selected=>{setFile(selected);start(selected)}} onLink={start} busy={busy}/>
      {file&&!busy&&<div className="flex items-center justify-between gap-3 mt-4 text-xs text-muted">
        <span className="truncate">{file.name} · {Math.round(file.size/1048576)} MB</span>
        <span className="text-accent font-medium">Ready</span>
      </div>}
    </>}
    {tab==='drive'&&(demo?<p className="text-muted text-sm">Sign in to choose files from your Google Drive. Sample projects stay local.</p>:<GoogleDriveBrowser workspaceId={workspace.id} userId={user.id} onImported={imported} onError={setError}/>)}
    {tab==='photos'&&(demo?<p className="text-muted text-sm">Sign in to open the authorized Google Photos picker.</p>:<GooglePhotosPicker workspaceId={workspace.id} userId={user.id} onImported={imported} onError={setError}/>)}
    {busy&&<div className="mt-5 space-y-2" role="status">
      <div className="flex justify-between items-center text-xs">
        <span className="font-medium text-foreground">{progress<90?`Uploading: ${progress}%`:'Finalizing source...'}</span>
        <span className="text-muted font-mono">{speed} MB/s · {eta}s ETA</span>
      </div>
      <progress max="100" value={progress} className="w-full h-2 rounded-full overflow-hidden"/>
      <div className="pt-2 flex justify-end">
        <Button variant="ghost" size="sm" onClick={cancelUpload}>Cancel upload</Button>
      </div>
    </div>}
    <p className="text-xs text-muted mt-5">Import only content you own or have permission to use. The server verifies source access and download limits.</p>
  </Modal>;
}
