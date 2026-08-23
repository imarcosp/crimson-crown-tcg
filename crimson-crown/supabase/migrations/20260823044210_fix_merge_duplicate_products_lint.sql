begin;

create or replace function public.merge_duplicate_products(batch_size integer default 100)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r record;
  original_id uuid;
  duplicate_id uuid;
  processed_count integer := 0;
begin
  if coalesce(auth.role(), 'anon') <> 'service_role' and not public.is_admin() then
    raise exception 'Sin permiso.' using errcode = '42501';
  end if;

  for r in
    select name, set_name, finish, condition, language, count(*)
    from public.products
    where tcg = 'Magic' and name not like '%(ARCHIVADO)%'
    group by name, set_name, finish, condition, language
    having count(*) > 1
    limit batch_size
  loop
    select id into original_id
    from public.products
    where name = r.name and set_name = r.set_name and finish = r.finish
      and condition = r.condition and language = r.language
      and name not like '%(ARCHIVADO)%'
    order by stock desc, created_at asc
    limit 1;

    for duplicate_id in
      select id from public.products
      where name = r.name and set_name = r.set_name and finish = r.finish
        and condition = r.condition and language = r.language
        and id <> original_id
    loop
      update public.cart_items c1
      set quantity = c1.quantity + c2.quantity
      from public.cart_items c2
      where c1.user_id = c2.user_id
        and c1.product_id = original_id::text
        and c2.product_id = duplicate_id::text;

      delete from public.cart_items where product_id = duplicate_id::text;
      update public.cart_items set product_id = original_id::text where product_id = duplicate_id::text;

      delete from public.wishlists
      where product_id = duplicate_id
        and user_id in (select user_id from public.wishlists where product_id = original_id);
      update public.wishlists set product_id = original_id where product_id = duplicate_id;

      -- saved_items.product_id es UUID; no conversión a text.
      delete from public.saved_items
      where product_id = duplicate_id
        and user_id in (select user_id from public.saved_items where product_id = original_id);
      update public.saved_items set product_id = original_id where product_id = duplicate_id;

      begin
        delete from public.products where id = duplicate_id;
      exception when foreign_key_violation then
        update public.products
        set stock = 0,
            is_manual_price = true,
            name = name || ' (ARCHIVADO)',
            scryfall_id = null
        where id = duplicate_id;
      end;
    end loop;
    processed_count := processed_count + 1;
  end loop;

  return 'Se procesaron ' || processed_count || ' grupos restantes.';
end;
$$;

revoke all on function public.merge_duplicate_products(integer) from public, anon, authenticated;
grant execute on function public.merge_duplicate_products(integer) to authenticated, service_role;

commit;
