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
  amount_base_units numeric(40,0) check (amount_base_units is null or amount_base_units >= 0),
  status text not null default 'PREPARED' check (status in ('PREPARED','SENT','CONFIRMED','EXPIRED','REORGED','FAILED')),
  serialized_tx text,
  recent_blockhash text,
  last_valid_block_height bigint,
  error text,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz
);

create index if not exists claims_token_id_idx on claims(token_id);
create index if not exists claims_recovery_idx on claims(status, created_at);

create table if not exists settlements (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id),
  source_asset text not null check (source_asset in ('SOL','USDC')),
  source_amount_base_units numeric(40,0) not null check (source_amount_base_units > 0),
  amount_cents bigint not null check (amount_cents > 0),
  status text not null default 'QUEUED' check (status in ('QUEUED','PROCESSING','COMPLETED','FAILED','CANCELLED')),
  conversion_reference text,
  donation_reference text,
  receipt_url text,
  note text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists settlements_campaign_id_idx on settlements(campaign_id);
create index if not exists settlements_status_idx on settlements(status);
create index if not exists settlements_campaign_asset_idx on settlements(campaign_id, source_asset);

create table if not exists audit_log (
  id bigserial primary key,
  event_type text not null,
  subject_type text not null,
  subject_id text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);


-- Per-trade creator-fee obligations. These are attributed to a token/campaign
-- from the chain event that generated the fee, independent of treasury collection.
create table if not exists fee_events (
  id uuid primary key default gen_random_uuid(),
  token_id uuid not null references tokens(id),
  venue text not null check (venue in ('PUMP','PUMP_SWAP')),
  signature text not null,
  event_index integer not null check (event_index >= 0),
  slot bigint not null,
  asset text not null check (asset in ('SOL','USDC')),
  amount_base_units numeric(40,0) not null check (amount_base_units > 0),
  block_time timestamptz,
  created_at timestamptz not null default now(),
  unique(signature, venue, event_index)
);

create index if not exists fee_events_token_id_idx on fee_events(token_id);
create index if not exists fee_events_asset_idx on fee_events(asset);
create index if not exists fee_events_created_at_idx on fee_events(created_at);

create table if not exists index_cursors (
  token_id uuid not null references tokens(id),
  venue text not null check (venue in ('PUMP','PUMP_SWAP')),
  cursor_signature text,
  updated_at timestamptz not null default now(),
  primary key(token_id, venue)
);

-- Global movements from Pump creator vaults into the GoFund treasury.
-- Direct-creator vaults are creator-scoped, so a collection is deliberately
-- not assigned to one token or campaign.
create table if not exists collections (
  id uuid primary key default gen_random_uuid(),
  signature text not null unique,
  sol_amount_base_units numeric(40,0) check (sol_amount_base_units is null or sol_amount_base_units >= 0),
  usdc_amount_base_units numeric(40,0) check (usdc_amount_base_units is null or usdc_amount_base_units >= 0),
  status text not null default 'PREPARED' check (status in ('PREPARED','SENT','CONFIRMED','EXPIRED','FAILED')),
  serialized_tx text,
  recent_blockhash text,
  last_valid_block_height bigint,
  error text,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz
);

create index if not exists collections_status_idx on collections(status, created_at);
