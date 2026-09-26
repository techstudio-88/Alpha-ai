"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";

const HEARTBEAT_MS = 20000;
const JOB_LEASE_MS = 120000;

export default function BrowserTranscriber({ workspace }) {
  const running = useRef(false);
  const [state, setState] = useState(null);

  useEffect(() => {
    if (!workspace || !supabase) return;

    let alive = true;
    const worker = new Worker(
      new URL("../workers/transcriber.worker.js", import.meta.url),
      { type: "module" }
    );

    async function touchJob(jobId, patch = {}) {
      const body = {
        heartbeat_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        lease_until: new Date(Date.now() + JOB_LEASE_MS).toISOString(),
        ...patch
      };
      const result = await supabase
        .from("processing_jobs")
        .update(body)
        .eq("id", jobId);
      if (result.error) throw result.error;
    }

    async function processJob(job) {
      if (running.current) return;

      running.current = true;
      const payload = job.payload || {};
      const chunks = Array.isArray(payload.transcriptionChunks)
        ? payload.transcriptionChunks
        : [];
      const next = Math.max(0, Number(payload.transcribeChunk || 0));

      let heartbeatTimer = null;

      try {
        if (!chunks.length || next >= chunks.length) {
          running.current = false;
          return;
        }

        await touchJob(job.id, {
          status: "transcribing",
          progress: Math.max(43, Number(job.progress) || 43),
          current_stage: "transcription",
          error: null
        });

        heartbeatTimer = setInterval(() => {
          touchJob(job.id).catch(error =>
            console.warn("browser transcription heartbeat failed:", error?.message)
          );
        }, HEARTBEAT_MS);

        for (let i = next; i < chunks.length; i++) {
          if (!alive) break;

          const chunk = chunks[i];
          setState({
            jobId: job.id,
            index: i,
            total: chunks.length,
            progress: 0,
            message: "Preparing audio…"
          });

          const signed = await supabase.storage
            .from("media")
            .createSignedUrl(chunk.storagePath, 600);

          if (signed.error) throw signed.error;

          const result = await new Promise((resolve, reject) => {
            const handler = event => {
              const data = event.data || {};

              if (data.index !== undefined && data.index !== i) return;

              if (data.type === "progress") {
                setState({
                  jobId: job.id,
                  index: i,
                  total: chunks.length,
                  progress: Number(data.value) || 0,
                  message: "Transcribing in this browser"
                });
              }

              if (data.type === "model-progress") {
                setState({
                  jobId: job.id,
                  index: i,
                  total: chunks.length,
                  progress: Math.min(44, Math.round((Number(data.value) || 0) * 0.44)),
                  message: "Downloading free transcription model…"
                });
              }

              if (data.type === "model-ready") {
                setState({
                  jobId: job.id,
                  index: i,
                  total: chunks.length,
                  progress: 45,
                  message:
                    data.device === "webgpu"
                      ? "Transcribing with your GPU"
                      : "Transcribing with your device CPU"
                });
              }

              if (data.type === "status") {
                setState(prev => ({
                  ...(prev || {}),
                  jobId: job.id,
                  index: i,
                  total: chunks.length,
                  message: data.message || "Transcribing in this browser"
                }));
              }

              if (data.type === "done") {
                worker.removeEventListener("message", handler);
                resolve(data);
              }

              if (data.type === "error") {
                worker.removeEventListener("message", handler);
                reject(new Error(data.error || "Browser transcription failed."));
              }
            };

            worker.addEventListener("message", handler);
            worker.postMessage({
              url: signed.data.signedUrl,
              index: i
            });
          });

          const startMs = Math.round(Number(chunk.start) * 1000);
          const endMs = Math.round(
            (Number(chunk.start) + Number(chunk.length)) * 1000
          );

          const existing = await supabase
            .from("transcript_segments")
            .select("id")
            .eq("transcript_id", payload.transcriptId)
            .gte("start_ms", startMs)
            .lt("start_ms", endMs)
            .limit(1);

          if (existing.error) throw existing.error;

          if (!(existing.data || []).length && result.segments?.length) {
            const rows = result.segments.map(segment => ({
              transcript_id: payload.transcriptId,
              start_ms: Math.round(
                (Number(segment.start) + Number(chunk.start)) * 1000
              ),
              end_ms: Math.round(
                (Number(segment.end) + Number(chunk.start)) * 1000
              ),
              text: String(segment.text || "").trim(),
              speaker: null,
              confidence: null
            })).filter(row => row.text && row.end_ms > row.start_ms);

            if (rows.length) {
              const inserted = await supabase
                .from("transcript_segments")
                .insert(rows);
              if (inserted.error) throw inserted.error;
            }
          }

          const textRows = await supabase
            .from("transcript_segments")
            .select("text,start_ms,end_ms")
            .eq("transcript_id", payload.transcriptId)
            .order("start_ms", { ascending: true });

          if (textRows.error) throw textRows.error;

          const completed = i + 1 >= chunks.length;
          const transcriptText = (textRows.data || [])
            .map(row => String(row.text || "").trim())
            .filter(Boolean)
            .join(" ");

          const transcriptUpdate = await supabase
            .from("transcripts")
            .update({
              text: transcriptText,
              language: result.language || "auto",
              status: completed ? "completed" : "processing"
            })
            .eq("id", payload.transcriptId);

          if (transcriptUpdate.error) throw transcriptUpdate.error;

          const nextPayload = {
            ...payload,
            transcriptId: payload.transcriptId,
            transcribeChunk: i + 1,
            transcriptionChunks: chunks,
            browserTranscriptionDevice:
              result.device || payload.browserTranscriptionDevice || "wasm"
          };

          await supabase.storage
            .from("media")
            .remove([chunk.storagePath])
            .catch(() => {});

          await touchJob(job.id, {
            status: completed ? "queued" : "transcribing",
            progress: completed
              ? 62
              : 43 + Math.round(((i + 1) / chunks.length) * 18),
            current_stage: completed ? "speaker_detection" : "transcription",
            error: null,
            payload: nextPayload,
            lease_until: completed
              ? null
              : new Date(Date.now() + JOB_LEASE_MS).toISOString()
          });

          setState({
            jobId: job.id,
            index: i + 1,
            total: chunks.length,
            progress: 100,
            message: completed
              ? "Transcription complete — continuing AI analysis"
              : "Transcribing in this browser"
          });
        }
      } catch (error) {
        if (alive) {
          setState({
            jobId: job.id,
            index: next,
            total: chunks.length,
            progress: 0,
            error: error?.message || "Browser transcription failed.",
            message: "Transcription needs attention"
          });
        }

        await touchJob(job.id, {
          status: "awaiting_transcription",
          current_stage: "transcription",
          error: error?.message || "Browser transcription failed.",
          payload: {
            ...payload,
            browserTranscriptionError:
              error?.message || "Browser transcription failed."
          }
        }).catch(() => {});
      } finally {
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        running.current = false;
      }
    }

    async function scan() {
      if (running.current || !alive) return;

      const result = await supabase
        .from("processing_jobs")
        .select("id,payload,status,progress,error")
        .eq("workspace_id", workspace.id)
        .eq("status", "awaiting_transcription")
        .order("created_at", { ascending: true })
        .limit(1);

      if (!result.error && result.data?.[0]) {
        processJob(result.data[0]);
      }
    }

    scan();
    const timer = setInterval(scan, 5000);

    return () => {
      alive = false;
      clearInterval(timer);
      worker.terminate();
    };
  }, [workspace]);

  if (!state) return null;

  return (
    <div className="browserTranscriberNotice">
      <b>
        {state.error
          ? "Transcription needs attention"
          : state.message || (state.progress >= 100
            ? "Transcription complete"
            : "Transcribing in this browser")}
      </b>
      <span>
        {state.error
          ? state.error
          : state.progress >= 100
            ? "Finishing AI clip analysis…"
            : "Audio chunk " +
              Math.min(state.index + 1, state.total) +
              " of " +
              state.total +
              (state.progress ? " · " + state.progress + "%" : "")}
      </span>
    </div>
  );
}