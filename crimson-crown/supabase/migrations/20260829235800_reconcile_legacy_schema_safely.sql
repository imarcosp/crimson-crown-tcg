-- Forward-only reconciliation for legacy migrations that were never recorded
-- in the production ledger. This file preserves every existing business row.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- New products keep the historical Magic default without rewriting rows.
alter table public.products
  alter column tcg set default 'Magic';

-- The production FK already exists. The missing nullable note column is
-- additive and does not rewrite existing buylist rows.
alter table public.buylist_orders
  add column if not exists manual_quote_notes text;

-- JSONB is the application-compatible canonical representation currently in
-- production. Fail closed rather than attempting a data conversion.
do $reconcile_color_identity$
begin
  if (
    select c.udt_name
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = 'external_prices'
      and c.column_name = 'color_identity'
  ) is distinct from 'jsonb' then
    raise exception 'external_prices.color_identity must remain jsonb' using errcode = '42804';
  end if;
end
$reconcile_color_identity$;

comment on column public.external_prices.color_identity is
  'Canonical JSONB array consumed by the Crimson catalog and import flows.';

-- These legacy RPCs have no application consumer and their old import return
-- shape expects columns/types that no longer exist. Keep the retired surface
-- absent instead of reintroducing an incompatible Data API endpoint.
drop function if exists public.search_orders_v2(text, text, boolean, integer, integer);
drop function if exists public.search_imports_v2(text, boolean, text, text, integer, integer);
drop function if exists public.normalize_text(text);

-- Nine retained periods predate the 2026-06 boundary. NOT VALID preserves
-- that history while enforcing the boundary for every future insert/update.
do $reconcile_commission_guard$
begin
  if not exists (
    select 1
    from pg_constraint c
    where c.conrelid = 'public.commission_periods'::regclass
      and c.conname = 'commission_periods_start_period_chk'
  ) then
    alter table public.commission_periods
      add constraint commission_periods_start_period_chk
      check (period_start >= timestamptz '2026-06-01 00:00:00+00')
      not valid;
  end if;
end
$reconcile_commission_guard$;

-- Public catalog reads remain available, while only authenticated admins may
-- mutate external price rows through RLS. The service role bypasses RLS.
drop policy if exists "Service role updates" on public.external_prices;
drop policy if exists "Admins manage external prices" on public.external_prices;
create policy "Admins manage external prices" on public.external_prices
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());
revoke insert, update, delete, truncate, references, trigger
  on public.external_prices from anon;

-- Price history and its operational backup are never browser write surfaces.
drop policy if exists "Insertar historial" on public.price_history;
revoke insert, update, delete, truncate
  on public.price_history from anon, authenticated;

do $reconcile_backup_acl$
begin
  if to_regclass('public.manual_price_backup_magic_once_20260526') is not null then
    revoke all on public.manual_price_backup_magic_once_20260526 from anon, authenticated;
  end if;
end
$reconcile_backup_acl$;

-- Normalize administrative import access through the central allowlist-aware
-- helper. Owner read/create policies remain untouched.
drop policy if exists "Admin gestiona todas las ordenes" on public.import_orders;
drop policy if exists "Admins manage all import orders" on public.import_orders;
create policy "Admins manage all import orders" on public.import_orders
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "Admin gestiona todos los items" on public.import_items;
drop policy if exists "Admins manage all import items" on public.import_items;
create policy "Admins manage all import items" on public.import_items
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Reassert the current runtime functions' fixed search path and least-privilege
-- Data API grants without replacing their already-tested production bodies.
alter function public.manage_credits(uuid, numeric, text, text, uuid)
  set search_path = public, pg_temp;
revoke all on function public.manage_credits(uuid, numeric, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.manage_credits(uuid, numeric, text, text, uuid)
  to authenticated, service_role;

alter function public.transfer_credits(text, numeric, text)
  set search_path = public, pg_temp;
revoke all on function public.transfer_credits(text, numeric, text)
  from public, anon, authenticated;
grant execute on function public.transfer_credits(text, numeric, text)
  to authenticated;

alter function public.restore_stock(uuid)
  set search_path = public, pg_temp;
revoke all on function public.restore_stock(uuid) from public, anon, authenticated;
grant execute on function public.restore_stock(uuid) to authenticated, service_role;

alter function public.approve_buylist_transaction(uuid, numeric)
  set search_path = public, pg_temp;
revoke all on function public.approve_buylist_transaction(uuid, numeric)
  from public, anon, authenticated;
grant execute on function public.approve_buylist_transaction(uuid, numeric)
  to authenticated, service_role;

alter function public.user_accept_buylist_offer(uuid)
  set search_path = public, pg_temp;
revoke all on function public.user_accept_buylist_offer(uuid)
  from public, anon, authenticated;
grant execute on function public.user_accept_buylist_offer(uuid) to authenticated;

alter function public.decrement_stock(integer, uuid)
  set search_path = public, pg_temp;
revoke all on function public.decrement_stock(integer, uuid)
  from public, anon, authenticated;
grant execute on function public.decrement_stock(integer, uuid)
  to authenticated, service_role;

alter function public.update_profile_details(text, text, text)
  set search_path = public, pg_temp;
revoke all on function public.update_profile_details(text, text, text)
  from public, anon, authenticated;
grant execute on function public.update_profile_details(text, text, text)
  to authenticated, service_role;

alter function public.submit_order_payment_proof(uuid, text)
  set search_path = public, pg_temp;
revoke all on function public.submit_order_payment_proof(uuid, text)
  from public, anon, authenticated;
grant execute on function public.submit_order_payment_proof(uuid, text)
  to authenticated, service_role;

alter function public.place_order_atomic(jsonb, text, text, jsonb, boolean, text, text, text)
  set search_path = public, pg_temp;
revoke all on function public.place_order_atomic(jsonb, text, text, jsonb, boolean, text, text, text)
  from public, anon, authenticated;
grant execute on function public.place_order_atomic(jsonb, text, text, jsonb, boolean, text, text, text)
  to authenticated, service_role;

alter function public.restore_order_inventory_atomic(uuid, text)
  set search_path = public, pg_temp;
alter function public.cancel_order_atomic(uuid, boolean, boolean)
  set search_path = public, pg_temp;
alter function public.refund_order_atomic(uuid, boolean, numeric)
  set search_path = public, pg_temp;
alter function public.remove_order_item_atomic(uuid, integer, boolean)
  set search_path = public, pg_temp;
alter function public.release_expired_orders_atomic(integer, text)
  set search_path = public, pg_temp;

revoke all on function public.restore_order_inventory_atomic(uuid, text)
  from public, anon, authenticated;
revoke all on function public.cancel_order_atomic(uuid, boolean, boolean)
  from public, anon, authenticated;
revoke all on function public.refund_order_atomic(uuid, boolean, numeric)
  from public, anon, authenticated;
revoke all on function public.remove_order_item_atomic(uuid, integer, boolean)
  from public, anon, authenticated;
revoke all on function public.release_expired_orders_atomic(integer, text)
  from public, anon, authenticated;

grant execute on function public.restore_order_inventory_atomic(uuid, text)
  to authenticated, service_role;
grant execute on function public.cancel_order_atomic(uuid, boolean, boolean)
  to authenticated, service_role;
grant execute on function public.refund_order_atomic(uuid, boolean, numeric)
  to authenticated, service_role;
grant execute on function public.remove_order_item_atomic(uuid, integer, boolean)
  to authenticated, service_role;
grant execute on function public.release_expired_orders_atomic(integer, text)
  to authenticated, service_role;

commit;
