import test from 'node:test';
import assert from 'node:assert/strict';
import {runPublishQueue} from '../worker/publish.js';
import {encryptCredential} from '../lib/credential-cipher.mjs';

function fixture(resume=false){
  const secret='fixture-secret';let job={id:'job',workspace_id:'workspace',clip_id:'clip',platform:'youtube',status:resume?'processing':'queued',last_attempt_at:'2020-01-01T00:00:00Z',attempt_count:0,metadata:resume?{youtube_upload_session:encryptCredential('https://www.googleapis.com/upload/session',secret)}:{}};
  let initializations=0,streams=0;
  const db=async(table,{method='GET',params={},body}={})=>{
    if(table==='publish_jobs'){
      if(method==='GET')return [{...job}];
      if(params.status!==`eq.${job.status}`)return [];
      if(params.last_attempt_at&&params.last_attempt_at!==`eq.${job.last_attempt_at}`)return [];
      job={...job,...body};return [{...job}];
    }
    if(table==='publish_connections')return [{id:'connection',access_token:'fixture-token',expires_at:'2099-01-01T00:00:00Z'}];
    if(table==='clips')return [{id:'clip',project_id:'project',title:'Fixture clip'}];
    if(table==='projects')return [{id:'project'}];
    if(table==='clip_versions')return [{storage_path:'workspace/project/clip.mp4'}];
    throw new Error('Unexpected table');
  };
  const fetcher=async(url,options={})=>{
    if(url.includes('/object/sign/')&&options.method==='POST')return Response.json({signedURL:'/object/sign/media/file'});
    if(options.method==='HEAD')return new Response(null,{headers:{'content-length':'4'}});
    if(url.includes('uploadType=resumable')){initializations++;return new Response(null,{headers:{location:'https://www.googleapis.com/upload/session'}})}
    if(url.includes('/upload/session')){
      if(options.headers['Content-Length']==='0')return Response.json({id:'youtube-fixture'});
      assert.ok(options.body instanceof ReadableStream,'Upload must stream rather than buffer the entire video');
      streams++;return Response.json({id:'youtube-fixture'});
    }
    return new Response('data');
  };
  return {options:{db,fetcher,secret,supabaseUrl:'https://fixture.supabase.co',headers:{},clientId:'fixture-id',clientSecret:'fixture-client-secret'},get state(){return {job,initializations,streams}}};
}
test('concurrent publishers claim once and stream exactly one YouTube upload',async()=>{
  const f=fixture();await Promise.all([runPublishQueue(f.options),runPublishQueue(f.options)]);
  assert.equal(f.state.job.status,'published',f.state.job.error);
  assert.equal(f.state.initializations,1);assert.equal(f.state.streams,1);assert.equal(f.state.job.status,'published');
});
test('a lost upload response resumes the existing session instead of creating a duplicate',async()=>{
  const f=fixture(true);await runPublishQueue(f.options);
  assert.equal(f.state.job.status,'published',f.state.job.error);
  assert.equal(f.state.initializations,0);assert.equal(f.state.streams,0);assert.equal(f.state.job.external_id,'youtube-fixture');
});
