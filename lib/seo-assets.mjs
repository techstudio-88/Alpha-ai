function responseText(response) {
  if (typeof response === 'string') return response;
  if (typeof response?.text === 'string') return response.text;
  const parts = response?.candidates?.[0]?.content?.parts;
  if (Array.isArray(parts)) return parts.map(part => part?.text || '').join('\n');
  return '';
}
function parseJsonWithRepair(raw) {
  const fence = String.fromCharCode(96).repeat(3);
  const cleaned = String(raw || '').replace(new RegExp('^\\s*' + fence + '(?:json)?\\s*', 'i'), '').replace(new RegExp('\\s*' + fence + '\\s*$'), '').trim();
  const start = cleaned.indexOf('{'), end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) throw Object.assign(new Error('AI returned no structured SEO data. Retry generation.'), { status: 502 });
  const candidate = cleaned.slice(start, end + 1);
  try { return JSON.parse(candidate); }
  catch {
    try { return JSON.parse(candidate.replace(/,\s*([}\]])/g, '$1').replace(/[“”]/g, '"').replace(/[‘’]/g, "'")); }
    catch { throw Object.assign(new Error('AI returned invalid SEO JSON. Retry generation.'), { status: 502 }); }
  }
}
export function parseSeoModelResponse(response, fallbackTitle = '') {
  const parsed = parseJsonWithRepair(responseText(response));
  const str = (value, max, fallback = '') => String(value ?? fallback).trim().slice(0, max);
  const hashtags = Array.isArray(parsed.hashtags) ? parsed.hashtags : typeof parsed.hashtags === 'string' ? parsed.hashtags.split(/[ ,\n]+/) : [];
  const social = parsed.social_copy && typeof parsed.social_copy === 'object' ? parsed.social_copy : {};
  return {
    hook: str(parsed.hook, 500), title: str(parsed.title, 100, fallbackTitle), caption: str(parsed.caption || parsed.instagram_caption, 2200),
    hashtags: [...new Set(hashtags.map(tag => str(tag, 80).replace(/^#+/, '')).filter(Boolean))].slice(0, 15),
    youtube_description: str(parsed.youtube_description || social.youtube, 5000),
    instagram_caption: str(parsed.instagram_caption || social.instagram || parsed.caption, 2200),
    tiktok_caption: str(parsed.tiktok_caption || social.tiktok, 2200), linkedin_caption: str(parsed.linkedin_caption || social.linkedin, 3000),
    thumbnail_prompt: str(parsed.thumbnail_prompt, 2000),
  };
}
