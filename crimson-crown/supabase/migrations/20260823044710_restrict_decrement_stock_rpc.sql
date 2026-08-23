begin;

create or replace function public.decrement_stock(qty integer, row_id uuid)
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

revoke all on function public.decrement_stock(integer, uuid) from public, anon, authenticated;
grant execute on function public.decrement_stock(integer, uuid) to authenticated, service_role;

commit;
