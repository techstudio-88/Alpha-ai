/** Duration-based estimate of likely usable clips; not a guaranteed render count. */
export function estimateClipCountRange(durationSeconds) {
  const seconds = Number(durationSeconds);
  if (!Number.isFinite(seconds) || seconds <= 0) return 'Estimate unavailable';
  const minutes = seconds / 60;
  const minClips = Math.max(1, Math.floor(minutes / 4));
  const maxClips = Math.max(minClips, Math.ceil(minutes / 2.8));
  return minClips === maxClips ? `${minClips} clips` : `${minClips}–${maxClips} clips`;
}
