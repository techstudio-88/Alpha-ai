import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {randomUUID} from "node:crypto";
import {PGlite} from "@electric-sql/pglite";

test("Phase 1 ledger migration reserves once, refunds once, and atomically charges accepted AI jobs",async()=>{
  const db=new PGlite();
  try{
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create schema auth;
      create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
      create table auth.users(id uuid primary key,email text);\n      create table public.control_center_members(id uuid primary key default gen_random_uuid(),email text,role text,active boolean default true);
      create table public.workspaces(id uuid primary key);
      create table public.workspace_members(workspace_id uuid,user_id uuid);
      create table public.projects(id uuid primary key,workspace_id uuid);
      create table public.media_assets(id uuid primary key,workspace_id uuid,project_id uuid,status text);
      create table public.processing_jobs(
        id uuid primary key,workspace_id uuid not null,project_id uuid,job_type text not null,
        status text,progress integer,payload jsonb,error text,created_at timestamptz default now(),
        updated_at timestamptz default now(),current_stage text,attempt_count integer not null default 0,
        heartbeat_at timestamptz,lease_token uuid,lease_until timestamptz
      );
      create table public.notifications(
        id uuid primary key default gen_random_uuid(),workspace_id uuid not null,user_id uuid,
        title text not null,message text,read_at timestamptz,created_at timestamptz default now()
      );
      create table public.publish_jobs(
        id uuid primary key default gen_random_uuid(),workspace_id uuid,user_id uuid,clip_id uuid,platform text,
        status text,scheduled_for timestamptz,created_at timestamptz default now(),updated_at timestamptz default now()
      );
      create table public.usage_credits(
        id uuid primary key default gen_random_uuid(),workspace_id uuid,user_id uuid,
        credits integer not null,updated_at timestamptz default now(),unique(workspace_id,user_id)
      );
      create table public.ai_chat_sessions(
        id uuid primary key,workspace_id uuid,user_id uuid,title text,project_id uuid,media_asset_id uuid,updated_at timestamptz default now()
      );
      create table public.ai_chat_messages(
        id uuid primary key,session_id uuid,workspace_id uuid,user_id uuid,role text,content text,metadata jsonb default '{}'::jsonb
      );
    `);
    const migration=await readFile(new URL("../supabase/migrations/20261015_phase_1_backend_foundation.sql",import.meta.url),"utf8");
    await db.exec(migration);
    const user=randomUUID(),workspace=randomUUID(),project=randomUUID(),asset=randomUUID();
    await db.query("insert into auth.users(id) values($1)",[user]);
    await db.query("insert into public.workspaces(id) values($1)",[workspace]);
    await db.query("insert into public.workspace_members(workspace_id,user_id) values($1,$2)",[workspace,user]);
    await db.query("insert into public.projects(id,workspace_id) values($1,$2)",[project,workspace]);
    await db.query("insert into public.media_assets(id,workspace_id,project_id,status) values($1,$2,$3,'uploaded')",[asset,workspace,project]);
    await db.query("insert into public.usage_credits(workspace_id,user_id,credits) values($1,$2,10)",[workspace,user]);

    const job=randomUUID();
    await db.query("insert into public.processing_jobs(id,workspace_id,project_id,job_type,status,payload) values($1,$2,$3,'process_media','queued',$4)",
      [job,workspace,project,JSON.stringify({requestedBy:user})]);
    await db.query("select public.reserve_job_credits($1,$2,$3,1,'accepted test job',$4)",[workspace,job,user,"job:"+job+":reserve"]);
    await db.query("select public.reserve_job_credits($1,$2,$3,1,'accepted test job',$4)",[workspace,job,user,"job:"+job+":reserve"]);
    assert.equal((await db.query("select credits from public.usage_credits where workspace_id=$1 and user_id=$2",[workspace,user])).rows[0].credits,9);
    assert.equal((await db.query("select count(*)::int as n from public.credit_ledger where job_id=$1",[job])).rows[0].n,1);

    await db.query("update public.processing_jobs set status='failed' where id=$1",[job]);
    await db.query("select public.refund_failed_job_credits($1,$2,$3,'test failure',$4)",[workspace,job,user,"job:"+job+":refund"]);
    await db.query("select public.refund_failed_job_credits($1,$2,$3,'test failure',$4)",[workspace,job,user,"job:"+job+":refund"]);
    assert.equal((await db.query("select credits from public.usage_credits where workspace_id=$1 and user_id=$2",[workspace,user])).rows[0].credits,10);
    assert.equal((await db.query("select count(*)::int as n from public.credit_ledger where job_id=$1",[job])).rows[0].n,2);
    assert.equal((await db.query("select reserved_credits from public.processing_jobs where id=$1",[job])).rows[0].reserved_credits,0);

    await db.query("update public.usage_credits set credits=0 where workspace_id=$1 and user_id=$2",[workspace,user]);
    const insufficient=randomUUID();
    await db.query("insert into public.processing_jobs(id,workspace_id,project_id,job_type,status,payload) values($1,$2,$3,'process_media','queued',$4)",
      [insufficient,workspace,project,JSON.stringify({requestedBy:user})]);
    await assert.rejects(db.query("select public.reserve_job_credits($1,$2,$3,1,'insufficient test',$4)",
      [workspace,insufficient,user,"job:"+insufficient+":reserve"]),/INSUFFICIENT_CREDITS/);
    assert.equal((await db.query("select credits from public.usage_credits where workspace_id=$1 and user_id=$2",[workspace,user])).rows[0].credits,0);
    assert.equal((await db.query("select count(*)::int as n from public.credit_ledger where job_id=$1",[insufficient])).rows[0].n,0);

    await db.query("update public.usage_credits set credits=5 where workspace_id=$1 and user_id=$2",[workspace,user]);
    const session=randomUUID(),accepted=randomUUID();
    const payload={requestedBy:user,sessionId:session,mediaAssetId:asset,creditCost:1};
    await db.query("select public.submit_ai_chat_job($1,$2,$3,$4,$5,$6,$7,$8)",
      [accepted,session,workspace,user,project,asset,"Create clips",JSON.stringify(payload)]);
    await db.query("select public.submit_ai_chat_job($1,$2,$3,$4,$5,$6,$7,$8)",
      [accepted,session,workspace,user,project,asset,"Create clips",JSON.stringify(payload)]);
    assert.equal((await db.query("select credits from public.usage_credits where workspace_id=$1 and user_id=$2",[workspace,user])).rows[0].credits,4);
    assert.equal((await db.query("select count(*)::int as n from public.credit_ledger where job_id=$1 and transaction_type='reserve'",[accepted])).rows[0].n,1);

    await db.query("update auth.users set email='admin@example.test' where id=$1",[user]);
    await db.query("insert into public.control_center_members(email,role,active) values('admin@example.test','admin',true)");
    await db.query("select public.admin_adjust_credits($1,$2,$3,2,'support adjustment',$4)",
      [workspace,user,user,"admin-adjust:"+randomUUID()]);
    assert.equal((await db.query("select credits from public.usage_credits where workspace_id=$1 and user_id=$2",[workspace,user])).rows[0].credits,6);
    const adjustment=(await db.query("select job_id from public.credit_ledger where transaction_type='adjustment'")).rows[0];
    assert.ok(adjustment.job_id);
    assert.equal((await db.query("select job_type from public.processing_jobs where id=$1",[adjustment.job_id])).rows[0].job_type,"credit_adjustment");
  }finally{await db.close()}
});
