begin;

-- Reemplaza el checkout anterior: cada unidad se reserva desde una fila de
-- products concreta, pero la solicitud se resuelve por variant_key.
create or replace function public.place_order_atomic(
  p_items jsonb,
  p_coupon_code text default null,
  p_delivery_method text default 'pickup',
  p_shipping_address jsonb default null,
  p_use_credits boolean default false,
  p_contact_name text default null,
  p_contact_lastname text default null,
  p_contact_phone text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_order_id uuid;
  v_request record;
  v_offer record;
  v_coupon record;
  v_profile_credits numeric := 0;
  v_subtotal numeric := 0;
  v_total numeric := 0;
  v_discount_amount numeric := 0;
  v_credits_applied numeric := 0;
  v_status text := 'pending_payment';
  v_delivery_base text := lower(trim(split_part(coalesce(p_delivery_method, 'pickup'), ' [Pago:', 1)));
  v_delivery_note text;
  v_notes text;
  v_remaining integer;
  v_take integer;
  v_order_item_id uuid;
  v_allocations jsonb := '[]'::jsonb;
begin
  if v_user_id is null then
    raise exception 'Usuario no autenticado.' using errcode = '42501';
  end if;
  if p_contact_name is null or trim(p_contact_name) = ''
     or p_contact_lastname is null or trim(p_contact_lastname) = ''
     or p_contact_phone is null or trim(p_contact_phone) = '' then
    raise exception 'Por favor completa los datos de contacto.' using errcode = '22023';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'El carrito está vacío.' using errcode = '22023';
  end if;
  if v_delivery_base not in ('pickup', 'moto', 'shipping') then
    raise exception 'Método de entrega inválido.' using errcode = '22023';
  end if;
  if v_delivery_base in ('moto', 'shipping')
     and (jsonb_typeof(p_shipping_address) <> 'object'
       or nullif(trim(p_shipping_address ->> 'street'), '') is null
       or nullif(trim(p_shipping_address ->> 'city'), '') is null
       or nullif(trim(p_shipping_address ->> 'province'), '') is null
       or nullif(trim(p_shipping_address ->> 'zip'), '') is null) then
    raise exception 'Dirección incompleta para envío.' using errcode = '22023';
  end if;

  -- Validación explícita: no se aceptan productos que no existan ni cantidades
  -- no enteras. La suma posterior impide duplicar una variante desde el cliente.
  for v_request in
    select id as item_id, quantity
    from jsonb_to_recordset(p_items) as items(id uuid, quantity numeric)
  loop
    if v_request.item_id is null
       or v_request.quantity is null
       or v_request.quantity <= 0
       or v_request.quantity <> trunc(v_request.quantity)
       or v_request.quantity > 2147483647 then
      raise exception 'Cantidad inválida para producto.' using errcode = '22023';
    end if;
    if not exists (select 1 from public.products where id = v_request.item_id) then
      raise exception 'Producto inválido: %', v_request.item_id using errcode = '22023';
    end if;
  end loop;

  -- Una solicitud se agrupa por variante y consume primero el principal.
  for v_request in
    select p.variant_key, p.is_manual_price, p.price_usd, sum(items.quantity)::integer as quantity
    from jsonb_to_recordset(p_items) as items(id uuid, quantity numeric)
    join public.products p on p.id = items.id
    group by p.variant_key, p.is_manual_price, p.price_usd
    order by p.variant_key, p.is_manual_price, p.price_usd
  loop
    v_remaining := v_request.quantity;

    for v_offer in
      select
        p.id as product_id,
        p.inventory_id,
        p.variant_key,
        p.name,
        p.price_usd,
        p.stock,
        i.kind as inventory_kind,
        i.name as source_inventory_name
      from public.products p
      join public.inventories i on i.id = p.inventory_id
      where p.variant_key = v_request.variant_key
        and p.is_manual_price is not distinct from v_request.is_manual_price
        and p.price_usd is not distinct from v_request.price_usd
        and i.is_active = true
        and i.archived_at is null
        and coalesce(p.stock, 0) > 0
      order by case when i.kind = 'primary' then 0 else 1 end, i.id, p.id
      for update of p
    loop
      exit when v_remaining = 0;
      v_take := least(v_remaining, v_offer.stock);

      update public.products p
      set stock = coalesce(p.stock, 0) - v_take
      where p.id = v_offer.product_id
        and p.inventory_id = v_offer.inventory_id
        and coalesce(p.stock, 0) >= v_take;
      if not found then
        raise exception 'El stock cambió mientras se procesaba: %', v_offer.name using errcode = '22023';
      end if;

      v_subtotal := v_subtotal + (coalesce(v_offer.price_usd, 0) * v_take);
      v_allocations := v_allocations || jsonb_build_array(jsonb_build_object(
        'product_id', v_offer.product_id,
        'inventory_id', v_offer.inventory_id,
        'variant_key', v_offer.variant_key,
        'source_inventory_name', v_offer.source_inventory_name,
        'quantity', v_take,
        'price_usd', coalesce(v_offer.price_usd, 0)
      ));
      v_remaining := v_remaining - v_take;
    end loop;

    if v_remaining > 0 then
      raise exception 'Stock insuficiente para la variante solicitada.' using errcode = '22023';
    end if;
  end loop;

  v_total := v_subtotal;
  if nullif(trim(p_coupon_code), '') is not null then
    select code, discount_type, value into v_coupon
    from public.coupons
    where lower(code) = lower(trim(p_coupon_code)) and active = true
    limit 1;
    if found then
      if v_coupon.discount_type = 'percentage' then
        v_discount_amount := v_subtotal * (coalesce(v_coupon.value, 0) / 100);
      else
        v_discount_amount := coalesce(v_coupon.value, 0);
      end if;
      v_discount_amount := least(v_subtotal, greatest(0, v_discount_amount));
      v_total := greatest(0, v_subtotal - v_discount_amount);
    end if;
  end if;

  if p_use_credits then
    select credits into v_profile_credits
    from public.profiles where id = v_user_id for update;
    if not found then
      raise exception 'Perfil de usuario inexistente.' using errcode = '22023';
    end if;
    v_credits_applied := least(v_total, greatest(0, coalesce(v_profile_credits, 0)));
    v_total := greatest(0, v_total - v_credits_applied);
    if v_total = 0 then v_status := 'paid'; end if;
  end if;

  if v_delivery_base = 'pickup' then
    v_delivery_note := 'Entrega: Retiro en Tienda (Almagro)';
  elsif v_delivery_base = 'moto' then
    v_delivery_note := 'Entrega: Moto Mensajería (CABA/GBA) - A coordinar / Pago en destino';
  else
    v_delivery_note := format(
      'Entrega: Correo Argentino | %s, %s, %s (%s)',
      p_shipping_address ->> 'street', p_shipping_address ->> 'city',
      p_shipping_address ->> 'province', p_shipping_address ->> 'zip'
    );
  end if;

  v_notes := v_delivery_note || ' • Contacto: '
    || trim(p_contact_name) || ' ' || trim(p_contact_lastname)
    || ' (' || trim(p_contact_phone) || ')';
  if v_credits_applied > 0 then
    v_notes := v_notes || format(' • Pago con créditos: US$ %s', round(v_credits_applied, 2));
  end if;

  insert into public.orders (
    user_id, status, total_amount, credits_used, coupon_code, discount_amount,
    delivery_notes, delivery_method, shipping_address, contact_name,
    contact_lastname, contact_phone
  ) values (
    v_user_id, v_status, round(v_total, 2), round(v_credits_applied, 2),
    nullif(trim(p_coupon_code), ''), round(v_discount_amount, 2), v_notes,
    p_delivery_method, p_shipping_address, trim(p_contact_name),
    trim(p_contact_lastname), trim(p_contact_phone)
  ) returning id into v_order_id;

  if v_credits_applied > 0 then
    update public.profiles
    set credits = coalesce(credits, 0) - v_credits_applied
    where id = v_user_id and coalesce(credits, 0) >= v_credits_applied;
    if not found then
      raise exception 'Saldo insuficiente.' using errcode = '22003';
    end if;
    insert into public.credit_transactions (user_id, amount, type, description, reference_id)
    values (v_user_id, -v_credits_applied, 'purchase', 'Pago orden (Pendiente)', v_order_id);
  end if;

  for v_request in
    select *
    from jsonb_to_recordset(v_allocations) as allocations(
      product_id uuid,
      inventory_id uuid,
      variant_key text,
      source_inventory_name text,
      quantity integer,
      price_usd numeric
    )
  loop
    insert into public.order_items (
      order_id, product_id, quantity, price_at_purchase,
      inventory_id, variant_key, source_inventory_name
    ) values (
      v_order_id, v_request.product_id, v_request.quantity,
      v_request.price_usd, v_request.inventory_id, v_request.variant_key,
      v_request.source_inventory_name
    ) returning id into v_order_item_id;

    insert into public.inventory_stock_movements (
      inventory_id, product_id, order_id, order_item_id, quantity_delta,
      movement_type, reference_key, notes, created_by
    ) values (
      v_request.inventory_id, v_request.product_id, v_order_id, v_order_item_id,
      -v_request.quantity, 'reserve',
      format('order_item:%s:reserve', v_order_item_id),
      'Reserva creada por checkout híbrido.', v_user_id
    );
  end loop;

  return v_order_id;
end;
$$;

revoke all on function public.place_order_atomic(jsonb, text, text, jsonb, boolean, text, text, text)
  from public, anon, authenticated;
grant execute on function public.place_order_atomic(jsonb, text, text, jsonb, boolean, text, text, text)
  to authenticated, service_role;

create or replace function public.restore_order_inventory_atomic(
  order_id_input uuid,
  movement_type_input text default 'release'
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  item record;
  movement_id uuid;
begin
  if coalesce(auth.role(), 'anon') <> 'service_role' and not public.is_admin() then
    raise exception 'Sin permiso.' using errcode = '42501';
  end if;
  if movement_type_input not in ('release', 'cancellation', 'refund') then
    raise exception 'Tipo de restitución inválido.' using errcode = '22023';
  end if;

  for item in
    select oi.id as order_item_id, oi.product_id, oi.inventory_id, oi.quantity
    from public.order_items oi
    where oi.order_id = order_id_input
    order by oi.id
  loop
    if item.product_id is null or item.inventory_id is null or item.quantity is null or item.quantity <= 0 then
      raise exception 'Item inválido en la orden %.', order_id_input using errcode = '23514';
    end if;

    movement_id := null;
    insert into public.inventory_stock_movements (
      inventory_id, product_id, order_id, order_item_id, quantity_delta,
      movement_type, reference_key, notes, created_by
    ) values (
      item.inventory_id, item.product_id, order_id_input, item.order_item_id,
      item.quantity, movement_type_input,
      format('order_item:%s:%s', item.order_item_id, movement_type_input),
      format('Stock restituido por %s.', movement_type_input), auth.uid()
    ) on conflict (reference_key) do nothing
    returning id into movement_id;

    if movement_id is not null then
      update public.products p
      set stock = coalesce(p.stock, 0) + item.quantity
      where p.id = item.product_id
        and p.inventory_id = item.inventory_id;
      if not found then
        raise exception 'Producto %s no pertenece al inventario de origen.', item.product_id using errcode = '23503';
      end if;
    end if;
  end loop;
end;
$$;

revoke all on function public.restore_order_inventory_atomic(uuid, text)
  from public, anon, authenticated;
grant execute on function public.restore_order_inventory_atomic(uuid, text)
  to authenticated, service_role;

create or replace function public.restore_stock(order_id_input uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.restore_order_inventory_atomic(order_id_input, 'release');
end;
$$;

revoke all on function public.restore_stock(uuid)
  from public, anon, authenticated;
grant execute on function public.restore_stock(uuid)
  to authenticated, service_role;

create or replace function public.cancel_order_atomic(
  order_id_input uuid,
  restock_input boolean default true,
  refund_credits_input boolean default true
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_order public.orders;
begin
  if coalesce(auth.role(), 'anon') <> 'service_role' and not public.is_admin() then
    raise exception 'Sin permiso.' using errcode = '42501';
  end if;

  select * into current_order from public.orders where id = order_id_input for update;
  if not found then raise exception 'Orden inexistente.' using errcode = 'P0002'; end if;
  if current_order.status in ('cancelled', 'refunded') then
    raise exception 'La orden ya fue cerrada.' using errcode = '22023';
  end if;

  if restock_input then
    perform public.restore_order_inventory_atomic(order_id_input, 'cancellation');
  end if;
  if refund_credits_input and coalesce(current_order.credits_used, 0) > 0 then
    perform public.manage_credits(
      current_order.user_id,
      current_order.credits_used,
      'refund',
      format('Cancelación #%s', left(order_id_input::text, 8)),
      order_id_input
    );
  end if;

  update public.orders
  set status = 'cancelled'
  where id = order_id_input and status not in ('cancelled', 'refunded');
end;
$$;

revoke all on function public.cancel_order_atomic(uuid, boolean, boolean)
  from public, anon, authenticated;
grant execute on function public.cancel_order_atomic(uuid, boolean, boolean)
  to authenticated, service_role;

create or replace function public.refund_order_atomic(
  order_id_input uuid,
  restock_input boolean default true,
  credit_amount_input numeric default 0
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_order public.orders;
  gross_total numeric;
begin
  if coalesce(auth.role(), 'anon') <> 'service_role' and not public.is_admin() then
    raise exception 'Sin permiso.' using errcode = '42501';
  end if;
  if coalesce(credit_amount_input, 0) < 0 then
    raise exception 'Monto de reembolso inválido.' using errcode = '22023';
  end if;

  select * into current_order from public.orders where id = order_id_input for update;
  if not found then raise exception 'Orden inexistente.' using errcode = 'P0002'; end if;
  if current_order.status in ('cancelled', 'refunded') then
    raise exception 'La orden ya fue cerrada.' using errcode = '22023';
  end if;

  select coalesce(sum(oi.quantity * oi.price_at_purchase), 0)
  into gross_total
  from public.order_items oi
  where oi.order_id = order_id_input;
  if credit_amount_input > gross_total then
    raise exception 'El reembolso supera el valor de la orden.' using errcode = '22023';
  end if;

  if restock_input then
    perform public.restore_order_inventory_atomic(order_id_input, 'refund');
  end if;
  if credit_amount_input > 0 then
    perform public.manage_credits(
      current_order.user_id,
      credit_amount_input,
      'refund',
      format('Reembolso #%s', left(order_id_input::text, 8)),
      order_id_input
    );
  end if;

  update public.orders set status = 'refunded' where id = order_id_input;
end;
$$;

revoke all on function public.refund_order_atomic(uuid, boolean, numeric)
  from public, anon, authenticated;
grant execute on function public.refund_order_atomic(uuid, boolean, numeric)
  to authenticated, service_role;

create or replace function public.remove_order_item_atomic(
  order_item_id_input uuid,
  quantity_input integer,
  restock_input boolean default true
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  item record;
  current_order public.orders;
  new_gross numeric;
  new_discount numeric;
  new_credits numeric;
  credit_refund numeric;
begin
  if coalesce(auth.role(), 'anon') <> 'service_role' and not public.is_admin() then
    raise exception 'Sin permiso.' using errcode = '42501';
  end if;
  if quantity_input is null or quantity_input <= 0 then
    raise exception 'Cantidad inválida.' using errcode = '22023';
  end if;

  select oi.id, oi.order_id, oi.product_id, oi.inventory_id, oi.quantity
  into item
  from public.order_items oi
  where oi.id = order_item_id_input
  for update;
  if not found then raise exception 'Línea de orden inexistente.' using errcode = 'P0002'; end if;
  if quantity_input > item.quantity then
    raise exception 'No puedes eliminar más unidades de las existentes.' using errcode = '22023';
  end if;

  select * into current_order from public.orders where id = item.order_id for update;
  if current_order.status not in ('pending_payment', 'verifying_payment') then
    raise exception 'La línea solo puede eliminarse antes de confirmar el pago.' using errcode = '22023';
  end if;

  if restock_input then
    update public.products p
    set stock = coalesce(p.stock, 0) + quantity_input
    where p.id = item.product_id
      and p.inventory_id = item.inventory_id;
    if not found then
      raise exception 'El producto no pertenece al inventario snapshot de la línea.' using errcode = '23503';
    end if;
    insert into public.inventory_stock_movements (
      inventory_id, product_id, order_id, order_item_id, quantity_delta,
      movement_type, reference_key, notes, created_by
    ) values (
      item.inventory_id, item.product_id, item.order_id, item.id, quantity_input,
      'release', format('order_item:%s:partial:%s', item.id, gen_random_uuid()),
      'Stock restituido por eliminación parcial de línea.', auth.uid()
    );
  end if;

  if quantity_input = item.quantity then
    delete from public.order_items where id = item.id;
  else
    update public.order_items
    set quantity = quantity - quantity_input
    where id = item.id;
  end if;

  select coalesce(sum(oi.quantity * oi.price_at_purchase), 0)
  into new_gross
  from public.order_items oi
  where oi.order_id = item.order_id;
  new_discount := least(greatest(coalesce(current_order.discount_amount, 0), 0), new_gross);
  new_credits := least(greatest(coalesce(current_order.credits_used, 0), 0), greatest(0, new_gross - new_discount));
  credit_refund := greatest(0, coalesce(current_order.credits_used, 0) - new_credits);
  if credit_refund > 0 then
    perform public.manage_credits(
      current_order.user_id,
      credit_refund,
      'refund',
      format('Ajuste por eliminación de línea #%s', left(item.order_id::text, 8)),
      item.order_id
    );
  end if;

  update public.orders
  set discount_amount = round(new_discount, 2),
      credits_used = round(new_credits, 2),
      total_amount = round(greatest(0, new_gross - new_discount - new_credits), 2)
  where id = item.order_id;
end;
$$;

revoke all on function public.remove_order_item_atomic(uuid, integer, boolean)
  from public, anon, authenticated;
grant execute on function public.remove_order_item_atomic(uuid, integer, boolean)
  to authenticated, service_role;

create or replace function public.release_expired_orders_atomic(
  p_age_minutes integer default 15,
  p_payment_marker text default 'Mercado Pago'
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cutoff timestamptz;
  v_order record;
  v_cancelled integer := 0;
begin
  if p_age_minutes is null or p_age_minutes <= 0 then
    raise exception 'La antigüedad de expiración debe ser positiva.' using errcode = '22023';
  end if;
  if nullif(trim(p_payment_marker), '') is null then
    raise exception 'El marcador de pago es obligatorio.' using errcode = '22023';
  end if;
  if coalesce(auth.role(), 'anon') <> 'service_role' and not public.is_admin() then
    raise exception 'Sin permiso.' using errcode = '42501';
  end if;

  v_cutoff := now() - make_interval(mins => p_age_minutes);
  for v_order in
    select o.id
    from public.orders o
    where o.status = 'pending_payment'
      and o.created_at <= v_cutoff
      and o.delivery_method ilike '%' || trim(p_payment_marker) || '%'
    order by o.created_at, o.id
    for update skip locked
  loop
    perform public.restore_order_inventory_atomic(v_order.id, 'release');
    update public.orders
    set status = 'cancelled',
        delivery_notes = format('Cancelada automáticamente por abandono de pago en %s.', trim(p_payment_marker))
    where id = v_order.id and status = 'pending_payment';
    if found then v_cancelled := v_cancelled + 1; end if;
  end loop;

  return v_cancelled;
end;
$$;

revoke all on function public.release_expired_orders_atomic(integer, text)
  from public, anon, authenticated;
grant execute on function public.release_expired_orders_atomic(integer, text)
  to authenticated, service_role;

create or replace function public.get_inventory_metrics(inventory_id_input uuid default null)
returns table (
  inventory_id uuid,
  inventory_name text,
  inventory_kind text,
  is_active boolean,
  archived_at timestamptz,
  available_units bigint,
  variant_count bigint,
  stock_value numeric,
  reserved_units bigint,
  sold_units bigint,
  sold_revenue numeric,
  cancelled_units bigint,
  cancelled_revenue numeric
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if coalesce(auth.role(), 'anon') <> 'service_role' and not public.is_admin() then
    raise exception 'Sin permiso.' using errcode = '42501';
  end if;

  return query
  select
    i.id,
    i.name,
    i.kind,
    i.is_active,
    i.archived_at,
    coalesce((select sum(greatest(coalesce(p.stock, 0), 0)) from public.products p where p.inventory_id = i.id), 0)::bigint,
    coalesce((select count(*) from public.products p where p.inventory_id = i.id), 0)::bigint,
    coalesce((select sum(greatest(coalesce(p.stock, 0), 0) * coalesce(p.price_usd, 0)) from public.products p where p.inventory_id = i.id), 0),
    coalesce((
      select sum(oi.quantity)
      from public.order_items oi
      join public.orders o on o.id = oi.order_id
      where oi.inventory_id = i.id and o.status in ('pending_payment', 'verifying_payment')
    ), 0)::bigint,
    coalesce((
      select sum(oi.quantity)
      from public.order_items oi
      join public.orders o on o.id = oi.order_id
      where oi.inventory_id = i.id and o.status in ('paid', 'ready_pickup', 'shipped', 'completed')
    ), 0)::bigint,
    coalesce((
      select sum(oi.quantity * oi.price_at_purchase)
      from public.order_items oi
      join public.orders o on o.id = oi.order_id
      where oi.inventory_id = i.id and o.status in ('paid', 'ready_pickup', 'shipped', 'completed')
    ), 0),
    coalesce((
      select sum(oi.quantity)
      from public.order_items oi
      join public.orders o on o.id = oi.order_id
      where oi.inventory_id = i.id and o.status in ('cancelled', 'refunded')
    ), 0)::bigint,
    coalesce((
      select sum(oi.quantity * oi.price_at_purchase)
      from public.order_items oi
      join public.orders o on o.id = oi.order_id
      where oi.inventory_id = i.id and o.status in ('cancelled', 'refunded')
    ), 0)
  from public.inventories i
  where inventory_id_input is null or i.id = inventory_id_input
  order by case when i.kind = 'primary' then 0 else 1 end, i.name;
end;
$$;

revoke all on function public.get_inventory_metrics(uuid)
  from public, anon, authenticated;
grant execute on function public.get_inventory_metrics(uuid)
  to authenticated, service_role;

commit;
