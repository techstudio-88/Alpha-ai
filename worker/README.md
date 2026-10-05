# Alpha.ai media worker

The worker downloads bounded sources, persists originals, creates proxies/thumbnails,
extracts audio, transcribes, scores moments, renders with FFmpeg, and publishes to
YouTube using one durable queue owner.

## Required environment

- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY` or `SUPABASE_SERVICE_ROLE_KEY` (server-only)
- `SUPABASE_PUBLISHABLE_KEY` or `SUPABASE_ANON_KEY`
- `MEDIA_WORKER_SECRET` — same value as Vercel; encrypts queued source/provider
  credentials and resumable publishing sessions
- `GEMINI_API_KEY` — server transcription, analysis, and AI editing
- `GEMINI_MODEL` — defaults to `gemini-2.5-flash`; the key must have access
- YouTube publishing: `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`

Optional controls:

- `TRANSCRIPTION_PROVIDER=browser` explicitly uses browser Whisper instead of Gemini
  server transcription. It requires an open studio tab, including after imports.
- `MAX_DOWNLOAD_MB=512` — direct downloads enforce advertised and streamed sizes;
  provider imports are also checked after download.
- `MAX_JOB_DISK_MB=2048` — process watchdog caps temporary job disk.

Sources are limited to 60 minutes. Commands have a 30-minute deadline. The worker
uses lease-based processing-job claims; transcription and render output checkpoint
in Supabase. Cancel requests are checked at job writes and while child processes run.
Source downloads and provider calls may finish before their next cancellation check.

## Build

```bash
docker build -t alpha-ai-media-worker -f worker/Dockerfile .
docker run --rm -p 8080:8080 --env-file worker/.env alpha-ai-media-worker
```

The root Dockerfile is the Render Blueprint target and exposes port 10000. The worker
Dockerfile uses port 8080. Both copy the shared workflow and credential-cipher modules.
Neither references an absent `transcribe.mjs` or loads faster-whisper.

Every import persists its source before analysis; the private `media` bucket must
permit its size. Temporary Gemini uploads are cleaned up at job exit. Authenticated
Drive/Photos picker tokens are encrypted in the canonical job and cleared after the
source is persisted. Public links must be HTTPS, and public-download DNS answers are
pinned to the TLS request on every redirect.

Only the worker publishes. YouTube files are streamed, claims are atomic, and upload
sessions are saved encrypted for restart/retry recovery. A refresh failure marks the
channel expired. Never deploy the encrypted-credential frontend against an old worker.
Live Google OAuth, Gemini transcription accuracy, Storage limits, and actual YouTube
uploads require separate account-level acceptance testing.
