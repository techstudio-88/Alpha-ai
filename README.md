# Alpha.ai

A focused video studio: import a source, transcribe it, review scored moments,
render vertical clips, edit, and schedule to YouTube in a shared workspace.

## Run the redesigned studio

```bash
npm ci
npm ci --prefix worker
npm run dev
```

- `/` — server-rendered landing page and lazy interactive pipeline demonstration.
- `/studio` — authenticated workspace; `/studio?mode=signup` creates an account.
- `/studio?demo=1` — isolated, labelled example workspace. It never creates real
  processing jobs, publishing jobs, credentials, or provider connections.
- `/design-system` — component gallery, design tokens, and state previews.
- `/pricing` — current pilot access and explicitly proposed paid plans.

The new shell uses `?view=projects|project|clips|editor|publish|insights|brand|settings`.
Project/editor links also contain `project` and `clip`. Old `/?view=...` bookmarks
are forwarded to the studio. SEO pages remain separate routes.

Tokens live in `app/design-tokens.css`; the active stylesheet is `app/studio.css`
(Tailwind v4). UI primitives in `components/studio/ui.jsx` follow shadcn/Radix
patterns. The previous monolithic implementation is retained in
`components/LegacyWorkspace.jsx` for migration reference, outside the new route's
imports. Legacy CSS files are no longer imported by the root layout.

## Real processing flow

Browser TUS upload / authorized cloud picker / public HTTPS source → durable
Supabase job → worker download and inspection → persisted original and proxy →
audio extraction → checkpointed transcription → moment analysis → vertical
FFmpeg render → private Storage objects and `clip_versions`.

With `GEMINI_API_KEY`, server transcription is the default and saves progress after
each 60-second audio window. `TRANSCRIPTION_PROVIDER=browser` explicitly selects
browser Whisper; absent Gemini credentials also selects that fallback. Browser
mode needs an open studio tab. API-only unattended jobs need server transcription.
The old AI-chat components and transactional planning APIs remain in the repository;
the redesigned editor exposes supported AI edit instructions.

Edited renders support trim ranges, transcript-word cuts, 0.5–2× playback speed,
9:16 / 1:1 / 16:9, caption presets and colour, zoom, colour treatments, and edge
fades. The timeline's speech track comes from timed words, **not** decoded audio
amplitude. Music, generated b-roll, arbitrary overlays, and automatic brand
intro/outro insertion are not supported by the renderer.

Publishing has one owner: the media worker. The publish cron only wakes that worker.
Compare-and-set claims prevent concurrent duplicate uploads. Videos stream into
YouTube resumable upload sessions; encrypted session checkpoints allow checking a
lost final response before attempting another upload. Failed jobs retain their
session for a deliberate retry. YouTube is the only configured destination.

## Configuration

Vercel needs the public Supabase URL/key, server-only Supabase service key,
`MEDIA_WORKER_URL`, and the same `MEDIA_WORKER_SECRET` used by the worker. Drive and
Photos pickers require their Google OAuth client IDs. YouTube requires its client
credentials, redirect URI, and `OAUTH_STATE_SECRET` (or `CRON_SECRET`).

Worker configuration is documented in `worker/README.md`. Both Dockerfiles build
from the repository root. Default limits are 512 MB per downloaded source, 60 minutes
per source, and 2 GB of temporary job disk. The Storage bucket must independently
permit the original's size. Sources are never deliberately discarded above 45 MB;
a storage rejection fails the import rather than producing an uneditable project.

New source credentials, OAuth credentials, and resumable sessions are encrypted with
AES-256-GCM using a key derived from `MEDIA_WORKER_SECRET`. Old plaintext publishing
connections remain readable for compatibility and are encrypted on refresh; existing
records were not bulk-migrated. Deploy the updated worker before the updated frontend
so it can read encrypted credentials. Secret rotation needs a coordinated credential
rotation/reconnection process.

`NEXT_PUBLIC_SITE_URL` controls canonical URLs, OG metadata, sitemap, and robots.
Local setup does not change Vercel's production domain or environment variables.
`CRON_SECRET` must be non-empty; cron routes fail closed when it is missing.

## Checks

```bash
npm run lint
npm run check:syntax
npm test
npm run typecheck
npm run build
npx playwright install --with-deps chromium
npm run test:ui
```

Tests exercise a real PostgreSQL-WASM transaction migration, actual FFmpeg output,
download bounds, private-address blocking, cron authorization, credential encryption,
publishing concurrency/session recovery, and 1440/390px browser flows with axe AA checks.
Browser tests use the isolated sample workspace. Local LCP is measured against the
production build; this is not a deployed, real-network performance guarantee.

See `docs/STUDIO-REPORT.md` for delivered screens and remaining production work.
