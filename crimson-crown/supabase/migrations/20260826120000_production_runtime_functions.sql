begin;

-- Runtime functions required by the current application release. This
-- migration only creates/replaces functions and grants; it does not modify
-- any existing rows or table policies.

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.profiles
    where id = (select auth.uid())
      and (
        role = 'admin'
        or lower(email) in ('mjperchezabala@gmail.com', 'crimsoncrownimports@gmail.com')
      )
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated, service_role;

-- Harden existing credit/stock RPCs before exposing the new checkout flow.
create or replace function public.manage_credits(
  target_user_id uuid,
  amount_change numeric,
  transaction_type text,
  transaction_desc text,
  ref_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if target_user_id is null or amount_change is null then
    raise exception 'Parámetros de créditos inválidos.' using errcode = '22023';
  end if;
  if coalesce(auth.role(), 'anon') <> 'service_role' and not public.is_admin() then
    if target_user_id is distinct from auth.uid() or amount_change >= 0 then
      raise exception 'Sin permiso.' using errcode = '42501';
    end if;
  end if;

  update public.profiles
  set credits = coalesce(credits, 0) + amount_change
  where id = target_user_id
    and (amount_change >= 0 or coalesce(credits, 0) + amount_change >= 0);
  if not found then
    raise exception 'Saldo insuficiente o usuario inexistente.' using errcode = '22003';
  end if;

  insert into public.credit_transactions (user_id, amount, type, description, reference_id)
  values (target_user_id, amount_change, transaction_type, transaction_desc, ref_id);
end;
$$;

revoke all on function public.manage_credits(uuid, numeric, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.manage_credits(uuid, numeric, text, text, uuid)
  to authenticated, service_role;

create or replace function public.transfer_credits(
  recipient_email text,
  amount numeric,
  note text default ''
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  sender_id uuid := auth.uid();
  sender_email text;
  recipient_id uuid;
  sender_balance numeric;
  tracking_id uuid := gen_random_uuid();
begin
  if sender_id is null or coalesce(auth.role(), 'anon') <> 'authenticated' then
    raise exception 'Debes iniciar sesión.' using errcode = '42501';
  end if;
  if amount is null or amount <= 0 then
    raise exception 'El monto debe ser mayor a 0.' using errcode = '22023';
  end if;

  select email, credits into sender_email, sender_balance
  from public.profiles where id = sender_id for update;
  select id into recipient_id
  from public.profiles where lower(email) = lower(trim(recipient_email)) for update;
  if recipient_id is null then
    raise exception 'El usuario destinatario no existe.';
  end if;
  if recipient_id = sender_id then
    raise exception 'No puedes transferirte a ti mismo.';
  end if;
  if coalesce(sender_balance, 0) < amount then
    raise exception 'Saldo insuficiente.';
  end if;

  update public.profiles set credits = coalesce(credits, 0) - amount where id = sender_id;
  update public.profiles set credits = coalesce(credits, 0) + amount where id = recipient_id;
  insert into public.credit_transactions (user_id, amount, type, transaction_desc, ref_id, created_at)
  values
    (sender_id, -amount, 'transfer_sent',
      'Enviado a ' || recipient_email || case when coalesce(note, '') <> '' then ' - Nota: ' || note else '' end,
      tracking_id, now()),
    (recipient_id, amount, 'transfer_received',
      'Recibido de ' || sender_email || case when coalesce(note, '') <> '' then ' - Nota: ' || note else '' end,
      tracking_id, now());
end;
$$;

revoke all on function public.transfer_credits(text, numeric, text)
  from public, anon, authenticated;
grant execute on function public.transfer_credits(text, numeric, text)
  to authenticated;

create or replace function public.approve_buylist_transaction(
  buylist_id_input uuid,
  amount_to_credit numeric
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_user_id uuid;
begin
  if coalesce(auth.role(), 'anon') <> 'service_role' and not public.is_admin() then
    raise exception 'Sin permiso.' using errcode = '42501';
  end if;
  if amount_to_credit is null or amount_to_credit < 0 then
    raise exception 'Monto inválido.' using errcode = '22023';
  end if;

  select user_id into target_user_id
  from public.buylist_orders where id = buylist_id_input for update;
  if target_user_id is null then
    raise exception 'Solicitud de compra inexistente.' using errcode = 'P0002';
  end if;

  update public.buylist_orders set status = 'completed' where id = buylist_id_input;
  update public.profiles set credits = coalesce(credits, 0) + amount_to_credit where id = target_user_id;
  insert into public.credit_transactions (user_id, amount, type, description, reference_id)
  values (target_user_id, amount_to_credit, 'buylist', 'Venta aprobada (Buylist)', buylist_id_input);
end;
$$;

revoke all on function public.approve_buylist_transaction(uuid, numeric)
  from public, anon, authenticated;
grant execute on function public.approve_buylist_transaction(uuid, numeric)
  to authenticated, service_role;

create or replace function public.user_accept_buylist_offer(buylist_id_input uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  order_data public.buylist_orders%rowtype;
begin
  if auth.uid() is null or coalesce(auth.role(), 'anon') <> 'authenticated' then
    raise exception 'Debes iniciar sesión.' using errcode = '42501';
  end if;
  select * into order_data
  from public.buylist_orders where id = buylist_id_input for update;
  if order_data.id is null or order_data.user_id is distinct from auth.uid() then
    raise exception 'Sin permiso.' using errcode = '42501';
  end if;
  if order_data.status <> 'waiting_user_approval' then
    raise exception 'Estado incorrecto.' using errcode = '22023';
  end if;
  update public.buylist_orders set status = 'waiting_receipt' where id = buylist_id_input;
end;
$$;

revoke all on function public.user_accept_buylist_offer(uuid)
  from public, anon, authenticated;
grant execute on function public.user_accept_buylist_offer(uuid)
  to authenticated;

create or replace function public.restore_stock(order_id_input uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  item record;
begin
  if coalesce(auth.role(), 'anon') <> 'service_role' and not public.is_admin() then
    raise exception 'Sin permiso.' using errcode = '42501';
  end if;
  for item in
    select product_id, quantity from public.order_items where order_id = order_id_input
  loop
    update public.products
    set stock = coalesce(stock, 0) + item.quantity
    where id = item.product_id;
  end loop;
end;
$$;

revoke all on function public.restore_stock(uuid)
  from public, anon, authenticated;
grant execute on function public.restore_stock(uuid)
  to authenticated, service_role;

drop function if exists public.decrement_stock(integer, uuid);
create function public.decrement_stock(qty integer, row_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if coalesce(auth.role(), 'anon') <> 'service_role' and not public.is_admin() then
    raise exception 'Sin permiso.' using errcode = '42501';
  end if;
  if qty is null or qty <= 0 then
    raise exception 'Cantidad inválida.' using errcode = '22023';
  end if;
  update public.products
  set stock = stock - qty
  where id = row_id and coalesce(stock, 0) >= qty;
  return found;
end;
$$;

revoke all on function public.decrement_stock(integer, uuid)
  from public, anon, authenticated;
grant execute on function public.decrement_stock(integer, uuid)
  to authenticated, service_role;

create or replace function public.update_profile_details(
  first_name_input text,
  last_name_input text,
  phone_input text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or coalesce(auth.role(), 'anon') <> 'authenticated' then
    raise exception 'Debes iniciar sesión.' using errcode = '42501';
  end if;

  update public.profiles
  set first_name = nullif(trim(first_name_input), ''),
      last_name = nullif(trim(last_name_input), ''),
      phone = nullif(trim(phone_input), '')
  where id = auth.uid();
end;
$$;

revoke all on function public.update_profile_details(text, text, text)
  from public, anon, authenticated;
grant execute on function public.update_profile_details(text, text, text)
  to authenticated;

create or replace function public.submit_order_payment_proof(
  order_id_input uuid,
  proof_url_input text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or coalesce(auth.role(), 'anon') <> 'authenticated' then
    raise exception 'Debes iniciar sesión.' using errcode = '42501';
  end if;
  if proof_url_input is null or length(trim(proof_url_input)) = 0 then
    raise exception 'Comprobante inválido.' using errcode = '22023';
  end if;

  update public.orders
  set status = 'verifying_payment', payment_proof_url = proof_url_input
  where id = order_id_input
    and user_id = auth.uid()
    and status in ('pending_payment', 'verifying_payment');

  if not found then
    raise exception 'La orden no permite cargar comprobante.' using errcode = '42501';
  end if;
end;
$$;

revoke all on function public.submit_order_payment_proof(uuid, text)
  from public, anon, authenticated;
grant execute on function public.submit_order_payment_proof(uuid, text)
  to authenticated;

create or replace function public.append_import_order_user_note(
  p_order_id bigint,
  p_note text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_notes text;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_order_id is null or btrim(coalesce(p_note, '')) = '' then
    raise exception 'order id and note are required' using errcode = '22023';
  end if;

  select user_notes into current_notes
  from public.import_orders
  where id = p_order_id
    and user_id = auth.uid()
    and status = 'Iniciada'
  for update;

  if not found then
    raise exception 'order not found or not editable' using errcode = '42501';
  end if;

  update public.import_orders
  set user_notes = case
    when btrim(coalesce(current_notes, '')) = '' then btrim(p_note)
    else current_notes || E'\n---\n[Agregado]: ' || btrim(p_note)
  end,
      updated_at = now()
  where id = p_order_id
    and user_id = auth.uid()
    and status = 'Iniciada';
end;
$$;

revoke all on function public.append_import_order_user_note(bigint, text)
  from public, anon;
grant execute on function public.append_import_order_user_note(bigint, text)
  to authenticated, service_role;

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

    select id, name, price_usd, stock into v_product
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
  v_item record;
  v_product_id uuid;
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
    for v_item in
      select oi.product_id, sum(oi.quantity)::integer as quantity
      from public.order_items oi
      where oi.order_id = v_order.id
      group by oi.product_id
      order by oi.product_id
    loop
      if v_item.product_id is null or v_item.quantity is null or v_item.quantity <= 0 then
        raise exception 'Item inválido en la orden %.', v_order.id using errcode = '23514';
      end if;
      select p.id into v_product_id
      from public.products p where p.id = v_item.product_id for update;
      if not found then
        raise exception 'Producto inexistente en la orden %.', v_order.id using errcode = '23503';
      end if;
      update public.products set stock = coalesce(stock, 0) + v_item.quantity
      where id = v_product_id;
    end loop;

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

commit;
