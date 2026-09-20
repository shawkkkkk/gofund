create extension if not exists pgcrypto;

create table if not exists campaigns (
  id uuid primary key default gen_random_uuid(),
  canonical_url text not null unique,
  slug text not null,
  title text not null,
  description text,
  image_url text,
  organizer text,
  verification_status text not null default 'UNVERIFIED' check (verification_status in ('UNVERIFIED','VERIFIED','OPTED_OUT')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists tokens (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id),
  mint text not null unique,
  name text not null,
  symbol text not null,
  description text not null default '',
  image_url text,
  quote_asset text not null check (quote_asset in ('SOL','USDC')),
  launcher_wallet text not null,
  metadata_uri text not null,
  launch_signature text unique,
  fee_lock_signature text unique,
  fee_status text not null default 'DRAFT' check (fee_status in ('DRAFT','CREATED','LOCKED','INVALID')),
  created_at timestamptz not null default now(),
  locked_at timestamptz
);

create index if not exists tokens_campaign_id_idx on tokens(campaign_id);
create index if not exists tokens_fee_status_idx on tokens(fee_status);

create table if not exists claims (
  id uuid primary key default gen_random_uuid(),
  token_id uuid not null references tokens(id),
  signature text not null unique,
  asset text not null check (asset in ('SOL','USDC')),
  amount_base_units numeric(40,0) not null check (amount_base_units >= 0),
  status text not null default 'CONFIRMED' check (status in ('CONFIRMED','REORGED','FAILED')),
  created_at timestamptz not null default now()
);

create index if not exists claims_token_id_idx on claims(token_id);

create table if not exists settlements (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id),
  amount_cents bigint not null check (amount_cents > 0),
  status text not null default 'QUEUED' check (status in ('QUEUED','PROCESSING','COMPLETED','FAILED','CANCELLED')),
  donation_reference text,
  receipt_url text,
  note text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists settlements_campaign_id_idx on settlements(campaign_id);
create index if not exists settlements_status_idx on settlements(status);

create table if not exists audit_log (
  id bigserial primary key,
  event_type text not null,
  subject_type text not null,
  subject_id text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
