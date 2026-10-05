import {retainedRanges} from './video-workflow.mjs';

export function normalizeEditorDraft(input, duration, words) {
  const start=Number(input.start??input.startSeconds), end=Number(input.end??input.endSeconds);
  if(!Number.isFinite(duration)||!Number.isFinite(start)||!Number.isFinite(end)||start<0||end>duration+.01||end-start<.25)
    throw new Error('Choose a valid range inside the source video.');
  const cutRanges=input.cutRanges||[];
  retainedRanges(start,end,cutRanges);
  const overrides=input.captionOverrides||{};
  if(typeof overrides!=='object'||Array.isArray(overrides)||Object.keys(overrides).length>2000)
    throw new Error('Caption corrections must be a map of transcript words.');
  const ids=words&&new Set(words.map(w=>String(w.id)));
  const captionOverrides=Object.fromEntries(Object.entries(overrides).map(([id,text])=>{
    if((ids&&!ids.has(id))||typeof text!=='string'||!text.trim()||text.length>80||/[{}\\\r\n]/.test(text))
      throw new Error('Use a valid transcript word and a caption correction of 1–80 characters.');
    return [id,text.trim()];
  }));
  const number=(value,min,max,fallback)=>value==null?fallback:Number.isFinite(Number(value))?Math.min(max,Math.max(min,Number(value))):fallback;
  return {start,end,title:String(input.title||'Edited clip').slice(0,180),
    aspect:['9:16','16:9','1:1'].includes(input.aspect)?input.aspect:'9:16',
    speed:number(input.speed,.5,2,1),zoom:number(input.zoom,1,1.4,1),
    effect:['none','cinematic','warm','cool','mono','vibrant'].includes(input.effect)?input.effect:'none',
    transition:['cut','fade','dip'].includes(input.transition)?input.transition:'cut',
    autoReframe:input.autoReframe!==false,
    captionStyle:input.captions===false?'none':['pop','bold','minimal','none'].includes(input.captionStyle)?input.captionStyle:'pop',
    captionColor:/^#[\da-f]{6}$/i.test(input.captionColor||'')?input.captionColor:'#ffffff',
    cutRanges,captionOverrides};
}

export function editedDuration(draft) {
  return retainedRanges(draft.start,draft.end,draft.cutRanges).reduce((sum,r)=>sum+r.end-r.start,0)/draft.speed;
}

export function splitEditorDraft(draft, at) {
  const ranges=retainedRanges(draft.start,draft.end,draft.cutRanges);
  if(at==null){
    let half=ranges.reduce((sum,r)=>sum+r.end-r.start,0)/2;
    for(const r of ranges){if(half<=r.end-r.start){at=r.start+half;break}half-=r.end-r.start;}
  }
  at=Number(at);
  if(!Number.isFinite(at)||at<=draft.start||at>=draft.end)throw new Error('Place the split inside the selected clip.');
  return [[draft.start,at],[at,draft.end]].map(([start,end],i)=>{
    const cutRanges=draft.cutRanges.map(r=>({start:Math.max(r.start,start),end:Math.min(r.end,end)})).filter(r=>r.end>r.start);
    return normalizeEditorDraft({...draft,start,end,cutRanges,title:`${draft.title} · Part ${i+1}`},draft.end);
  });
}

// Concrete actions are deterministic; open-ended editorial requests use Gemini.
// Return null unless every clause is understood, so unsupported actions are never silently ignored.
export function planEditorCommand(prompt,draft,words=[]) {
  const text=String(prompt||'').trim().replace(/[.!]+$/,'').replace(/^(?:please|can you|could you)\s+/i,'');
  let patch={},split=false,at;
  const replace=text.match(/^(?:replace|change)\s+["“]([^"”]+)["”]\s+(?:with|to)\s+["“]([^"”]+)["”](?:\s+in\s+(?:the\s+)?captions)?$/i);
  if(replace){
    const matched=words.filter(w=>w.end_ms>draft.start*1000&&w.start_ms<draft.end*1000&&String(draft.captionOverrides[w.id]??w.word).replace(/[.,!?]+$/,'').toLowerCase()===replace[1].toLowerCase());
    if(!matched.length)throw new Error(`“${replace[1]}” was not found in the selected clip’s caption words.`);
    const next=normalizeEditorDraft({...draft,captionOverrides:{...draft.captionOverrides,...Object.fromEntries(matched.map(w=>[w.id,replace[2]]))}},draft.end,words);
    return {summary:`Proposed ${matched.length} caption correction${matched.length===1?'':'s'}. The source transcript stays intact.`,parts:[next],engine:'commands'};
  }
  for(const part of text.split(/\s+(?:and|then|also)\s+|[;\n]/i).map(s=>s.trim()).filter(Boolean)){
    let match;
    if((match=part.match(/^(?:split|divide|cut)\s+(?:(?:(?:this|the|selected|my)\s+)?(?:clip|video|it)\s+)?(?:into|in|to)\s+(?:two|2)(?:\s+(?:parts|clips|halves|pieces))?(?:\s+at\s+(\d+(?:\.\d+)?)(?:\s*(?:s|seconds?))?)?$/i))){split=true;at=match[1]==null?undefined:Number(match[1]);}
    else if(/^(?:remove|hide|disable|turn off)\s+(?:the\s+)?(?:captions|subtitles|cc)$/i.test(part))patch.captionStyle='none';
    else if(/^(?:add|show|enable|turn on)\s+(?:the\s+)?(?:captions|subtitles|cc)$/i.test(part))patch.captionStyle='pop';
    else if((match=part.match(/^(?:make\s+(?:the\s+)?captions|(?:set|change)\s+(?:the\s+)?caption(?:s| style)\s+to)\s+(bold|minimal|pop|word pop|none)$/i)))patch.captionStyle=match[1].toLowerCase()==='word pop'?'pop':match[1].toLowerCase();
    else if((match=part.match(/^(?:set|change|make)\s+(?:the\s+)?caption(?:s| color)(?:\s+to)?\s+(#[\da-f]{6}|white|yellow|lime|red|blue)$/i))){const colors={white:'#ffffff',yellow:'#ffdd00',lime:'#c6f432',red:'#ff5555',blue:'#55aaff'};patch.captionColor=colors[match[1].toLowerCase()]||match[1];}
    else if((match=part.match(/^(?:set|change)\s+(?:the\s+)?(?:playback\s+)?speed\s+(?:to\s+)?(\d+(?:\.\d+)?)\s*x?$/i))){const speed=Number(match[1]);if(speed<.5||speed>2)throw new Error('Playback speed must be between 0.5× and 2×.');patch.speed=speed;}
    else if((match=part.match(/^make\s+(?:it|this clip|the clip)\s+(vertical|square|landscape)$/i)))patch.aspect={vertical:'9:16',square:'1:1',landscape:'16:9'}[match[1].toLowerCase()];
    else return null;
  }
  if(!text)return null;
  const next=normalizeEditorDraft({...draft,...patch},draft.end,words.length?words:undefined);
  return {summary:split?'Proposed two separate clips. Review each part before rendering.':'Proposed changes are ready to preview. Render to create an exported version.',parts:split?splitEditorDraft(next,at):[next],engine:'commands'};
}

export function editorHistory(state,action) {
  if(action.type==='reset')return {present:action.value,past:[],future:[]};
  if(action.type==='undo')return state.past.length?{present:state.past.at(-1),past:state.past.slice(0,-1),future:[state.present,...state.future]}:state;
  if(action.type==='redo')return state.future.length?{present:state.future[0],past:[...state.past,state.present],future:state.future.slice(1)}:state;
  if(action.type==='edit'&&JSON.stringify(action.value)!==JSON.stringify(state.present))return {present:action.value,past:[...state.past,state.present].slice(-50),future:[]};
  return state;
}
