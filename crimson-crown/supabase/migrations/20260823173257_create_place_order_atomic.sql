begin;

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
  v_item record;
  v_product record;
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
  v_resolved_items jsonb := '[]'::jsonb;
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

  -- Aggregate duplicate product IDs and lock each row before checking stock.
  -- Any later exception rolls back every lock-protected update in this function.
  for v_item in
    select id as item_id, sum(quantity) as quantity
    from jsonb_to_recordset(p_items) as items(id uuid, quantity numeric)
    group by id
    order by id
  loop
    if v_item.item_id is null
       or v_item.quantity is null
       or v_item.quantity <= 0
       or v_item.quantity <> trunc(v_item.quantity)
       or v_item.quantity > 2147483647 then
      raise exception 'Cantidad inválida para producto.' using errcode = '22023';
    end if;

    select id, name, price_usd, stock
    into v_product
    from public.products
    where id = v_item.item_id
    for update;

    if not found then
      raise exception 'Producto inválido: %', v_item.item_id using errcode = '22023';
    end if;

    if coalesce(v_product.stock, 0) < v_item.quantity::integer then
      raise exception 'Stock insuficiente para: %', v_product.name using errcode = '22023';
    end if;

    update public.products
    set stock = stock - v_item.quantity::integer
    where id = v_item.item_id;

    v_subtotal := v_subtotal + (coalesce(v_product.price_usd, 0) * v_item.quantity);
    v_resolved_items := v_resolved_items || jsonb_build_array(jsonb_build_object(
      'id', v_product.id,
      'name', v_product.name,
      'quantity', v_item.quantity::integer,
      'price_usd', coalesce(v_product.price_usd, 0)
    ));
  end loop;

  v_total := v_subtotal;

  if nullif(trim(p_coupon_code), '') is not null then
    select code, discount_type, value
    into v_coupon
    from public.coupons
    where lower(code) = lower(trim(p_coupon_code))
      and active = true
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
    select credits
    into v_profile_credits
    from public.profiles
    where id = v_user_id
    for update;

    if not found then
      raise exception 'Perfil de usuario inexistente.' using errcode = '22023';
    end if;

    v_credits_applied := least(v_total, greatest(0, coalesce(v_profile_credits, 0)));
    v_total := greatest(0, v_total - v_credits_applied);
    if v_total = 0 then
      v_status := 'paid';
    end if;
  end if;

  if v_delivery_base = 'pickup' then
    v_delivery_note := 'Entrega: Retiro en Tienda (Almagro)';
  elsif v_delivery_base = 'moto' then
    v_delivery_note := 'Entrega: Moto Mensajería (CABA/GBA) - A coordinar / Pago en destino';
  else
    v_delivery_note := format(
      'Entrega: Correo Argentino | %s, %s, %s (%s)',
      p_shipping_address ->> 'street',
      p_shipping_address ->> 'city',
      p_shipping_address ->> 'province',
      p_shipping_address ->> 'zip'
    );
  end if;

  v_notes := v_delivery_note || ' • Contacto: '
    || trim(p_contact_name) || ' ' || trim(p_contact_lastname)
    || ' (' || trim(p_contact_phone) || ')';
  if v_credits_applied > 0 then
    v_notes := v_notes || format(' • Pago con créditos: US$ %s', round(v_credits_applied, 2));
  end if;

  insert into public.orders (
    user_id,
    status,
    total_amount,
    credits_used,
    coupon_code,
    discount_amount,
    delivery_notes,
    delivery_method,
    shipping_address,
    contact_name,
    contact_lastname,
    contact_phone
  ) values (
    v_user_id,
    v_status,
    round(v_total, 2),
    round(v_credits_applied, 2),
    nullif(trim(p_coupon_code), ''),
    round(v_discount_amount, 2),
    v_notes,
    p_delivery_method,
    p_shipping_address,
    trim(p_contact_name),
    trim(p_contact_lastname),
    trim(p_contact_phone)
  ) returning id into v_order_id;

  if v_credits_applied > 0 then
    update public.profiles
    set credits = coalesce(credits, 0) - v_credits_applied
    where id = v_user_id
      and coalesce(credits, 0) >= v_credits_applied;

    if not found then
      raise exception 'Saldo insuficiente.' using errcode = '22003';
    end if;

    insert into public.credit_transactions (user_id, amount, type, description, reference_id)
    values (v_user_id, -v_credits_applied, 'purchase', 'Pago orden (Pendiente)', v_order_id);
  end if;

  for v_item in
    select id as item_id, quantity, price_usd
    from jsonb_to_recordset(v_resolved_items) as items(id uuid, quantity integer, price_usd numeric)
  loop
    insert into public.order_items (order_id, product_id, quantity, price_at_purchase)
    values (v_order_id, v_item.item_id, v_item.quantity, v_item.price_usd);
  end loop;

  return v_order_id;
end;
$$;

revoke all on function public.place_order_atomic(jsonb, text, text, jsonb, boolean, text, text, text)
  from public, anon, authenticated;
grant execute on function public.place_order_atomic(jsonb, text, text, jsonb, boolean, text, text, text)
  to authenticated, service_role;

commit;
