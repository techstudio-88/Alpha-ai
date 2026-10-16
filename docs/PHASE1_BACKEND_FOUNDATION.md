# Phase 1 — Backend foundation hardening

This phase changes backend behavior only. It does not redesign the application UI.

## Migration safety

- `20261015_phase_1_backend_foundation.sql` restores the source-controlled baseline for the foundation already present in the live database. The live migration history must be checked before applying anything.
- `20261016_phase_1_runtime_hardening.sql` adds runtime rate-limit, credit-pause/refund, and plan-entitlement enforcement.
- Do not manually re-run the 20261015 baseline against production. Confirm that version is already recorded, inspect the pending diff, then apply only pending migrations after CI passes and production rollout is approved.

Suggested checks from a trusted developer environment:

```sh
npx supabase migration list --project-ref gmgswfsajvkiqrpsnuvx
npx supabase db push --project-ref gmgswfsajvkiqrpsnuvx
```

Run `db push` only after verifying the migration list and obtaining production rollout approval. Do not paste secrets into chat or commit `.env` files.

## Environment variables

Keep existing deployed variable names. The aliases below are alternatives; do not create duplicate keys with different values.

### Vercel / Next.js server

- `SUPABASE_URL` or `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SECRET_KEY` or `SUPABASE_SERVICE_ROLE_KEY` — server only
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` or `NEXT_PUBLIC_SUPABASE_ANON_KEY` — browser-safe publishable/anon key
- `MEDIA_WORKER_URL`
- `MEDIA_WORKER_SECRET` — server-side shared secret only
- `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` — optional distributed rate limiting; database-backed atomic fallback remains available
- Existing publishing/OAuth variables: `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`, `YOUTUBE_REDIRECT_URI`, `OAUTH_STATE_SECRET`
- Existing operational variables: `CRON_SECRET`, `NEXT_PUBLIC_SITE_URL`

### Media worker (Render or the approved replacement host)

- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY` or `SUPABASE_SERVICE_ROLE_KEY` — server only
- `MEDIA_WORKER_SECRET` — must match the Vercel value
- `GEMINI_API_KEY` — supported single-key fallback
- `GEMINI_API_KEY_1` through `GEMINI_API_KEY_5` — optional rotation pool
- `GEMINI_API_KEYS` — optional comma-separated key pool
- `GEMINI_MODEL` — currently documented default: `gemini-2.5-flash`
- `TRANSCRIPTION_PROVIDER`
- `MAX_DOWNLOAD_MB`
- `MAX_JOB_DISK_MB`
- Existing YouTube/OAuth variables required by the publishing worker

Never use a `NEXT_PUBLIC_` prefix for service-role keys, Gemini keys, or worker secrets.

## Acceptance checks

The CI workflow should run:

```sh
npm ci
npm ci --prefix worker
npm run lint
npm run check:syntax
npm test
npm run typecheck
npm run build
npx playwright install --with-deps chromium
npm run test:ui
```

The backend tests include atomic API rate limits, plan-entitlement defaults and changes, title/cover usage idempotency, brand-kit/scheduling/auto-publish caps, daily video-minute splitting and pending parts, credit reservation, provider-pause credit release/reacquisition, terminal refund idempotency, and worker retry policy.

## Rollout blockers

- Confirm the Render workspace before inspecting logs or deploying the worker. Do not deploy until the PR CI run is green.
- Review the Supabase migration list before applying 20261016.
- Enable Supabase Auth password-leak protection in the project Auth settings; this setting is not safely toggled by a SQL migration.
- Verify the worker's live health endpoint, queue recovery, Gemini failover, and a real end-to-end upload/job/credit flow after deployment. Schema and CI tests do not substitute for those production checks.
