# Alpha-ai

AI video content workspace: upload or import long-form video, transcribe, find moments, create clips, caption, edit, export and publish.

## Media worker

The production media worker lives in `worker/` and uses Docker, FFmpeg, yt-dlp, Google Drive download support and faster-whisper.

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
- `WHISPER_MODEL`: `small` by default.

### Production flow

Browser → Supabase resumable upload → Alpha.ai API → media worker → FFmpeg / faster-whisper / clip analysis → Supabase database + Storage.


<!-- Alpha production engineering baseline refreshed 2026-09-23 -->
