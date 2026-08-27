-- La biblioteca Magic se consulta por coincidencias parciales mientras el admin escribe.
-- El índice trigram evita un sequential scan sobre external_prices.
create extension if not exists pg_trgm;

create index if not exists external_prices_name_trgm_idx
  on public.external_prices using gin (name gin_trgm_ops);
