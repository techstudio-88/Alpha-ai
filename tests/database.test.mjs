import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {randomUUID} from "node:crypto";
import {PGlite} from "@electric-sql/pglite";

test("chat transactions enforce workspace scope and persist exactly one plan/render on replay",async()=>{
  const db=new PGlite();
  try{
    // Minimal pre-existing schema: execute the real migration on PostgreSQL WASM.
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create schema auth; create schema private;
      create table auth.users(id uuid primary key);
      create table workspaces(id uuid primary key);
      create table workspace_members(workspace_id uuid,user_id uuid);
      create table projects(id uuid primary key,workspace_id uuid);
      create table media_assets(id uuid primary key,project_id uuid,status text);
      create table clips(id uuid primary key default gen_random_uuid(),project_id uuid,media_asset_id uuid,title text,start_seconds numeric,end_seconds numeric,score numeric,status text);
      create table processing_jobs(id uuid primary key,workspace_id uuid,project_id uuid,job_type text,status text,progress integer,payload jsonb,created_at timestamptz default now(),current_stage text,error text,heartbeat_at timestamptz,updated_at timestamptz,lease_until timestamptz,lease_token uuid,attempt_count integer);
      create function private.is_workspace_member(uuid) returns boolean language sql as 'select true';`);
    await db.exec(await readFile(new URL("../supabase/migrations/20260928_chat_first_production.sql",import.meta.url),"utf8"));
    await db.exec(await readFile(new URL("../supabase/migrations/20261003_ai_video_workflow.sql",import.meta.url),"utf8"));
    const w=randomUUID(),other=randomUUID(),user=randomUUID(),project=randomUUID(),asset=randomUUID(),session=randomUUID(),job=randomUUID();
    await db.query("insert into workspaces values ($1),($2)",[w,other]);
    await db.query("insert into auth.users values ($1)",[user]);
    await db.query("insert into workspace_members values ($1,$2),($3,$2)",[w,user,other]);
    await db.query("insert into projects values ($1,$2)",[project,w]);
    await db.query("insert into media_assets values ($1,$2,'uploading')",[asset,project]);
    const payload={operation:"ai_chat_plan",sessionId:session,mediaAssetId:asset,requestedBy:user,prompt:"Create a short"};
    const submit=(id=job,workspace=w)=>db.query("select submit_ai_chat_job($1,$2,$3,$4,$5,$6,$7,$8)",[id,session,workspace,user,project,asset,"Create a short",payload]);
    await assert.rejects(submit(job,other),/context mismatch/);
    await submit();await submit();
    assert.equal((await db.query("select * from claim_processing_job()")).rows.length,0,"An incomplete upload must not be processed");
    await db.query("update media_assets set status='uploaded' where id=$1",[asset]);
    assert.equal((await db.query("select * from claim_processing_job()")).rows[0].id,job);
    assert.equal((await db.query("select count(*)::int as n from ai_chat_messages")).rows[0].n,1);
    await assert.rejects(submit(randomUUID()),/active job/);
    const plan={summary:"A useful moment",clips:[{a:0,b:9,title:"Useful moment",startSeconds:5,endSeconds:10,score:75,aspect:"9:16",captions:true,captionStyle:"bold",captionColor:"#ffffff"}]};
    await db.query("select complete_ai_chat_plan($1,$2)",[job,plan]);
    await db.query("select complete_ai_chat_plan($1,$2)",[job,plan]);
    assert.equal((await db.query("select count(*)::int as n from clips")).rows[0].n,1);
    assert.equal((await db.query("select count(*)::int as n from processing_jobs")).rows[0].n,2);
    const result=(await db.query("select * from ai_chat_messages where role='assistant'")).rows[0];
    assert.equal(result.metadata.clipIds.length,1);assert.equal(result.metadata.jobIds.length,1);
    const render=(await db.query("select * from processing_jobs where job_type='render_edit'")).rows[0];
    assert.equal(render.status,"queued");assert.equal(render.payload.clipId,result.metadata.clipIds[0]);
    assert.equal(render.payload.startSeconds,5);assert.equal(render.payload.captions,true);
    await assert.rejects(db.query("insert into ai_chat_messages(session_id,workspace_id,user_id,role,content) values($1,$2,$3,'user','bad context')",[session,other,user]),/workspace mismatch/);
    await db.exec("set role authenticated");
    await assert.rejects(db.query("select complete_ai_chat_plan($1,$2)",[job,plan]),/permission denied/);
    await db.exec("reset role");
  }finally{await db.close()}
});
