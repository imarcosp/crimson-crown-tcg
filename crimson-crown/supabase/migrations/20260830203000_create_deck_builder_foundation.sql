begin;

create table if not exists public.deck_builder_snapshots (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  format text not null,
  status text not null default 'staging',
  fetched_at timestamptz not null default now(),
  activated_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint deck_builder_snapshots_source_check check (
    source in ('edhrec', 'mtgtop8', 'edhtop16', 'manual')
  ),
  constraint deck_builder_snapshots_format_check check (
    format in ('commander', 'standard', 'pioneer', 'modern', 'legacy', 'vintage', 'pauper', 'premodern', 'duel-commander')
  ),
  constraint deck_builder_snapshots_status_check check (
    status in ('staging', 'active', 'retired', 'failed')
  ),
  constraint deck_builder_snapshots_metadata_check check (jsonb_typeof(metadata) = 'object')
);

create unique index if not exists deck_builder_snapshots_one_active_idx
  on public.deck_builder_snapshots (source, format)
  where status = 'active';

create index if not exists deck_builder_snapshots_public_idx
  on public.deck_builder_snapshots (format, fetched_at desc)
  where status = 'active';

create table if not exists public.deck_builder_decks (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references public.deck_builder_snapshots(id) on delete cascade,
  external_id text not null,
  name text not null,
  archetype text,
  commander_names text[] not null default '{}'::text[],
  source_url text,
  image_url text,
  stats jsonb not null default '{}'::jsonb,
  payload jsonb not null default '{}'::jsonb,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  constraint deck_builder_decks_external_id_check check (char_length(btrim(external_id)) between 1 and 240),
  constraint deck_builder_decks_name_check check (char_length(btrim(name)) between 1 and 240),
  constraint deck_builder_decks_stats_check check (jsonb_typeof(stats) = 'object'),
  constraint deck_builder_decks_payload_check check (jsonb_typeof(payload) = 'object'),
  constraint deck_builder_decks_snapshot_external_unique unique (snapshot_id, external_id)
);

create index if not exists deck_builder_decks_snapshot_order_idx
  on public.deck_builder_decks (snapshot_id, display_order, name, id);

create table if not exists public.deck_builder_cards (
  id uuid primary key default gen_random_uuid(),
  deck_id uuid not null references public.deck_builder_decks(id) on delete cascade,
  scryfall_id uuid,
  name text not null,
  role text not null default 'main',
  quantity integer not null default 1,
  display_order integer not null default 0,
  image_url text,
  type_line text,
  created_at timestamptz not null default now(),
  constraint deck_builder_cards_name_check check (char_length(btrim(name)) between 1 and 240),
  constraint deck_builder_cards_role_check check (role in ('commander', 'main', 'sideboard', 'companion', 'maybeboard')),
  constraint deck_builder_cards_quantity_check check (quantity between 1 and 1000),
  constraint deck_builder_cards_deck_order_unique unique (deck_id, display_order)
);

create index if not exists deck_builder_cards_deck_role_idx
  on public.deck_builder_cards (deck_id, role, display_order, id);
create index if not exists deck_builder_cards_scryfall_idx
  on public.deck_builder_cards (scryfall_id)
  where scryfall_id is not null;
create index if not exists deck_builder_cards_name_idx
  on public.deck_builder_cards (lower(name));

alter table public.deck_builder_snapshots enable row level security;
alter table public.deck_builder_decks enable row level security;
alter table public.deck_builder_cards enable row level security;

revoke all on table public.deck_builder_snapshots, public.deck_builder_decks, public.deck_builder_cards from public, anon, authenticated;
grant select on table public.deck_builder_snapshots, public.deck_builder_decks, public.deck_builder_cards to anon, authenticated;
grant insert, update, delete on table public.deck_builder_snapshots, public.deck_builder_decks, public.deck_builder_cards to authenticated;
grant all on table public.deck_builder_snapshots, public.deck_builder_decks, public.deck_builder_cards to service_role;

drop policy if exists "Public read active deck builder snapshots" on public.deck_builder_snapshots;
create policy "Public read active deck builder snapshots" on public.deck_builder_snapshots
  for select to anon, authenticated
  using (status = 'active');

drop policy if exists "Admins manage deck builder snapshots" on public.deck_builder_snapshots;
create policy "Admins manage deck builder snapshots" on public.deck_builder_snapshots
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "Public read active deck builder decks" on public.deck_builder_decks;
create policy "Public read active deck builder decks" on public.deck_builder_decks
  for select to anon, authenticated
  using (exists (
    select 1 from public.deck_builder_snapshots snapshot
    where snapshot.id = snapshot_id and snapshot.status = 'active'
  ));

drop policy if exists "Admins manage deck builder decks" on public.deck_builder_decks;
create policy "Admins manage deck builder decks" on public.deck_builder_decks
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "Public read active deck builder cards" on public.deck_builder_cards;
create policy "Public read active deck builder cards" on public.deck_builder_cards
  for select to anon, authenticated
  using (exists (
    select 1
    from public.deck_builder_decks deck
    join public.deck_builder_snapshots snapshot on snapshot.id = deck.snapshot_id
    where deck.id = deck_id and snapshot.status = 'active'
  ));

drop policy if exists "Admins manage deck builder cards" on public.deck_builder_cards;
create policy "Admins manage deck builder cards" on public.deck_builder_cards
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create or replace function public.promote_deck_builder_snapshot(p_snapshot_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_snapshot public.deck_builder_snapshots%rowtype;
begin
  if coalesce(auth.role(), 'anon') <> 'service_role' then
    raise exception 'Acceso denegado' using errcode = '42501';
  end if;

  select * into target_snapshot
  from public.deck_builder_snapshots
  where id = p_snapshot_id
  for update;

  if not found then
    raise exception 'Snapshot inexistente' using errcode = 'P0002';
  end if;
  if target_snapshot.status <> 'staging' then
    raise exception 'Sólo se puede promover un snapshot staging' using errcode = '22023';
  end if;
  if not exists (select 1 from public.deck_builder_decks where snapshot_id = p_snapshot_id) then
    raise exception 'No se puede promover un snapshot vacío' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(target_snapshot.source || ':' || target_snapshot.format, 0));

  update public.deck_builder_snapshots
  set status = 'retired'
  where source = target_snapshot.source
    and format = target_snapshot.format
    and status = 'active'
    and id <> p_snapshot_id;

  update public.deck_builder_snapshots
  set status = 'active', activated_at = now()
  where id = p_snapshot_id;
end;
$$;

revoke all on function public.promote_deck_builder_snapshot(uuid) from public, anon, authenticated;
grant execute on function public.promote_deck_builder_snapshot(uuid) to service_role;

comment on table public.deck_builder_snapshots is 'Capturas aisladas y promocionables del explorador de decks de Crimson.';
comment on function public.promote_deck_builder_snapshot(uuid) is 'Promueve atómicamente un snapshot staging sin borrar historial ni tocar datos operativos.';

commit;
