# Alpha-ai

AI video content workspace: upload or import long-form video, transcribe, find moments, create clips, caption, edit, export and publish.

## Media worker

The production media worker lives in `worker/` and uses Docker, FFmpeg, yt-dlp, Google Drive download support and Gemini, with browser Whisper transcription.

### Deploy the worker

Use the Render Blueprint in `render.yaml`.

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/techstudio-88/Alpha-ai)

Render will prompt for the server-only Supabase secret and publishable key. It generates `MEDIA_WORKER_SECRET` automatically. The Alpha.ai API also forwards the signed-in user's Supabase access token, so the worker can authorize the workspace even when the shared secret is not present in the caller.

After the worker is live, its public service URL is used by Alpha.ai as the default media-worker endpoint; `MEDIA_WORKER_URL` can override it in Vercel if you later choose a custom worker URL.

### Required worker credentials

- `SUPABASE_URL`: Alpha.ai Supabase project URL.
- `SUPABASE_SECRET_KEY`: server-only Supabase secret key; never expose it in the browser.
- `SUPABASE_PUBLISHABLE_KEY`: browser-safe Supabase publishable key used only to validate signed-in user tokens.
- `MEDIA_WORKER_SECRET`: generated server-to-server secret.
- `GEMINI_API_KEY` and `GEMINI_MODEL`: transcript-based clip planning and editing.

### Production flow

Browser → Supabase resumable upload → Alpha.ai API → Render/FFmpeg audio extraction → browser Whisper (word timestamps) → Gemini → FFmpeg → Supabase database + Storage.

## AI video chat

Open **Create → AI Video Chat** (`/?view=chat`). Its conversation sidebar is separate from the feature navigation. Attach a video file, a YouTube/shared-source URL, or an existing workspace video and send an instruction. Uploads use Supabase TUS and support pause/resume; URLs use the existing Render download adapters. Source accessibility and your Storage bucket's size limits determine whether an import succeeds.

The request and user message are saved together. Render extracts audio; the existing browser Whisper worker checkpoints timed words and segments in Supabase. **Keep Alpha.ai open during transcription.** Gemini reads every transcript window, then selects an overall plan. Planning and rendering are separate persisted jobs: saving a plan does not mean the output is ready. Render jobs produce real Storage objects and `clip_versions`; chat cards show their current status and the last successful preview. Failed jobs retain their errors and can be retried.

Open a result in the editor to load that exact media asset, clip boundaries, render, captions and settings. Its `clip` URL parameter supports reloading. **Edit with AI** targets the individual clip. Executed controls include contiguous trimming, speed, centered zoom, aspect ratio, caption style/color, color effects and edge fades. Unsupported requests (such as generated music, b-roll or internal montage cuts) fail explicitly rather than being reported as applied. Clip planning understands spoken content through Whisper, not unobserved visual details.

### Deploy this workflow

1. Apply existing migrations, then `supabase/migrations/20261003_ai_video_workflow.sql` to the real Supabase database. It adds service-role-only transactional chat submission/result RPCs, a message-context guard and a queue index; existing tables/media are preserved.
2. Vercel needs `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (or `NEXT_PUBLIC_SUPABASE_ANON_KEY`), `SUPABASE_SECRET_KEY` (or `SUPABASE_SERVICE_ROLE_KEY`), and `MEDIA_WORKER_URL` when overriding the existing Render endpoint.
3. Render needs `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `SUPABASE_PUBLISHABLE_KEY`, `GEMINI_API_KEY` and an available `GEMINI_MODEL` (default `gemini-2.5-flash`). Set the same `MEDIA_WORKER_SECRET` on both services if using shared-secret authentication; the signed-in token is also forwarded. The updated root Dockerfile remains the Render Blueprint build target.
4. The private `media` bucket and its existing workspace policies must allow the source size you upload. Chat URL sources are persisted instead of being discarded above 45 MB, because editing needs their original media. A Storage rejection is surfaced as a failed job.

Missing migrations/credentials, inaccessible URLs, Whisper errors, unsupported edits, model failures and render failures remain visible; there are no simulated success responses.

### Verification

```bash
npm ci
npm ci --prefix worker
npm run build
npm run typecheck
npm run lint
npm run check:syntax
npm test
```

Tests exercise the real migration in PostgreSQL WASM, full-transcript pagination/planning validation, and real FFmpeg output with captions, trim ranges and speed changes. Test fixtures do not substitute for live provider verification. The render test uses the development-only `ffmpeg-static`/`ffprobe-static` binaries; production uses Docker's FFmpeg. If lifecycle scripts are disabled locally, run `npm rebuild ffmpeg-static` first.

For deployment acceptance, sign in, submit a real long video, observe Whisper checkpoints and Gemini planning, wait for a playable rendered card, reload the conversation, open the exact clip in Editor, apply a clip instruction, and verify a new ready version. Also verify an inaccessible URL and an unsupported instruction produce visible errors.


<!-- Alpha production engineering baseline refreshed 2026-09-23 -->
