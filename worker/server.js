    if(!asset?.storage_path)throw new Error("Uploaded source has no storage path.");
    await downloadStored(asset.storage_path,input);
  }
  await patchJob(p.jobId,{progress:20});
  const probe=JSON.parse(await cmd("ffprobe",["-v","quiet","-print_format","json","-show_format","-show_streams",input]));
  const stream=probe.streams.find(x=>x.codec_type==="video"),formatDuration=Number(probe.format?.duration||0),streamDuration=Number(stream?.duration||0),duration=Math.max(0,Math.min(...[formatDuration,streamDuration].filter(x=>Number.isFinite(x)&&x>0))),width=Number(stream?.width||0),height=Number(stream?.height||0),fps=Number((stream?.r_frame_rate||"0/1").split("/")[0])/(Number((stream?.r_frame_rate||"0/1").split("/")[1])||1);
  if(!asset){const fileName=(probe.format?.tags?.title||"Imported video").replace(/[^a-zA-Z0-9._ -]/g,"-")+".mp4",storagePath=p.workspaceId+"/"+p.projectId+"/source-"+randomUUID()+".mp4",size=await upload(input,storagePath);asset=(await db("media_assets",{method:"POST",body:{workspace_id:p.workspaceId,project_id:p.projectId,owner_id:p.requestedBy,name:fileName,storage_path:storagePath,mime_type:"video/mp4",size_bytes:size,duration_seconds:duration,status:"uploaded"}}))[0];await db("videos",{method:"POST",body:{project_id:p.projectId,media_asset_id:asset.id,title:fileName.replace(/\.mp4$/,""),duration_seconds:duration,width,height,fps,status:"ready"}})}else{await db("media_assets",{method:"PATCH",params:{id:"eq."+asset.id},body:{duration_seconds:duration,status:"uploaded"}});await db("videos",{method:"PATCH",params:{media_asset_id:"eq."+asset.id},body:{duration_seconds:duration,width,height,fps,status:"ready"}}).catch(()=>{})}
  if(p.sourceId)await db("project_sources",{method:"PATCH",params:{id:"eq."+p.sourceId},body:{status:"downloaded",file_name:asset.name}}).catch(()=>{});
  await patchJob(p.jobId,{progress:35});
  await cmd("ffmpeg",["-y","-i",input,"-vn","-ac","1","-ar","16000","-c:a","pcm_s16le",audio]);
  // Free-tier safe transcription: process short audio windows and checkpoint after every window.
  // If Render restarts, recovery resumes from the last saved window instead of starting Whisper again.
  let transcript=null;
  if(p.transcriptId){