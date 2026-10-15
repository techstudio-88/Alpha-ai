"use client";
import {useState} from 'react';
import * as tus from 'tus-js-client';
import {sourceUrl} from '../../lib/video-workflow.mjs';
import {supabase} from '../../lib/supabase';
import GoogleDriveBrowser from '../GoogleDriveBrowser';
import GooglePhotosPicker from '../GooglePhotosPicker';
import {useStudio,unwrap} from './data';
import {Button,DropZone,ErrorState,Modal,Tabs} from './ui';

export default function ImportVideo({open,onOpenChange,file:initialFile}){
  const {workspace,user,demo,refresh,navigate,notify}=useStudio();
  const [tab,setTab]=useState(initialFile?.tab||'upload');const [busy,setBusy]=useState(false);const [progress,setProgress]=useState(0);const [error,setError]=useState('');const [file,setFile]=useState(typeof initialFile?.name==='string'?initialFile:null);const [rightsConfirmed,setRightsConfirmed]=useState(false);
  async function start(input){
    setBusy(true);setError('');setProgress(0);
    let project;
    try{
      if(demo){notify('This is a sample workspace. Sign in to import your own footage.');return}
      const isFile=input instanceof File,parsed=isFile?null:sourceUrl(input);\n      if(!isFile&&!rightsConfirmed)throw new Error('Confirm that you own or have permission to use this content before importing a link.');
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
        await new Promise((resolve,reject)=>{
          const upload=new tus.Upload(input,{endpoint,retryDelays:[0,2000,5000,10000],headers:{authorization:`Bearer ${data.session.access_token}`,apikey:process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY},chunkSize:6*1024*1024,metadata:{bucketName:'media',objectName:path,contentType:input.type||'video/mp4',cacheControl:'3600'},removeFingerprintOnSuccess:true,onError:()=>reject(new Error('Upload interrupted. Check your connection and retry.')),onProgress:(sent,total)=>setProgress(Math.round(sent/total*90)),onSuccess:resolve});
          upload.findPreviousUploads().then(previous=>{if(previous[0])upload.resumeFromPreviousUpload(previous[0]);upload.start()}).catch(reject);
        });
        unwrap(await supabase.from('media_assets').update({status:'uploaded'}).eq('id',asset.id));
        unwrap(await supabase.from('videos').insert({project_id:project.id,media_asset_id:asset.id,title:name,status:'ready'}));
      }
      const source=unwrap(await supabase.from('project_sources').insert({workspace_id:workspace.id,project_id:project.id,source_type:isFile?'upload':parsed.sourceType,source_url:parsed?.url||null,file_name:isFile?input.name:null,status:'queued',metadata:isFile?{}:{rights_confirmed:true,rights_confirmed_at:new Date().toISOString()}}).select().single());
      const payload={workspaceId:workspace.id,projectId:project.id,sourceId:source.id,mediaAssetId:asset?.id||null,requestedBy:user.id,sourceType:isFile?'upload':parsed.sourceType,url:parsed?.url||null,rightsConfirmed:isFile?false:rightsConfirmed,preferencesRequired:true};
      // Hold the durable job until the creator answers (or skips) the optional processing brief.
      // The worker only claims queued jobs, so this cannot start processing behind the chat screen.
      const job=unwrap(await supabase.from('processing_jobs').insert({workspace_id:workspace.id,project_id:project.id,job_type:'ingest',status:'awaiting_preferences',progress:0,payload}).select().single());
      notify('Source uploaded. Let’s tailor the cut before processing.');
      await supabase.from('projects').update({status:'processing'}).eq('id',project.id);
      setProgress(100);refresh();onOpenChange(false);navigate('chat',{project:project.id,job:job.id,afterUpload:'1'});
    }catch(err){const errorId=crypto.randomUUID();const message=String(err?.message||'');setError(/Choose a video under|Choose an MP4|Confirm that you own|Upload interrupted/.test(message)?message:'Import failed. Please retry. Error ID: '+errorId);if(project)await supabase.from('projects').update({status:'upload_failed'}).eq('id',project.id)}finally{setBusy(false)}
  }
  const imported=result=>{refresh();onOpenChange(false);notify('Source added. Processing is queued.');navigate('chat',{project:result.projectId,job:result.jobId})};
  return <Modal open={open} onOpenChange={value=>{if(!busy)onOpenChange(value)}} title="Bring your next recording." description="Upload a video or choose an authorized source. You keep ownership of your footage."><Tabs value={tab} onValueChange={setTab} label="Video import source" items={[{value:'upload',label:'Upload / link'},{value:'drive',label:'Drive'},{value:'photos',label:'Photos'}]}/>{error&&<div className="mb-4"><ErrorState message={error} onRetry={()=>setError('')}/></div>}{tab==='upload'&&<><DropZone compact initialUrl={typeof initialFile==='string'?initialFile:''} onFile={selected=>{setFile(selected);start(selected)}} onLink={start} busy={busy}/>{file&&<div className="mt-3 text-xs text-muted">{file.name} · {Math.round(file.size/1048576)} MB</div>}<label className="mt-4 flex items-start gap-2 text-xs text-muted"><input type="checkbox" checked={rightsConfirmed} onChange={e=>setRightsConfirmed(e.target.checked)} className="mt-0.5"/>I own or have rights to this content. Required before importing a URL.</label></>}{tab==='drive'&&(demo?<p className="text-muted text-sm">Sign in to choose files from your Google Drive. Sample projects stay local.</p>:<GoogleDriveBrowser workspaceId={workspace.id} userId={user.id} onImported={imported} onError={setError}/>)}{tab==='photos'&&(demo?<p className="text-muted text-sm">Sign in to open the authorized Google Photos picker.</p>:<GooglePhotosPicker workspaceId={workspace.id} userId={user.id} onImported={imported} onError={setError}/>)}{busy&&<div className="mt-5" role="status"><progress max="100" value={progress} className="w-full"/><p className="text-xs text-muted mt-2">{progress<90?`Uploading ${progress}%`:'Saving your project…'}</p></div>}<p className="text-xs text-muted mt-5">Import only content you own or have permission to use. The server verifies source access and download limits.</p></Modal>;
}
