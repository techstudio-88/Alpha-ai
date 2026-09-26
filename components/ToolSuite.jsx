"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { ArrowRight, Check, Copy, Download, FileAudio, FileText, Image as ImageIcon, Loader2, LockKeyhole, Sparkles, Upload, Video } from "lucide-react";

const CONFIG = {
  "video-to-text": {
    title: "Video to Text Converter",
    eyebrow: "VIDEO TO TEXT",
    description: "Turn a video into editable text with word-level timestamps using browser-based Whisper transcription.",
    action: "Transcribe video",
    icon: FileText,
    type: "transcript"
  },
  "video-transcript": {
    title: "Video Transcript Generator",
    eyebrow: "VIDEO TRANSCRIPT",
    description: "Generate a timestamped transcript from your video directly in your browser.",
    action: "Generate transcript",
    icon: FileText,
    type: "transcript"
  },
  "video-to-thumbnail": {
    title: "Video to Thumbnail Maker",
    eyebrow: "VIDEO TO THUMBNAIL",
    description: "Create downloadable thumbnail frames from any video and choose the frame that works best.",
    action: "Create thumbnails",
    icon: ImageIcon,
    type: "thumbnail"
  },
  "video-to-mp3": {
    title: "Video to MP3 Converter",
    eyebrow: "VIDEO TO MP3",
    description: "Extract audio from a video and convert it to an MP3 file in your browser.",
    action: "Convert to MP3",
    icon: FileAudio,
    type: "mp3"
  },
  "video-to-mp4": {
    title: "Video to MP4 Converter",
    eyebrow: "VIDEO TO MP4",
    description: "Convert supported video files to MP4 without uploading the source to Alpha.ai.",
    action: "Convert to MP4",
    icon: Video,
    type: "mp4"
  },
  "video-summary": {
    title: "Video Summary Generator",
    eyebrow: "VIDEO SUMMARY",
    description: "Create a concise text summary and key points from the spoken content of your video.",
    action: "Summarize video",
    icon: Sparkles,
    type: "summary"
  }
};

const PROCESS_WORDS = [
  "Preparing your video",
  "Inspecting the source",
  "Reading the media",
  "Extracting the audio",
  "Understanding the speech",
  "Transcribing the timeline",
  "Finding meaningful sections",
  "Organizing the result",
  "Checking the output",
  "Still working",
  "Almost there",
  "Finishing the last details",
  "Polishing the result",
  "Making the result ready",
  "Final checks in progress",
  "Processing continues",
  "Working through the source",
  "Keeping your video intact",
  "Finishing up",
  "Result is nearly ready"
];

let ffmpegPromise = null;

async function getFFmpeg(setStatus) {
  if (ffmpegPromise) return ffmpegPromise;
  ffmpegPromise = (async () => {
    setStatus("Loading the browser media engine");
    const [{ FFmpeg }, { fetchFile, toBlobURL }] = await Promise.all([
      import("@ffmpeg/ffmpeg"),
      import("@ffmpeg/util")
    ]);
    const ffmpeg = new FFmpeg();
    ffmpeg.on("log", ({ message }) => {
      if (/error|failed/i.test(String(message))) console.warn("ffmpeg:", message);
    });
    const base = "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd";
    await ffmpeg.load({
      coreURL: await toBlobURL(base + "/ffmpeg-core.js", "text/javascript"),
      wasmURL: await toBlobURL(base + "/ffmpeg-core.wasm", "application/wasm")
    });
    return { ffmpeg, fetchFile };
  })().catch(error => {
    ffmpegPromise = null;
    throw error;
  });
  return ffmpegPromise;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function summarizeTranscript(text) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (!clean) return { overview: "No spoken content was detected.", points: [] };
  const sentences = clean.split(/(?<=[.!?])\s+/).filter(s => s.length > 30);
  const points = [];
  const seen = new Set();
  for (const sentence of sentences.sort((a,b) => b.length - a.length)) {
    const normalized = sentence.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter(Boolean);
    const key = normalized.slice(0, 8).join(" ");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    points.push(sentence.trim());
    if (points.length === 5) break;
  }
  const overview = (sentences.slice(0, 3).join(" ") || clean.slice(0, 600)).trim();
  return { overview, points };
}

function AuthGate({ onClose, onAuthed }) {
  const [mode, setMode] = useState("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (!supabase) return setMessage("Authentication is not configured.");
    setBusy(true); setMessage("");
    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        onAuthed();
      } else {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { full_name: name } }
        });
        if (error) throw error;
        setMessage("Account created. Check your email if confirmation is required, then return to this tool.");
      }
    } catch (error) {
      setMessage(error?.message || "Authentication failed.");
    } finally { setBusy(false); }
  }

  async function google() {
    if (!supabase) return;
    setBusy(true); setMessage("");
    const next = window.location.pathname;
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin + "/auth/callback?next=" + encodeURIComponent(next) }
    });
    if (error) { setMessage(error.message); setBusy(false); }
  }

  return (
    <div className="alphaToolOverlay">
      <div className="alphaToolAuthCard">
        <button className="alphaToolClose" onClick={onClose} aria-label="Close">×</button>
        <div className="alphaToolLock"><LockKeyhole size={20}/></div>
        <div className="alphaToolEyebrow">SAVE YOUR RESULT</div>
        <h2>Sign in to download or copy</h2>
        <p>Your result is ready. Sign in so Alpha.ai can let you download or copy it.</p>
        <button className="alphaToolGoogle" onClick={google} disabled={busy}>Continue with Google</button>
        <div className="alphaToolDivider"><span>or</span></div>
        <form onSubmit={submit} className="alphaToolForm">
          {mode === "signup" && <input value={name} onChange={e=>setName(e.target.value)} placeholder="Your name" autoComplete="name" />}
          <input value={email} onChange={e=>setEmail(e.target.value)} placeholder="Email address" type="email" required autoComplete="email" />
          <input value={password} onChange={e=>setPassword(e.target.value)} placeholder="Password" type="password" required minLength={6} autoComplete={mode==="signin"?"current-password":"new-password"} />
          <button className="alphaToolPrimary" disabled={busy}>{busy ? "Working…" : mode === "signin" ? "Sign in" : "Create account"}</button>
        </form>
        {message && <div className="alphaToolMessage">{message}</div>}
        <button className="alphaToolSwitch" onClick={()=>{setMode(mode==="signin"?"signup":"signin");setMessage("")}}>
          {mode === "signin" ? "New to Alpha.ai? Create an account" : "Already have an account? Sign in"}
        </button>
      </div>
    </div>
  );
}

function ProcessingView({ status }) {
  return (
    <div className="alphaToolProcessing">
      <div className="alphaToolProcessingIcon"><Loader2 size={30} className="alphaToolSpin"/></div>
      <h2>Don’t close this site</h2>
      <p className="alphaToolProcessingLead">Alpha.ai is still processing your video. Keep this tab open until the result is ready.</p>
      <div className="alphaToolStatusList">
        <div className="alphaToolStatus active"><i/><span>{status}</span></div>
        <div className="alphaToolStatus"><i/><span>Still working through the source</span></div>
        <div className="alphaToolStatus"><i/><span>Checking the next section</span></div>
        <div className="alphaToolStatus"><i/><span>Making the result consistent</span></div>
        <div className="alphaToolStatus"><i/><span>Finishing the processing steps</span></div>
      </div>
    </div>
  );
}

export default function ToolSuite({ slug }) {
  const config = CONFIG[slug] || CONFIG["video-to-text"];
  const Icon = config.icon;
  const inputRef = useRef(null);
  const [file, setFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("Waiting for a video");
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState(null);
  const [session, setSession] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    if (!supabase) return;
    supabase.auth.getSession().then(({data}) => { if (alive) setSession(data?.session || null); });
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      if (alive) setSession(next || null);
    });
    return () => { alive = false; data?.subscription?.unsubscribe(); };
  }, []);

  useEffect(() => {
    if (!file) { setPreviewUrl(""); return; }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  useEffect(() => {
    if (!pendingAction || !session || !result) return;
    const action = pendingAction;
    setPendingAction(null);
    setAuthOpen(false);
    if (action === "download") downloadResult();
    if (action === "copy") copyResult();
  }, [session, pendingAction, result]);

  useEffect(() => {
    if (!busy) return;
    let i = 0;
    const timer = setInterval(() => {
      i = (i + 1) % PROCESS_WORDS.length;
      setStatus(PROCESS_WORDS[i]);
    }, 2400);
    return () => clearInterval(timer);
  }, [busy]);

  const resultReady = Boolean(result);
  const filenameBase = useMemo(() => (file?.name || "alpha-ai-video").replace(/\.[^.]+$/, "").replace(/[^a-z0-9_-]+/gi, "-").slice(0,80) || "alpha-ai-video", [file]);

  function selectFile(e) {
    const next = e.target.files?.[0] || null;
    e.target.value = "";
    setResult(null); setError("");
    if (next && next.type.startsWith("video/")) setFile(next);
    else if (next) setError("Please choose a video file.");
  }

  async function transcribeAudio(wavBytes) {
    return new Promise((resolve, reject) => {
      const worker = new Worker(new URL("../workers/transcriber.worker.js", import.meta.url), { type: "module" });
      const handler = event => {
        const data = event.data || {};
        if (data.type === "status") setStatus(data.message || "Transcribing the video");
        if (data.type === "model-progress") setProgress(Math.max(1, Math.min(60, Math.round((Number(data.value)||0)*0.6))));
        if (data.type === "progress") setProgress(Math.max(60, Math.min(90, Number(data.value)||0)));
        if (data.type === "model-ready") { setStatus(data.device === "webgpu" ? "Transcribing with your GPU" : "Transcribing with your CPU"); setProgress(62); }
        if (data.type === "done") {
          worker.removeEventListener("message", handler); worker.terminate(); resolve(data);
        }
        if (data.type === "error") {
          worker.removeEventListener("message", handler); worker.terminate(); reject(new Error(data.error || "Transcription failed."));
        }
      };
      worker.addEventListener("message", handler);
      const transferable = wavBytes.buffer.slice(wavBytes.byteOffset, wavBytes.byteOffset + wavBytes.byteLength);
      worker.postMessage({ wavBuffer: transferable, index: 0 }, [transferable]);
    });
  }

  async function run() {
    if (!file || busy) return;
    setBusy(true); setResult(null); setError(""); setProgress(2); setStatus("Preparing your video");
    try {
      if (config.type === "thumbnail") {
        setStatus("Finding useful frames"); setProgress(35);
        const video = document.createElement("video");
        video.preload = "metadata"; video.src = URL.createObjectURL(file); video.muted = true; video.playsInline = true;
        await new Promise((resolve, reject) => { video.onloadedmetadata = resolve; video.onerror = () => reject(new Error("The video could not be read.")); });
        const duration = Number(video.duration) || 0;
        const canvas = document.createElement("canvas");
        const width = 1280;
        const height = Math.max(720, Math.round((video.videoHeight / Math.max(1, video.videoWidth)) * width));
        canvas.width = width; canvas.height = height;
        const points = [0.12, 0.5, 0.88];
        const images = [];
        for (let i=0;i<points.length;i++) {
          video.currentTime = Math.max(0, Math.min(duration - 0.05, duration * points[i]));
          await new Promise(resolve => { video.onseeked = resolve; });
          const ctx = canvas.getContext("2d");
          ctx.drawImage(video, 0, 0, width, height);
          const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", .92));
          images.push({ blob, url: URL.createObjectURL(blob), label: Math.round(duration * points[i]) + "s" });
          setProgress(25 + i * 25);
        }
        video.removeAttribute("src"); video.load();
        setProgress(100); setStatus("Thumbnail frames are ready");
        setResult({ kind:"thumbnails", images });
      } else {
        const { ffmpeg, fetchFile } = await getFFmpeg(setStatus);
        setStatus("Loading your video into the local converter"); setProgress(15);
        await ffmpeg.writeFile("input-video", await fetchFile(file));
        if (config.type === "mp4") {
          setStatus("Converting the video to MP4"); setProgress(35);
          await ffmpeg.exec(["-i","input-video","-c:v","libx264","-preset","ultrafast","-crf","28","-c:a","aac","-b:a","128k","-movflags","+faststart","output.mp4"]);
          const data = await ffmpeg.readFile("output.mp4");
          setProgress(100); setStatus("MP4 is ready");
          setResult({ kind:"file", blob:new Blob([data.buffer],{type:"video/mp4"}), filename:filenameBase+".mp4" });
        } else {
          setStatus(config.type === "mp3" ? "Extracting audio" : "Extracting speech audio"); setProgress(30);
          await ffmpeg.exec(["-i","input-video","-vn","-ac","1","-ar","16000","-c:a","pcm_s16le","speech.wav"]);
          const wav = await ffmpeg.readFile("speech.wav");
          if (config.type === "mp3") {
            setStatus("Encoding MP3 audio"); setProgress(70);
            await ffmpeg.exec(["-i","speech.wav","-c:a","libmp3lame","-b:a","192k","output.mp3"]);
            const data = await ffmpeg.readFile("output.mp3");
            setProgress(100); setStatus("MP3 is ready");
            setResult({ kind:"file", blob:new Blob([data.buffer],{type:"audio/mpeg"}), filename:filenameBase+".mp3" });
          } else {
            setStatus("Transcribing the spoken audio"); setProgress(40);
            const transcript = await transcribeAudio(wav);
            const segments = Array.isArray(transcript.segments) ? transcript.segments : [];
            const text = segments.map(x=>x.text).join(" ").replace(/\s+/g," ").trim();
            setProgress(100); setStatus("Transcript is ready");
            if (config.type === "summary") {
              setResult({ kind:"summary", text, summary:summarizeTranscript(text), segments });
            } else {
              setResult({ kind:"transcript", text, segments });
            }
          }
        }
      }
    } catch (e) {
      console.error("Alpha.ai tool failed", e);
      setError(e?.message || "The video could not be processed in this browser.");
    } finally {
      setBusy(false);
    }
  }

  function requireAuth(action) {
    if (session) return true;
    setPendingAction(action); setAuthOpen(true); return false;
  }

  function downloadResult() {
    if (!result || !requireAuth("download")) return;
    if (result.kind === "file") downloadBlob(result.blob, result.filename);
    if (result.kind === "thumbnails") result.images.forEach((image,i) => downloadBlob(image.blob, filenameBase+"-thumbnail-"+(i+1)+".jpg"));
    if (result.kind === "transcript") downloadBlob(new Blob([result.text],{type:"text/plain;charset=utf-8"}), filenameBase+"-transcript.txt");
    if (result.kind === "summary") {
      const body = "SUMMARY\n\n"+result.summary.overview+"\n\nKEY POINTS\n"+result.summary.points.map((x,i)=>(i+1)+". "+x).join("\n");
      downloadBlob(new Blob([body],{type:"text/plain;charset=utf-8"}), filenameBase+"-summary.txt");
    }
  }

  async function copyResult() {
    if (!result || !requireAuth("copy")) return;
    let text = result.text || "";
    if (result.kind === "summary") text = result.summary.overview + "\n\n" + result.summary.points.map((x,i)=>(i+1)+". "+x).join("\n");
    if (!text) return;
    await navigator.clipboard.writeText(text);
    setStatus("Copied to your clipboard");
  }

  const related = Object.entries(CONFIG).filter(([key])=>key!==slug).slice(0,5);

  return (
    <main className="alphaToolPage">
      <nav className="alphaToolNav">
        <a href="/" className="alphaToolBrand"><img src="/alpha-logo-exact.png" alt="Alpha.ai"/></a>
        <div className="alphaToolNavLinks">
          <a href="/video-to-text">Video to Text</a>
          <a href="/video-to-thumbnail">Thumbnail</a>
          <a href="/video-to-mp3">MP3</a>
          <a href="/video-summary">Summary</a>
          <a href="/">AI Clipper</a>
        </div>
        <a className="alphaToolSignIn" href="/?auth=signin">Sign in</a>
      </nav>

      <section className="alphaToolHero">
        <div className="alphaToolEyebrow"><Icon size={15}/>{config.eyebrow}</div>
        <h1>{config.title}</h1>
        <p>{config.description}</p>
        <div className="alphaToolTrust"><span>Private browser processing where supported</span><span>•</span><span>No forced upload</span><span>•</span><span>Sign in only to save results</span></div>
      </section>

      <section className="alphaToolWorkspace">
        {!busy && !result && (
          <div className="alphaToolDrop">
            <div className="alphaToolUploadIcon"><Upload size={27}/></div>
            <h2>Drop your video here</h2>
            <p>or choose a video from your device</p>
            <input ref={inputRef} type="file" accept="video/*,.mp4,.mov,.webm,.m4v,.avi" onChange={selectFile} />
            <button className="alphaToolPrimary" onClick={()=>inputRef.current?.click()}>Choose video</button>
            <small>For very long videos, browser conversion can take time. Keep this tab open.</small>
          </div>
        )}

        {file && !busy && !result && (
          <div className="alphaToolSelected">
            <div><b>{file.name}</b><span>{(file.size/1024/1024).toFixed(1)} MB</span></div>
            <button className="alphaToolPrimary" onClick={run}>{config.action}<ArrowRight size={16}/></button>
          </div>
        )}

        {busy && <ProcessingView status={status} />}

        {error && !busy && <div className="alphaToolError"><b>Processing stopped</b><span>{error}</span><button onClick={()=>setError("")}>Try again</button></div>}

        {result && !busy && (
          <div className="alphaToolResult">
            <div className="alphaToolResultHead"><div><span className="alphaToolReady"><Check size={14}/> READY</span><h2>Your result is ready</h2></div><button className="alphaToolReset" onClick={()=>{setResult(null);setFile(null)}}>Process another video</button></div>
            {result.kind === "file" && <div className="alphaToolFileResult"><div className="alphaToolFileIcon"><FileAudio size={25}/></div><div><b>{result.filename}</b><span>Processed locally in your browser</span></div></div>}
            {result.kind === "thumbnails" && <div className="alphaToolThumbGrid">{result.images.map((image,i)=><div className="alphaToolThumb" key={image.url}><img src={image.url} alt={"Video thumbnail frame "+(i+1)}/><span>{image.label}</span></div>)}</div>}
            {result.kind === "transcript" && <div className="alphaToolTextResult">{result.segments.slice(0,500).map((x,i)=><p key={i}><time>{Number(x.start).toFixed(1)}s</time>{x.text}</p>)}</div>}
            {result.kind === "summary" && <div className="alphaToolSummary"><h3>Overview</h3><p>{result.summary.overview}</p><h3>Key points</h3><ul>{result.summary.points.map((x,i)=><li key={i}>{x}</li>)}</ul></div>}
            <div className="alphaToolResultActions">
              <button className="alphaToolPrimary" onClick={downloadResult}><Download size={16}/> Download</button>
              {(result.kind === "transcript" || result.kind === "summary") && <button className="alphaToolSecondary" onClick={copyResult}><Copy size={16}/> Copy</button>}
            </div>
            {!session && <div className="alphaToolGateNotice"><LockKeyhole size={16}/><span><b>Sign in required to download or copy.</b> Your processing result is already available above.</span></div>}
          </div>
        )}
      </section>

      <section className="alphaToolContent">
        <div><span className="alphaToolEyebrow">WHY ALPHA.AI</span><h2>One video, more ways to use it.</h2><p>Alpha.ai is building a full video utility layer alongside its long-form AI clipping workflow. Convert media, extract text, create thumbnails, summarize recordings, then move the same content into clips and editing.</p></div>
        <div className="alphaToolRelated"><h3>More video tools</h3>{related.map(([key,c])=><a href={"/"+key} key={key}>{c.title}<ArrowRight size={15}/></a>)}</div>
      </section>

      {authOpen && <AuthGate onClose={()=>{setAuthOpen(false);setPendingAction(null)}} onAuthed={()=>{setAuthOpen(false)}}/>}
    </main>
  );
}
