-- Alpha.ai accounting foundation.
-- Assumptions: workspaces, workspace_members, projects, clips, and auth.users
-- already exist. Reward entries remain pending until a human reviews the claim;
-- this migration does not attempt to verify YouTube or Instagram activity.

create table if not exists public.token_ledger (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  amount integer not null check (amount <> 0),
  entry_type text not null check (entry_type in ('reward','spend','adjustment')),
  status text not null default 'pending' check (status in ('pending','posted','reversed')),
  reason text not null,
  reference_type text,
  reference_id uuid,
  idempotency_key text not null unique,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.daily_usage (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  usage_date date not null default current_date,
  export_count integer not null default 0 check (export_count >= 0),
  promotion_claim_count integer not null default 0 check (promotion_claim_count >= 0),
  tokens_pending integer not null default 0 check (tokens_pending >= 0),
  tokens_posted integer not null default 0 check (tokens_posted >= 0),
  daily_tokens integer not null default 100 check (daily_tokens >= 0),
  tokens_spent integer not null default 0 check (tokens_spent >= 0),
  processing_minutes numeric(12,2) not null default 0 check (processing_minutes >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, user_id, usage_date)
);

create table if not exists public.promotion_claims (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  clip_id uuid references public.clips(id) on delete set null,
  project_id uuid references public.projects(id) on delete set null,
  platform text not null check (platform in ('youtube','instagram')),
  post_url text not null check (length(post_url) between 10 and 2000),
  external_post_id text check (external_post_id is null or length(external_post_id) between 1 and 300),
  dedupe_key text not null check (length(dedupe_key) between 8 and 128),
  reward_tokens integer not null default 10 check (reward_tokens between 1 and 100),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  reviewer_note text,
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  unique (workspace_id, user_id, platform, dedupe_key)
);
alter table public.promotion_claims add column if not exists claim_type text not null default 'reel_tag';
alter table public.promotion_claims drop constraint if exists promotion_claims_claim_type_check;
alter table public.promotion_claims add constraint promotion_claims_claim_type_check check (claim_type in ('reel_tag','profile_bio'));

create unique index if not exists promotion_claims_clip_platform_uidx
  on public.promotion_claims(workspace_id, user_id, platform, clip_id)
  where clip_id is not null;
create unique index if not exists promotion_claims_external_id_uidx
  on public.promotion_claims(workspace_id, user_id, platform, external_post_id)
  where external_post_id is not null;
create unique index if not exists promotion_claims_profile_bio_uidx
  on public.promotion_claims(workspace_id,user_id,platform,claim_type)
  where claim_type='profile_bio';
create index if not exists token_ledger_user_created_idx
  on public.token_ledger(workspace_id, user_id, created_at desc);
create index if not exists daily_usage_workspace_date_idx
  on public.daily_usage(workspace_id, usage_date desc);
create index if not exists promotion_claims_workspace_submitted_idx
  on public.promotion_claims(workspace_id, submitted_at desc);

alter table public.token_ledger enable row level security;
alter table public.daily_usage enable row level security;
alter table public.promotion_claims enable row level security;

drop policy if exists token_ledger_member_select on public.token_ledger;
create policy token_ledger_member_select
  on public.token_ledger for select to authenticated
  using (user_id = (select auth.uid()) and public.is_workspace_member(workspace_id));

drop policy if exists daily_usage_member_select on public.daily_usage;
create policy daily_usage_member_select
  on public.daily_usage for select to authenticated
  using (user_id = (select auth.uid()) and public.is_workspace_member(workspace_id));

drop policy if exists promotion_claims_member_select on public.promotion_claims;
create policy promotion_claims_member_select
  on public.promotion_claims for select to authenticated
  using (user_id = (select auth.uid()) and public.is_workspace_member(workspace_id));

revoke all on public.token_ledger from anon, authenticated;
revoke all on public.daily_usage from anon, authenticated;
revoke all on public.promotion_claims from anon, authenticated;
grant select on public.token_ledger, public.daily_usage, public.promotion_claims to authenticated;

-- The server route calls this helper after a successful archive response. It is
-- deliberately a counter only; it cannot issue or spend tokens.
create or replace function public.record_daily_usage(
  p_workspace_id uuid,
  p_user_id uuid,
  p_usage_date date default current_date,
  p_export_count integer default 0
) returns public.daily_usage
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare result public.daily_usage;
begin
  if p_export_count < 0 then
    raise exception 'Usage increments cannot be negative';
  end if;
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role'
     and p_user_id <> auth.uid() then
    raise exception 'Usage user mismatch';
  end if;
  if not exists (
    select 1 from public.workspace_members
    where workspace_id = p_workspace_id and user_id = p_user_id
  ) then
    raise exception 'Workspace access denied';
  end if;
  insert into public.daily_usage(workspace_id, user_id, usage_date, export_count)
  values (p_workspace_id, p_user_id, coalesce(p_usage_date, current_date), p_export_count)
  on conflict (workspace_id, user_id, usage_date) do update
    set export_count = public.daily_usage.export_count + excluded.export_count,
        updated_at = now()
  returning * into result;
  return result;
end;
$$;

revoke all on function public.record_daily_usage(uuid, uuid, date, integer) from public, anon;
grant execute on function public.record_daily_usage(uuid, uuid, date, integer) to authenticated, service_role;

create or replace function public.ensure_daily_token_allowance(
  p_workspace_id uuid,
  p_user_id uuid,
  p_usage_date date default current_date
) returns public.daily_usage
language plpgsql security definer set search_path = public, pg_temp as $$
declare result public.daily_usage;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' and p_user_id <> auth.uid() then
    raise exception 'Usage user mismatch';
  end if;
  if not exists(select 1 from public.workspace_members where workspace_id=p_workspace_id and user_id=p_user_id) then
    raise exception 'Workspace access denied';
  end if;
  insert into public.daily_usage(workspace_id,user_id,usage_date,daily_tokens)
    values(p_workspace_id,p_user_id,coalesce(p_usage_date,current_date),100)
    on conflict(workspace_id,user_id,usage_date) do nothing;
  select * into result from public.daily_usage where workspace_id=p_workspace_id and user_id=p_user_id and usage_date=coalesce(p_usage_date,current_date);
  return result;
end;
$$;
revoke all on function public.ensure_daily_token_allowance(uuid,uuid,date) from public, anon;
grant execute on function public.ensure_daily_token_allowance(uuid,uuid,date) to authenticated, service_role;

-- A claim and its pending reward are written in one database transaction. This
-- gives support/audit tooling an immutable, idempotent ledger entry without
-- allowing a client to mint tokens directly.
create or replace function public.audit_promotion_claim()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.token_ledger(
    workspace_id, user_id, amount, entry_type, status, reason,
    reference_type, reference_id, idempotency_key, metadata
  ) values (
    new.workspace_id, new.user_id, new.reward_tokens, 'reward', 'pending',
    'Promotion claim submitted', 'promotion_claim', new.id,
    'promotion-claim:' || new.id::text,
    jsonb_build_object('platform', new.platform, 'claim_status', new.status)
  );

  insert into public.daily_usage(
    workspace_id, user_id, usage_date, promotion_claim_count, tokens_pending
  ) values (
    new.workspace_id, new.user_id, (new.submitted_at at time zone 'utc')::date, 1, new.reward_tokens
  )
  on conflict (workspace_id, user_id, usage_date) do update
    set promotion_claim_count = public.daily_usage.promotion_claim_count + 1,
        tokens_pending = public.daily_usage.tokens_pending + excluded.tokens_pending,
        updated_at = now();
  return new;
end;
$$;

drop trigger if exists promotion_claim_audit_trigger on public.promotion_claims;
create trigger promotion_claim_audit_trigger
after insert on public.promotion_claims
for each row execute function public.audit_promotion_claim();

revoke all on function public.audit_promotion_claim() from public, anon, authenticated;

-- Processing charges are idempotent per durable job. A 20-minute source costs
-- 100 tokens by default (5 tokens per source minute), while short sources cost
-- proportionally less. Failed retries cannot charge the same job twice.
create or replace function public.consume_processing_tokens(
  p_workspace_id uuid,
  p_user_id uuid,
  p_job_id uuid,
  p_processing_minutes numeric
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  usage_row public.daily_usage;
  existing public.token_ledger;
  reward_balance integer;
  charge integer;
  available integer;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role'
     and p_user_id <> auth.uid() then
    raise exception 'Usage user mismatch';
  end if;
  if not exists (select 1 from public.workspace_members where workspace_id=p_workspace_id and user_id=p_user_id) then
    raise exception 'Workspace access denied';
  end if;
  select * into existing from public.token_ledger
    where idempotency_key='processing-job:' || p_job_id::text limit 1;
  if existing.id is not null then
    select * into usage_row from public.daily_usage
      where workspace_id=p_workspace_id and user_id=p_user_id and usage_date=current_date;
    return jsonb_build_object('ok',true,'alreadyCharged',true,'charge',abs(existing.amount),'availableTokens',greatest(0,coalesce(usage_row.daily_tokens,100)+coalesce((select sum(amount) from public.token_ledger where workspace_id=p_workspace_id and user_id=p_user_id and entry_type='reward' and status='posted'),0)-coalesce(usage_row.tokens_spent,0)));
  end if;
  charge := greatest(1, ceil(greatest(0,coalesce(p_processing_minutes,0))*5)::integer);
  insert into public.daily_usage(workspace_id,user_id,usage_date,daily_tokens)
    values(p_workspace_id,p_user_id,current_date,100)
    on conflict(workspace_id,user_id,usage_date) do nothing;
  select * into usage_row from public.daily_usage
    where workspace_id=p_workspace_id and user_id=p_user_id and usage_date=current_date for update;
  select coalesce(sum(amount),0)::integer into reward_balance from public.token_ledger
    where workspace_id=p_workspace_id and user_id=p_user_id and entry_type='reward' and status='posted';
  available := usage_row.daily_tokens + reward_balance - usage_row.tokens_spent;
  if charge > available then raise exception 'Daily token allowance reached'; end if;
  insert into public.token_ledger(workspace_id,user_id,amount,entry_type,status,reason,reference_type,reference_id,idempotency_key,metadata)
    values(p_workspace_id,p_user_id,-charge,'spend','posted','Video processing','processing_job',p_job_id,'processing-job:' || p_job_id::text,jsonb_build_object('processing_minutes',coalesce(p_processing_minutes,0)));
  update public.daily_usage set tokens_spent=tokens_spent+charge,processing_minutes=processing_minutes+greatest(0,coalesce(p_processing_minutes,0)),updated_at=now() where id=usage_row.id returning * into usage_row;
  return jsonb_build_object('ok',true,'alreadyCharged',false,'charge',charge,'availableTokens',greatest(0,usage_row.daily_tokens+reward_balance-usage_row.tokens_spent));
end;
$$;
revoke all on function public.consume_processing_tokens(uuid,uuid,uuid,numeric) from public, anon;
grant execute on function public.consume_processing_tokens(uuid,uuid,uuid,numeric) to authenticated, service_role;
