# Alpha.ai Phase 1 — Backend Foundation Report

Branch: `phase-1/backend-foundation`  
Pull request: [#3 — Phase 1 backend foundation](https://github.com/techstudio-88/Alpha-ai/pull/3)  
Branch head: `f67ddb391030483b9e18f47dbb908dca197523aa` at report preparation  
Production Supabase project: `gmgswfsajvkiqrpsnuvx`  
Production site: https://alpha-ai-techstudio7808-4455.vercel.app

## Audit findings and earlier unfinished work

- Existing production already used `processing_jobs`, worker leases, `usage_credits`, token/reward accounting, daily usage, and source fingerprints. AI credits remain separate from token/reward accounting.
- Earlier reported upload failures (unauthorized near 88%, incorrect/zero clip duration, resumable retries, long uploads), Google Drive import issues, transcription stuck near 93%, chat history, persisted clip plans, and editor timeline still need end-to-end verification against the deployed worker and production UI.
- Visual design tasks (sidebar/logo/onboarding/workspace cards/editor layout) are intentionally excluded from this backend phase.
- The worker service currently tracks the `main` branch; Phase 1 worker code has not been deployed to that service. Do not assume production behavior matches this branch until a compatible worker deployment and runtime checks occur.

## Status by requirement

Status is conservative: code or a passing unit test alone does not prove live production behavior.

| Requirement | Status | Verified evidence and remaining work |
|---|---|---|
| Credit ledger | **Partial** | `credit_ledger` records, idempotency keys, reserve/refund/admin-adjustment RPCs, user transaction-history API, and 1-credit reservation for accepted AI-chat jobs exist. Other job-acceptance paths still need explicit charge policy and integration. |
| Refunds and duplicate requests | **Partial** | Terminal worker failures call an idempotent refund RPC. Reservation/refund and duplicate-claim tests exist. Run live end-to-end tests on actual worker failures and repeated HTTP requests before calling production behavior complete. |
| UUID/database integrity | **Partial** | Server-side UUID validation, job/project/workspace/media-asset integrity trigger, and several workspace ownership checks exist. A live RLS audit found and fixed missing `WITH CHECK` conditions on five legacy UPDATE policies. A complete route-by-route ownership audit remains. |
| RLS and private media | **Partial** | Live catalog check showed RLS enabled on ordinary public tables. Tables without policies are service-role-only/default-deny. The broad policy and grants audit, signed-expiring media URL verification, and encrypted OAuth-token end-to-end checks still need completion. |
| Durable background jobs | **Partial** | Durable queue, lease-based claims, retry/backoff, cancellation checks, recovery scan, error IDs, failure categories, dead-letter state, progress checkpoints, and pending-part scheduler exist. Live restart/cancel/recovery tests and worker deployment verification remain. |
| Upload and ingestion | **Partial** | Server-side size/duration checks, YouTube source recognition, rights confirmation for URL imports, stored original media, and source/asset reuse are implemented in the current code path. Resumable upload and previously reported real-world upload failures need regression verification. |
| Daily minutes and pending parts | **Partial** | Production migrations implement daily usage separate from AI credits, timezone-aware limits (IST fallback), silence-boundary-aware splitting, pending approval/decline/reschedule, scheduler claims, 48-hour expiry, and notifications. The full user-visible 50-minute flow and all day-boundary races need end-to-end verification. |
| Free/Pro/Studio entitlements | **Partial** | Database defaults and server-side resolution/watermark/publishing checks exist; tests verify the defaults. Studio priority ordering is now in the durable queue claim RPC, and a database trigger enforces the combined brand-kit limit across `brand_kits` and `brand_kit_profiles`. Remaining: complete end-to-end coverage of all limits, upgrade responses, and live enforcement. Pro default is 180 minutes/day as the approved provisional value. |
| Gemini key rotation | **Partial** | Worker rotation supports `GEMINI_API_KEY`, `GEMINI_API_KEY_1` through `GEMINI_API_KEY_5`, or `GEMINI_API_KEYS`; generation and file uploads share rotation, key health is stored without values, cooldowns are restored before worker schedulers start, and provider-unavailable responses include retry guidance. Live tests with real configured keys and worker restart are still needed. |
| Rate limiting | **Blocked on configuration** | Per-user/IP/endpoint limits and `Retry-After` responses are implemented. They fail closed when Redis is unavailable. Vercel production currently has none of `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, or `REDIS_URL`, so protected routes can return a safe 503 until a Redis connection is configured. |
| Admin diagnostics | **Partial** | The hidden admin page calls an admin-only diagnostics API for failed jobs, backlog, key health, credit changes, and source/publish failures. Runtime visibility and real production worker metrics still need verification. |
| Automated tests | **Partial** | CI has previously passed lint, syntax, tests, typecheck, build, and Playwright UI checks. Added coverage includes ledger reserve/refund, tenant integrity, long-video splitting, pending-part claims/rescheduling, entitlement defaults, Gemini rotation/failure, and rate limiting. The latest code changes require a fresh complete CI pass; live integration tests are not a substitute for CI. |

## Production migrations applied and verified

Live migration history contains these Phase 1 versions:

- `20261015062057` — `20261015_phase_1_backend_foundation`
- `20261015063111` — `20261015_phase_1_video_scheduler`
- `20261015063508` — `20261015_phase_1_video_scheduler_fix`
- `20261015065623` — `20261015_phase_1_feature_limits`
- `20261015110308` — `20261015_phase_1_feature_limits_idempotency`
- `20261015110548` — `20261015_phase_1_rls_update_checks`
- `20261015110930` — `20261015_phase_1_priority_queue`
- `20261015111118` — `20261015_phase_1_brand_kit_limits`

The feature-limit idempotency fix was applied to production and now reactivates a refunded reservation only if the daily cap still permits it. The RLS update-policy fix was applied and live-verified: all five affected policies now include `WITH CHECK`.

Migration files in the branch:

- `supabase/migrations/20261015_phase_1_backend_foundation.sql`
- `supabase/migrations/20261015_phase_1_video_scheduler.sql`
- `supabase/migrations/20261015_phase_1_feature_limits.sql`
- `supabase/migrations/20261015_phase_1_plan_entitlements.sql`
- `supabase/migrations/20261015_phase_1_feature_limits_idempotency.sql`
- `supabase/migrations/20261015_phase_1_rls_update_checks.sql`
- `supabase/migrations/20261015_phase_1_priority_queue.sql`
- `supabase/migrations/20261015_phase_1_brand_kit_limits.sql`

Do not re-run already recorded migrations manually; use the repository's migration workflow for future changes.

## Environment variables

### Required to enable rate-limited production routes

Configure one option on **Vercel `alpha-ai`**:

- Upstash: `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`, or
- Standard Redis/TLS: `REDIS_URL` (a `redis://` or `rediss://` connection URL).

The Render Key Value service `alpha-ai-rate-limit-redis` exists, but its connection URL/credentials are not exposed by the connected Render management API. Do not invent a URL or copy credentials into source control.

### Worker environment

- Existing: `GEMINI_API_KEY`, `GEMINI_MODEL`
- Optional rotation keys: `GEMINI_API_KEY_1`, `GEMINI_API_KEY_2`, `GEMINI_API_KEY_3`, `GEMINI_API_KEY_4`, `GEMINI_API_KEY_5`, or comma-separated `GEMINI_API_KEYS`
- Retain: `SUPABASE_URL`, `SUPABASE_SECRET_KEY` or `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_PUBLISHABLE_KEY` or `SUPABASE_ANON_KEY`, `MEDIA_WORKER_SECRET`, `TRANSCRIPTION_PROVIDER`, `MAX_DOWNLOAD_MB`, `MAX_JOB_DISK_MB`, and existing YouTube client variables.

### Vercel application environment

Retain:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` or `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- Server-only `SUPABASE_SECRET_KEY` or `SUPABASE_SERVICE_ROLE_KEY`
- `MEDIA_WORKER_SECRET`
- `CRON_SECRET` and/or `OAUTH_STATE_SECRET` where existing routes require them
- Existing YouTube OAuth variables

`MEDIA_WORKER_URL` is currently absent from Vercel production. The code falls back to the Render worker URL, but that Render service currently tracks `main`, not this Phase 1 branch. Set `MEDIA_WORKER_URL` only after the intended compatible worker endpoint is deployed. The Oracle HTTPS endpoint has not been provided or connected yet.

Never place Gemini keys, service-role keys, worker secrets, OAuth tokens, or Redis tokens in `NEXT_PUBLIC_*`, GitHub source, or logs. No secret values are recorded in this report.

## Approval and blockers

The user approved the 1-credit-per-AI-chat-job policy, provisional Pro limits, production migration, and continuation of Phase 1 work. The database migrations above have been applied.

Still blocked on external configuration/deployment:

1. Configure Redis/Upstash connection for Vercel production; current protected routes fail closed without it.
2. Provide/deploy the intended Oracle worker HTTPS endpoint, or explicitly choose the existing Render worker and update it to the compatible Phase 1 code. The connected Render API cannot change the worker's branch, and this agent must not deploy incompatible code to the production worker.
3. Configure additional Gemini keys if the expected request volume needs them. A key count cannot guarantee throughput because quotas depend on the selected Gemini model, project tier, and per-model limits.

## Latest verification

- Live Supabase migration history verified the six Phase 1 migrations listed above.
- Live RLS query verified `WITH CHECK` exists on the five repaired UPDATE policies.
- Live catalog checks verified the Studio priority queue function and both brand-kit limit triggers are installed.
- Earlier complete CI run passed on commit `3dfac2c0b73f2ebe8517e26a45d10b45ffb93b62`: [GitHub Actions run](https://github.com/techstudio-88/Alpha-ai/actions/runs/38724895705).
- Additional worker, tool-generation, Google Photos/Drive, and clip-API hardening commits were pushed after that run. CI for the newest commit must finish successfully before this branch can be considered code-verified.
- Production site and worker have not been verified end-to-end against the latest branch. Phase 1 is **not complete** while the Redis and compatible worker deployment blockers remain.
