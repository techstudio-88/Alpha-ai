# Alpha.ai Phase 1 — Backend Foundation Report

Branch: `phase-1/backend-foundation`  
Pull request: [#3 — Phase 1 backend foundation](https://github.com/techstudio-88/Alpha-ai/pull/3)  
Baseline: `main` at `214f4b278e1fb103e2ac8ce52a580dc1ad857c10`  
Production migration status: **NOT APPLIED**

## Audit findings before implementation

- Existing production already had `processing_jobs`, lease-based worker recovery, `usage_credits`, a separate `token_ledger`, `daily_usage`, and source fingerprint deduplication. The new AI credit ledger must remain separate from token/reward accounting.
- Existing code and documentation identified production gaps: no comprehensive billed-credit ledger, no complete product-wide video-minute enforcement, no payment provider, no comprehensive rate limiting, and incomplete database reproducibility/RLS verification.
- Supabase reports RLS enabled on public tables, but also warns that multiple policies permit anonymous-role access. These policies need a table-by-table ownership review; they were not blindly removed because anonymous sign-in is part of the existing development/testing flow.
- The deployed worker is responsible for source ingestion, transcription, clip analysis/rendering, and publishing. Changes to worker code and schema must be deployed in compatible order.

## Status by requirement

Status terms below are conservative. A code change is not called complete until CI and the relevant runtime behavior have been verified.

| Requirement | Status | Evidence / remaining work |
|---|---|---|
| Credit ledger | Partial | Additive `credit_ledger` migration, idempotent reserve/refund/admin-adjustment RPCs, authenticated history API, admin adjustment API, and atomic 1-credit reservation for AI-chat job submission. Other job types still need their acceptance paths wired to the ledger. Cost per operation is not yet fully specified. |
| Refunds | Partial | Worker terminal failures call the refund RPC; SQL guards refunds to failed/dead-letter jobs and uses an idempotency key. End-to-end production failure/refund test awaits migration and deployment. |
| UUID/database integrity | Partial | UUID validation added to import ticket/source and job status paths; workflow project/media context checks tightened. A complete audit of every API route and every cross-table ownership relationship remains. |
| Durable jobs | Partial | Existing queue/leases retained; migration adds retry metadata, normalized failure fields, idempotency, output locations, and dead-letter recovery. Backoff and safe error IDs are added to worker failure handling. Must apply migration and verify worker restart/recovery in a live worker. |
| Upload/ingestion | Partial | File selection/drop now starts upload automatically; existing TUS chunking/retries remain. URL import requires rights confirmation and worker validation; known YouTube URL variants already have tests. Server-side speed/ETA display, cancellation controls, and comprehensive file/duration checks remain. |
| Daily video-minute limits | Blocked | Schema for daily usage and pending parts exists, but the limit reservation, midnight-in-user-timezone accounting, and FFmpeg boundary-aware splitting are not wired end-to-end. Long videos must not be considered supported until this is done. |
| Pending page/scheduler | Partial | Authenticated list/approve/decline/reschedule API, 48-hour expiry worker, and idempotent job-start/job-finish/expiry notifications added. Due-part scheduler and actual part render pipeline remain, so approved pending parts do not yet run end-to-end. |
| Plans/entitlements | Partial | Server-owned workspace entitlements define Free/Pro/Studio defaults; FFmpeg export paths now cap resolution and burn the Free watermark, and publishing API/worker check auto-publish/scheduling entitlements. Daily-minute enforcement, regeneration/cover limits, brand-kit limits, and priority-queue enforcement remain. Pro is set to 180 minutes/day as a provisional value requiring approval. No payment provider/purchase flow was added. |
| Gemini rotation | Partial | Worker chat planning rotates across the primary key and optional keys 2–5, retries transient failures, applies cooldowns, and records health by environment label only. Other direct Gemini worker paths still use the primary key; durable cooldown recovery across worker restarts is not complete. |
| Rate limiting | Partial | Upstash-backed per-user/per-IP helper wired into import tickets, source fetch, AI chat, Drive import, and job-status polling. Other endpoints still need coverage. Protected paths return 503 if Redis configuration is absent or unavailable. |
| Security | Partial | Server errors are sanitized in the updated workflow/ingestion paths; private credentials stay in environment variables and Gemini health stores labels only. Full per-endpoint authorization, signed-media URL review, encrypted OAuth token migration, and table-by-table anonymous-policy review remain. |
| Admin diagnostics | Partial | Admin-only diagnostics API and credit adjustment API added; existing hidden admin page already exists but the new diagnostics endpoint is not yet integrated into its UI. Publish failure IDs and normalized categories are now stored; broader upload/export failure correlation remains. |
| Automated tests | Pending | New PostgreSQL-WASM tests cover reserve/idempotency/refund/insufficient balance/atomic chat submission. CI lint failed on an escaped-regex/newline syntax issue, which has been corrected in the branch; a fresh CI run is required. Build/typecheck/test results are not yet verified. |

## Environment variables

### Required for this branch's protected rate-limited routes
- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`

Both must be configured in Vercel server environments. Without them, rate-limited endpoints intentionally fail closed with a friendly 503.

### Gemini key rotation (worker environment only)
- Existing: `GEMINI_API_KEY`
- Optional additional keys: `GEMINI_API_KEY_2`, `GEMINI_API_KEY_3`, `GEMINI_API_KEY_4`, `GEMINI_API_KEY_5`
- Existing: `GEMINI_MODEL`

Never use `NEXT_PUBLIC_*` for Gemini keys. Do not paste secrets into GitHub or this report.

### Existing Alpha.ai runtime variables to retain
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` or `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- Server-only `SUPABASE_SECRET_KEY` or `SUPABASE_SERVICE_ROLE_KEY`
- `MEDIA_WORKER_URL`
- `MEDIA_WORKER_SECRET`
- `TRANSCRIPTION_PROVIDER`
- `MAX_DOWNLOAD_MB`
- `MAX_JOB_DISK_MB`
- Existing YouTube OAuth variables, `OAUTH_STATE_SECRET` (or `CRON_SECRET` where already supported), and current lifecycle/cron variables must be retained.

No secret values were read into this report.

## Migration to review and run

- `supabase/migrations/20261015_phase_1_backend_foundation.sql`

This migration is **not applied to production**. It adds credit accounting, server-owned entitlements, daily video usage, pending parts, Gemini key health, and processing-job recovery columns/RPCs. Review it against the current schema and run it through the authorized Supabase migration workflow before deploying code that references its new tables/columns. Do not deploy the new worker/API branch to production first.

## Approval needed

1. Confirm that **1 AI credit per accepted AI-chat job** is an acceptable initial cost. Other operation-specific credit costs need a product decision.
2. Configure the two Upstash variables in Vercel before enabling the rate-limited routes.
3. Review/apply the migration only after CI passes and the SQL has been checked against production schema.
4. Approve the follow-up work for daily-minute splitting/scheduling, full entitlement enforcement, all-endpoint authorization/rate limits, and Gemini rotation across every direct provider call.

## Verification log

- Production project lookup: Vercel project accessible; latest deployment was reported `READY` at audit time.
- Supabase project lookup: `gmgswfsajvkiqrpsnuvx` reported `ACTIVE_HEALTHY`.
- Early CI attempts exposed escaped-regex/newline syntax issues and a publish-test fixture missing the new entitlement lookup. These were fixed in subsequent commits.
- A fresh CI run is currently running on the latest branch commit. Do not treat the branch as production-ready until lint, syntax, tests, typecheck, build, and UI tests all pass.
