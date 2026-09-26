import { pipeline } from "@huggingface/transformers";

let transcriberPromise = null;
let transcriberDevice = "wasm";

function post(type, payload = {}) {
  self.postMessage({ type, ...payload });
}

function getPreferredModel(device) {
  if (device !== "webgpu") return "onnx-community/whisper-tiny";

  const memory = Number(self.navigator?.deviceMemory || 0);
  const cores = Number(self.navigator?.hardwareConcurrency || 0);
  const capable = memory >= 6 || cores >= 8;

  return capable
    ? "onnx-community/whisper-base"
    : "onnx-community/whisper-tiny";
}

function loadModel(model, device) {
  return pipeline(
    "automatic-speech-recognition",
    model,
    {
      dtype: "q4",
      device,
      progress_callback: info => {
        if (info?.status === "progress_total") {
          post("model-progress", {
            value: Math.max(0, Math.min(100, Number(info.progress) || 0)),
            device,
            model
          });
        } else if (info?.status === "ready") {
          post("model-ready", { device, model });
        }
      }
    }
  );
}

async function getTranscriber() {
  if (transcriberPromise) return transcriberPromise;

  const canUseWebGPU = Boolean(self.navigator?.gpu);
  const preferredDevice = canUseWebGPU ? "webgpu" : "wasm";
  const preferredModel = getPreferredModel(preferredDevice);

  transcriberPromise = loadModel(preferredModel, preferredDevice)
    .then(pipe => {
      transcriberDevice = preferredDevice;
      return pipe;
    })
    .catch(async firstError => {
      // A capable GPU gets the more accurate Base model first. If memory,
      // driver, or operator support prevents it from loading, use Tiny.
      if (preferredModel !== "onnx-community/whisper-tiny") {
        post("status", {
          message: "Whisper Base could not load; switching to the lighter model."
        });

        try {
          const tiny = await loadModel(
            "onnx-community/whisper-tiny",
            preferredDevice
          );
          transcriberDevice = preferredDevice;
          return tiny;
        } catch {
          // Continue to the universal WASM fallback below.
        }
      }

      if (preferredDevice === "webgpu") {
        post("status", {
          message: "GPU transcription unavailable; switching to CPU mode."
        });
        const tinyWasm = await loadModel(
          "onnx-community/whisper-tiny",
          "wasm"
        );
        transcriberDevice = "wasm";
        return tinyWasm;
      }

      transcriberPromise = null;
      throw firstError;
    });

  return transcriberPromise;
}
function decodePcm16Wav(buffer) {
  const view = new DataView(buffer);
  if (
    view.byteLength < 12 ||
    view.getUint32(0, false) !== 0x52494646 ||
    view.getUint32(8, false) !== 0x57415645
  ) {
    throw new Error("Invalid WAV audio.");
  }

  let offset = 12;
  let channels = 1;
  let sampleRate = 16000;
  let bits = 16;
  let dataOffset = -1;
  let dataSize = 0;

  while (offset + 8 <= view.byteLength) {
    const id = view.getUint32(offset, false);
    const size = view.getUint32(offset + 4, true);
    offset += 8;

    if (id === 0x666d7420) {
      const format = view.getUint16(offset, true);
      channels = view.getUint16(offset + 2, true);
      sampleRate = view.getUint32(offset + 4, true);
      bits = view.getUint16(offset + 14, true);
      if (format !== 1 || bits !== 16) {
        throw new Error("Only PCM16 WAV chunks are supported.");
      }
    } else if (id === 0x64617461) {
      dataOffset = offset;
      dataSize = size;
      break;
    }

    offset += size + (size % 2);
  }

  if (dataOffset < 0) throw new Error("WAV data chunk not found.");

  const frames = Math.floor(dataSize / (channels * 2));
  const out = new Float32Array(frames);

  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (let ch = 0; ch < channels; ch++) {
      sum += view.getInt16(dataOffset + (i * channels + ch) * 2, true) / 32768;
    }
    out[i] = sum / channels;
  }

  return { samples: out, sampleRate };
}

self.onmessage = async event => {
  const { url, index } = event.data || {};

  try {
    if (!url) throw new Error("Audio chunk URL is required.");

    post("progress", { index, value: 5 });
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error("Could not download transcription audio.");

    const buffer = await response.arrayBuffer();
    post("progress", { index, value: 20 });

    const { samples, sampleRate } = decodePcm16Wav(buffer);
    if (sampleRate !== 16000) {
      throw new Error("Unexpected transcription sample rate.");
    }

    post("status", { index, message: "Loading free browser transcription model…" });
    const transcriber = await getTranscriber();

    post("progress", { index, value: 45 });

    const result = await transcriber(samples, {
      chunk_length_s: 15,
      stride_length_s: 3,
      return_timestamps: "word"
    });

    const chunks = Array.isArray(result?.chunks) ? result.chunks : [];
    const segments = chunks
      .map(x => {
        const t = x.timestamp || [0, 0];
        return {
          start: Number(t[0] ?? 0),
          end: Number(t[1] ?? t[0] ?? 0),
          text: String(x.text || "").trim()
        };
      })
      .filter(x => x.text && x.end > x.start);

    post("progress", { index, value: 100 });
    post("done", {
      index,
      device: transcriberDevice,
      language: String(result?.language || result?.language_code || "").trim() || null,
      segments
    });
  } catch (error) {
    transcriberPromise = null;
    post("error", {
      index,
      error: error?.message || "Browser transcription failed."
    });
  }
};