export const DEFAULT_LOCAL_EXPORT_LIMIT = 80 * 1024 * 1024;

export function getLocalExportPolicy({ isMobile = false, deviceMemory = 0, hardwareConcurrency = 0 } = {}) {
  if (isMobile) {
    return { allowed: false, maxBytes: 0, reason: "Local export is desktop-first. Open Alpha.ai on a desktop to export locally; mobile support will follow." };
  }

  const memory = Number(deviceMemory) || 0;
  const cores = Number(hardwareConcurrency) || 0;
  if ((memory > 0 && memory < 4) || (cores > 0 && cores < 4)) {
    return { allowed: true, maxBytes: 48 * 1024 * 1024, reason: "Low-resource desktop detected; local export is limited to 48 MB to reduce the risk of freezing." };
  }
  if (memory >= 8 && cores >= 8) {
    return { allowed: true, maxBytes: 200 * 1024 * 1024, reason: "Local export is limited to 200 MB to protect browser memory." };
  }
  if (memory >= 4 && cores >= 4) {
    return { allowed: true, maxBytes: 120 * 1024 * 1024, reason: "Local export is limited to 120 MB to protect browser memory." };
  }
  return { allowed: true, maxBytes: DEFAULT_LOCAL_EXPORT_LIMIT, reason: "Device capacity is unknown; local export is limited to 80 MB for safety." };
}

export function createTrimArguments(startSeconds, endSeconds) {
  const start = Number(startSeconds);
  const end = Number(endSeconds);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) {
    throw new Error("Choose a valid clip range before exporting.");
  }
  return [
    "-i", "input.mp4",
    "-ss", String(start),
    "-t", String(end - start),
    "-map", "0:v:0?",
    "-map", "0:a:0?",
    "-c:v", "libx264",
    "-preset", "ultrafast",
    "-crf", "28",
    "-c:a", "aac",
    "-b:a", "96k",
    "-movflags", "+faststart",
    "output.mp4"
  ];
}

export async function readResponseWithinLimit(response, maxBytes) {
  if (!response?.ok) throw new Error("Could not download the source video for local processing.");
  const declaredLength = Number(response.headers?.get?.("content-length") || 0);
  if (declaredLength > maxBytes) {
    throw new Error(`This video exceeds the safe local-export limit of ${Math.floor(maxBytes / (1024 * 1024))} MB. Use a smaller source or another supported processing option.`);
  }

  if (!response.body?.getReader) {
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > maxBytes) throw new Error("This video exceeds the safe local-export memory limit.");
    return new Uint8Array(buffer);
  }

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new Error(`This video exceeds the safe local-export limit of ${Math.floor(maxBytes / (1024 * 1024))} MB. Use a smaller source or another supported processing option.`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock?.();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
