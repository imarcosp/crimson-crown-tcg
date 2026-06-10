alter table public.external_prices
  add column if not exists name text,
  add column if not exists set_name text,
  add column if not exists set_code text,
  add column if not exists collector_number text,
  add column if not exists image_url text,
  add column if not exists type_line text,
  add column if not exists color_identity text[] default '{}'::text[],
  add column if not exists cmc numeric,
  add column if not exists rarity text,
  add column if not exists foil_variant text,
  add column if not exists tcgplayer_id text,
  add column if not exists tcgplayer_market_normal numeric,
  add column if not exists tcgplayer_market_foil numeric,
  add column if not exists active_price_normal numeric,
  add column if not exists active_price_foil numeric,
  add column if not exists cardkingdom_buylist_normal numeric,
  add column if not exists cardkingdom_buylist_foil numeric,
  add column if not exists cardkingdom_variation text;

create index if not exists idx_external_prices_set_name
  on public.external_prices (set_name);

create index if not exists idx_external_prices_collector_number
  on public.external_prices (collector_number);

create index if not exists idx_external_prices_foil_variant
  on public.external_prices (foil_variant);

create index if not exists idx_external_prices_type_line
  on public.external_prices (type_line);

create index if not exists idx_external_prices_color_identity_gin
  on public.external_prices
  using gin (color_identity);
