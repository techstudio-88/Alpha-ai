import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeEditorDraft,planEditorCommand,splitEditorDraft,editedDuration,editorHistory} from '../lib/editor-assistant.mjs';
import {captionEvents} from '../lib/video-workflow.mjs';
import {enqueueEditorRender} from '../lib/editor-render.mjs';

const draft=normalizeEditorDraft({start:10,end:20,title:'Selected clip',speed:2,cutRanges:[{start:12,end:14}],captionOverrides:{}},30);
const clip={id:'11111111-1111-4111-8111-111111111111',project_id:'project',media_asset_id:'asset',start_seconds:10,end_seconds:20};
const body={workspaceId:'workspace',projectId:'project',mediaAssetId:'asset',clipId:clip.id,parts:splitEditorDraft(draft)};

test('split clips preserve all retained source frames and divide actual edited duration equally',()=>{
  const parts=splitEditorDraft(draft);
  assert.equal(parts[0].end,16);assert.equal(parts[1].start,16);
  assert.equal(parts[0].start,draft.start);assert.equal(parts[1].end,draft.end);
  assert.equal(editedDuration(parts[0]),2);assert.equal(editedDuration(parts[1]),2);
  assert.deepEqual(parts[0].cutRanges,draft.cutRanges);assert.deepEqual(parts[1].cutRanges,[]);
  assert.throws(()=>splitEditorDraft(draft,10.1),/valid range/);
});
test('common assistant commands compose split/caption operations and never partially apply unsupported instructions',()=>{
  const result=planEditorCommand('Split it in two parts and remove captions',draft);
  assert.equal(result.parts.length,2);assert.ok(result.parts.every(p=>p.captionStyle==='none'));
  assert.equal(result.engine,'commands');assert.match(result.summary,/Proposed/);
  assert.equal(planEditorCommand('Remove captions and add music',draft),null);
  assert.equal(planEditorCommand('Do not remove captions',draft),null);
  assert.equal(planEditorCommand('Make captions bold',draft).parts[0].captionStyle,'bold');
  assert.equal(planEditorCommand('Change caption color to yellow',draft).parts[0].captionColor,'#ffdd00');
  assert.throws(()=>planEditorCommand('Set speed to 8x',draft),/between/);
});
test('caption corrections change rendered text, preserve transcript/audio boundaries and survive cut/speed retiming',()=>{
  const words=[{id:'one',word:'question.',start_ms:15000,end_ms:16000},{id:'two',word:'cut',start_ms:12500,end_ms:13000}];
  const result=planEditorCommand('Replace "question" with "idea"',draft,words);
  assert.equal(words[0].word,'question.');assert.deepEqual(result.parts[0].cutRanges,draft.cutRanges);
  assert.deepEqual(captionEvents(words,10,20,2,draft.cutRanges,result.parts[0].captionOverrides),[{word:'idea',start:1.5,end:2}]);
  assert.throws(()=>normalizeEditorDraft({...draft,captionOverrides:{unknown:'bad'}},30,words),/valid transcript word/);
  assert.throws(()=>normalizeEditorDraft({...draft,captionOverrides:{one:'{\\pos(1,1)}injected'}},30,words),/caption correction/);
  assert.throws(()=>planEditorCommand('Replace "imaginary" with "invented"',draft,words),/not found/);
});
test('assistant and manual changes share bounded undo/redo, including multi-clip drafts',()=>{
  const initial={draft,parts:[],activePart:-1};
  let state=editorHistory(null,{type:'reset',value:initial});
  const parts=splitEditorDraft(draft);
  const split={draft:parts[0],parts,activePart:0};
  state=editorHistory(state,{type:'edit',value:split});
  state=editorHistory(state,{type:'undo'});assert.deepEqual(state.present,initial);
  state=editorHistory(state,{type:'redo'});assert.deepEqual(state.present,split);
  state=editorHistory(state,{type:'undo'});
  state=editorHistory(state,{type:'edit',value:{...initial,draft:{...draft,captionStyle:'none'}}});
  assert.equal(state.future.length,0);
});

function store({pending=[],clips=[clip],words=[{id:'word'}]}={}){
  const writes=[],wakes=[],capabilities=[];
  const tables={clips,processing_jobs:pending,transcripts:[{id:'transcript',media_asset_id:'asset'}],transcript_words:words};
  const admin={from(table){
    const filters=[];let inserted,one=false,or='';
    const query={select(){return query},order(){return query},limit(){return query},range(){return query},
      eq(key,value){filters.push([key,value]);return query},in(){return query},or(value){or=value;return query},
      maybeSingle(){one=true;return query},insert(value){inserted=value;return query},
      then(resolve,reject){
        let rows=tables[table]||[];
        if(inserted){writes.push({table,rows:inserted});rows=inserted.map((r,i)=>({...r,id:'job-'+i}));}
        else rows=rows.filter(row=>filters.every(([key,value])=>key==='workspace_id'||key==='transcript_id'||row[key]===value));
        if(or)rows=rows.filter(row=>row.payload?.clipId===clip.id||row.payload?.sourceClipId===clip.id);
        return Promise.resolve({data:one?rows[0]||null:rows,error:null}).then(resolve,reject);
      }};
    return query;
  }};
  return {admin,writes,wakes,capabilities,user:{id:'user'},token:'test-token',asset:{id:'asset',duration_seconds:30},
    requireCapability:async c=>capabilities.push(c),wake:async p=>{wakes.push(p);return 'Worker sleeping; queue saved.'}};
}
test('a multi-clip request is validated completely and persisted in one durable queue insert before one wake',async()=>{
  const deps=store();
  const result=await enqueueEditorRender({...deps,body});
  assert.equal(deps.writes.length,1);assert.equal(deps.writes[0].rows.length,2);assert.equal(deps.wakes.length,1);
  assert.equal(result.jobIds.length,2);assert.match(result.warning,/queue saved/);
  const payloads=deps.writes[0].rows.map(r=>r.payload);
  assert.ok(payloads.every(p=>p.clipId===null&&p.sourceClipId===clip.id&&p.requestedBy==='user'));
  assert.notEqual(payloads[0].newClipId,payloads[1].newClipId);
  assert.deepEqual(deps.capabilities,['transcript-cuts','editor-batch-render']);
});
test('invalid later parts, foreign clips, and stale-worker capabilities leave the queue untouched',async()=>{
  for(const input of [{...body,parts:[body.parts[0],{...body.parts[1],end:31}]},{...body,parts:[{...draft,start:0}]},{...body,clipId:'foreign'}]){
    const deps=store();await assert.rejects(enqueueEditorRender({...deps,body:input}));assert.equal(deps.writes.length,0);assert.equal(deps.wakes.length,0);
  }
  const deps=store();
  await assert.rejects(enqueueEditorRender({...deps,body,requireCapability:async()=>{throw new Error('Worker updating')}}),/updating/);
  assert.equal(deps.writes.length,0);
});
test('pending split renders are found by source clip and rejected before another request is queued',async()=>{
  const deps=store({pending:[{id:'existing',payload:{clipId:null,sourceClipId:clip.id}}]});
  await assert.rejects(enqueueEditorRender({...deps,body}),/already has a render/);assert.equal(deps.writes.length,0);
});
test('caption changes cannot refer to word IDs from another transcript',async()=>{
  const deps=store();
  await assert.rejects(enqueueEditorRender({...deps,body:{...body,parts:[{...draft,captionOverrides:{foreign:'new text'}}]}}),/valid transcript word/);
  assert.equal(deps.writes.length,0);
});
