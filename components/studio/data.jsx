"use client";
import {createContext,useCallback,useContext,useEffect,useRef,useState} from 'react';
import {supabase} from '../../lib/supabase';

export const StudioContext=createContext(null);
export const useStudio=()=>useContext(StudioContext);
export function unwrap(result){if(result.error)throw new Error(result.error.message);return result.data||[]}
export async function studioApi(path,{body,method,signal}={}){
  if(!supabase)throw new Error('Sign-in is not configured in this environment.');
  const {data}=await supabase.auth.getSession();
  if(!data.session?.access_token)throw new Error('Your session expired. Sign in to continue.');
  const response=await fetch(path,{method:method||(body?'POST':'GET'),headers:{Authorization:`Bearer ${data.session.access_token}`,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,cache:'no-store',signal:signal||AbortSignal.timeout(25000)});
  const result=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(result.error||`The request could not finish (${response.status}).`);
  return result;
}
export function useResource(load,deps=[]){
  const [state,setState]=useState({loading:true,error:'',data:null});const [revision,setRevision]=useState(0);const loader=useRef(load);loader.current=load;
  useEffect(()=>{let alive=true;setState(s=>({...s,loading:true,error:''}));Promise.resolve().then(()=>loader.current()).then(data=>{if(alive)setState({data,loading:false,error:''})}).catch(error=>{if(alive)setState({data:null,loading:false,error:error.message||'Could not load your data.'})});return()=>{alive=false}},[...deps,revision]);
  const retry=useCallback(()=>setRevision(v=>v+1),[]);
  return {...state,retry};
}
const projectId='11111111-1111-4111-8111-111111111111';
const assetId='33333333-3333-4333-8333-333333333333';
const sampleWords='The best ideas start with a question. Not a perfect plan. If you wait until you know everything, you never start. Make the first move smaller. Give yourself permission to learn along the way.'.split(' ').map((word,i)=>({id:`word-${i}`,word,start_ms:i*1000,end_ms:i*1000+850,speaker:'Speaker 1'}));
export const SAMPLE={
  projects:[{id:projectId,name:'The Long Game · Episode 24',status:'ready',created_at:'2026-10-02T08:00:00Z',thumbnail:'/studio-sample.svg'},
    {id:'22222222-2222-4222-8222-222222222222',name:'Building a studio that lasts',status:'processing',created_at:'2026-10-03T08:00:00Z',thumbnail:'/studio-sample.svg'}],
  clips:[['A question beats a perfect plan',94,0,18],['The hidden cost of waiting',91,9,28],['Make the first move smaller',88,21,37],['Give yourself permission to learn',86,27,38]].map(([title,score,start,end],i)=>({id:`clip-${i}`,project_id:projectId,media_asset_id:assetId,title,score,start_seconds:start,end_seconds:end,status:'ready',thumbnail:'/studio-sample.svg',created_at:'2026-10-02T10:00:00Z',clip_versions:[],clip_scores:[{score,hook_score:score,clarity_score:92,reason:'A specific opening question, a complete thought, and an actionable takeaway. Sample editorial score.'}]})),
  processing_jobs:[{id:'job-1',project_id:projectId,status:'completed',progress:100,current_stage:'completed',payload:{transcribeChunk:48,transcriptionTotalChunks:48}},
    {id:'job-2',project_id:'22222222-2222-4222-8222-222222222222',status:'processing',progress:49,current_stage:'transcription',payload:{transcribeChunk:12,transcriptionTotalChunks:38}}],
  processing_stages:[{stage_key:'media_inspection',status:'completed',progress:100},{stage_key:'transcription',status:'completed',progress:100},{stage_key:'clip_scoring',status:'completed',progress:100},{stage_key:'clip_render',status:'completed',progress:100}],
  media_assets:[{id:assetId,project_id:projectId,duration_seconds:38,name:'podcast-ep-24.mp4',status:'uploaded'}],
  transcript_words:sampleWords,
  clip_versions:[{id:'version-1',version:1,render_status:'ready',created_at:'2026-10-02T10:00:00Z',edit_data:{aspect:'9:16',speed:1}}],
  publish_jobs:[{id:'post-1',clip_id:'clip-0',platform:'youtube',status:'queued',scheduled_for:new Date(new Date().getFullYear(),new Date().getMonth(),new Date().getDate()+1,10).toISOString(),metadata:{title:'A question beats a perfect plan',description:'A conversation about making the first move.',privacy:'private'}}],
  publish_connections:[{id:'channel-1',platform:'youtube',status:'connected',display_name:'The Long Game'}],
  brand_kit_profiles:[{id:'brand-1',name:'The Long Game',primary_color:'#C6F432',secondary_color:'#FFFFFF',font_family:'Inter',caption_style:'pop',intro_text:'',outro_text:'',logo_path:''}],
  workspace_members:[{user_id:'sample-user',role:'owner',created_at:'2026-09-01T00:00:00Z'}],
  api_keys:[],
  analytics:[],
  content_performance:Array.from({length:18},(_,i)=>({id:`metric-${i}`,clip_id:`clip-${i%3}`,platform:'youtube',title:['A question beats a perfect plan','The hidden cost of waiting','Make the first move smaller'][i%3],captured_at:new Date(2026,9,Math.floor(i/3)+1,12).toISOString(),views:800+i*230,likes:40+i*8,comments:5+i,shares:4+i,retention:62+i%5*3})).reverse(),
};
export function useRows(table,select='*',{projectId,order='created_at',poll=false}={}){
  const {workspace,demo,revision,state}=useStudio();
  const result=useResource(async()=>{
    if(demo)return state==='empty'?[]:(SAMPLE[table]||[]).filter(row=>!projectId||!row.project_id||row.project_id===projectId);
    if(!workspace?.id)return [];
    let query=supabase.from(table).select(select);
    if(table==='clips')query=query.eq('projects.workspace_id',workspace.id);
    else query=query.eq('workspace_id',workspace.id);
    if(projectId)query=query.eq('project_id',projectId);
    return unwrap(await query.order(order,{ascending:false}).limit(100));
  },[workspace?.id,demo,table,projectId,revision,state]);
  useEffect(()=>{if(!poll||demo)return;const timer=setInterval(result.retry,6000);return()=>clearInterval(timer)},[poll,demo,result.retry]);
  return result;
}
export function useClipSources(clips=[]){
  const {demo}=useStudio();const [sources,setSources]=useState({});
  const key=clips.map(c=>`${c.id}:${[...(c.clip_versions||[])].sort((a,b)=>b.version-a.version).map(v=>`${v.version}:${v.render_status}:${v.storage_path||''}`).join(',')}`).join('|');
  useEffect(()=>{let alive=true;if(demo){setSources({});return}const load=()=>Promise.all(clips.map(async clip=>{const versions=[...(clip.clip_versions||[])].sort((a,b)=>b.version-a.version);const path=versions.find(v=>v.storage_path&&v.render_status==='ready')?.storage_path;if(!path)return [clip.id,''];const {data}=await supabase.storage.from('media').createSignedUrl(path,900);return [clip.id,data?.signedUrl||'']})).then(entries=>{if(alive)setSources(Object.fromEntries(entries))}).catch(()=>{});load();const timer=setInterval(load,12*60*1000);return()=>{alive=false;clearInterval(timer)}},[key,demo]);
  return sources;
}
