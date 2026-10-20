const MAX_CLIPS_PER_MINUTE = 0.4;
const MAX_AUTO_CLIPS = 12;

function countRange(durationSeconds) {
  const duration = Number(durationSeconds);
  if (!Number.isFinite(duration) || duration <= 0) return null;
  const minutes = duration / 60;
  return {
    min: Math.max(1, Math.floor(minutes * 0.25)),
    max: Math.min(MAX_AUTO_CLIPS, Math.max(2, Math.round(minutes * MAX_CLIPS_PER_MINUTE))),
  };
}

/** Returns a human-readable estimate, or the explicit user-selected count. */
export function estimateClipCountRange(durationSeconds, { clipCount = 'auto' } = {}) {
  const selected = Number(clipCount);
  if (clipCount !== 'auto' && Number.isInteger(selected) && selected > 0) return selected;
  const range = countRange(durationSeconds);
  if (!range) return 'Calculating…';
  return `${range.min}–${range.max} clips`;
}

/** Worker limit: respect explicit choices; otherwise use a duration-based midpoint. */
export function clipLimitForDuration(durationSeconds, { clipCount = 'auto' } = {}) {
  const selected = Number(clipCount);
  if (clipCount !== 'auto' && Number.isInteger(selected) && selected > 0) {
    return Math.min(MAX_AUTO_CLIPS, selected);
  }
  const range = countRange(durationSeconds);
  if (!range) return 1;
  return Math.min(MAX_AUTO_CLIPS, Math.max(1, Math.round((range.min + range.max) / 2)));
}

export function maxClipDurationForPacing(pacing) {
  return ({ tight: 30, auto: 45, story: 60 })[pacing] || 45;
}
