begin;

create or replace function public.guard_import_item_quote_mutation()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $function$
declare
  target_order_id bigint;
  locked_status text;
  protected_change boolean;
begin
  if tg_op = 'UPDATE' and old.order_id is distinct from new.order_id then
    raise exception 'No se puede mover un artículo entre órdenes.' using errcode = '22023';
  end if;

  target_order_id := case when tg_op = 'DELETE' then old.order_id else new.order_id end;
  if target_order_id is null then
    raise exception 'Orden de importación inválida.' using errcode = '22023';
  end if;

  select io.status::text
    into locked_status
  from public.import_orders as io
  where io.id = target_order_id
  for update;

  if not found or locked_status is null then
    raise exception 'Orden de importación no editable.' using errcode = '42501';
  end if;

  protected_change := tg_op <> 'UPDATE'
    or (
      to_jsonb(new) - array['is_available', 'is_delivered', 'in_cart']::text[]
      is distinct from
      to_jsonb(old) - array['is_available', 'is_delivered', 'in_cart']::text[]
    );

  if protected_change
    and locked_status not in ('Iniciada', 'En cotización', 'Cotizada') then
    raise exception 'Los artículos de una cotización aprobada están congelados.' using errcode = '42501';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$function$;

drop trigger if exists guard_import_item_quote_mutation on public.import_items;
create trigger guard_import_item_quote_mutation
before insert or update or delete on public.import_items
for each row execute function public.guard_import_item_quote_mutation();

revoke all on function public.guard_import_item_quote_mutation()
  from public, anon, authenticated, service_role;

create or replace function public.admin_mutate_import_item_atomic(
  order_id_input bigint,
  item_id_input bigint,
  operation_input text,
  payload_input jsonb
)
returns bigint
language plpgsql
security invoker
set search_path = public, pg_temp
as $function$
declare
  locked_status text;
  changed_count integer;
  result_item_id bigint;
  product_name_value text;
  image_url_value text;
  quantity_value integer;
  platform_value public.import_platform;
  unit_price_value numeric;
  tax_percent_value numeric;
  shipping_cost_value numeric;
  set_name_value text;
  collector_number_value text;
  product_url_value text;
  flag_field text;
  flag_value boolean;
begin
  if order_id_input is null or order_id_input <= 0
    or operation_input is null
    or operation_input not in ('insert', 'update', 'delete', 'set-flag')
    or payload_input is null
    or jsonb_typeof(payload_input) <> 'object' then
    raise exception 'Mutación de artículo inválida.' using errcode = '22023';
  end if;

  if operation_input <> 'insert' and (item_id_input is null or item_id_input <= 0) then
    raise exception 'Artículo de importación inválido.' using errcode = '22023';
  end if;
  if operation_input = 'insert' and item_id_input is not null then
    raise exception 'Artículo de importación inválido.' using errcode = '22023';
  end if;

  select io.status::text
    into locked_status
  from public.import_orders as io
  where io.id = order_id_input
  for update;

  if not found or locked_status is null then
    raise exception 'Orden de importación no disponible.' using errcode = '42501';
  end if;
  if operation_input <> 'set-flag'
    and locked_status not in ('Iniciada', 'En cotización', 'Cotizada') then
    raise exception 'Orden de importación no editable.' using errcode = '42501';
  end if;

  if operation_input in ('insert', 'update') then
    if exists (
      select 1
      from jsonb_object_keys(payload_input) as key_name
      where key_name not in (
        'product_name', 'image_url', 'quantity', 'platform', 'unit_price',
        'tax_percent', 'shipping_cost', 'set_name', 'collector_number', 'product_url'
      )
    )
      or jsonb_typeof(payload_input -> 'product_name') <> 'string'
      or jsonb_typeof(payload_input -> 'image_url') <> 'string'
      or jsonb_typeof(payload_input -> 'quantity') <> 'number'
      or jsonb_typeof(payload_input -> 'platform') <> 'string'
      or jsonb_typeof(payload_input -> 'unit_price') <> 'number'
      or jsonb_typeof(payload_input -> 'tax_percent') <> 'number'
      or jsonb_typeof(payload_input -> 'shipping_cost') <> 'number'
      or jsonb_typeof(payload_input -> 'set_name') <> 'string'
      or jsonb_typeof(payload_input -> 'collector_number') <> 'string'
      or jsonb_typeof(payload_input -> 'product_url') <> 'string' then
      raise exception 'Datos de artículo inválidos.' using errcode = '22023';
    end if;

    product_name_value := btrim(payload_input ->> 'product_name');
    image_url_value := btrim(payload_input ->> 'image_url');
    quantity_value := (payload_input ->> 'quantity')::integer;
    platform_value := (payload_input ->> 'platform')::public.import_platform;
    unit_price_value := (payload_input ->> 'unit_price')::numeric;
    tax_percent_value := (payload_input ->> 'tax_percent')::numeric;
    shipping_cost_value := (payload_input ->> 'shipping_cost')::numeric;
    set_name_value := btrim(payload_input ->> 'set_name');
    collector_number_value := btrim(payload_input ->> 'collector_number');
    product_url_value := btrim(payload_input ->> 'product_url');

    if product_name_value = '' or octet_length(product_name_value) > 1000
      or octet_length(image_url_value) > 4096
      or quantity_value <= 0 or quantity_value > 1000000
      or unit_price_value::text in ('NaN', 'Infinity', '-Infinity')
      or tax_percent_value::text in ('NaN', 'Infinity', '-Infinity')
      or shipping_cost_value::text in ('NaN', 'Infinity', '-Infinity')
      or unit_price_value < 0 or unit_price_value > 1000000000
      or tax_percent_value < 0 or tax_percent_value > 1000
      or shipping_cost_value < 0 or shipping_cost_value > 1000000000
      or octet_length(set_name_value) > 1000
      or octet_length(collector_number_value) > 500
      or octet_length(product_url_value) > 4096 then
      raise exception 'Datos de artículo inválidos.' using errcode = '22023';
    end if;

    if operation_input = 'insert' then
      insert into public.import_items (
        order_id, product_name, image_url, quantity, platform, unit_price,
        tax_percent, shipping_cost, set_name, collector_number, product_url
      ) values (
        order_id_input, product_name_value, image_url_value, quantity_value,
        platform_value, unit_price_value, tax_percent_value, shipping_cost_value,
        set_name_value, collector_number_value, product_url_value
      )
      returning id into result_item_id;
    else
      update public.import_items
      set
        product_name = product_name_value,
        image_url = image_url_value,
        quantity = quantity_value,
        platform = platform_value,
        unit_price = unit_price_value,
        tax_percent = tax_percent_value,
        shipping_cost = shipping_cost_value,
        set_name = set_name_value,
        collector_number = collector_number_value,
        product_url = product_url_value
      where id = item_id_input
        and order_id = order_id_input;
      get diagnostics changed_count = row_count;
      if changed_count <> 1 then
        raise exception 'Artículo de importación no disponible.' using errcode = '42501';
      end if;
      result_item_id := item_id_input;
    end if;
  elsif operation_input = 'delete' then
    if payload_input <> '{}'::jsonb then
      raise exception 'Datos de artículo inválidos.' using errcode = '22023';
    end if;
    delete from public.import_items
    where id = item_id_input
      and order_id = order_id_input;
    get diagnostics changed_count = row_count;
    if changed_count <> 1 then
      raise exception 'Artículo de importación no disponible.' using errcode = '42501';
    end if;
    result_item_id := item_id_input;
  else
    if exists (
      select 1 from jsonb_object_keys(payload_input) as key_name
      where key_name not in ('field', 'value')
    )
      or jsonb_typeof(payload_input -> 'field') <> 'string'
      or jsonb_typeof(payload_input -> 'value') <> 'boolean' then
      raise exception 'Datos de estado inválidos.' using errcode = '22023';
    end if;
    flag_field := payload_input ->> 'field';
    flag_value := (payload_input ->> 'value')::boolean;
    if flag_field not in ('is_available', 'is_delivered', 'in_cart') then
      raise exception 'Campo de estado inválido.' using errcode = '22023';
    end if;

    update public.import_items
    set
      is_available = case when flag_field = 'is_available' then flag_value else is_available end,
      is_delivered = case when flag_field = 'is_delivered' then flag_value else is_delivered end,
      in_cart = case when flag_field = 'in_cart' then flag_value else in_cart end
    where id = item_id_input
      and order_id = order_id_input;
    get diagnostics changed_count = row_count;
    if changed_count <> 1 then
      raise exception 'Artículo de importación no disponible.' using errcode = '42501';
    end if;
    result_item_id := item_id_input;
  end if;

  return result_item_id;
end;
$function$;

create or replace function public.reject_import_quote_atomic(
  order_id_input bigint,
  user_id_input uuid
)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $function$
declare
  locked_owner_id uuid;
  locked_status text;
  changed_count integer;
begin
  if order_id_input is null or order_id_input <= 0 or user_id_input is null then
    raise exception 'Orden de importación inválida.' using errcode = '22023';
  end if;

  select io.user_id, io.status::text
    into locked_owner_id, locked_status
  from public.import_orders as io
  where io.id = order_id_input
  for update;

  if not found
    or locked_owner_id is distinct from user_id_input
    or locked_status is null
    or locked_status is distinct from 'Cotizada' then
    raise exception 'Orden de importación no disponible.' using errcode = '42501';
  end if;

  update public.import_orders
  set status = 'Solo Cotización'
  where id = order_id_input
    and user_id = locked_owner_id
    and status = 'Cotizada';
  get diagnostics changed_count = row_count;
  if changed_count <> 1 then
    raise exception 'Orden de importación no disponible.' using errcode = '42501';
  end if;
end;
$function$;

create or replace function public.delete_import_item_atomic(
  item_id_input bigint,
  order_id_input bigint,
  user_id_input uuid
)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $function$
declare
  locked_owner_id uuid;
  locked_status text;
  changed_count integer;
begin
  if item_id_input is null or item_id_input <= 0
    or order_id_input is null or order_id_input <= 0
    or user_id_input is null then
    raise exception 'Artículo de importación inválido.' using errcode = '22023';
  end if;

  select io.user_id, io.status::text
    into locked_owner_id, locked_status
  from public.import_orders as io
  where io.id = order_id_input
  for update;

  if not found
    or locked_owner_id is distinct from user_id_input
    or locked_status is null
    or locked_status not in ('Iniciada', 'Cotizada') then
    raise exception 'Orden de importación no editable.' using errcode = '42501';
  end if;

  delete from public.import_items
  where id = item_id_input
    and order_id = order_id_input;
  get diagnostics changed_count = row_count;
  if changed_count <> 1 then
    raise exception 'Artículo de importación no disponible.' using errcode = '42501';
  end if;
end;
$function$;

revoke all on function public.admin_mutate_import_item_atomic(bigint, bigint, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.admin_mutate_import_item_atomic(bigint, bigint, text, jsonb)
  to service_role;

revoke all on function public.reject_import_quote_atomic(bigint, uuid)
  from public, anon, authenticated;
grant execute on function public.reject_import_quote_atomic(bigint, uuid)
  to service_role;

revoke all on function public.delete_import_item_atomic(bigint, bigint, uuid)
  from public, anon, authenticated;
grant execute on function public.delete_import_item_atomic(bigint, bigint, uuid)
  to service_role;

commit;
