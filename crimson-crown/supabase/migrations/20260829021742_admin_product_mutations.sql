begin;

create or replace function public.validate_admin_product_input(product_input jsonb)
returns jsonb
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_name text;
  v_set_name text;
  v_collector_number text;
  v_tcg text;
  v_price_usd numeric;
  v_stock_numeric numeric;
  v_condition text;
  v_finish text;
  v_rarity text;
  v_image_url text;
  v_scryfall_id text;
  v_is_manual_price boolean;
  v_language text;
  v_metadata jsonb;
begin
  if jsonb_typeof(product_input) is distinct from 'object' then
    raise exception 'Datos de producto inválidos.' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_object_keys(product_input) as keys(key)
    where keys.key not in (
      'name', 'set_name', 'collector_number', 'tcg', 'price_usd', 'stock',
      'condition', 'finish', 'rarity', 'image_url', 'scryfall_id',
      'is_manual_price', 'language', 'metadata'
    )
  ) then
    raise exception 'Campos de producto inválidos.' using errcode = '22023';
  end if;

  if jsonb_typeof(product_input -> 'name') is distinct from 'string'
     or jsonb_typeof(product_input -> 'set_name') is distinct from 'string'
     or jsonb_typeof(product_input -> 'tcg') is distinct from 'string'
     or jsonb_typeof(product_input -> 'condition') is distinct from 'string'
     or jsonb_typeof(product_input -> 'finish') is distinct from 'string'
     or jsonb_typeof(product_input -> 'language') is distinct from 'string' then
    raise exception 'Campos obligatorios de producto inválidos.' using errcode = '22023';
  end if;

  v_name := regexp_replace(btrim(product_input ->> 'name'), '\s+', ' ', 'g');
  v_set_name := regexp_replace(btrim(product_input ->> 'set_name'), '\s+', ' ', 'g');
  v_tcg := regexp_replace(btrim(product_input ->> 'tcg'), '\s+', ' ', 'g');
  v_condition := regexp_replace(btrim(product_input ->> 'condition'), '\s+', ' ', 'g');
  v_finish := regexp_replace(btrim(product_input ->> 'finish'), '\s+', ' ', 'g');
  v_language := regexp_replace(btrim(product_input ->> 'language'), '\s+', ' ', 'g');

  if v_name = '' or v_set_name = '' or v_tcg = '' or v_condition = '' or v_finish = '' or v_language = '' then
    raise exception 'Campos obligatorios de producto inválidos.' using errcode = '22023';
  end if;

  if jsonb_typeof(product_input -> 'stock') is distinct from 'number' then
    raise exception 'Stock inválido.' using errcode = '22023';
  end if;
  v_stock_numeric := (product_input ->> 'stock')::numeric;
  if v_stock_numeric < 0 or v_stock_numeric <> trunc(v_stock_numeric) or v_stock_numeric > 2147483647 then
    raise exception 'Stock inválido.' using errcode = '22023';
  end if;

  if jsonb_typeof(product_input -> 'price_usd') is distinct from 'number' then
    raise exception 'Precio inválido.' using errcode = '22023';
  end if;
  v_price_usd := (product_input ->> 'price_usd')::numeric;
  if v_price_usd < 0 or v_price_usd::text in ('NaN', 'Infinity', '-Infinity') then
    raise exception 'Precio inválido.' using errcode = '22023';
  end if;

  if product_input ? 'collector_number'
     and jsonb_typeof(product_input -> 'collector_number') not in ('string', 'null') then
    raise exception 'Número de colección inválido.' using errcode = '22023';
  end if;
  v_collector_number := nullif(regexp_replace(btrim(coalesce(product_input ->> 'collector_number', '')), '\s+', ' ', 'g'), '');

  if product_input ? 'scryfall_id'
     and jsonb_typeof(product_input -> 'scryfall_id') not in ('string', 'null') then
    raise exception 'Identificador de Scryfall inválido.' using errcode = '22023';
  end if;
  v_scryfall_id := nullif(regexp_replace(btrim(coalesce(product_input ->> 'scryfall_id', '')), '\s+', ' ', 'g'), '');

  if product_input ? 'rarity' and jsonb_typeof(product_input -> 'rarity') not in ('string', 'null') then
    raise exception 'Rareza inválida.' using errcode = '22023';
  end if;
  if product_input ? 'image_url' and jsonb_typeof(product_input -> 'image_url') not in ('string', 'null') then
    raise exception 'URL de imagen inválida.' using errcode = '22023';
  end if;
  v_rarity := regexp_replace(btrim(coalesce(product_input ->> 'rarity', '')), '\s+', ' ', 'g');
  v_image_url := btrim(coalesce(product_input ->> 'image_url', ''));

  if jsonb_typeof(product_input -> 'is_manual_price') is distinct from 'boolean' then
    raise exception 'Indicador de precio manual inválido.' using errcode = '22023';
  end if;
  v_is_manual_price := (product_input ->> 'is_manual_price')::boolean;

  if not (product_input ? 'metadata') or jsonb_typeof(product_input -> 'metadata') = 'null' then
    v_metadata := '{}'::jsonb;
  elsif jsonb_typeof(product_input -> 'metadata') = 'object' then
    v_metadata := product_input -> 'metadata';
  else
    raise exception 'Metadatos inválidos.' using errcode = '22023';
  end if;

  return jsonb_build_object(
    'name', v_name,
    'set_name', v_set_name,
    'collector_number', v_collector_number,
    'tcg', v_tcg,
    'price_usd', v_price_usd,
    'stock', v_stock_numeric::integer,
    'condition', v_condition,
    'finish', v_finish,
    'rarity', v_rarity,
    'image_url', v_image_url,
    'scryfall_id', v_scryfall_id,
    'is_manual_price', v_is_manual_price,
    'language', v_language,
    'metadata', v_metadata
  );
end;
$$;

create or replace function public.admin_create_or_restock_product(
  inventory_id_input uuid,
  product_input jsonb,
  operation_key_input text
)
returns table(product_id uuid, mutation_kind text, previous_stock integer, current_stock integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_input jsonb;
  v_reference_key text;
  v_expected_variant_key text;
  v_product_id uuid;
  v_mutation_kind text;
  v_previous_stock integer;
  v_current_stock integer;
  v_stock integer;
  v_inserted boolean;
  v_existing record;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Sin permiso.' using errcode = '42501';
  end if;
  if operation_key_input is null or btrim(operation_key_input) !~ '^[A-Za-z0-9:_-]{8,160}$' then
    raise exception 'Clave de operación inválida.' using errcode = '22023';
  end if;

  perform 1
  from public.inventories inventories
  where inventories.id = inventory_id_input
    and inventories.is_active = true
    and inventories.archived_at is null
  for share;
  if not found then
    raise exception 'Inventario inexistente o archivado.' using errcode = '23503';
  end if;

  v_input := public.validate_admin_product_input(product_input);
  v_stock := (v_input ->> 'stock')::integer;
  v_reference_key := 'admin-product:' || btrim(operation_key_input);
  v_expected_variant_key := public.build_product_variant_key(
    v_input ->> 'tcg',
    v_input ->> 'scryfall_id',
    v_input ->> 'name',
    v_input ->> 'set_name',
    v_input ->> 'collector_number',
    v_input ->> 'condition',
    v_input ->> 'language',
    v_input ->> 'finish'
  );

  select movements.product_id, movements.inventory_id, movements.notes, products.stock, products.variant_key
  into v_existing
  from public.inventory_stock_movements movements
  left join public.products products on products.id = movements.product_id
  where movements.reference_key = v_reference_key;

  if found then
    if v_existing.product_id is null
       or v_existing.inventory_id is distinct from inventory_id_input
       or v_existing.variant_key is distinct from v_expected_variant_key
       or split_part(coalesce(v_existing.notes, ''), '|', 1) <> 'admin-product' then
      raise exception 'La clave de operación ya fue utilizada.' using errcode = '22023';
    end if;
    v_product_id := v_existing.product_id;
    v_mutation_kind := split_part(v_existing.notes, '|', 2);
    v_previous_stock := split_part(v_existing.notes, '|', 3)::integer;
    v_current_stock := v_existing.stock;
    return query select v_product_id, v_mutation_kind, v_previous_stock, v_current_stock;
    return;
  end if;

  insert into public.products as products (
    name, set_name, collector_number, tcg, price_usd, stock,
    condition, finish, rarity, image_url, scryfall_id,
    is_manual_price, language, metadata, restocked_at, inventory_id
  ) values (
    v_input ->> 'name',
    v_input ->> 'set_name',
    v_input ->> 'collector_number',
    v_input ->> 'tcg',
    (v_input ->> 'price_usd')::numeric,
    v_stock,
    v_input ->> 'condition',
    v_input ->> 'finish',
    v_input ->> 'rarity',
    v_input ->> 'image_url',
    v_input ->> 'scryfall_id',
    (v_input ->> 'is_manual_price')::boolean,
    v_input ->> 'language',
    v_input -> 'metadata',
    case when v_stock > 0 then now() else null end,
    inventory_id_input
  )
  on conflict (inventory_id, variant_key) do update
  set stock = products.stock + excluded.stock,
      image_url = case when excluded.image_url <> '' then excluded.image_url else products.image_url end,
      metadata = case when excluded.metadata <> '{}'::jsonb then excluded.metadata else products.metadata end,
      restocked_at = case when excluded.stock > 0 then now() else products.restocked_at end
  returning products.id, products.stock, (xmax = 0)
  into v_product_id, v_current_stock, v_inserted;

  v_mutation_kind := case when v_inserted then 'inserted' else 'restocked' end;
  v_previous_stock := case when v_inserted then 0 else v_current_stock - v_stock end;

  if v_stock <> 0 then
    insert into public.inventory_stock_movements (
      inventory_id, product_id, quantity_delta, movement_type,
      reference_key, notes, created_by
    ) values (
      inventory_id_input, v_product_id, v_stock, 'inbound',
      v_reference_key,
      format('admin-product|%s|%s|%s', v_mutation_kind, v_previous_stock, v_current_stock),
      auth.uid()
    );
  end if;

  return query select v_product_id, v_mutation_kind, v_previous_stock, v_current_stock;
end;
$$;

create or replace function public.admin_update_product(
  product_id_input uuid,
  inventory_id_input uuid,
  product_input jsonb,
  operation_key_input text
)
returns table(product_id uuid, mutation_kind text, previous_stock integer, current_stock integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_input jsonb;
  v_reference_key text;
  v_product public.products%rowtype;
  v_existing record;
  v_previous_stock integer;
  v_current_stock integer;
  v_delta integer;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Sin permiso.' using errcode = '42501';
  end if;
  if operation_key_input is null or btrim(operation_key_input) !~ '^[A-Za-z0-9:_-]{8,160}$' then
    raise exception 'Clave de operación inválida.' using errcode = '22023';
  end if;

  perform 1
  from public.inventories inventories
  where inventories.id = inventory_id_input
    and inventories.is_active = true
    and inventories.archived_at is null
  for share;
  if not found then
    raise exception 'Inventario inexistente o archivado.' using errcode = '23503';
  end if;

  v_input := public.validate_admin_product_input(product_input);
  v_reference_key := 'admin-product:' || btrim(operation_key_input);

  select movements.product_id, movements.inventory_id, movements.notes, products.stock
  into v_existing
  from public.inventory_stock_movements movements
  left join public.products products on products.id = movements.product_id
  where movements.reference_key = v_reference_key;

  if found then
    if v_existing.product_id is distinct from product_id_input
       or v_existing.inventory_id is distinct from inventory_id_input
       or split_part(coalesce(v_existing.notes, ''), '|', 1) <> 'admin-product' then
      raise exception 'La clave de operación ya fue utilizada.' using errcode = '22023';
    end if;
    return query select
      product_id_input,
      split_part(v_existing.notes, '|', 2),
      split_part(v_existing.notes, '|', 3)::integer,
      v_existing.stock::integer;
    return;
  end if;

  select products.*
  into v_product
  from public.products products
  where products.id = product_id_input
    and products.inventory_id = inventory_id_input
  for update;
  if not found then
    raise exception 'Producto inexistente en el inventario.' using errcode = '23503';
  end if;

  v_previous_stock := v_product.stock;
  v_current_stock := (v_input ->> 'stock')::integer;
  v_delta := v_current_stock - v_previous_stock;

  update public.products products
  set name = v_input ->> 'name',
      set_name = v_input ->> 'set_name',
      collector_number = v_input ->> 'collector_number',
      tcg = v_input ->> 'tcg',
      price_usd = (v_input ->> 'price_usd')::numeric,
      stock = v_current_stock,
      condition = v_input ->> 'condition',
      finish = v_input ->> 'finish',
      rarity = v_input ->> 'rarity',
      image_url = v_input ->> 'image_url',
      scryfall_id = v_input ->> 'scryfall_id',
      is_manual_price = (v_input ->> 'is_manual_price')::boolean,
      language = v_input ->> 'language',
      metadata = v_input -> 'metadata',
      restocked_at = case when v_delta > 0 then now() else products.restocked_at end
  where products.id = product_id_input
    and products.inventory_id = inventory_id_input;

  if v_delta <> 0 then
    insert into public.inventory_stock_movements (
      inventory_id, product_id, quantity_delta, movement_type,
      reference_key, notes, created_by
    ) values (
      inventory_id_input, product_id_input, v_delta, 'adjustment',
      v_reference_key,
      format('admin-product|updated|%s|%s', v_previous_stock, v_current_stock),
      auth.uid()
    );
  end if;

  return query select product_id_input, 'updated'::text, v_previous_stock, v_current_stock;
end;
$$;

create or replace function public.admin_delete_products(
  inventory_id_input uuid,
  product_ids_input uuid[],
  operation_key_input text
)
returns table(deleted_ids uuid[], rejected_ids uuid[])
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_requested_ids uuid[];
  v_candidate_ids uuid[];
  v_deleted_ids uuid[];
  v_rejected_ids uuid[];
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Sin permiso.' using errcode = '42501';
  end if;
  if operation_key_input is null or btrim(operation_key_input) !~ '^[A-Za-z0-9:_-]{8,160}$' then
    raise exception 'Clave de operación inválida.' using errcode = '22023';
  end if;

  perform 1
  from public.inventories inventories
  where inventories.id = inventory_id_input
    and inventories.is_active = true
    and inventories.archived_at is null
  for share;
  if not found then
    raise exception 'Inventario inexistente o archivado.' using errcode = '23503';
  end if;

  select array(
    select distinct requested_id
    from unnest(coalesce(product_ids_input, '{}'::uuid[])) as requested(requested_id)
    where requested_id is not null
    order by requested_id
  ) into v_requested_ids;
  if cardinality(v_requested_ids) = 0 then
    raise exception 'No hay productos para eliminar.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('admin-product-delete:' || btrim(operation_key_input), 0));

  perform 1
  from public.products products
  where products.inventory_id = inventory_id_input
    and products.id = any(v_requested_ids)
  order by products.id
  for update;

  select array(
    select products.id
    from public.products products
    where products.inventory_id = inventory_id_input
      and products.id = any(v_requested_ids)
    order by products.id
  ) into v_candidate_ids;

  select array(
    select requested_id
    from unnest(v_requested_ids) as requested(requested_id)
    where not (requested_id = any(v_candidate_ids))
       or exists (select 1 from public.order_items items where items.product_id = requested_id)
       or exists (select 1 from public.inventory_stock_movements movements where movements.product_id = requested_id)
    order by requested_id
  ) into v_rejected_ids;

  select array(
    select candidate_id
    from unnest(v_candidate_ids) as candidates(candidate_id)
    where not (candidate_id = any(v_rejected_ids))
    order by candidate_id
  ) into v_deleted_ids;

  if cardinality(v_deleted_ids) > 0 then
    delete from public.products products
    where products.inventory_id = inventory_id_input
      and products.id = any(v_deleted_ids);
  end if;

  return query select v_deleted_ids, v_rejected_ids;
end;
$$;

revoke all on function public.validate_admin_product_input(jsonb) from public, anon, authenticated;
grant execute on function public.validate_admin_product_input(jsonb) to service_role;

revoke all on function public.admin_create_or_restock_product(uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.admin_create_or_restock_product(uuid, jsonb, text) to authenticated, service_role;
revoke all on function public.admin_update_product(uuid, uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.admin_update_product(uuid, uuid, jsonb, text) to authenticated, service_role;
revoke all on function public.admin_delete_products(uuid, uuid[], text) from public, anon, authenticated;
grant execute on function public.admin_delete_products(uuid, uuid[], text) to authenticated, service_role;

commit;
