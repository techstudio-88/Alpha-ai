-- Compatibility migration marker for 20261015110930 / 20261015_phase_1_priority_queue.
-- The original SQL file was absent from repository history, but this version is
-- already recorded as applied in the live Supabase project.
-- The restored bootstrap snapshot 20261015062057_phase_1_backend_foundation.sql
-- is reconstructed from the live final schema and already contains these objects
-- and behaviors. This marker intentionally performs no additional DDL so clean
-- installs reproduce the same final state without reapplying non-idempotent
-- historical changes. Keep the version/name aligned with Supabase migration history.
select 1;
