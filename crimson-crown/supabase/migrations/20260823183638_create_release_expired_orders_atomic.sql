begin;

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

  -- Lock the order before inspecting its items. A future payment webhook must
  -- take the same lock, so it cannot approve an order while this release runs.
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

      select p.id
      into v_product_id
      from public.products p
      where p.id = v_item.product_id
      for update;

      if not found then
        raise exception 'Producto inexistente en la orden %.', v_order.id using errcode = '23503';
      end if;

      update public.products
      set stock = coalesce(stock, 0) + v_item.quantity
      where id = v_product_id;
    end loop;

    update public.orders
    set status = 'cancelled',
        delivery_notes = format(
          'Cancelada automáticamente por abandono de pago en %s.',
          trim(p_payment_marker)
        )
    where id = v_order.id
      and status = 'pending_payment';

    if found then
      v_cancelled := v_cancelled + 1;
    end if;
  end loop;

  return v_cancelled;
end;
$$;

revoke all on function public.release_expired_orders_atomic(integer, text)
  from public, anon, authenticated;
grant execute on function public.release_expired_orders_atomic(integer, text)
  to authenticated, service_role;

commit;
