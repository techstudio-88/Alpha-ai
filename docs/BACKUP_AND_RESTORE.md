# Alpha.ai Database and Storage Backup & Restore Guide

This document defines the exact procedures for backing up and restoring Alpha.ai's PostgreSQL database (Supabase) and Supabase Storage bucket (`media`).

---

## 1. Scope of Backups

### 1.1 Core Database Tables

The following tables contain critical state and must be included in scheduled snapshots:

| Domain | Tables | Description |
|---|---|---|
| **Workspaces & Auth** | `profiles`, `workspaces`, `workspace_members`, `subscriptions`, `workspace_entitlements` | User identity, multi-tenant workspace associations, and plan entitlements |
| **Media & Projects** | `projects`, `media_assets`, `project_sources`, `videos` | Project hierarchy, raw source file metadata, upload tracking |
| **AI & Transcripts** | `transcripts`, `transcript_segments`, `transcript_words`, `processing_jobs` | Whisper/Gemini transcripts, word-level timestamps, processing job queue |
| **Clips & Edits** | `clips`, `clip_versions`, `clip_scores`, `clip_repurpose_assets`, `clip_schedules` | Generated clips, re-cut boundaries, 4-metric scores, SEO copy, schedules |
| **Publishing** | `publish_connections`, `publish_jobs`, `scheduled_posts`, `posts` | Encrypted YouTube/Instagram OAuth tokens, publish queue, status logs |
| **Accounting & Quota** | `usage_credits`, `credit_ledger`, `daily_usage`, `token_ledger`, `video_usage_daily`, `workspace_feature_usage` | Credit balance, daily video-minute counters, feature regeneration quotas |
| **Governance & Exports**| `export_archives`, `storage_deletion_logs`, `audit_logs`, `notifications`, `brand_kits`, `brand_kit_profiles` | ZIP archive metadata, retention logs, compliance audit trail |

### 1.2 Storage Buckets

- **`media`**: Contains raw video uploads (`<workspaceId>/<projectId>/...`), rendered vertical clips, generated thumbnails (`.jpg`/`.png`), and cached export ZIP archives (`<workspaceId>/<projectId>/exports/...`).

---

## 2. Backup Procedures

### 2.1 Database Full Dump (`pg_dump`)

To create a complete snapshot of the database schema and data:

```bash
# Set database connection string securely (from Supabase dashboard or pooler)
export DB_URL="postgresql://postgres:[YOUR-PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres"

# Dump entire database with custom format (compressed, supports selective restore)
pg_dump "$DB_URL" \
  --format=custom \
  --clean \
  --if-exists \
  --no-owner \
  --no-privileges \
  --schema=public \
  --file="alpha_ai_backup_$(date +%Y%m%d_%H%M%S).dump"

# Plaintext SQL dump for audit and schema inspection
pg_dump "$DB_URL" \
  --format=plain \
  --schema=public \
  --no-owner \
  --no-privileges \
  --file="alpha_ai_schema_$(date +%Y%m%d_%H%M%S).sql"
```

### 2.2 Table-Specific Data Dump

For lightweight, frequent operational backups of ledger, publish connections, and workspace memberships:

```bash
pg_dump "$DB_URL" \
  --table=public.usage_credits \
  --table=public.credit_ledger \
  --table=public.daily_usage \
  --table=public.workspace_entitlements \
  --table=public.publish_connections \
  --table=public.export_archives \
  --table=public.storage_deletion_logs \
  --data-only \
  --file="alpha_ai_ledger_$(date +%Y%m%d).sql"
```

### 2.3 Storage Bucket Backup (`media`)

Supabase Storage is S3-compatible. Use AWS CLI or Supabase CLI to synchronize the `media` bucket to local or offsite backup storage:

```bash
# Configure AWS CLI with Supabase S3 credentials
export AWS_ACCESS_KEY_ID="[SUPABASE-STORAGE-KEY-ID]"
export AWS_SECRET_ACCESS_KEY="[SUPABASE-STORAGE-SECRET]"
export S3_ENDPOINT="https://[PROJECT-REF].supabase.co/storage/v1/s3"

# Mirror the media bucket to an offsite S3-compatible archive
aws s3 sync s3://media ./storage_backup_media/ \
  --endpoint-url="$S3_ENDPOINT" \
  --exclude "*.tmp"
```

---

## 3. Restoration Procedures

### 3.1 Disaster Recovery: Full Database Restore (`pg_restore`)

To restore into a fresh database or staging instance:

```bash
# Ensure target database is clean and accessible
export TARGET_DB_URL="postgresql://postgres:[PASSWORD]@db.[NEW-PROJECT-REF].supabase.co:5432/postgres"

# Restore from the custom-format dump
pg_restore \
  --dbname="$TARGET_DB_URL" \
  --clean \
  --if-exists \
  --no-owner \
  --no-privileges \
  --schema=public \
  --verbose \
  "alpha_ai_backup_20261019_120000.dump"
```

### 3.2 Selective Table Restore

To restore only specific tables (for example, recovering accidentally deleted projects or credit ledger):

```bash
pg_restore \
  --dbname="$TARGET_DB_URL" \
  --table=credit_ledger \
  --table=usage_credits \
  --data-only \
  "alpha_ai_backup_20261019_120000.dump"
```

### 3.3 Storage Bucket Restore

Restore media files back to the Supabase `media` bucket:

```bash
aws s3 sync ./storage_backup_media/ s3://media \
  --endpoint-url="$S3_ENDPOINT" \
  --exact-timestamps
```

---

## 4. Verification & Health Checklist

After any restore operation, run the following verification steps:

1. **Verify Schema & Migrations**:
   ```bash
   npx supabase migration list --project-ref [PROJECT-REF]
   ```
2. **Verify Row Counts**:
   ```sql
   SELECT 'workspaces' as table_name, count(*) FROM public.workspaces
   UNION ALL
   SELECT 'projects', count(*) FROM public.projects
   UNION ALL
   SELECT 'clips', count(*) FROM public.clips
   UNION ALL
   SELECT 'usage_credits', count(*) FROM public.usage_credits
   UNION ALL
   SELECT 'publish_connections', count(*) FROM public.publish_connections;
   ```
3. **Verify Encryption & Secrets**:
   Ensure `MEDIA_WORKER_SECRET` matches the key used to encrypt `publish_connections` and `project_sources`.
4. **Run Application Acceptance Tests**:
   ```bash
   npm test
   npm run check:syntax
   npm run build
   ```
