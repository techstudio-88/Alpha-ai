# Alpha.ai Media Worker

This service downloads linked media, probes/extracts audio with FFmpeg, plans edits with Gemini and renders clips. The existing browser Whisper worker transcribes the stored audio chunks and resumes this durable Supabase queue when transcription completes.

Required server-only environment:
- SUPABASE_URL
- SUPABASE_SECRET_KEY (Supabase secret/service key)
- SUPABASE_PUBLISHABLE_KEY (validates signed-in tokens)
- MEDIA_WORKER_SECRET (shared with Vercel when configured)
- GEMINI_API_KEY
- GEMINI_MODEL (default: gemini-2.5-flash; must be available to the key)

Build and run:
```bash
docker build -t alpha-ai-media-worker -f worker/Dockerfile .
docker run --rm -p 8080:8080 --env-file worker/.env alpha-ai-media-worker
```

Expose the worker at a stable HTTPS URL and set MEDIA_WORKER_URL plus MEDIA_WORKER_SECRET in Vercel. Never expose the Supabase secret key in the browser or repository.

The worker accepts YouTube, Google Drive and other supported public URLs through yt-dlp. Private Drive links require an authenticated Drive export path; the app never pretends a URL was downloaded when the worker could not access it.

Deploy the chat workflow migration documented in the root README before sending chat jobs. `/process` wakes the existing lease-based queue and only uses persisted job context. `ai_chat_plan` analyzes completed transcripts; `chat_ingest` first prepares audio for browser Whisper. Both save their plans atomically with `render_edit` child jobs and chat result references. The render pipeline saves a ready version only after FFmpeg and Storage succeed. Failed chat/edit jobs retain their checkpoint and expose a manual retry.
