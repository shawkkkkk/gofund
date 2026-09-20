begin;

alter table claims alter column amount_base_units drop not null;
alter table claims add column if not exists serialized_tx text;
alter table claims add column if not exists recent_blockhash text;
alter table claims add column if not exists last_valid_block_height bigint;
alter table claims add column if not exists error text;
alter table claims add column if not exists confirmed_at timestamptz;

alter table claims drop constraint if exists claims_status_check;
alter table claims
  add constraint claims_status_check
  check (status in ('PREPARED','SENT','CONFIRMED','EXPIRED','REORGED','FAILED'));

alter table claims alter column status set default 'PREPARED';

create index if not exists claims_recovery_idx on claims(status, created_at);

commit;
