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
      create table public.workspace_entitlements(workspace_id uuid primary key,brand_kit_limit integer default 1,scheduling_enabled boolean default false,auto_publish boolean default false);
      create table public.brand_kits(id uuid primary key default gen_random_uuid(),workspace_id uuid not null);
      create table public.brand_kit_profiles(id uuid primary key default gen_random_uuid(),workspace_id uuid not null);
      create table public.clip_schedules(id uuid primary key default gen_random_uuid(),workspace_id uuid not null,scheduled_for timestamptz not null);
      create table public.scheduled_posts(id uuid primary key default gen_random_uuid(),workspace_id uuid not null,scheduled_for timestamptz);
      create table public.content_plans(id uuid primary key default gen_random_uuid(),workspace_id uuid,scheduled_for timestamptz);
      create table public.publish_jobs(id uuid primary key default gen_random_uuid(),workspace_id uuid,scheduled_for timestamptz,metadata jsonb not null default '{}'::jsonb);
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

    const workspace="dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    await db.query("insert into public.workspace_entitlements(workspace_id,brand_kit_limit,scheduling_enabled,auto_publish) values($1,1,false,false)",[workspace]);
    await db.query("insert into public.brand_kits(workspace_id) values($1)",[workspace]);
    await assert.rejects(db.query("insert into public.brand_kits(workspace_id) values($1)",[workspace]),/BRAND_KIT_LIMIT_REACHED/);
    await assert.rejects(db.query("insert into public.clip_schedules(workspace_id,scheduled_for) values($1,now()+interval '1 day')",[workspace]),/SCHEDULING_NOT_INCLUDED_IN_PLAN/);
    await assert.rejects(db.query("insert into public.publish_jobs(workspace_id,scheduled_for,metadata) values($1,now(),$2::jsonb)",[workspace,JSON.stringify({auto_publish:true})]),/AUTO_PUBLISH_NOT_INCLUDED_IN_PLAN/);
    await db.query("update public.workspace_entitlements set scheduling_enabled=true,auto_publish=true where workspace_id=$1",[workspace]);
    await db.query("insert into public.clip_schedules(workspace_id,scheduled_for) values($1,now()+interval '1 day')",[workspace]);
    await db.query("insert into public.publish_jobs(workspace_id,scheduled_for,metadata) values($1,now(),$2::jsonb)",[workspace,JSON.stringify({auto_publish:true})]);
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
      create table public.workspace_entitlements(workspace_id uuid primary key,brand_kit_limit integer default 1,scheduling_enabled boolean default false,auto_publish boolean default false);
      create table public.brand_kits(id uuid primary key default gen_random_uuid(),workspace_id uuid not null);
      create table public.brand_kit_profiles(id uuid primary key default gen_random_uuid(),workspace_id uuid not null);
      create table public.clip_schedules(id uuid primary key default gen_random_uuid(),workspace_id uuid not null,scheduled_for timestamptz not null);
      create table public.scheduled_posts(id uuid primary key default gen_random_uuid(),workspace_id uuid not null,scheduled_for timestamptz);
      create table public.content_plans(id uuid primary key default gen_random_uuid(),workspace_id uuid,scheduled_for timestamptz);
      create table public.publish_jobs(id uuid primary key default gen_random_uuid(),workspace_id uuid,scheduled_for timestamptz,metadata jsonb not null default '{}'::jsonb);
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
      create table public.media_assets(id uuid primary key,project_id uuid,workspace_id uuid,storage_path text,duration_seconds numeric,status text default 'uploaded',created_at timestamptz default now());
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
    await db.exec(`
      create table public.brand_kits(id uuid primary key default gen_random_uuid(),workspace_id uuid not null);
      create table public.brand_kit_profiles(id uuid primary key default gen_random_uuid(),workspace_id uuid not null);
      create table public.clip_schedules(id uuid primary key default gen_random_uuid(),workspace_id uuid not null,scheduled_for timestamptz not null);
      create table public.scheduled_posts(id uuid primary key default gen_random_uuid(),workspace_id uuid not null,scheduled_for timestamptz);
      create table public.content_plans(id uuid primary key default gen_random_uuid(),workspace_id uuid,scheduled_for timestamptz);
      create table public.publish_jobs(id uuid primary key default gen_random_uuid(),workspace_id uuid,scheduled_for timestamptz,metadata jsonb not null default '{}'::jsonb);
    `);
    const runtimeSql = await readFile(new URL("../supabase/migrations/20261016_phase_1_runtime_hardening.sql", import.meta.url), "utf8");
    await db.exec(runtimeSql);
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
    await db.query("insert into public.processing_jobs(id,workspace_id,project_id,job_type,status,payload) values($1,$2,$3,'process_media','processing',$4::jsonb)",[job,workspace,project,JSON.stringify({requestedBy:user})]);
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
    await db.query("update public.processing_jobs set status='completed' where id=$1",[job]);

    await db.query("insert into public.usage_credits(workspace_id,user_id,credits) values($1,$2,1)",[workspace,user]);
    const chatSession="99999999-9999-4999-8999-999999999999";
    const chatJob="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const chatPayload={operation:"ai_chat_plan",sessionId:chatSession,mediaAssetId:asset,workspaceId:workspace,projectId:project,requestedBy:user,prompt:"Create a short"};
    const submitChat=()=>db.query("select public.submit_ai_chat_job($1,$2,$3,$4,$5,$6,$7,$8)",[chatJob,chatSession,workspace,user,project,asset,"Create a short",chatPayload]);
    await submitChat();
    await submitChat();
    assert.equal((await db.query("select credits from public.usage_credits where workspace_id=$1 and user_id=$2",[workspace,user])).rows[0].credits,0,"An accepted AI-chat job must reserve one credit and finish at zero balance");
    assert.equal((await db.query("select count(*)::int as n from public.credit_ledger where job_id=$1 and transaction_type='reserve'",[chatJob])).rows[0].n,1,"Replaying an accepted job must not charge twice");
    const zeroSession="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const zeroJob="cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    await assert.rejects(db.query("select public.submit_ai_chat_job($1,$2,$3,$4,$5,$6,$7,$8)",[zeroJob,zeroSession,workspace,user,project,asset,"No balance",{...chatPayload,sessionId:zeroSession}]),/credit/i);
    assert.equal((await db.query("select count(*)::int as n from public.processing_jobs where id=$1",[zeroJob])).rows[0].n,0,"A zero-balance job must not be accepted");
    assert.equal((await db.query("select count(*)::int as n from public.ai_chat_messages where session_id=$1",[zeroSession])).rows[0].n,0,"A failed reservation must roll back the chat message");

    await db.query("select public.release_job_credits_for_provider_pause($1,$2,$3,$4,$5)",[workspace,chatJob,user,"Gemini provider outage","job:"+chatJob+":provider_pause:1"]);
    assert.equal((await db.query("select credits from public.usage_credits where workspace_id=$1 and user_id=$2",[workspace,user])).rows[0].credits,1,"A provider outage must release the reserved credit while the job is paused");
    assert.equal((await db.query("select reserved_credits from public.processing_jobs where id=$1",[chatJob])).rows[0].reserved_credits,0);
    await db.query("select public.reserve_job_credits($1,$2,$3,1,$4,$5)",[workspace,chatJob,user,"Credit reservation after provider recovery","job:"+chatJob+":resume:1"]);
    assert.equal((await db.query("select credits from public.usage_credits where workspace_id=$1 and user_id=$2",[workspace,user])).rows[0].credits,0,"A resumed job reacquires its credit reservation");
    await db.query("update public.processing_jobs set status='failed' where id=$1",[chatJob]);
    await db.query("select public.refund_failed_job_credits($1,$2,$3,$4,$5)",[workspace,chatJob,user,"Terminal failure after resume","job:"+chatJob+":refund:1"]);
    await db.query("select public.refund_failed_job_credits($1,$2,$3,$4,$5)",[workspace,chatJob,user,"Duplicate terminal refund","job:"+chatJob+":refund:1"]);
    assert.equal((await db.query("select credits from public.usage_credits where workspace_id=$1 and user_id=$2",[workspace,user])).rows[0].credits,1,"Terminal refund after resume is idempotent");

    const reserveFeature=async requestId=>(await db.query("select public.reserve_workspace_feature_usage($1,$2,$3,$4,$5) as result",[workspace,user,"title_regeneration","Asia/Kolkata",requestId])).rows[0].result;
    const title1=await reserveFeature("title-1");
    const title1Replay=await reserveFeature("title-1");
    assert.equal(title1.allowed,true);
    assert.equal(title1Replay.duplicate,true,"Feature retries must not consume a second daily slot");
    assert.equal((await reserveFeature("title-2")).allowed,true);
    assert.equal((await reserveFeature("title-3")).allowed,true);
    assert.equal((await reserveFeature("title-4")).allowed,false,"Free workspaces get three title regenerations per day");
    await db.query("select public.finish_workspace_feature_usage($1,false)",[title1.usageId]);
    assert.equal((await reserveFeature("title-4")).allowed,true,"Refunded feature reservations must release the slot");
    assert.equal((await db.query("select public.reserve_workspace_feature_usage($1,$2,'cover_rotation','Asia/Kolkata','cover-1') as result",[workspace,user])).rows[0].result.allowed,true);
    assert.equal((await db.query("select public.reserve_workspace_feature_usage($1,$2,'cover_rotation','Asia/Kolkata','cover-2') as result",[workspace,user])).rows[0].result.allowed,false,"Free workspaces get one cover rotation per day");

    await db.query("update public.workspace_entitlements set plan='pro' where workspace_id=$1",[workspace]);
    let entitlement=(await db.query("select daily_video_minutes,title_regenerations,auto_publish,scheduling_enabled,brand_kit_limit from public.workspace_entitlements where workspace_id=$1",[workspace])).rows[0];
    assert.equal(entitlement.daily_video_minutes,180);
    assert.equal(entitlement.title_regenerations,30);
    assert.equal(entitlement.auto_publish,true);
    assert.equal(entitlement.scheduling_enabled,false);
    await db.query("update public.workspace_entitlements set plan='studio' where workspace_id=$1",[workspace]);
    entitlement=(await db.query("select daily_video_minutes,scheduling_enabled,brand_kit_limit,fair_use_unlimited from public.workspace_entitlements where workspace_id=$1",[workspace])).rows[0];
    assert.equal(entitlement.daily_video_minutes,999999);
    assert.equal(entitlement.scheduling_enabled,true);
    assert.equal(entitlement.brand_kit_limit,10);
    assert.equal(entitlement.fair_use_unlimited,true);
  } finally {
    await db.close();
  }
});
