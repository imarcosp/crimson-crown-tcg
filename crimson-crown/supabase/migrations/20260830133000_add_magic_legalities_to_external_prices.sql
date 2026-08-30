alter table public.external_prices
  add column if not exists legalities jsonb not null default '{}'::jsonb;

comment on column public.external_prices.legalities is
  'Legalidades por formato provenientes de Scryfall; sólo metadata de catálogo, nunca stock ni precio.';

alter table public.external_prices
  drop constraint if exists external_prices_legalities_object_check;

alter table public.external_prices
  add constraint external_prices_legalities_object_check
  check (jsonb_typeof(legalities) = 'object') not valid;

alter table public.external_prices
  validate constraint external_prices_legalities_object_check;
