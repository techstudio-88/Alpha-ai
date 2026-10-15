# Alpha.ai Phase 1 — Backend Foundation Report

Branch: `phase-1/backend-foundation`  
Pull request: [#3 — Phase 1 backend foundation](https://github.com/techstudio-88/Alpha-ai/pull/3)  
Baseline: `main` at `214f4b278e1fb103e2ac8ce52a580dc1ad857c10`  
Production migration status: **APPLIED AND VERIFIED** (`20261015062057`, `20261015_phase_1_backend_foundation`)

## Audit findings before implementation

- Existing production already had `processing_jobs`, lease-based worker recovery, `usage_credits`, a separate `token_ledger`, `daily_usage`, and source fingerprint deduplication. The new AI credit ledger must remain separate from token/reward accounting.
- Existing code and documentation identified production gaps: no comprehensive billed-credit ledger, no complete product-wide video-minute enforcement, no payment provider, no comprehensive rate limiting, and incomplete database reproducibility/RLS verification.
- A live catalog query confirmed RLS is enabled on every ordinary table in the `public` schema. The ownership/role policies still require a table-by-table audit; broad anonymous policies were not blindly removed because anonymous sign-in is part of the existing development/testing flow.
- The deployed worker is responsible for source ingestion, transcription, clip analysis/rendering, and publishing. Changes to worker code and schema must be deployed in compatible order.

## Earlier unfinished work flagged during this audit

- Previously reported upload defects (unauthorized near 88%, incorrect/zero clip durations, retry failures, and long-upload failures) still need end-to-end regression verification; current CI does not prove the live upload path is fixed.
- Google Drive import and transcription progress/recovery (including the earlier 93% stuck state) need live connector/worker verification.
- AI chat history, persisted clip plans, editor timeline, and actual render output must be verified as one real backend workflow; demo-mode UI tests are not proof of production integration.
- Previously requested sidebar/logo/onboarding/workspace-card/editor-layout changes are deliberately deferred because this phase explicitly forbids visual-design work.

## Status by requirement

Status terms below are conservative. A code change is not called complete until CI and the relevant runtime behavior have been verified.

| Requirement | Status | Evidence / remaining work |
|---|---|---|
| Credit ledger | Partial | Additive `credit_ledger` migration, idempotent reserve/refund/admin-adjustment RPCs, authenticated history API, admin adjustment API, and atomic 1-credit reservation for AI-chat job submission. Other job types still need their acceptance paths wired to the ledger. The approved initial policy is 1 AI credit per accepted AI-chat job; operation-specific costs for other job types still need implementation. |
| Refunds | Partial | Worker terminal failures call the refund RPC; SQL guards refunds to failed/dead-letter jobs and uses an idempotency key. The migration is applied; production worker failure/refund behavior still needs an end-to-end test after a compatible worker deployment. |
| UUID/database integrity | Partial | UUID validation added to import ticket/source and job status paths; workflow project/media context checks tightened. A complete audit of every API route and every cross-table ownership relationship remains. |
| Durable jobs | Partial | Existing queue/leases retained; migration adds retry metadata, normalized failure fields, idempotency, output locations, and dead-letter recovery. Backoff and safe error IDs are added to worker failure handling. Migration applied; verify worker restart/recovery against the live worker. |
| Upload/ingestion | Partial | File selection/drop now starts upload automatically; existing TUS chunking/retries remain. URL import requires rights confirmation and worker validation; known YouTube URL variants already have tests. Server-side speed/ETA display, cancellation controls, and comprehensive file/duration checks remain. |
| Daily video-minute limits | Blocked | Schema for daily usage and pending parts exists, but the limit reservation, midnight-in-user-timezone accounting, and FFmpeg boundary-aware splitting are not wired end-to-end. Long videos must not be considered supported until this is done. |
| Pending page/scheduler | Partial | Added a Pending page in Studio, authenticated list/approve/decline/reschedule API, 48-hour expiry worker, and idempotent job-start/job-finish/expiry notifications. Due-part scheduler and actual part render pipeline remain, so approved pending parts do not yet run end-to-end. |
| Plans/entitlements | Partial | Server-owned workspace entitlements define Free/Pro/Studio defaults; FFmpeg export paths now cap resolution and burn the Free watermark, and publishing API/worker check auto-publish/scheduling entitlements. Daily-minute enforcement, regeneration/cover limits, brand-kit limits, and priority-queue enforcement remain. The user approved the provisional Pro allowance of 180 minutes/day, 30 title/description/tag regenerations and 10 cover rotations. No payment provider/purchase flow was added. No payment provider/purchase flow was added. |
| Gemini rotation | Partial | Shared text generation and cached file uploads now use the multi-key failover helper; remaining direct text-generation calls were routed through it, per-key health is persisted by label, and saved cooldowns are restored at worker startup. Provider rotation tests passed in CI; live 429/restart behavior has not been verified against the deployed worker. |
| Rate limiting | Partial | Upstash-backed per-user/per-IP helper wired into email/OAuth authentication attempts, import tickets, source fetch, AI chat, Drive import, publishing, admin diagnostics, and job-status polling. Other endpoints still need coverage. Protected paths return 503 if Redis configuration is absent or unavailable. |
| Security | Partial | Server errors are sanitized in the updated workflow/ingestion paths; private credentials stay in environment variables and Gemini health stores labels only. Full per-endpoint authorization, signed-media URL review, encrypted OAuth token migration, and table-by-table anonymous-policy review remain. |
| Admin diagnostics | Partial | Admin-only diagnostics API is connected to the existing hidden admin page's Diagnostics tab, with queue/job, key-health, publishing and credit-ledger views. Production schema application and live verification remain; upload/export/publish error correlation still needs a completeness audit. |
| Automated tests | Partial | PostgreSQL-WASM ledger tests cover reserve/idempotency/refund/insufficient balance/atomic chat submission. New Gemini tests cover key rotation, health reporting and provider-unavailable retry signaling. Full CI passed on application commit `620ae6aa530bc29334480ca75ae8f4e46edd3467`, including the new Gemini rotation tests. The suite still does not cover every requested isolation, daily-splitting, plan-limit and rate-limit scenario. |

## Environment variables

### Required for this branch's protected rate-limited routes
- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`

Both are still absent from Vercel production. A free Redis-compatible Render Key Value instance was provisioned, but the current rate-limit implementation requires Upstash REST URL/token; that Redis instance is not wired to the app. Protected routes therefore still fail closed with a friendly 503 until a compatible REST endpoint and credentials are configured.

### Gemini key rotation (worker environment only)
- Existing: `GEMINI_API_KEY`
- Optional additional keys: `GEMINI_API_KEY_1`, `GEMINI_API_KEY_2`, `GEMINI_API_KEY_3`, `GEMINI_API_KEY_4`, `GEMINI_API_KEY_5`, or comma-separated `GEMINI_API_KEYS`.
- Shared generation and file uploads use the common rotation helper. Health records contain environment-variable labels, never key values; cooldowns are restored from the database at worker startup. Worker behavior still needs a live deployment test.
- Existing: `GEMINI_MODEL`

Never use `NEXT_PUBLIC_*` for Gemini keys. Do not paste secrets into GitHub or this report.

### Existing Alpha.ai runtime variables to retain
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` or `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- Server-only `SUPABASE_SECRET_KEY` or `SUPABASE_SERVICE_ROLE_KEY`
- `MEDIA_WORKER_URL` (still absent from Vercel production; must point to the intended worker HTTPS endpoint. The existing Render worker is on `main`; the intended Oracle worker endpoint has not been supplied/connected.)
- `MEDIA_WORKER_SECRET`
- `TRANSCRIPTION_PROVIDER`
- `MAX_DOWNLOAD_MB`
- `MAX_JOB_DISK_MB`
- Existing YouTube OAuth variables, `OAUTH_STATE_SECRET` (or `CRON_SECRET` where already supported), and current lifecycle/cron variables must be retained.

No secret values were read into this report.

## Migration to review and run

- `supabase/migrations/20261015_phase_1_backend_foundation.sql`

This migration was applied successfully through the Supabase migration workflow. The recorded database migration version is `20261015062057`. Live verification confirmed the new ledger, usage, pending-part, entitlement and Gemini-health tables exist with RLS enabled, and the reservation/refund/claim/chat/admin RPCs exist. Applying the schema does not mean the full workflow is production-ready; compatible app/worker deployment and runtime tests are still required.

## Approvals and remaining external configuration

The user approved the initial 1-credit-per-AI-chat-job policy, the provisional Pro limits, and the production migration. The migration is now applied and verified. Remaining external configuration: create/provide a compatible Upstash REST endpoint (or adapt the app to the provisioned Redis service), and provide the intended Oracle worker HTTPS endpoint. Do not paste secret values into GitHub or this report.

## Verification log

- Production project lookup: Vercel project accessible; latest deployment was reported `READY` at audit time.
- Supabase project lookup: `gmgswfsajvkiqrpsnuvx` reported `ACTIVE_HEALTHY`.
- Early CI attempts exposed escaped-regex/newline syntax issues and a publish-test fixture missing the new entitlement lookup. These were fixed in subsequent commits.
- Full CI passed on commit `ceaabeef9614de586c07729b815b8dd53f7d3bfb`: lint, unit/database tests, typecheck, production build, and Playwright UI tests. [Verified CI run](https://github.com/techstudio-88/Alpha-ai/actions/runs/38666703528).
- Production migration `20261015_phase_1_backend_foundation` applied successfully; live migration history records version `20261015062057`.
- Live catalog check confirmed all ordinary tables in `public` have RLS enabled; new Phase 1 tables and RPCs are present.
- Vercel production environment names were inspected without reading secret values; `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, and `MEDIA_WORKER_URL` are absent.
- A free Render Key Value instance `alpha-ai-rate-limit-redis` was provisioned in Singapore. It is not yet connected because the current code expects Upstash's REST protocol, and Render Key Value does not provide that REST interface in the available management response.
