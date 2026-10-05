export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function sourceUrl(value) {
  const url = new URL(String(value).trim());
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || url.username || url.password || url.port ||
      host === "localhost" || host.endsWith(".local") || host.endsWith(".internal") ||
      host.includes(":") || /^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    throw new Error("Use a public HTTPS video or supported sharing URL.");
  }
  const domain = name => host === name || host.endsWith("." + name);
  const sourceType = domain("youtube.com") || host === "youtu.be" ? "youtube" :
    host === "drive.google.com" ? "google_drive" : domain("dropbox.com") ? "dropbox" :
    host === "1drv.ms" || host === "onedrive.live.com" ? "onedrive" : "direct_url";
  url.hash = "";
  return {url: url.toString(), sourceType};
}

export function youtubeVideoUrl(value){
  const parsed=sourceUrl(value);
  if(parsed.sourceType!=='youtube')throw new Error('Use a YouTube video link.');
  const url=new URL(parsed.url),parts=url.pathname.split('/').filter(Boolean);
  const id=url.hostname==='youtu.be'?parts[0]:url.pathname==='/watch'?url.searchParams.get('v'):['shorts','embed','live'].includes(parts[0])?parts[1]:null;
  if(!/^[a-z\d_-]{11}$/i.test(id||''))throw new Error('Use a direct YouTube watch, Shorts, or video link.');
  return 'https://www.youtube.com/watch?v='+id;
}

// Paginate explicitly: Supabase/PostgREST caps individual responses at 1,000 rows.
export async function allPages(readPage, size = 1000) {
  const rows = [];
  for (let offset = 0; ; offset += size) {
    const page = await readPage(offset, size);
    rows.push(...page);
    if (page.length < size) return rows;
  }
}

export function validateEdit(spec, words, duration) {
  if (!Number.isInteger(spec.a) || !Number.isInteger(spec.b) || spec.a < 0 ||
      spec.b < spec.a || spec.b >= words.length) throw new Error("Gemini returned invalid transcript boundaries.");
  const start = Number(words[spec.a].start_ms) / 1000;
  const end = Math.min(Number(words[spec.b].end_ms) / 1000, duration);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end - start < .25)
    throw new Error("Gemini returned an unusable clip range.");
  const number = (value, fallback, min, max) => value == null ? fallback :
    Number.isFinite(Number(value)) ? Math.max(min, Math.min(max, Number(value))) : fallback;
  return {
    ...spec, startSeconds: start, endSeconds: end,
    title: String(spec.title || "Untitled clip").slice(0,180),
    aspect: ["9:16","1:1","16:9"].includes(spec.aspect) ? spec.aspect : "9:16",
    speed: number(spec.speed,1,.5,2), zoom: number(spec.zoom,1,1,1.4),
    score: number(spec.score,0,0,100),
    captions: spec.captions !== false && spec.captionStyle !== "none",
    captionStyle: ["pop","bold","minimal","none"].includes(spec.captionStyle) ? spec.captionStyle : "pop",
    captionColor: /^#[\da-f]{6}$/i.test(spec.captionColor || "") ? spec.captionColor : "#ffffff",
    effect: ["none","cinematic","warm","cool","mono","vibrant"].includes(spec.effect) ? spec.effect : "none",
    transition: ["cut","fade","dip"].includes(spec.transition) ? spec.transition : "cut"
  };
}

export function retainedRanges(start,end,cuts=[]) {
  if(!Array.isArray(cuts)||cuts.length>100)throw new Error('Choose at most 100 cut ranges.');
  const sorted=cuts.map(c=>({start:Number(c.start),end:Number(c.end)})).sort((a,b)=>a.start-b.start);
  let cursor=start;const ranges=[];
  for(const cut of sorted){
    if(!Number.isFinite(cut.start)||!Number.isFinite(cut.end)||cut.start<start||cut.end>end||cut.end<=cut.start)
      throw new Error('Cuts must be valid ranges inside the selected clip.');
    if(cut.start>cursor)ranges.push({start:cursor,end:cut.start});
    cursor=Math.max(cursor,cut.end);
  }
  if(cursor<end)ranges.push({start:cursor,end});
  if(ranges.reduce((n,r)=>n+r.end-r.start,0)<.25)throw new Error('Keep at least a quarter second of the selected clip.');
  return ranges;
}
export function captionEvents(words, start, end, speed = 1, cuts = [], overrides = {}) {
  let offset=0;const events=[];
  for(const range of retainedRanges(start,end,cuts)){
    for(const w of words.filter(w=>w.end_ms>range.start*1000&&w.start_ms<range.end*1000)){
      const begin=Math.max(range.start,w.start_ms/1000),finish=Math.min(range.end,w.end_ms/1000);
      if(finish>begin)events.push({word:String(Object.hasOwn(overrides,w.id)?overrides[w.id]:w.word).replace(/[{}\\\r\n]/g,''),start:(offset+begin-range.start)/speed,end:(offset+finish-range.start)/speed});
    }
    offset+=range.end-range.start;
  }
  return events;
}
