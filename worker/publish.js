import {encryptCredential,decryptCredential} from '../lib/credential-cipher.mjs';

const isSealed=value=>String(value||'').startsWith('v1.');
const credential=(value,secret)=>isSealed(value)?decryptCredential(value,secret):value;
const fail=message=>new Error(message);

// Compare-and-set claims prevent two workers from uploading the same queued job.
// A retained resumable session also handles a lost final YouTube response.
export async function runPublishQueue({db,supabaseUrl,headers,secret,fetcher=fetch,
  clientId=process.env.YOUTUBE_CLIENT_ID,clientSecret=process.env.YOUTUBE_CLIENT_SECRET}){
  if(!clientId||!clientSecret||!secret)return;
  const jobs=await db('publish_jobs',{params:{status:'in.(queued,processing)',scheduled_for:'lte.'+new Date().toISOString(),select:'*',order:'created_at.asc',limit:'10'}});
  for(const candidate of jobs||[]){
    if(candidate.status==='processing'&&new Date(candidate.last_attempt_at||0).getTime()>Date.now()-120000)continue;
    const params={id:'eq.'+candidate.id,status:'eq.'+candidate.status};
    if(candidate.status==='processing')params.last_attempt_at=candidate.last_attempt_at?'eq.'+candidate.last_attempt_at:'is.null';
    const claimed=await db('publish_jobs',{method:'PATCH',params,body:{status:'processing',attempt_count:Number(candidate.attempt_count||0)+1,last_attempt_at:new Date().toISOString()}});
    if(!claimed?.length)continue;
    let job=claimed[0];
    const heartbeat=setInterval(()=>db('publish_jobs',{method:'PATCH',params:{id:'eq.'+job.id,status:'eq.processing'},body:{last_attempt_at:new Date().toISOString()}}).catch(()=>{}),20000);
    try{
      if(job.platform!=='youtube')throw fail('Only YouTube publishing is configured.');
      const connection=(await db('publish_connections',{params:{workspace_id:'eq.'+job.workspace_id,platform:'eq.youtube',status:'eq.connected',select:'*',limit:'1'}}))[0];
      if(!connection)throw fail('Connect your YouTube channel before publishing.');
      let access=credential(connection.access_token,secret);
      if(new Date(connection.expires_at||0).getTime()<Date.now()+120000){
        const refresh=credential(connection.refresh_token,secret);
        if(!refresh){await db('publish_connections',{method:'PATCH',params:{id:'eq.'+connection.id},body:{status:'expired'}});throw fail('Your YouTube connection expired. Reconnect the channel.')}
        const response=await fetcher('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:clientId,client_secret:clientSecret,refresh_token:refresh,grant_type:'refresh_token'})});
        const result=await response.json();
        if(!response.ok||!result.access_token){
          await db('publish_connections',{method:'PATCH',params:{id:'eq.'+connection.id},body:{status:'expired'}});
          throw fail('Your YouTube authorization expired. Reconnect the channel.');
        }
        access=result.access_token;
        await db('publish_connections',{method:'PATCH',params:{id:'eq.'+connection.id},body:{access_token:encryptCredential(access,secret),refresh_token:encryptCredential(result.refresh_token||refresh,secret),expires_at:new Date(Date.now()+Number(result.expires_in||3600)*1000).toISOString()}});
      }
      const clip=(await db('clips',{params:{id:'eq.'+job.clip_id,select:'id,title,project_id',limit:'1'}}))[0];
      if(!clip||!(await db('projects',{params:{id:'eq.'+clip.project_id,workspace_id:'eq.'+job.workspace_id,select:'id',limit:'1'}})).length)throw fail('Clip does not belong to this workspace.');
      const version=(await db('clip_versions',{params:{clip_id:'eq.'+clip.id,render_status:'eq.ready',select:'storage_path',order:'version.desc',limit:'1'}}))[0];
      if(!version?.storage_path)throw fail('Render a ready version before publishing.');
      const sign=await fetcher(supabaseUrl+'/storage/v1/object/sign/media/'+version.storage_path,{method:'POST',headers,body:JSON.stringify({expiresIn:3600})});
      const signed=await sign.json();
      const source=signed.signedURL?supabaseUrl+'/storage/v1'+signed.signedURL:signed.signedUrl;
      if(!sign.ok||!source||new URL(source).origin!==new URL(supabaseUrl).origin)throw fail('The rendered clip could not be accessed.');
      const head=await fetcher(source,{method:'HEAD'});
      const size=Number(head.headers.get('content-length'));
      if(!head.ok||!size||size>512*1024*1024)throw fail('The rendered clip size is unavailable or exceeds the publishing limit.');
      let session=job.metadata?.youtube_upload_session?decryptCredential(job.metadata.youtube_upload_session,secret):null;
      let offset=0,result=null;
      if(session){
        const probe=await fetcher(session,{method:'PUT',headers:{'Content-Length':'0','Content-Range':`bytes */${size}`}});
        if(probe.ok)result=await probe.json();
        else if(probe.status===308){const range=probe.headers.get('range')?.match(/bytes=0-(\d+)/);offset=range?Number(range[1])+1:0}
        else throw fail('The saved upload session cannot resume. Check your channel before starting a new upload.');
      }else{
        const metadata=job.metadata||{};
        const response=await fetcher('https://www.googleapis.com/upload/youtube/v3/videos?part=snippet,status&uploadType=resumable',{method:'POST',headers:{Authorization:'Bearer '+access,'Content-Type':'application/json','X-Upload-Content-Type':'video/mp4','X-Upload-Content-Length':String(size)},body:JSON.stringify({snippet:{title:String(metadata.title||clip.title||'Alpha.ai clip').slice(0,100),description:String(metadata.description||'').slice(0,5000)},status:{privacyStatus:['private','unlisted','public'].includes(metadata.privacy)?metadata.privacy:'private',selfDeclaredMadeForKids:false}})});
        session=response.headers.get('location');
        if(!response.ok||!session)throw fail('YouTube could not start the upload. Recheck the channel connection.');
        const endpoint=new URL(session);
        if(endpoint.protocol!=='https:'||!endpoint.hostname.endsWith('.googleapis.com'))throw fail('YouTube returned an unexpected upload endpoint.');
        job={...job,metadata:{...(job.metadata||{}),youtube_upload_session:encryptCredential(session,secret)}};
        await db('publish_jobs',{method:'PATCH',params:{id:'eq.'+job.id,status:'eq.processing'},body:{metadata:job.metadata}});
      }
      if(!result){
        const media=await fetcher(source,{headers:offset?{Range:`bytes=${offset}-`}:undefined});
        if(!media.ok||!media.body||(offset&&media.status!==206))throw fail('The source stream could not resume. Retry the saved upload.');
        const uploaded=await fetcher(session,{method:'PUT',headers:{'Content-Type':'video/mp4','Content-Length':String(size-offset),'Content-Range':`bytes ${offset}-${size-1}/${size}`},body:media.body,duplex:'half',signal:AbortSignal.timeout(30*60*1000)});
        if(!uploaded.ok)throw fail('YouTube has not confirmed the upload. Retry to check the saved session.');
        result=await uploaded.json();
      }
      if(!result.id)throw fail('YouTube did not return a video ID. Retry to check the saved session.');
      await db('publish_jobs',{method:'PATCH',params:{id:'eq.'+job.id,status:'eq.processing'},body:{status:'published',external_id:result.id,published_at:new Date().toISOString(),error:null,metadata:{...job.metadata,youtube_upload_session:null}}});
    }catch(error){
      await db('publish_jobs',{method:'PATCH',params:{id:'eq.'+job.id,status:'eq.processing'},body:{status:'failed',error:error.message}}).catch(()=>{});
    }finally{clearInterval(heartbeat)}
    return; // One streamed upload at a time per worker.
  }
}
