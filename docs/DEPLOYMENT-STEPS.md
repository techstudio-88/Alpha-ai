# Your remaining setup steps

The reviewed release uses the existing `alpha-ai` Vercel project and GitHub `main`
branch. The owner authorized the coordinated GitHub/Render/Vercel rollout; the final
release report records the verified live deployment status. Keep the current domain
and existing environment variables. Do not put secret values in Git or in chat.

To preview without credentials, run `npm run dev` and open
`http://localhost:3000/studio?demo=1`. Real local sign-in also needs your development
environment; the linked CLI can pull it with
`npm exec --yes --package=vercel -- vercel env pull .env.local`.
Keep that file ignored and private.

## 1. Prepare the existing Render worker

Use the existing `alpha-ai-media-worker` service, not a new Vercel project.

Check these Render variables:

| Variable | Source / purpose |
|---|---|
| `SUPABASE_URL` | Same Supabase project as Vercel |
| `SUPABASE_SECRET_KEY` **or** `SUPABASE_SERVICE_ROLE_KEY` | Supabase server-only key |
| `SUPABASE_PUBLISHABLE_KEY` **or** `SUPABASE_ANON_KEY` | Supabase public application key |
| `MEDIA_WORKER_SECRET` | **Must exactly match the existing Vercel value** |
| `GEMINI_API_KEY` | Google AI Studio key enabled for the selected Gemini model |
| `GEMINI_MODEL` | An available model; code defaults to `gemini-2.5-flash` |
| `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET` | Same Google OAuth app as Vercel; needed by the worker publisher |

Optional worker limits: `TRANSCRIPTION_PROVIDER=gemini`, `MAX_DOWNLOAD_MB=512`,
`MAX_JOB_DISK_MB=2048`. Browser transcription remains available explicitly, but
unattended imports require server transcription.

Build from the repository root with the existing root `Dockerfile`, or run
`docker build -f worker/Dockerfile .` when testing locally. Both services should deploy
the same `main` revision. The updated frontend checks worker capabilities before
creating encrypted cloud jobs or transcript-cut renders during a rolling deployment.
Verify worker health reports version `2.0` and the matching release revision. Worker
capacity and Storage limits must suit your footage.

## 2. Add only missing Vercel integration configuration

Read-only inspection found these already present: Supabase URL/anon key/server keys,
`MEDIA_WORKER_SECRET`, YouTube client ID/secret/redirect URI, `OAUTH_STATE_SECRET`, and
production `CRON_SECRET`. Keep their existing values. This inspection verifies names
and targets, not correctness or access rights.

Optional/missing additions:

| Variable | Needed for |
|---|---|
| `NEXT_PUBLIC_GOOGLE_DRIVE_CLIENT_ID` | Google Drive import picker; not currently configured |
| `NEXT_PUBLIC_GOOGLE_PHOTOS_CLIENT_ID` | Photos picker; may reuse Drive client ID if the same Google app enables Photos |
| `MEDIA_WORKER_URL` | Set to the existing worker's HTTPS URL to make the endpoint explicit; otherwise existing Render fallback is used |
| `NEXT_PUBLIC_SITE_URL` | Canonical website URL; defaults to `https://alpha-ai-smoky.vercel.app` |

Use the Vercel dashboard's Environment Variables page. Add needed targets deliberately;
Google integration origins must match each environment you enable. Redeploy after any
`NEXT_PUBLIC_*` addition, because these values are embedded at build time.

## 3. Google configuration

In Google Cloud, use an OAuth **web application** client and enable Drive API,
Google Photos Picker API, and YouTube Data API v3 for features you plan to use.

- Authorized JavaScript origin: `https://alpha-ai-smoky.vercel.app` (plus any existing
  production alias that users actually visit). Local origin: `http://localhost:3000`.
- YouTube redirect URI: the **exact existing** `YOUTUBE_REDIRECT_URI` value must be
  registered in Google Cloud. For the primary domain it is
  `https://alpha-ai-smoky.vercel.app/api/publish/callback`. Existing aliases still work;
  do not replace a working registered URI just to rename it.
- During OAuth testing, add the Google accounts that will test the connections.
- Unverified YouTube API projects may be restricted to private uploads. Test private
  first and complete provider review before promising public automated publishing.

Drive/Photos client IDs are public identifiers; Google OAuth client secrets, Gemini
keys, Supabase service keys, worker secrets and refresh tokens are secrets.

## 4. Supabase readiness

- Keep the `media` bucket private and verify workspace-scoped read/write policies.
- Set the bucket's file-size allowance for the originals you intend to import.
  The new worker persists originals rather than discarding large imports.
- Confirm the existing incremental migrations are applied, particularly transcript
   words, processing leases and `20261003_ai_video_workflow.sql` for AI edit planning.
- Production inspection specifically found the two transactional AI-chat functions
  `submit_ai_chat_job` and `complete_ai_chat_plan` absent. The owner must apply that
  migration through an authorized Supabase connection before using those APIs.
- Configure Supabase Auth site/allowed redirects for the production origin,
  `/auth/callback` and `/auth/update-password`, and local testing if needed.
- The repo still lacks a complete core schema/RLS baseline; do not assume these
  incremental migrations can create a fresh staging database by themselves.

## 5. Deploy and accept

1. Review the diff, commit the intended source changes, and push through your normal
   workflow when ready. The deployment source remains `main`.
2. Deploy the updated worker first; verify `/health`.
3. Deploy the frontend to the existing Vercel `alpha-ai` project, preserving its domains
   and current environment variables.
4. Sign in at `/studio`, upload your own short video, and verify server transcription,
   playable vertical clips and a retained original.
5. Remove a transcript word in the editor, render, and verify audio/video/caption timing.
6. Test a source larger than 45 MB, then reopen its editor after import credentials expire.
7. Connect your own Drive/Photos account if enabled and import selected footage.
8. Connect YouTube, queue a **private** clip, and verify one upload and its external ID.
9. Confirm both cron endpoints reject a missing/wrong Authorization header.

The follow-up verified the production studio tables/workflow RPCs and a private media
bucket without modifying records. Workspace initialization now preserves existing
member roles and subscription plans. These checks do not prove every RLS policy or
replace a real-account upload/OAuth/publishing acceptance run.

Billing enforcement, complete database reconstruction/RLS auditing, full data cleanup,
comprehensive throttling/monitoring, and advanced editorial features remain separate
launch tasks. See `STUDIO-REPORT.md` for the full scope and limitations.
