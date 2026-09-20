begin;

alter table settlements add column if not exists source_asset text;
alter table settlements add column if not exists source_amount_base_units numeric(40,0);
alter table settlements add column if not exists conversion_reference text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'settlements_source_asset_check') then
    alter table settlements
      add constraint settlements_source_asset_check
      check (source_asset in ('SOL','USDC'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'settlements_source_amount_positive') then
    alter table settlements
      add constraint settlements_source_amount_positive
      check (source_amount_base_units > 0);
  end if;
end $$;

create index if not exists settlements_campaign_asset_idx
  on settlements(campaign_id, source_asset);

-- Existing rows need a human-reviewed source assignment before these columns
-- can safely become NOT NULL. A fresh database created from db/schema.sql is
-- already strict. Do not invent source amounts for historical payouts.

commit;
