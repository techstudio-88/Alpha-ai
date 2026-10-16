# Phase 1 — Backend foundation hardening

This phase changes backend behavior only. It does not redesign the application UI.

## Migration safety

- `supabase/migrations/20261015062057_phase_1_backend_foundation.sql` restores the missing source for a migration version already recorded in production. It is an idempotent bootstrap snapshot reconstructed from the live final schema so clean installs can build the Phase 1 foundation.
- Seven later Phase 1 migration source files were also absent from repository history. Their versioned compatibility files are intentionally no-ops because their final schema/function behavior is already represented in the bootstrap snapshot; this is documented in each file rather than pretending their original SQL was recovered.
- `tests/fixtures/phase1_backend_foundation_baseline.sql` is a test-only mirror of the bootstrap snapshot. It is not a deployable migration.
- Production already has the 2026-10-15 Phase 1 migration versions recorded. The only new deployable migration in this branch is `20261016113000_phase_1_runtime_hardening.sql`, which adds runtime rate-limit, credit-pause/refund, and plan-entitlement enforcement.
- Never apply the test fixture or re-run already-recorded migration versions against production. Review the full migration list and pending diff, then apply only the new timestamped runtime migration after CI passes and production rollout is approved.

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
