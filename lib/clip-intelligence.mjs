const hookWords=/\b(why|how|secret|mistake|truth|nobody|actually|imagine|what if|problem|solution)\b/i;
const filler=/^(?:um+|uh+|erm|hmm)[,.!?]*$/i;
// Transcript-derived estimates, not measured audience retention or visual tracking.
export function sentenceMoments(segments,duration,{limit=8,maxDuration=45}={}){
  const rows=segments.filter(s=>Number.isFinite(s.start)&&Number.isFinite(s.end)&&s.end>s.start&&s.start>=0&&s.end<=duration).sort((a,b)=>a.start-b.start);
  const candidates=[];
  for(let i=0;i<rows.length;i++){
    const first=rows[i];if(!String(first.text||'').trim()||filler.test(first.text.trim()))continue;
    // A strong opening is chosen at its own boundary, never by cutting most of a selected story away.
    const group=[];let ending;
    for(let j=i;j<rows.length&&rows[j].end-first.start<=maxDuration;j++){
      group.push(rows[j]);
      if(rows[j].end-first.start>=Math.min(12,duration)&&(/[.!?]["”']?$/.test(rows[j].text.trim())||j===rows.length-1))ending=group.slice();
    }
    if(!ending)continue;
    const end=ending.at(-1).end,text=ending.map(s=>s.text).join(' ').trim();
    const opening=ending.filter(s=>s.start<first.start+3).map(s=>s.text).join(' ');
    const hook=Math.min(95,35+(hookWords.test(opening)?35:0)+(/\?/.test(opening)?15:0)+(opening.split(/\s+/).length>=4?10:0));
    const completeness=/[.!?]["”']?$/.test(text)?85:55;
    candidates.push({start_seconds:first.start,end_seconds:end,hook:opening.slice(0,320),title:first.text.replace(/[.!?]+$/,'').slice(0,100),reason:'Transcript estimate: sentence-bounded opening and a complete ending. Review before publishing.',hook_score:hook,story_completeness:completeness,information_density:Math.min(90,text.split(/\s+/).length/(end-first.start)*24),shareability_score:Math.round((hook+completeness)/2),text});
  }
  return distinctMoments(candidates,limit).map(({text,...candidate})=>candidate);
}
export function distinctMoments(candidates,limit=8){
  const selected=[];
  const tokens=s=>new Set(String(s||'').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(w=>w.length>2));
  for(const candidate of [...candidates].sort((a,b)=>(b.hook_score+b.story_completeness)-(a.hook_score+a.story_completeness))){
    const length=candidate.end_seconds-candidate.start_seconds;if(length<2)continue;
    const words=tokens(candidate.text||candidate.hook);
    if(selected.some(other=>{
      const overlap=Math.max(0,Math.min(candidate.end_seconds,other.end_seconds)-Math.max(candidate.start_seconds,other.start_seconds));
      const otherWords=tokens(other.text||other.hook),intersection=[...words].filter(w=>otherWords.has(w)).length;
      return overlap/Math.min(length,other.end_seconds-other.start_seconds)>.55||(words.size>5&&intersection/Math.max(words.size,otherWords.size)>.85);
    }))continue;
    selected.push(candidate);if(selected.length>=limit)break;
  }
  return selected;
}
export function cleanupSuggestions(words,start,end){
  const selected=words.filter(w=>w.start_ms>=start*1000&&w.end_ms<=end*1000);
  const suggestions=[];
  for(let i=0;i<selected.length;i++){
    const word=selected[i],next=selected[i+1];
    if(filler.test(word.word))suggestions.push({start:word.start_ms/1000,end:word.end_ms/1000,reason:'Filler word'});
    if(next&&next.start_ms-word.end_ms>900)suggestions.push({start:word.end_ms/1000+.12,end:next.start_ms/1000-.12,reason:'Transcript gap — preview audio before removing'});
  }
  return suggestions;
}
