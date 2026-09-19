# Alpha.ai Media Worker

This service performs the work the browser and Vercel app should not do: downloading linked media, FFmpeg probing/transcoding, Whisper transcription, and clip candidate generation.

Required server-only environment:
- SUPABASE_URL
- SUPABASE_SECRET_KEY (Supabase secret/service key)
- MEDIA_WORKER_SECRET
- WHISPER_MODEL (default: small)

Build and run:
```bash
docker build -t alpha-ai-media-worker ./worker
docker run --rm -p 8080:8080 --env-file worker/.env alpha-ai-media-worker
```

Expose the worker at a stable HTTPS URL and set MEDIA_WORKER_URL plus MEDIA_WORKER_SECRET in Vercel. Never expose the Supabase secret key in the browser or repository.

The worker accepts YouTube, Google Drive and other supported public URLs through yt-dlp. Private Drive links require an authenticated Drive export path; the app never pretends a URL was downloaded when the worker could not access it.