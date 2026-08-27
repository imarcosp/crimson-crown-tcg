begin;

create table if not exists public.inventories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  location_label text,
  kind text not null default 'secondary' check (kind in ('primary', 'secondary')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create unique index if not exists inventories_one_primary_idx on public.inventories (kind) where kind = 'primary';
create unique index if not exists inventories_active_name_idx on public.inventories (lower(btrim(name))) where archived_at is null;

create or replace function public.build_product_variant_key(
  p_tcg text,
  p_scryfall_id text,
  p_name text,
  p_set_name text,
  p_collector_number text,
  p_condition text,
  p_language text,
  p_finish text
)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  with normalized as (
    select
      regexp_replace(lower(btrim(coalesce(p_tcg, ''))), '\s+', ' ', 'g') as tcg,
      regexp_replace(lower(btrim(coalesce(p_scryfall_id, ''))), '\s+', ' ', 'g') as scryfall_id,
      regexp_replace(lower(btrim(coalesce(p_name, ''))), '\s+', ' ', 'g') as name,
      regexp_replace(lower(btrim(coalesce(p_set_name, ''))), '\s+', ' ', 'g') as set_name,
      regexp_replace(lower(btrim(coalesce(p_collector_number, ''))), '\s+', ' ', 'g') as collector_number,
      regexp_replace(lower(btrim(coalesce(p_condition, ''))), '\s+', ' ', 'g') as condition,
      regexp_replace(lower(btrim(coalesce(p_language, ''))), '\s+', ' ', 'g') as language,
      regexp_replace(regexp_replace(lower(btrim(coalesce(p_finish, ''))), '[\s_-]+', '', 'g'), '^normal$', 'nonfoil') as finish
  )
  select case
    when tcg = 'magic' and scryfall_id <> '' then
      array_to_string(array['magic', 'print', scryfall_id, condition, language, finish], chr(31))
    else
      array_to_string(array['tcg', tcg, name, set_name, collector_number, condition, language, finish], chr(31))
  end
  from normalized;
$$;

alter table public.products add column if not exists inventory_id uuid;
alter table public.products add column if not exists variant_key text;

insert into public.inventories (name, description, kind, is_active)
select 'Inventario Principal', 'Inventario existente de Crimson Crown.', 'primary', true
where not exists (select 1 from public.inventories where kind = 'primary');

update public.products
set inventory_id = inventories.id
from public.inventories
where inventories.kind = 'primary'
  and public.products.inventory_id is null;

update public.products
set variant_key = public.build_product_variant_key(
  tcg,
  scryfall_id,
  name,
  set_name,
  collector_number,
  condition,
  language,
  finish
)
where variant_key is null or btrim(variant_key) = '';

alter table public.products alter column inventory_id set not null;
alter table public.products alter column variant_key set not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'products_inventory_id_fkey') then
    alter table public.products
      add constraint products_inventory_id_fkey foreign key (inventory_id) references public.inventories(id) on delete restrict;
  end if;
end;
$$;

create unique index if not exists products_inventory_variant_unique_idx on public.products (inventory_id, variant_key);
create index if not exists products_active_inventory_idx on public.products (inventory_id, stock) where stock > 0;

alter table public.order_items add column if not exists inventory_id uuid;
alter table public.order_items add column if not exists variant_key text;
alter table public.order_items add column if not exists source_inventory_name text;

update public.order_items oi
set inventory_id = p.inventory_id,
    variant_key = p.variant_key,
    source_inventory_name = i.name
from public.products p
join public.inventories i on i.id = p.inventory_id
where p.id = oi.product_id
  and (oi.inventory_id is null or oi.variant_key is null or oi.source_inventory_name is null);

alter table public.order_items alter column inventory_id set not null;
alter table public.order_items alter column variant_key set not null;
alter table public.order_items alter column source_inventory_name set not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'order_items_inventory_id_fkey') then
    alter table public.order_items
      add constraint order_items_inventory_id_fkey foreign key (inventory_id) references public.inventories(id) on delete restrict;
  end if;
end;
$$;

create index if not exists order_items_inventory_id_idx on public.order_items (inventory_id, order_id);

create table if not exists public.inventory_stock_movements (
  id uuid primary key default gen_random_uuid(),
  inventory_id uuid not null references public.inventories(id) on delete restrict,
  product_id uuid references public.products(id) on delete set null,
  order_id uuid references public.orders(id) on delete set null,
  order_item_id uuid references public.order_items(id) on delete set null,
  quantity_delta integer not null,
  movement_type text not null check (movement_type in ('inbound', 'reserve', 'sale', 'release', 'cancellation', 'refund', 'adjustment', 'manual')),
  reference_key text not null,
  notes text,
  created_by uuid,
  created_at timestamptz not null default now(),
  constraint inventory_stock_movements_idempotency_unique unique (reference_key)
);

create index if not exists inventory_stock_movements_inventory_idx on public.inventory_stock_movements (inventory_id, created_at desc);
create index if not exists inventory_stock_movements_order_idx on public.inventory_stock_movements (order_id, order_item_id);

create or replace function public.set_product_inventory_fields()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE' and new.inventory_id is distinct from old.inventory_id then
    raise exception 'Un producto no puede cambiar de inventario.' using errcode = '22023';
  end if;

  new.variant_key := public.build_product_variant_key(
    new.tcg,
    new.scryfall_id,
    new.name,
    new.set_name,
    new.collector_number,
    new.condition,
    new.language,
    new.finish
  );
  return new;
end;
$$;

drop trigger if exists products_set_inventory_fields on public.products;
create trigger products_set_inventory_fields
before insert or update of tcg, scryfall_id, name, set_name, collector_number, condition, language, finish, inventory_id
on public.products
for each row execute function public.set_product_inventory_fields();

create or replace function public.create_inventory(
  name_input text,
  description_input text default null,
  location_label_input text default null
)
returns public.inventories
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  created public.inventories;
begin
  if coalesce(auth.role(), 'anon') <> 'service_role' and not public.is_admin() then
    raise exception 'Sin permiso.' using errcode = '42501';
  end if;
  if nullif(btrim(name_input), '') is null then
    raise exception 'El nombre del inventario es obligatorio.' using errcode = '22023';
  end if;
  if exists (select 1 from public.inventories where archived_at is null and lower(btrim(name)) = lower(btrim(name_input))) then
    raise exception 'Ya existe un inventario con ese nombre.' using errcode = '23505';
  end if;

  insert into public.inventories (name, description, location_label, kind, is_active)
  values (btrim(name_input), nullif(btrim(description_input), ''), nullif(btrim(location_label_input), ''), 'secondary', true)
  returning * into created;
  return created;
end;
$$;

create or replace function public.set_inventory_active(
  inventory_id_input uuid,
  is_active_input boolean
)
returns public.inventories
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_inventory public.inventories;
begin
  if coalesce(auth.role(), 'anon') <> 'service_role' and not public.is_admin() then
    raise exception 'Sin permiso.' using errcode = '42501';
  end if;
  select * into current_inventory from public.inventories where id = inventory_id_input for update;
  if not found then raise exception 'Inventario inexistente.' using errcode = 'P0002'; end if;
  if current_inventory.kind = 'primary' then
    raise exception 'El inventario principal siempre debe permanecer activo.' using errcode = '42501';
  end if;
  if current_inventory.archived_at is not null and is_active_input then
    raise exception 'Un inventario archivado no puede reactivarse.' using errcode = '22023';
  end if;

  update public.inventories
  set is_active = coalesce(is_active_input, false), updated_at = now()
  where id = inventory_id_input
  returning * into current_inventory;
  return current_inventory;
end;
$$;

create or replace function public.archive_inventory(inventory_id_input uuid)
returns public.inventories
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  archived public.inventories;
begin
  if coalesce(auth.role(), 'anon') <> 'service_role' and not public.is_admin() then
    raise exception 'Sin permiso.' using errcode = '42501';
  end if;
  select * into archived from public.inventories where id = inventory_id_input for update;
  if not found then raise exception 'Inventario inexistente.' using errcode = 'P0002'; end if;
  if archived.kind = 'primary' then raise exception 'El inventario principal no se puede archivar.' using errcode = '42501'; end if;

  update public.inventories
  set is_active = false, archived_at = coalesce(archived_at, now()), updated_at = now()
  where id = inventory_id_input
  returning * into archived;
  return archived;
end;
$$;

create or replace function public.delete_inventory_safely(inventory_id_input uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_inventory public.inventories;
  deleted_products integer := 0;
begin
  if coalesce(auth.role(), 'anon') <> 'service_role' and not public.is_admin() then
    raise exception 'Sin permiso.' using errcode = '42501';
  end if;
  select * into current_inventory from public.inventories where id = inventory_id_input for update;
  if not found then raise exception 'Inventario inexistente.' using errcode = 'P0002'; end if;
  if current_inventory.kind = 'primary' then raise exception 'El inventario principal no se puede eliminar.' using errcode = '42501'; end if;
  if exists (select 1 from public.products where inventory_id = inventory_id_input and coalesce(stock, 0) > 0) then
    raise exception 'No se puede eliminar un inventario con stock.' using errcode = '23514';
  end if;
  if exists (select 1 from public.order_items where inventory_id = inventory_id_input)
     or exists (select 1 from public.inventory_stock_movements where inventory_id = inventory_id_input) then
    raise exception 'El inventario tiene historial y debe archivarse.' using errcode = '23514';
  end if;

  delete from public.products where inventory_id = inventory_id_input;
  get diagnostics deleted_products = row_count;
  delete from public.inventories where id = inventory_id_input;
  return deleted_products;
end;
$$;

alter table public.inventories enable row level security;
alter table public.inventory_stock_movements enable row level security;

drop policy if exists "Public reads active inventories" on public.inventories;
create policy "Public reads active inventories" on public.inventories
  for select to anon, authenticated
  using (is_active = true and archived_at is null);

drop policy if exists "Admins manage inventories" on public.inventories;
create policy "Admins manage inventories" on public.inventories
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "Admins read inventory movements" on public.inventory_stock_movements;
create policy "Admins read inventory movements" on public.inventory_stock_movements
  for select to authenticated using (public.is_admin());

revoke all on public.inventories from public, anon, authenticated;
grant select on public.inventories to anon, authenticated;
grant all on public.inventories to service_role;
revoke all on public.inventory_stock_movements from public, anon, authenticated;
grant select on public.inventory_stock_movements to authenticated;
grant all on public.inventory_stock_movements to service_role;

revoke all on function public.build_product_variant_key(text, text, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.build_product_variant_key(text, text, text, text, text, text, text, text) to authenticated, service_role;
revoke all on function public.create_inventory(text, text, text) from public, anon, authenticated;
grant execute on function public.create_inventory(text, text, text) to authenticated, service_role;
revoke all on function public.set_inventory_active(uuid, boolean) from public, anon, authenticated;
grant execute on function public.set_inventory_active(uuid, boolean) to authenticated, service_role;
revoke all on function public.archive_inventory(uuid) from public, anon, authenticated;
grant execute on function public.archive_inventory(uuid) to authenticated, service_role;
revoke all on function public.delete_inventory_safely(uuid) from public, anon, authenticated;
grant execute on function public.delete_inventory_safely(uuid) to authenticated, service_role;

commit;
