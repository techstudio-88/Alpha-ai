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
    const videoMigration=await readFile(new URL("../supabase/migrations/20261015_phase_1_video_scheduler.sql",import.meta.url),"utf8");
    await db.exec(videoMigration);
    const featureMigration=await readFile(new URL("../supabase/migrations/20261015_phase_1_feature_limits.sql",import.meta.url),"utf8");
    await db.exec(featureMigration);
    const planMigration=await readFile(new URL("../supabase/migrations/20261015_phase_1_plan_entitlements.sql",import.meta.url),"utf8");
    await db.exec(planMigration);
    const featureIdempotencyMigration=await readFile(new URL("../supabase/migrations/20261015_phase_1_feature_limits_idempotency.sql",import.meta.url),"utf8");
    await db.exec(featureIdempotencyMigration);
    const user=randomUUID(),workspace=randomUUID(),project=randomUUID(),asset=randomUUID();
    await db.query("insert into auth.users(id) values($1)",[user]);
    await db.query("insert into public.workspaces(id) values($1)",[workspace]);
    await db.query("insert into public.workspace_members(workspace_id,user_id) values($1,$2)",[workspace,user]);
    await db.query("insert into public.projects(id,workspace_id) values($1,$2)",[project,workspace]);
    await db.query("insert into public.media_assets(id,workspace_id,project_id,status) values($1,$2,$3,'uploaded')",[asset,workspace,project]);
    await db.query("insert into public.usage_credits(workspace_id,user_id,credits) values($1,$2,10)",[workspace,user]);

    const otherWorkspace=randomUUID(),otherProject=randomUUID();
    await db.query("insert into public.workspaces(id) values($1)",[otherWorkspace]);
    await db.query("insert into public.projects(id,workspace_id) values($1,$2)",[otherProject,otherWorkspace]);
    await assert.rejects(db.query("insert into public.processing_jobs(id,workspace_id,project_id,job_type,status,payload) values($1,$2,$3,'process_media','queued',$4)",
      [randomUUID(),workspace,otherProject,JSON.stringify({requestedBy:user})]),/Processing job project\/workspace mismatch/);
    await assert.rejects(db.query("insert into public.processing_jobs(id,workspace_id,project_id,job_type,status,payload) values($1,$2,$3,'process_media','queued',$4)",
      [randomUUID(),workspace,project,JSON.stringify({requestedBy:user,mediaAssetId:randomUUID()})]),/Processing job media asset\/workspace mismatch/);

    const job=randomUUID();
    await db.query("insert into public.processing_jobs(id,workspace_id,project_id,job_type,status,payload) values($1,$2,$3,'process_media','queued',$4)",
      [job,workspace,project,JSON.stringify({requestedBy:user,mediaAssetId:asset})]);
    await db.query("select public.reserve_job_credits($1,$2,$3,1,'accepted test job',$4)",[workspace,job,user,"job:"+job+":reserve"]);
    await db.query("select public.reserve_job_credits($1,$2,$3,1,'accepted test job',$4)",[workspace,job,user,"job:"+job+":reserve"]);
    assert.equal((await db.query("select credits from public.usage_credits where workspace_id=$1 and user_id=$2",[workspace,user])).rows[0].credits,9);
    assert.equal((await db.query("select count(*)::int as n from public.credit_ledger where job_id=$1",[job])).rows[0].n,1);

    await db.query("update public.processing_jobs set status='failed' where id=$1",[job]);
    await db.query("select public.refund_failed_job_credits($1,$2,$3,'test failure',$4)",[workspace,job,user,"job:"+job+":refund"]);
    await db.query("select public.refund_failed_job_credits($1,$2,$3,'test failure',$4)",[workspace,job,user,"job:"+job+":refund"]);
    assert.equal((await db.query("select credits from public.usage_credits where workspace_id=$1 and user_id=$2",[workspace,user])).rows[0].credits,10);
    assert.equal((await db.query("select count(*)::int as n from public.credit_ledger where job_id=$1",[job])).rows[0].n,2);

    const videoJob=randomUUID();
    await db.query("insert into public.processing_jobs(id,workspace_id,project_id,job_type,status,payload) values($1,$2,$3,'process_media','processing',$4)",
      [videoJob,workspace,project,JSON.stringify({requestedBy:user,mediaAssetId:asset})]);
    const videoPlan=(await db.query("select public.plan_video_processing_parts($1,$2,$3,$4,$5,3000,'Asia/Kolkata','[1190,2390]'::jsonb) as plan",
      [workspace,project,user,videoJob,asset])).rows[0].plan;
    assert.equal(videoPlan.split,true);
    assert.equal(videoPlan.deferCurrent,false);
    assert.equal(Number(videoPlan.partEndSeconds),1190);
    assert.equal(Number(videoPlan.pendingParts),2);
    const reservedMinutes=Number((await db.query("select minutes_reserved from public.video_usage_daily where workspace_id=$1 and user_id=$2 and usage_date=(now() at time zone 'Asia/Kolkata')::date",[workspace,user])).rows[0].minutes_reserved);
    assert.ok(Math.abs(reservedMinutes-19.83)<0.01,'reserved minutes were '+reservedMinutes);
    await db.query("select public.plan_video_processing_parts($1,$2,$3,$4,$5,3000,'Asia/Kolkata','[1190,2390]'::jsonb)",
      [workspace,project,user,videoJob,asset]);
    assert.ok(Math.abs(Number((await db.query("select minutes_reserved from public.video_usage_daily where workspace_id=$1 and user_id=$2 and usage_date=(now() at time zone 'Asia/Kolkata')::date",[workspace,user])).rows[0].minutes_reserved)-19.83)<0.01);
    const pending=(await db.query("select id,part_number,start_seconds,end_seconds from public.pending_processing_parts where parent_job_id=$1 order by part_number",[videoJob])).rows;
    assert.deepEqual(pending.map(row=>row.part_number),[2,3]);
    assert.equal(Number(pending[0].start_seconds),1190);
    assert.equal(Number(pending[0].end_seconds),2390);
    await db.query("update public.processing_jobs set status='completed' where id=$1",[videoJob]);
    await db.query("select public.finish_video_usage_for_job($1,true)",[videoJob]);
    const finalized=(await db.query("select minutes_reserved,minutes_completed from public.video_usage_daily where workspace_id=$1 and user_id=$2 and usage_date=(now() at time zone 'Asia/Kolkata')::date",[workspace,user])).rows[0];
    assert.equal(Number(finalized.minutes_reserved),0);
    assert.ok(Math.abs(Number(finalized.minutes_completed)-19.83)<0.01);
    await db.query("update public.pending_processing_parts set status='approved',scheduled_for=now()-interval '1 minute',expires_at=now()+interval '2 days' where id=$1",[pending[0].id]);
    const delayed=(await db.query("select public.claim_due_pending_part($1) as result",[pending[0].id])).rows[0].result;
    assert.equal(delayed.queued,false);
    assert.ok(delayed.rescheduledFor);
    await db.query("update public.video_usage_daily set minutes_completed=0,minutes_reserved=0 where workspace_id=$1 and user_id=$2 and usage_date=(now() at time zone 'Asia/Kolkata')::date",[workspace,user]);
    await db.query("update public.pending_processing_parts set status='approved',scheduled_for=now()-interval '1 minute',usage_date=(now() at time zone 'Asia/Kolkata')::date where id=$1",[pending[0].id]);
    const claimed=(await db.query("select public.claim_due_pending_part($1) as result",[pending[0].id])).rows[0].result;
    assert.equal(claimed.queued,true);
    assert.equal((await db.query("select status,job_id from public.pending_processing_parts where id=$1",[pending[0].id])).rows[0].status,"queued");
    const duplicateClaim=(await db.query("select public.claim_due_pending_part($1) as result",[pending[0].id])).rows[0].result;
    assert.equal(duplicateClaim.queued,false);
    assert.equal((await db.query("select count(*)::int as n from public.processing_jobs where idempotency_key=$1",["pending-part:"+pending[0].id])).rows[0].n,1);
    const feature1=(await db.query("select public.reserve_workspace_feature_usage($1,$2,'title_regeneration','Asia/Kolkata','title-1') as result",[workspace,user])).rows[0].result;
    const feature2=(await db.query("select public.reserve_workspace_feature_usage($1,$2,'title_regeneration','Asia/Kolkata','title-2') as result",[workspace,user])).rows[0].result;
    const feature3=(await db.query("select public.reserve_workspace_feature_usage($1,$2,'title_regeneration','Asia/Kolkata','title-3') as result",[workspace,user])).rows[0].result;
    assert.equal(feature1.allowed,true);assert.equal(feature2.allowed,true);assert.equal(feature3.allowed,true);
    const featureBlocked=(await db.query("select public.reserve_workspace_feature_usage($1,$2,'title_regeneration','Asia/Kolkata','title-4') as result",[workspace,user])).rows[0].result;
    assert.equal(featureBlocked.allowed,false);assert.equal(Number(featureBlocked.limit),3);
    await db.query("select public.finish_workspace_feature_usage($1,false)",[feature2.usageId]);
    const sameFeatureRetry=(await db.query("select public.reserve_workspace_feature_usage($1,$2,'title_regeneration','Asia/Kolkata','title-2') as result",[workspace,user])).rows[0].result;
    assert.equal(sameFeatureRetry.allowed,true);assert.equal(sameFeatureRetry.duplicate,false);assert.equal(sameFeatureRetry.usageId,feature2.usageId);
    const featureRetry=(await db.query("select public.reserve_workspace_feature_usage($1,$2,'title_regeneration','Asia/Kolkata','title-5') as result",[workspace,user])).rows[0].result;
    assert.equal(featureRetry.allowed,false);
    const cover1=(await db.query("select public.reserve_workspace_feature_usage($1,$2,'cover_rotation','Asia/Kolkata','cover-1') as result",[workspace,user])).rows[0].result;
    const cover2=(await db.query("select public.reserve_workspace_feature_usage($1,$2,'cover_rotation','Asia/Kolkata','cover-2') as result",[workspace,user])).rows[0].result;
    assert.equal(cover1.allowed,true);assert.equal(cover2.allowed,false);
    const duplicateFeature=(await db.query("select public.reserve_workspace_feature_usage($1,$2,'title_regeneration','Asia/Kolkata','title-1') as result",[workspace,user])).rows[0].result;
    assert.equal(duplicateFeature.duplicate,true);
    await db.query("update public.workspace_entitlements set plan='pro' where workspace_id=$1",[workspace]);
    const pro=(await db.query("select daily_video_minutes,max_resolution,title_regenerations,cover_rotations,auto_publish,watermark_text from public.workspace_entitlements where workspace_id=$1",[workspace])).rows[0];
    assert.equal(Number(pro.daily_video_minutes),180);assert.equal(Number(pro.max_resolution),1080);
    assert.equal(Number(pro.title_regenerations),30);assert.equal(Number(pro.cover_rotations),10);
    assert.equal(pro.auto_publish,true);assert.equal(pro.watermark_text,"");
    await db.query("update public.workspace_entitlements set plan='studio' where workspace_id=$1",[workspace]);
    const studio=(await db.query("select daily_video_minutes,max_resolution,brand_kit_limit,priority_queue,fair_use_unlimited from public.workspace_entitlements where workspace_id=$1",[workspace])).rows[0];
    assert.equal(Number(studio.daily_video_minutes),999999);assert.equal(Number(studio.max_resolution),3840);
    assert.equal(Number(studio.brand_kit_limit),10);assert.equal(studio.priority_queue,true);assert.equal(studio.fair_use_unlimited,true);


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
