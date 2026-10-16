export const DEFAULT_LOCAL_EXPORT_LIMIT = 80 * 1024 * 1024;
const MB = 1024 * 1024;

export function getLocalExportPolicy({ isMobile = false, deviceMemory = 0, hardwareConcurrency = 0 } = {}) {
  const memory = Number(deviceMemory) || 0;
  const cores = Number(hardwareConcurrency) || 0;

  if (isMobile) {
    if ((memory > 0 && memory < 4) || (cores > 0 && cores < 4)) {
      return { allowed: true, maxBytes: 12 * MB, reason: "Mobile local export is enabled with a 12 MB source limit on lower-resource devices." };
    }
    if (memory >= 8 && cores >= 8) {
      return { allowed: true, maxBytes: 48 * MB, reason: "Mobile local export is enabled with a conservative 48 MB source limit." };
    }
    return { allowed: true, maxBytes: 20 * MB, reason: "Mobile local export is enabled with a conservative 20 MB source limit to protect browser memory." };
  }

  if ((memory > 0 && memory < 4) || (cores > 0 && cores < 4)) {
    return { allowed: true, maxBytes: 48 * MB, reason: "Low-resource desktop detected; local export is limited to 48 MB to reduce the risk of freezing." };
  }
  if (memory >= 8 && cores >= 8) {
    return { allowed: true, maxBytes: 200 * MB, reason: "Local export is limited to 200 MB to protect browser memory." };
  }
  if (memory >= 4 && cores >= 4) {
    return { allowed: true, maxBytes: 120 * MB, reason: "Local export is limited to 120 MB to protect browser memory." };
  }
  return { allowed: true, maxBytes: DEFAULT_LOCAL_EXPORT_LIMIT, reason: "Device capacity is unknown; local export is limited to 80 MB for safety." };
}

export function createTrimArguments(startSeconds, endSeconds) {
  return createLocalExportArguments(startSeconds, endSeconds);
}

export function createLocalExportArguments(startSeconds, endSeconds, options = {}) {
  const start = Number(startSeconds);
  const end = Number(endSeconds);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) {
    throw new Error("Choose a valid clip range before exporting.");
  }

  const duration = end - start;
  const speed = Number(options.speed ?? 1);
  if (!Number.isFinite(speed) || speed < 0.5 || speed > 2) {
    throw new Error("Local export speed must be between 0.5× and 2×.");
  }

  const aspect = String(options.aspect || "9:16");
  const dimensions = aspect === "16:9" ? [1920, 1080] : aspect === "1:1" ? [1080, 1080] : [1080, 1920];
  const zoom = Math.max(0.8, Math.min(1.4, Number(options.zoom) || 1));
  const scaledWidth = Math.max(2, Math.round(dimensions[0] * zoom / 2) * 2);
  const scaledHeight = Math.max(2, Math.round(dimensions[1] * zoom / 2) * 2);
  const filters = [
    `scale=${scaledWidth}:${scaledHeight}:force_original_aspect_ratio=increase`,
    `crop=${scaledWidth}:${scaledHeight}`,
    `scale=${dimensions[0]}:${dimensions[1]}`
  ];

  const effect = String(options.effect || "none");
  const effectFilters = {
    cinematic: "eq=contrast=1.12:saturation=1.08:gamma=0.98",
    warm: "colorbalance=rs=0.08:gs=0.02:bs=-0.04",
    cool: "colorbalance=rs=-0.04:gs=0.01:bs=0.08",
    mono: "hue=s=0",
    vibrant: "eq=saturation=1.25:contrast=1.06"
  };
  if (effectFilters[effect]) filters.push(effectFilters[effect]);

  if (options.captions && options.hasCaptions) {
    const color = String(options.captionColor || "#ffffff").replace("#", "");
    const safeHex = /^[0-9a-f]{6}$/i.test(color) ? color : "ffffff";
    const assColor = safeHex.slice(4, 6) + safeHex.slice(2, 4) + safeHex.slice(0, 2);
    const fontSize = options.captionStyle === "minimal" ? 16 : options.captionStyle === "bold" ? 24 : 20;
    filters.push(`subtitles=captions.srt:force_style='FontName=Arial,FontSize=${fontSize},PrimaryColour=&H00${assColor.toUpperCase()},Outline=2,Alignment=2'`);
  }

  if (options.transition === "fade" || options.transition === "dip") {
    const fadeDuration = Math.min(0.35, duration / 4);
    filters.push(`fade=t=in:st=0:d=${fadeDuration}`);
    filters.push(`fade=t=out:st=${Math.max(0, duration - fadeDuration)}:d=${fadeDuration}`);
  }
  if (speed !== 1) filters.push(`setpts=PTS/${speed}`);

  const args = [
    "-ss", String(start),
    "-i", "input.mp4",
    "-t", String(duration),
    "-map", "0:v:0?",
    "-map", "0:a:0?",
    "-vf", filters.join(","),
    "-c:v", "libx264",
    "-preset", "ultrafast",
    "-crf", "28",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-b:a", "96k"
  ];
  if (speed !== 1) args.push("-af", `atempo=${speed}`);
  if (options.transition === "fade" || options.transition === "dip") {
    const fadeDuration = Math.min(0.35, duration / 4);
    args.push("-af", `afade=t=in:st=0:d=${fadeDuration},afade=t=out:st=${Math.max(0, duration - fadeDuration)}:d=${fadeDuration}`);
  }
  args.push("-movflags", "+faststart", "output.mp4");
  return args;
}

export function createCaptionSrt(words, startSeconds, endSeconds) {
  const start = Math.max(0, Number(startSeconds) || 0);
  const end = Math.max(start, Number(endSeconds) || 0);
  const selected = (Array.isArray(words) ? words : [])
    .map(word => ({
      start: Number(word.start_ms) / 1000,
      end: Number(word.end_ms) / 1000,
      text: String(word.word || word.text || "").trim()
    }))
    .filter(word => word.text && word.end > start && word.start < end)
    .map(word => ({
      start: Math.max(0, word.start - start),
      end: Math.max(0.01, Math.min(end, word.end) - start),
      text: word.text.replace(/\s+/g, " ")
    }))
    .sort((a, b) => a.start - b.start);

  const groups = [];
  let group = null;
  for (const word of selected) {
    if (!group || group.words.length >= 5 || word.start - group.end > 0.7) {
      group = { start: word.start, end: word.end, words: [word.text] };
      groups.push(group);
    } else {
      group.end = Math.max(group.end, word.end);
      group.words.push(word.text);
    }
  }
  const stamp = seconds => {
    const ms = Math.max(0, Math.round(seconds * 1000));
    const hours = Math.floor(ms / 3600000);
    const minutes = Math.floor((ms % 3600000) / 60000);
    const secs = Math.floor((ms % 60000) / 1000);
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`;
  };
  return groups.map((item, index) => `${index + 1}\n${stamp(item.start)} --> ${stamp(Math.max(item.start + 0.05, item.end))}\n${item.words.join(" ")}`).join("\n\n");
}

export async function readResponseWithinLimit(response, maxBytes) {
  if (!response?.ok) throw new Error("Could not download the source video for local processing.");
  const declaredLength = Number(response.headers?.get?.("content-length") || 0);
  if (declaredLength > maxBytes) {
    throw new Error(`This video exceeds the safe local-export limit of ${Math.floor(maxBytes / MB)} MB. Use a smaller source or another supported processing option.`);
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
        throw new Error(`This video exceeds the safe local-export limit of ${Math.floor(maxBytes / MB)} MB. Use a smaller source or another supported processing option.`);
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
