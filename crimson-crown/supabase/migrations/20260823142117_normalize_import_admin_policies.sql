-- Unificar las políticas administrativas de importaciones con la función
-- central que también conserva la allowlist de admins productivos.
drop policy if exists "Admin gestiona todas las ordenes" on public.import_orders;
create policy "Admins manage all import orders"
  on public.import_orders for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "Admin gestiona todos los items" on public.import_items;
create policy "Admins manage all import items"
  on public.import_items for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());
