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
      create table public.credit_ledger(
        id uuid primary key default gen_random_uuid(), workspace_id uuid, user_id uuid, job_id uuid,
        amount integer, transaction_type text, reason text, idempotency_key text unique,
        created_at timestamptz default now()
      );
      create table public.processing_jobs(
        id uuid primary key, workspace_id uuid, project_id uuid, status text, reserved_credits integer,
        payload jsonb default '{}'::jsonb, updated_at timestamptz default now()
      );
      create table public.usage_credits(
        id uuid primary key default gen_random_uuid(), workspace_id uuid, user_id uuid,
        credits integer not null default 0, updated_at timestamptz default now(), unique(workspace_id,user_id)
      );
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

test("failed and cancelled job credit refunds are idempotent", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create schema if not exists public;
      create table public.api_rate_limits(
        id uuid primary key default gen_random_uuid(), key_hash text not null, route text not null,
        window_start timestamptz not null, request_count integer not null default 0,
        unique(key_hash,route,window_start)
      );
      create table public.credit_ledger(
        id uuid primary key default gen_random_uuid(), workspace_id uuid, user_id uuid, job_id uuid,
        amount integer, transaction_type text, reason text, idempotency_key text unique,
        created_at timestamptz default now()
      );
      create table public.processing_jobs(
        id uuid primary key, workspace_id uuid, project_id uuid, status text, reserved_credits integer,
        payload jsonb default '{}'::jsonb, updated_at timestamptz default now()
      );
      create table public.usage_credits(
        id uuid primary key default gen_random_uuid(), workspace_id uuid, user_id uuid,
        credits integer not null default 0, updated_at timestamptz default now(), unique(workspace_id,user_id)
      );
      create table public.pending_processing_parts(job_id uuid,media_asset_id uuid,project_id uuid,user_id uuid,workspace_id uuid);
      create table public.video_usage_daily(user_id uuid);
      create table public.workspace_feature_usage(user_id uuid);
      create role anon;
      create role authenticated;
      create role service_role;
    `);
    const sql = await readFile(new URL("../supabase/migrations/20261016_phase_1_runtime_hardening.sql", import.meta.url), "utf8");
    await db.exec(sql);
    const workspace="11111111-1111-4111-8111-111111111111";
    const user="22222222-2222-4222-8222-222222222222";
    const job="33333333-3333-4333-8333-333333333333";
    await db.query("insert into public.usage_credits(workspace_id,user_id,credits) values($1,$2,0)",[workspace,user]);
    await db.query("insert into public.processing_jobs(id,workspace_id,status,reserved_credits) values($1,$2,'cancelled',5)",[job,workspace]);
    await db.query("insert into public.credit_ledger(workspace_id,user_id,job_id,amount,transaction_type,reason,idempotency_key) values($1,$2,$3,-5,'reserve','test reserve',$4)",[workspace,user,job,"job:"+job+":reserve"]);
    await db.query("select public.refund_failed_job_credits($1,$2,$3,$4,$5)",[workspace,job,user,"cancelled test","job:"+job+":refund"]);
    await db.query("select public.refund_failed_job_credits($1,$2,$3,$4,$5)",[workspace,job,user,"cancelled test","job:"+job+":refund"]);
    assert.equal((await db.query("select credits from public.usage_credits where workspace_id=$1 and user_id=$2",[workspace,user])).rows[0].credits,5);
    assert.equal((await db.query("select count(*)::int as n from public.credit_ledger where job_id=$1 and transaction_type='refund'",[job])).rows[0].n,1);
  } finally {
    await db.close();
  }
});

test("the restored Phase 1 foundation migration builds on the pre-Phase-1 schema", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create schema auth;
      create schema private;
      create role anon;
      create role authenticated;
      create role service_role;
      create table auth.users(id uuid primary key,email text);
      create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
      create table public.workspaces(id uuid primary key,name text,owner_id uuid,created_at timestamptz default now());
      create table public.workspace_members(workspace_id uuid,user_id uuid,role text,created_at timestamptz default now());
      create table public.projects(id uuid primary key,workspace_id uuid,owner_id uuid,name text,created_at timestamptz default now());
      create table public.media_assets(id uuid primary key,project_id uuid,workspace_id uuid,storage_path text,duration_seconds numeric,created_at timestamptz default now());
      create table public.processing_jobs(
        id uuid primary key,workspace_id uuid,project_id uuid,job_type text not null default 'process_media',
        status text not null default 'queued',progress integer not null default 0,payload jsonb not null default '{}'::jsonb,
        error text,created_at timestamptz default now(),updated_at timestamptz default now()
      );
      create table public.ai_chat_sessions(id uuid primary key,workspace_id uuid,user_id uuid,title text,project_id uuid,media_asset_id uuid,updated_at timestamptz default now());
      create table public.ai_chat_messages(id uuid primary key,session_id uuid,workspace_id uuid,user_id uuid,role text,content text,metadata jsonb default '{}'::jsonb);
      create table public.control_center_members(email text,active boolean default true);
      create function private.issue_processing_ticket(p_workspace_id uuid,p_project_id uuid,p_source_id uuid,p_job_id uuid,p_media_asset_id uuid)
        returns table(ticket text,expires_at timestamptz) language sql as $$ select null::text,now() $$;
    `);
    const sql = await readFile(new URL("../supabase/migrations/20261015_phase_1_backend_foundation.sql", import.meta.url), "utf8");
    await db.exec(sql);
    const tables = (await db.query("select table_name from information_schema.tables where table_schema='public' and table_name=any($1)",[[
      "usage_credits","credit_ledger","pending_processing_parts","video_usage_daily","workspace_entitlements","workspace_feature_usage","gemini_key_health","api_rate_limits"
    ]])).rows.map(row=>row.table_name).sort();
    assert.equal(tables.length,8);
    assert.ok((await db.query("select count(*)::int as n from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='reserve_job_credits'")).rows[0].n===1);
    assert.ok((await db.query("select relrowsecurity from pg_class where oid='public.credit_ledger'::regclass")).rows[0].relrowsecurity);

    const workspace="44444444-4444-4444-8444-444444444444";
    const user="55555555-5555-4555-8555-555555555555";
    const project="66666666-6666-4666-8666-666666666666";
    const asset="77777777-7777-4777-8777-777777777777";
    const job="88888888-8888-4888-8888-888888888888";
    await db.query("insert into auth.users(id,email) values($1,'phase1@example.test')",[user]);
    await db.query("insert into public.workspaces(id) values($1)",[workspace]);
    await db.query("insert into public.workspace_members(workspace_id,user_id) values($1,$2)",[workspace,user]);
    await db.query("insert into public.projects(id,workspace_id) values($1,$2)",[project,workspace]);
    await db.query("insert into public.media_assets(id,project_id,workspace_id,duration_seconds) values($1,$2,$3,2100)",[asset,project,workspace]);
    await db.query("insert into public.processing_jobs(id,workspace_id,project_id,job_type,status,payload) values($1,$2,$3,'process_media','processing','{}'::jsonb)",[job,workspace,project]);
    const planned=(await db.query("select public.plan_video_processing_parts($1,$2,$3,$4,$5,$6,$7,$8) as plan",[workspace,project,user,job,asset,2100,"Asia/Kolkata","[]"])).rows[0].plan;
    assert.equal(planned.split,true,"35 minutes must split against the free 20-minute daily allowance");
    assert.equal(planned.deferCurrent,false,"The first segment should use today's available allowance");
    assert.equal(planned.partStartSeconds,0);
    assert.ok(Number(planned.partEndSeconds)<=1200.01&&Number(planned.partEndSeconds)>1190);
    assert.equal(planned.pendingParts,1);
    assert.equal((await db.query("select count(*)::int as n from public.pending_processing_parts where parent_job_id=$1 and status='pending'",[job])).rows[0].n,1);
    await db.query("select public.finish_video_usage_for_job($1,true)",[job]);
    const usage=(await db.query("select minutes_reserved,minutes_completed from public.video_usage_daily where workspace_id=$1 and user_id=$2",[workspace,user])).rows[0];
    assert.equal(Number(usage.minutes_reserved),0);
    assert.ok(Number(usage.minutes_completed)>=19.9&&Number(usage.minutes_completed)<=20.1);
  } finally {
    await db.close();
  }
});
