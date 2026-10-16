import test from "node:test";
import assert from "node:assert/strict";
import {PGlite} from "@electric-sql/pglite";
import {readFile} from "node:fs/promises";

test("Phase 1 rate limit migration atomically caps a fixed-window key and route", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create schema if not exists public;
      create table public.api_rate_limits(
        id uuid primary key default gen_random_uuid(),
        key_hash text not null,
        route text not null,
        window_start timestamptz not null,
        request_count integer not null default 0,
        unique(key_hash, route, window_start)
      );
      create table public.credit_ledger(user_id uuid);
      create table public.pending_processing_parts(
        job_id uuid, media_asset_id uuid, project_id uuid, user_id uuid, workspace_id uuid
      );
      create table public.video_usage_daily(user_id uuid);
      create table public.workspace_feature_usage(user_id uuid);
      create role anon;
      create role authenticated;
      create role service_role;
    `);
    const sql = await readFile(new URL("../supabase/migrations/20261016_phase_1_runtime_hardening.sql", import.meta.url), "utf8");
    await db.exec(sql);
    const key = "a".repeat(64);
    const invoke = () => db.query(
      "select public.consume_api_rate_limit($1,$2,$3,$4) as result",
      [key, "/api/ai/chat/plan", 2, 60]
    );
    const first = (await invoke()).rows[0].result;
    const second = (await invoke()).rows[0].result;
    const third = (await invoke()).rows[0].result;
    assert.equal(first.allowed, true);
    assert.equal(second.allowed, true);
    assert.equal(third.allowed, false);
    assert.equal(third.count, 3);
    assert.equal(third.limit, 2);
    await assert.rejects(
      db.query("select public.consume_api_rate_limit($1,$2,$3,$4)", ["not-a-hash", "/x", 2, 60]),
      /Invalid API rate-limit request/
    );
  } finally {
    await db.close();
  }
});

test("rate limiting hashes identities and never stores raw user or API keys", async () => {
  const sql = await readFile(new URL("../supabase/migrations/20261016_phase_1_runtime_hardening.sql", import.meta.url), "utf8");
  assert.match(sql, /p_key_hash text/);
  assert.match(sql, /'\^\[a-f0-9\]\{64\}\$'/);
  assert.match(sql, /revoke all on function public\.consume_api_rate_limit[\s\S]*from public, anon, authenticated/i);
  assert.match(sql, /grant execute on function public\.consume_api_rate_limit[\s\S]*to service_role/i);
});
