-- UPI orders are created server-side and reviewed before entitlements are granted.
create table if not exists public.upi_payment_orders (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  plan text not null check (plan in ('pro', 'studio')),
  billing_interval text not null default 'monthly' check (billing_interval in ('monthly', 'yearly')),
  amount_paise bigint not null check (amount_paise > 0),
  reference text not null unique,
  utr text,
  status text not null default 'pending'
    check (status in ('pending', 'submitted', 'approved', 'rejected', 'expired')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 minutes'),
  submitted_at timestamptz,
  reviewed_at timestamptz
);

create unique index if not exists upi_payment_orders_utr_unique
  on public.upi_payment_orders (utr)
  where utr is not null;

create index if not exists upi_payment_orders_workspace_status_expiry
  on public.upi_payment_orders (workspace_id, status, expires_at);

create index if not exists upi_payment_orders_user_created
  on public.upi_payment_orders (user_id, created_at desc);

alter table public.upi_payment_orders enable row level security;

-- No direct client policies: all order reads/writes go through authenticated server routes
-- using the service-role client after verifying workspace membership.
