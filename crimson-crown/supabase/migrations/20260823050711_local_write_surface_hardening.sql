begin;

-- external_prices se consulta públicamente, pero sólo el backend o un admin
-- puede modificar precios, IDs externos o flags de sincronización.
drop policy if exists "Service role updates" on public.external_prices;
create policy "Admins manage external prices" on public.external_prices
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- price_history es un registro generado por procesos de sincronización. No se
-- permite insertar/editar/borrar desde el navegador.
drop policy if exists "Insertar historial" on public.price_history;
revoke insert, update, delete, truncate on public.price_history from anon, authenticated;

-- La tabla de backup es operativa, no parte del Data API de la aplicación.
revoke all on public.manual_price_backup_magic_once_20260526 from anon, authenticated;

-- Estas funciones sólo son callbacks de triggers. Mantenerlas ejecutables por
-- el dueño/backend evita exponer endpoints SECURITY DEFINER innecesarios.
revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.notify_buylist_manager() from public, anon, authenticated;
revoke all on function public.notify_credit_change() from public, anon, authenticated;
revoke all on function public.notify_import_manager() from public, anon, authenticated;
revoke all on function public.notify_order_manager() from public, anon, authenticated;
revoke all on function public.notify_stock_alert() from public, anon, authenticated;

-- Los helpers de autorización se usan desde políticas autenticadas, nunca por
-- el rol anónimo.
revoke execute on function public.is_admin() from public, anon;
revoke execute on function public.is_commission_admin() from public, anon;

commit;
