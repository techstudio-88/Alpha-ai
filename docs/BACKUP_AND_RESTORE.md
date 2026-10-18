# Alpha.ai Database and Storage Backup & Restore Guide

This document defines the exact procedures for backing up and restoring Alpha.ai's PostgreSQL database (Supabase) and Supabase Storage bucket (`media`).

---

## 1. Scope of Backups (Requirement #0)

### 1.1 Tables Requiring Daily Automated Backups (Point-in-Time Recovery / pg_dump)

- **Identity & Tenancy**: `auth.users`, `public.profiles`, `public.workspaces`, `public.workspace_members`, `public.subscriptions`
- **Billing & Quotas**: `public.token_ledger`, `public.credit_ledger`, `public.daily_usage`, `public.promotion_claims`, `public.usage_credits`, `public.workspace_entitlements`
- **Projects & Editorial State**: `public.projects`, `public.project_sources`, `public.media_assets`, `public.videos`, `public.transcripts`, `public.transcript_segments`, `public.transcript_words`, `public.clips`, `public.clip_versions`, `public.clip_scores`, `public.clip_repurpose_assets`
- **Queues, Publishing & Audit**: `public.processing_jobs`, `public.pending_video_parts`, `public.publish_connections`, `public.publish_jobs`, `public.export_archives`, `public.storage_deletion_logs`, `public.audit_logs`, `public.user_consent_events`

### 1.2 Storage Buckets Requiring Backup

- **Bucket `media`**: Specifically active `<workspace_id>/<project_id>/source-*.mp4`, `/clips/*/v*.mp4`, `/thumbnails/*.jpg`, and `/exports/*.zip` within their retention window, plus permanent brand-kit logos.

---

## 2. How to Back Up & Restore

### 2.1 Database Backup
Run `pg_dump` with custom format:
```bash
pg_dump --format=custom --no-acl --no-owner "$SUPABASE_DB_URL" -f alpha_backup_$(date +%F).dump
```

### 2.2 Database Restore
Restore with automatic cleanup of existing objects:
```bash
pg_restore --clean --if-exists --no-acl --no-owner -d "$SUPABASE_DB_URL" alpha_backup_YYYY-MM-DD.dump
```

### 2.3 Storage Backup & Restore
Supabase Storage is S3-compatible. Use AWS CLI or Supabase S3 protocol:

**Backup Storage:**
```bash
aws s3 sync s3://media s3://media-backup --endpoint-url https://<project_ref>.supabase.co/storage/v1/s3
```

**Storage Restore:**
Sync object prefixes back to `supabase.storage.from('media')` via Supabase Storage S3 protocol:
```bash
aws s3 sync s3://media-backup s3://media --endpoint-url https://<project_ref>.supabase.co/storage/v1/s3
```

---

## 3. Platform Limitations & Approval Submissions (Requirement #7)

### 3.1 YouTube Data API v3 (`youtube.upload` scope)
- **Limitation**: Until Google completes OAuth Trust & Safety verification for your Google Cloud project, all videos uploaded via the API by external users are locked to private by YouTube unless your app is verified, and unverified apps are capped at 100 test users. Default quota is 10,000 units/day (each video upload costs 1,600 units = ~6 uploads/day on default quota).
- **What You Must Submit to Google**:
  1. **OAuth Brand Verification**: verified domain ownership in Google Search Console, homepage link to `/privacy` and `/terms`.
  2. **Sensitive/Restricted Scope Verification** for `https://www.googleapis.com/auth/youtube.upload` with a YouTube screencast video showing the full OAuth consent screen, connecting a channel, and publishing a clip in Alpha AI.
  3. **YouTube API Quota Extension form** requesting 100,000+ units/day.

### 3.2 Instagram Graph API (`instagram_content_publish`, `instagram_basic`, `pages_show_list`)
- **Limitation**: Instagram's API does not support Personal Instagram accounts—users must have an Instagram Business or Creator account linked to a Facebook Page. Reel uploads use a 2-step container flow (`POST /<ig-user-id>/media` with `media_type=REELS` and a public/signed video URL, polling container status until `FINISHED`, then `POST /<ig-user-id>/media_publish`), capped at 50 API-published posts per 24 hours per account.
- **What You Must Submit to Meta App Review**:
  1. **Meta Business Verification** in Meta Business Suite.
  2. **App Review submission** for `instagram_basic`, `instagram_content_publish`, and `pages_read_engagement` with screen recordings showing the OAuth login, account connection, and Reel publishing inside Alpha AI.
