const HOOK_TERMS = new Set([
  "why","how","secret","mistake","never","best","first","stop","learn","because",
  "truth","problem","solution","important","actually","surprising","instead","remember",
  "imagine","finally","wrong","right","simple","easy","hard","lesson","reason","real"
]);
const EMOTION_TERMS = new Set([
  "love","fear","fail","failure","win","won","lose","lost","amazing","terrible","crazy",
  "shocking","beautiful","danger","dangerous","believe","hope","hate","regret","success"
]);

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function generateLocalClipCandidates(inputWords, sourceDuration = 0, limit = 6) {
  const words = (Array.isArray(inputWords) ? inputWords : [])
    .map((item) => ({
      text: String(item.word ?? item.text ?? "").replace(/\s+/g, " ").trim(),
      start: Number(item.start_ms) / 1000,
      end: Number(item.end_ms) / 1000
    }))
    .filter((item) => item.text && Number.isFinite(item.start) && Number.isFinite(item.end) && item.start >= 0 && item.end > item.start)
    .sort((a, b) => a.start - b.start);

  if (!words.length) return [];
  const duration = Number(sourceDuration) > 0
    ? Number(sourceDuration)
    : Math.max(...words.map((word) => word.end));
  const minDuration = Math.min(15, Math.max(3, duration * 0.65));
  const maxDuration = Math.min(60, duration);
  const stride = Math.max(1, Math.floor(words.length / 160));
  const candidates = [];

  for (let startIndex = 0; startIndex < words.length; startIndex += stride) {
    const start = words[startIndex].start;
    if (start >= duration) break;
    for (let endIndex = startIndex; endIndex < words.length; endIndex++) {
      const end = Math.min(duration, words[endIndex].end);
      const length = end - start;
      if (length > maxDuration) break;
      if (length < minDuration) continue;

      const selected = words.slice(startIndex, endIndex + 1);
      const transcript = selected.map((word) => word.text).join(" ");
      if (transcript.length < 45) continue;
      const tokens = transcript.toLowerCase().match(/[a-z0-9']+/g) || [];
      if (!tokens.length) continue;
      const uniqueRatio = new Set(tokens).size / tokens.length;
      const hookCount = tokens.filter((token) => HOOK_TERMS.has(token)).length;
      const emotionCount = tokens.filter((token) => EMOTION_TERMS.has(token)).length;
      const hasQuestion = /\?/.test(transcript);
      const hasEmphasis = /!/.test(transcript);
      const hasNumber = /\b\d+\b/.test(transcript);
      const durationBonus = length >= 20 && length <= 45 ? 10 : length >= 15 ? 5 : 0;
      const score = Math.round(clamp(
        42 + Math.min(20, hookCount * 5) + Math.min(12, emotionCount * 4) +
        (hasQuestion ? 6 : 0) + (hasEmphasis ? 3 : 0) + (hasNumber ? 3 : 0) +
        Math.round(uniqueRatio * 10) + durationBonus + (start < 20 ? 3 : 0),
        0, 100
      ));
      const title = transcript
        .replace(/[.!?]+/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .split(" ")
        .slice(0, 10)
        .join(" ")
        .replace(/[,;:]+$/g, "");
      const signals = [];
      if (hookCount) signals.push("strong hook language");
      if (emotionCount) signals.push("emotional wording");
      if (hasQuestion) signals.push("question-led moment");
      if (hasNumber) signals.push("specific detail");
      if (uniqueRatio >= 0.62) signals.push("information-dense transcript");
      candidates.push({
        startSeconds: Math.round(start * 100) / 100,
        endSeconds: Math.round(end * 100) / 100,
        title: title ? title.charAt(0).toUpperCase() + title.slice(1) : "Transcript highlight",
        score,
        hook: selected.slice(0, 14).map((word) => word.text).join(" ").slice(0, 180),
        reason: signals.length ? "Local transcript signals: " + signals.join(", ") + "." : "Selected from transcript timing and duration as a review candidate.",
        transcript: transcript.slice(0, 1600),
        analysisType: "local-heuristic"
      });
      if (candidates.length >= 800) break;
    }
    if (candidates.length >= 800) break;
  }

  candidates.sort((a, b) => b.score - a.score || a.startSeconds - b.startSeconds);
  const selected = [];
  const maxResults = clamp(Number(limit) || 6, 1, 12);
  for (const candidate of candidates) {
    const overlaps = selected.some((existing) => {
      const intersection = Math.max(0, Math.min(existing.endSeconds, candidate.endSeconds) - Math.max(existing.startSeconds, candidate.startSeconds));
      const shorter = Math.min(existing.endSeconds - existing.startSeconds, candidate.endSeconds - candidate.startSeconds);
      return shorter > 0 && intersection / shorter > 0.6;
    });
    if (!overlaps) selected.push(candidate);
    if (selected.length >= maxResults) break;
  }
  return selected.sort((a, b) => a.startSeconds - b.startSeconds);
}
