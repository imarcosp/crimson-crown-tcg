begin;

-- Compatibility layer for the current production schema.  This migration is
-- intentionally limited to function contracts and grants; RLS and Storage
-- policy changes are reviewed in separate migrations.
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

-- Production currently exposes this legacy function to anon/authenticated and
-- returns void.  Recreate it with the boolean contract used by server-side
-- callers and reject underflow or non-admin callers.
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
  where id = row_id
    and coalesce(stock, 0) >= qty;

  return found;
end;
$$;

revoke all on function public.decrement_stock(integer, uuid) from public, anon, authenticated;
grant execute on function public.decrement_stock(integer, uuid) to authenticated, service_role;

-- Keep the legacy signature for callers that still use restore_stock, but
-- close the public grants and enforce the same authorization boundary.
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
    select product_id, quantity
    from public.order_items
    where order_id = order_id_input
  loop
    update public.products
    set stock = coalesce(stock, 0) + item.quantity
    where id = item.product_id;
  end loop;
end;
$$;

revoke all on function public.restore_stock(uuid) from public, anon, authenticated;
grant execute on function public.restore_stock(uuid) to authenticated, service_role;

commit;
