export const DEFAULT_PREFERENCES=Object.freeze({platform:'both',captions:true,captionStyle:'pop',clipCount:'auto',clipPacing:'auto',aspect:'9:16',autoReframe:true,broll:false,transition:'cut',naming:'numbered',includeCopy:true,includeCaptions:true,includeThumbnail:true});
const choices={platform:['both','youtube','instagram'],captionStyle:['pop','bold','minimal'],clipCount:['auto','3','5','7'],clipPacing:['tight','auto','story'],aspect:['9:16','1:1','16:9'],transition:['cut','fade','dip'],naming:['numbered','title']};
export function normalizePreferences(input={}){
  const result={...DEFAULT_PREFERENCES};
  for(const [key,values] of Object.entries(choices))if(values.includes(String(input[key])))result[key]=String(input[key]);
  for(const key of ['captions','autoReframe','broll','includeCopy','includeCaptions','includeThumbnail'])if(typeof input[key]==='boolean')result[key]=input[key];
  return result;
}
export function relevantQuestions({duration=0,hasSpeech=null,speakers=0,answered={},phase='creation'}={}){
  const questions=[];
  const add=(id,title,description,options)=>{if(!Object.hasOwn(answered,id))questions.push({id,title,description,options:options.map(([value,label])=>({value,label}))})};
  if(phase==='export'){
    add('naming','How should the clip folders be named?','Each ready clip gets its own folder.',[['numbered','Clip_01, Clip_02…'],['title','Use each clip title']]);
    add('includeCopy','Include platform posting copy?','Separate YouTube and Instagram files, where generated copy is available.',[[true,'Include posting copy'],[false,'Video files only']]);
    if(hasSpeech===true)add('includeCaptions','Include downloadable subtitles?','Add timed SRT subtitles alongside the video.',[[true,'Include SRT files'],[false,'No subtitle files']]);
    add('includeThumbnail','Include available covers?','Only generated covers are included; missing images are not fabricated.',[[true,'Include covers'],[false,'Skip covers']]);
  }else{
    add('platform','Where will these clips go?','This sets the intended destinations for your posting package.',[['both','Shorts + Reels'],['youtube','YouTube Shorts'],['instagram','Instagram Reels']]);
    if(duration>=120)add('clipCount','How many moments should Alpha look for?','Quality first: fewer clips may be returned when the source has fewer complete moments.',[['auto','Let Alpha choose'],['3','Up to 3'],['5','Up to 5'],['7','Up to 7']]);
    if(hasSpeech===true)add('captions','Add captions to the spoken moments?','Timed captions are on by default. No decorative effects are added automatically.',[[true,'Add captions'],[false,'No captions']]);
    if(speakers>1)add('autoReframe','How should this conversation be framed?','Speaker-guided crop analysis is used when the worker supports it.',[[true,'Follow the speaker'],[false,'Keep centered framing']]);
  }
  return questions;
}
