begin;

-- Centraliza la autorización administrativa y evita repetir comprobaciones de
-- email en cada política.  SECURITY DEFINER es intencional: la consulta de
-- perfiles debe poder evaluar el rol sin quedar atrapada por el propio RLS.
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

-- Todas las funciones que escriben datos sensibles usan un search_path fijo.
alter function public.manage_credits(uuid, numeric, text, text, uuid)
  set search_path = public, pg_temp;
alter function public.transfer_credits(text, numeric, text)
  set search_path = public, pg_temp;
alter function public.restore_stock(uuid)
  set search_path = public, pg_temp;
alter function public.approve_buylist_transaction(uuid, numeric)
  set search_path = public, pg_temp;
alter function public.user_accept_buylist_offer(uuid)
  set search_path = public, pg_temp;
alter function public.find_orders_by_id_part(text)
  set search_path = public, pg_temp;
alter function public.generate_next_import_order_number()
  set search_path = public, pg_temp;
alter function public.assign_import_order_number()
  set search_path = public, pg_temp;
alter function public.decrement_stock(integer, uuid)
  set search_path = public, pg_temp;

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
    -- Un cliente normal sólo puede consumir sus propios créditos; las
    -- acreditaciones y ajustes positivos quedan reservados a admins/backend.
    if target_user_id is distinct from auth.uid() or amount_change >= 0 then
      raise exception 'Sin permiso.' using errcode = '42501';
    end if;
  end if;

  -- Evita saldos negativos incluso cuando dos operaciones llegan en paralelo.
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

  -- Bloquea ambas filas antes de comprobar el saldo para evitar doble gasto.
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

create or replace function public.restore_stock(order_id_input uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare item record;
begin
  if coalesce(auth.role(), 'anon') <> 'service_role' and not public.is_admin() then
    raise exception 'Sin permiso.' using errcode = '42501';
  end if;
  for item in select product_id, quantity from public.order_items where order_id = order_id_input loop
    update public.products set stock = coalesce(stock, 0) + item.quantity where id = item.product_id;
  end loop;
end;
$$;

create or replace function public.approve_buylist_transaction(
  buylist_id_input uuid,
  amount_to_credit numeric
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare target_user_id uuid;
begin
  if coalesce(auth.role(), 'anon') <> 'service_role' and not public.is_admin() then
    raise exception 'Sin permiso.' using errcode = '42501';
  end if;
  if amount_to_credit is null or amount_to_credit < 0 then
    raise exception 'Monto inválido.' using errcode = '22023';
  end if;

  select user_id into target_user_id from public.buylist_orders where id = buylist_id_input for update;
  if target_user_id is null then
    raise exception 'Solicitud de compra inexistente.' using errcode = 'P0002';
  end if;

  update public.buylist_orders set status = 'completed' where id = buylist_id_input;
  update public.profiles set credits = coalesce(credits, 0) + amount_to_credit where id = target_user_id;
  insert into public.credit_transactions (user_id, amount, type, description, reference_id)
  values (target_user_id, amount_to_credit, 'buylist', 'Venta aprobada (Buylist)', buylist_id_input);
end;
$$;

create or replace function public.user_accept_buylist_offer(buylist_id_input uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare order_data public.buylist_orders%rowtype;
begin
  if auth.uid() is null or coalesce(auth.role(), 'anon') <> 'authenticated' then
    raise exception 'Debes iniciar sesión.' using errcode = '42501';
  end if;
  select * into order_data from public.buylist_orders where id = buylist_id_input for update;
  if order_data.id is null or order_data.user_id is distinct from auth.uid() then
    raise exception 'Sin permiso.' using errcode = '42501';
  end if;
  if order_data.status <> 'waiting_user_approval' then
    raise exception 'Estado incorrecto.' using errcode = '22023';
  end if;
  update public.buylist_orders set status = 'waiting_receipt' where id = buylist_id_input;
end;
$$;

create or replace function public.find_orders_by_id_part(q text)
returns table(id uuid)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select o.id
  from public.orders o
  where public.is_admin()
    and o.id::text ilike '%' || coalesce(q, '') || '%'
  limit 200;
$$;

-- El stock se descuenta atómicamente y nunca puede quedar negativo. Sólo el
-- flujo server-side de checkout (service_role) o un admin puede invocarlo.
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

-- RPCs de bajo privilegio para evitar UPDATE directo de columnas sensibles.
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

-- Las funciones que deben ejecutarse desde el cliente sólo quedan disponibles
-- para usuarios autenticados. Los triggers y service_role no dependen de estos
-- grants; las funciones administrativas se validan además internamente.
revoke all on function public.manage_credits(uuid, numeric, text, text, uuid) from public, anon, authenticated;
grant execute on function public.manage_credits(uuid, numeric, text, text, uuid) to authenticated, service_role;
revoke all on function public.transfer_credits(text, numeric, text) from public, anon, authenticated;
grant execute on function public.transfer_credits(text, numeric, text) to authenticated;
revoke all on function public.restore_stock(uuid) from public, anon, authenticated;
grant execute on function public.restore_stock(uuid) to authenticated, service_role;
revoke all on function public.approve_buylist_transaction(uuid, numeric) from public, anon, authenticated;
grant execute on function public.approve_buylist_transaction(uuid, numeric) to authenticated, service_role;
revoke all on function public.user_accept_buylist_offer(uuid) from public, anon, authenticated;
grant execute on function public.user_accept_buylist_offer(uuid) to authenticated;
revoke all on function public.find_orders_by_id_part(text) from public, anon, authenticated;
grant execute on function public.find_orders_by_id_part(text) to authenticated;
revoke all on function public.generate_next_import_order_number() from public, anon, authenticated;
grant execute on function public.generate_next_import_order_number() to service_role;
revoke all on function public.assign_import_order_number() from public, anon, authenticated;
grant execute on function public.assign_import_order_number() to service_role;
revoke all on function public.decrement_stock(integer, uuid) from public, anon, authenticated;
grant execute on function public.decrement_stock(integer, uuid) to authenticated, service_role;
revoke all on function public.update_profile_details(text, text, text) from public, anon, authenticated;
grant execute on function public.update_profile_details(text, text, text) to authenticated;
revoke all on function public.submit_order_payment_proof(uuid, text) from public, anon, authenticated;
grant execute on function public.submit_order_payment_proof(uuid, text) to authenticated;

-- Productos: sólo administradores pueden escribir; el catálogo sigue siendo público.
drop policy if exists "Permitir Borrado" on public.products;
drop policy if exists "Permitir Carga Masiva" on public.products;
drop policy if exists "Permitir Edicion" on public.products;
create policy "Admins manage products" on public.products
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Órdenes e items: el cliente sólo ve/crea sus propias órdenes; las acciones
-- administrativas requieren rol admin. El comprobante usa el RPC anterior.
drop policy if exists "Admin modifica ordenes" on public.orders;
drop policy if exists "Admin puede ver todas las ordenes" on public.orders;
drop policy if exists "Admin ve todas las ordenes" on public.orders;
drop policy if exists "Permitir borrar orders a usuarios autenticados" on public.orders;
create policy "Admins read orders" on public.orders
  for select to authenticated using (public.is_admin());
create policy "Admins update orders" on public.orders
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "Admins delete orders" on public.orders
  for delete to authenticated using (public.is_admin());

drop policy if exists "Admin puede ver todos los items" on public.order_items;
drop policy if exists "Permitir borrar items a usuarios autenticados" on public.order_items;
create policy "Admins read order items" on public.order_items
  for select to authenticated using (public.is_admin());
create policy "Admins delete order items" on public.order_items
  for delete to authenticated using (public.is_admin());

-- Perfiles: un usuario ve sólo su perfil; admins ven/editan todos. La edición
-- normal pasa por update_profile_details para no exponer credits/role.
drop policy if exists "Admin ve perfiles" on public.profiles;
drop policy if exists "Admin ve todos los perfiles" on public.profiles;
drop policy if exists "Admins can view all profiles" on public.profiles;
drop policy if exists "Usuarios autenticados ven perfiles" on public.profiles;
drop policy if exists "Ver perfiles" on public.profiles;
drop policy if exists "Usuarios pueden editar su propio perfil" on public.profiles;
create policy "Users read own profile" on public.profiles
  for select to authenticated using (auth.uid() = id);
create policy "Admins read profiles" on public.profiles
  for select to authenticated using (public.is_admin());
create policy "Admins update profiles" on public.profiles
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- Buylist: los usuarios pueden crear/ver sus solicitudes y sólo cancelarlas;
-- los items propios se crean/leen, pero no se pueden editar arbitrariamente.
drop policy if exists "Admin manages all buylists" on public.buylist_orders;
drop policy if exists "Users manage own buylists" on public.buylist_orders;
create policy "Admins manage all buylists" on public.buylist_orders
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "Users read own buylists" on public.buylist_orders
  for select to authenticated using (auth.uid() = user_id);
create policy "Users create own buylists" on public.buylist_orders
  for insert to authenticated with check (auth.uid() = user_id);
create policy "Users cancel own buylists" on public.buylist_orders
  for update to authenticated
  using (auth.uid() = user_id and status in ('pending_review', 'waiting_user_approval'))
  with check (auth.uid() = user_id and status = 'cancelled');

drop policy if exists "Admin actualiza items buylist" on public.buylist_items;
drop policy if exists "Users manage own buylist items" on public.buylist_items;
create policy "Admins manage all buylist items" on public.buylist_items
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "Users read own buylist items" on public.buylist_items
  for select to authenticated using (
    exists (select 1 from public.buylist_orders o where o.id = buylist_items.buylist_id and o.user_id = auth.uid())
  );
create policy "Users create own buylist items" on public.buylist_items
  for insert to authenticated with check (
    exists (select 1 from public.buylist_orders o where o.id = buylist_items.buylist_id and o.user_id = auth.uid())
  );

-- Tablas de configuración y administración.
drop policy if exists "Usuarios autenticados pueden editar faqs" on public.faqs;
create policy "Admins manage faqs" on public.faqs
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "Admin gestiona Settings" on public.system_settings;
create policy "Admins manage settings" on public.system_settings
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "Admin borra cupones" on public.coupons;
drop policy if exists "Admin inserta cupones" on public.coupons;
drop policy if exists "Admin ve cupones" on public.coupons;
drop policy if exists "Lectura Publica Cupones" on public.coupons;
create policy "Admins manage coupons" on public.coupons
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
-- La validación pública de códigos sólo necesita leer el código activo.
create policy "Public read active coupons" on public.coupons
  for select to anon, authenticated using (active = true);

drop policy if exists "Admin ve todo" on public.credit_transactions;
create policy "Admins read credit transactions" on public.credit_transactions
  for select to authenticated using (public.is_admin());

drop policy if exists "Admin ve todo" on public.wishlists;
drop policy if exists "Lectura global de wishlists" on public.wishlists;
create policy "Admins read all wishlists" on public.wishlists
  for select to authenticated using (public.is_admin());

drop policy if exists "Admin gestiona banners" on public.banners;
drop policy if exists "Admin gestiona banners tabla" on public.banners;
create policy "Admins manage banners" on public.banners
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "Admin select analytics" on public.analytics_visits;
create policy "Admins read analytics" on public.analytics_visits
  for select to authenticated using (public.is_admin());

drop policy if exists "Solo admin ve logs" on public.search_logs;
create policy "Admins read search logs" on public.search_logs
  for select to authenticated using (public.is_admin());

drop policy if exists "Solo admins ven feedback" on public.feedback;
create policy "Admins read feedback" on public.feedback
  for select to authenticated using (public.is_admin());

drop policy if exists "Solo admin gestiona oportunidades" on public.price_opportunities;
drop policy if exists "Insertar script local" on public.price_opportunities;
create policy "Admins manage price opportunities" on public.price_opportunities
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "Admins pueden crear notificaciones" on public.notifications;
drop policy if exists "System inserts notifications" on public.notifications;
create policy "Admins create notifications" on public.notifications
  for insert to authenticated with check (public.is_admin());

-- La vista no se utiliza por el frontend actual y no debe filtrar la lista de
-- administradores a clientes anon/authenticated.
revoke all on public.admin_users from public, anon, authenticated;

-- Las tablas de comisiones usan el mismo criterio de admin que el resto.
create or replace function public.is_commission_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$ select public.is_admin(); $$;
revoke all on function public.is_commission_admin() from public;
grant execute on function public.is_commission_admin() to authenticated, service_role;

commit;
