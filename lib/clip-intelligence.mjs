const hookWords = /\b(why|how|secret|mistake|truth|nobody|actually|imagine|what if|problem|solution|stop|never|always|exposed|shocking|insane|biggest)\b/i;
const emotionWords = /\b(crazy|insane|incredible|amazing|love|hate|terrible|huge|secret|danger|disaster|unbelievable|genius|warning|fear|brilliant|mindblowing)\b/i;
const filler = /^(?:um+|uh+|erm|hmm)[,.!?]*$/i;

export function estimateClipCountRange(durationSeconds) {
  const durationMinutes = Math.max(1, Number(durationSeconds || 0) / 60);
  // The processing worker caps each source at 8 selected clips. Keep the
  // estimate consistent with that hard limit rather than promising impossible
  // yields for long recordings.
  const minClips = Math.min(8, Math.max(1, Math.floor(durationMinutes * 0.3)));
  const maxClips = Math.min(8, Math.max(minClips, Math.ceil(durationMinutes * 0.45)));
  return minClips === maxClips ? `${maxClips} clips` : `${minClips} to ${maxClips} clips`;
}

export function compute4PartScores({ text = '', hookText = '', start = 0, end = 0 }) {
  const duration = Math.max(1, end - start);
  const opening = String(hookText || text).slice(0, 200);

  // 1. Hook score (0-100): first 3 seconds strength
  let hook = 40;
  if (hookWords.test(opening)) hook += 30;
  if (/\?/.test(opening)) hook += 15;
  if (/!/.test(opening)) hook += 10;
  if (opening.split(/\s+/).length >= 4) hook += 5;
  const hook_score = Math.min(100, Math.max(10, hook));

  // 2. Flow score (0-100): pacing, completeness & sentence boundary cleanliness
  let flow = 50;
  if (/[.!?]["”']?$/.test(text.trim())) flow += 25;
  const wpm = (text.split(/\s+/).filter(Boolean).length / duration) * 60;
  if (wpm >= 120 && wpm <= 180) flow += 20; // natural conversational pacing
  else if (wpm > 80 && wpm < 220) flow += 10;
  if (!filler.test(text.slice(0, 50))) flow += 5;
  const flow_score = Math.min(100, Math.max(15, flow));

  // 3. Emotion score (0-100): emotional resonance and emphasis
  let emotion = 45;
  const matches = (text.match(new RegExp(emotionWords.source, 'gi')) || []).length;
  emotion += Math.min(40, matches * 15);
  if (/!/.test(text)) emotion += 10;
  if (text.length > 100 && /\b(I|we|you|they)\b/i.test(text)) emotion += 5;
  const emotion_score = Math.min(100, Math.max(10, emotion));

  // 4. Length score (0-100): optimal vertical short-form duration (20-50s)
  let length_score = 50;
  if (duration >= 20 && duration <= 50) {
    length_score = 95;
  } else if (duration >= 15 && duration <= 60) {
    length_score = 80;
  } else if (duration > 60 && duration <= 90) {
    length_score = 65;
  } else {
    length_score = 45;
  }

  // Overall score: weighted composite
  const score = Math.min(100, Math.max(1, Math.round(
    0.35 * hook_score + 0.25 * flow_score + 0.20 * emotion_score + 0.20 * length_score
  )));

  return { hook_score, flow_score, emotion_score, length_score, score };
}

// Cut strictly at sentence boundaries (.!? or pauses >400ms), never mid-word.
export function sentenceMoments(segments, duration, { limit = 8, maxDuration = 45 } = {}) {
  const rows = segments
    .filter(s => Number.isFinite(s.start) && Number.isFinite(s.end) && s.end > s.start && s.start >= 0 && s.end <= duration)
    .sort((a, b) => a.start - b.start);

  const candidates = [];
  for (let i = 0; i < rows.length; i++) {
    const first = rows[i];
    if (!String(first.text || '').trim() || filler.test(first.text.trim())) continue;

    const group = [];
    let ending;
    for (let j = i; j < rows.length && rows[j].end - first.start <= maxDuration; j++) {
      group.push(rows[j]);
      const currentSpan = rows[j].end - first.start;
      const isSentenceEnd = /[.!?]["”']?$/.test(rows[j].text.trim());
      const isNextLongPause = j + 1 < rows.length && (rows[j + 1].start - rows[j].end >= 0.4);

      if (currentSpan >= Math.min(12, duration) && (isSentenceEnd || isNextLongPause || j === rows.length - 1)) {
        ending = group.slice();
      }
    }
    if (!ending) continue;

    const end = ending.at(-1).end;
    const text = ending.map(s => s.text).join(' ').trim();
    const opening = ending.filter(s => s.start < first.start + 3).map(s => s.text).join(' ');

    const scores = compute4PartScores({ text, hookText: opening, start: first.start, end });

    candidates.push({
      start_seconds: first.start,
      end_seconds: end,
      hook: opening.slice(0, 320),
      title: first.text.replace(/[.!?]+$/, '').slice(0, 100),
      reason: `Sentence-bounded cut with ${scores.score}/100 viral score (Hook: ${scores.hook_score}, Flow: ${scores.flow_score}, Emotion: ${scores.emotion_score}, Length: ${scores.length_score}).`,
      ...scores,
      story_completeness: scores.flow_score,
      information_density: Math.min(90, (text.split(/\s+/).length / (end - first.start)) * 24),
      shareability_score: Math.round((scores.hook_score + scores.emotion_score) / 2),
      text,
    });
  }

  return distinctMoments(candidates, limit).map(({ text, ...candidate }) => candidate);
}

export function distinctMoments(candidates, limit = 8) {
  const selected = [];
  const tokens = s => new Set(String(s || '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(w => w.length > 2));
  for (const candidate of [...candidates].sort((a, b) => b.score - a.score)) {
    const length = candidate.end_seconds - candidate.start_seconds;
    if (length < 2) continue;
    const words = tokens(candidate.text || candidate.hook);
    if (
      selected.some(other => {
        const overlap = Math.max(0, Math.min(candidate.end_seconds, other.end_seconds) - Math.max(candidate.start_seconds, other.start_seconds));
        const otherWords = tokens(other.text || other.hook);
        const intersection = [...words].filter(w => otherWords.has(w)).length;
        return (
          overlap / Math.min(length, other.end_seconds - other.start_seconds) > 0.55 ||
          (words.size > 5 && intersection / Math.max(words.size, otherWords.size) > 0.85)
        );
      })
    ) {
      continue;
    }
    selected.push(candidate);
    if (selected.length >= limit) break;
  }
  return selected;
}

export function cleanupSuggestions(words, start, end) {
  const selected = words.filter(w => w.start_ms >= start * 1000 && w.end_ms <= end * 1000);
  const suggestions = [];
  for (let i = 0; i < selected.length; i++) {
    const word = selected[i];
    const next = selected[i + 1];
    if (filler.test(word.word)) {
      suggestions.push({ start: word.start_ms / 1000, end: word.end_ms / 1000, reason: 'Filler word' });
    }
    if (next && next.start_ms - word.end_ms > 900) {
      suggestions.push({ start: word.end_ms / 1000 + 0.12, end: next.start_ms / 1000 - 0.12, reason: 'Transcript gap — silence >900ms' });
    }
  }
  return suggestions;
}

// Generate animated .ass subtitle content with preset styling (pop, bold, minimal)
export function generateAssCaptions(events = [], { stylePreset = 'pop', fontName = 'Inter', primaryColor = '&H00FFFFFF', outlineColor = '&H00000000' } = {}) {
  const styles = {
    pop: {
      fontSize: 56,
      bold: -1,
      primary: '&H0000FFFF', // vibrant yellow highlight
      outline: '&H00000000',
      backColour: '&H80000000',
      borderStyle: 1,
      outlineWidth: 4,
      shadow: 2,
      alignment: 2, // bottom center
      animation: '{\\t(0,70,\\fscx112\\fscy112)\\t(70,140,\\fscx100\\fscy100)}',
    },
    bold: {
      fontSize: 60,
      bold: -1,
      primary: primaryColor,
      outline: outlineColor,
      backColour: '&H00000000',
      borderStyle: 1,
      outlineWidth: 5,
      shadow: 3,
      alignment: 2,
      animation: '',
    },
    minimal: {
      fontSize: 48,
      bold: 0,
      primary: '&H00FFFFFF',
      outline: '&H40000000',
      backColour: '&H00000000',
      borderStyle: 1,
      outlineWidth: 2,
      shadow: 1,
      alignment: 2,
      animation: '',
    },
  };

  const active = styles[stylePreset] || styles.pop;

  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${fontName},${active.fontSize},${active.primary},&H000000FF,${active.outline},${active.backColour},${active.bold},0,0,0,100,100,0,0,${active.borderStyle},${active.outlineWidth},${active.shadow},${active.alignment},40,40,240,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const formatTimeAss = sec => {
    const s = Math.max(0, Number(sec || 0));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const secRemain = s % 60;
    const cs = Math.floor((secRemain % 1) * 100);
    return `${h}:${String(m).padStart(2, '0')}:${String(Math.floor(secRemain)).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
  };

  const lines = events.map(ev => {
    const startStr = formatTimeAss(ev.start);
    const endStr = formatTimeAss(ev.end);
    const textStr = `${active.animation}${ev.word || ev.text || ''}`;
    return `Dialogue: 0,${startStr},${endStr},Default,,0,0,0,,${textStr}`;
  });

  return header + lines.join('\n');
}

// Language detection helper based on common character ranges and words
export function detectLanguage(text = '') {
  const str = String(text || '').trim();
  if (/[\u0900-\u097F]/.test(str)) return 'hi'; // Hindi / Devanagari
  if (/[\u4E00-\u9FFF]/.test(str)) return 'zh'; // Chinese
  if (/[\u3040-\u309F\u30A0-\u30FF]/.test(str)) return 'ja'; // Japanese
  if (/[\u0600-\u06FF]/.test(str)) return 'ar'; // Arabic
  if (/[\u0400-\u04FF]/.test(str)) return 'ru'; // Russian
  if (/\b(el|la|los|las|de|que|y|en|un|es)\b/i.test(str)) return 'es'; // Spanish
  if (/\b(le|la|les|des|un|une|et|en|est)\b/i.test(str)) return 'fr'; // French
  if (/\b(der|die|das|und|ist|in|den|von)\b/i.test(str)) return 'de'; // German
  return 'en'; // default English
}
