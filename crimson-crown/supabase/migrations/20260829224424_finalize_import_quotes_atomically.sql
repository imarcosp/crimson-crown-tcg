begin;

create or replace function public.approve_import_quote_atomic(
  order_id_input bigint,
  user_id_input uuid,
  proof_path_input text,
  credits_input numeric
)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $function$
declare
  locked_owner_id uuid;
  locked_status text;
  available_credits numeric;
  quoted_total numeric := 0;
  item_count integer := 0;
  item_row record;
  changed_count integer;
begin
  if order_id_input is null or order_id_input <= 0 or user_id_input is null then
    raise exception 'Orden de importación inválida.' using errcode = '22023';
  end if;
  if credits_input is null
    or credits_input::text in ('NaN', 'Infinity', '-Infinity')
    or credits_input < 0
    or credits_input <> round(credits_input, 2) then
    raise exception 'Créditos inválidos.' using errcode = '22023';
  end if;

  select io.user_id, io.status::text
    into locked_owner_id, locked_status
  from public.import_orders as io
  where io.id = order_id_input
  for update;

  if not found
    or locked_owner_id is distinct from user_id_input
    or locked_status is distinct from 'Cotizada' then
    raise exception 'Orden de importación no disponible.' using errcode = '42501';
  end if;

  select coalesce(p.credits, 0)
    into available_credits
  from public.profiles as p
  where p.id = locked_owner_id
  for update;

  if not found
    or available_credits::text in ('NaN', 'Infinity', '-Infinity')
    or available_credits < 0
    or credits_input > available_credits then
    raise exception 'Créditos no disponibles.' using errcode = '22003';
  end if;

  for item_row in
    select ii.id, ii.unit_price, ii.tax_percent, ii.shipping_cost, ii.quantity
    from public.import_items as ii
    where ii.order_id = order_id_input
    order by ii.id
    for update
  loop
    item_count := item_count + 1;
    if item_row.unit_price is null
      or item_row.tax_percent is null
      or item_row.shipping_cost is null
      or item_row.quantity is null
      or item_row.unit_price::text in ('NaN', 'Infinity', '-Infinity')
      or item_row.tax_percent::text in ('NaN', 'Infinity', '-Infinity')
      or item_row.shipping_cost::text in ('NaN', 'Infinity', '-Infinity')
      or item_row.unit_price < 0
      or item_row.tax_percent < 0
      or item_row.shipping_cost < 0
      or item_row.quantity <= 0 then
      raise exception 'Artículo de importación inválido.' using errcode = '22023';
    end if;

    quoted_total := quoted_total + (
      item_row.unit_price * (1 + item_row.tax_percent / 100)
      + item_row.shipping_cost
    ) * item_row.quantity;
  end loop;

  quoted_total := round(quoted_total, 2);
  if item_count < 1
    or quoted_total::text in ('NaN', 'Infinity', '-Infinity')
    or quoted_total <= 0
    or credits_input > quoted_total then
    raise exception 'Total de importación inválido.' using errcode = '22023';
  end if;

  if proof_path_input is null then
    if credits_input <> quoted_total then
      raise exception 'Se requiere comprobante.' using errcode = '22023';
    end if;
  elsif octet_length(proof_path_input) > 256
    or proof_path_input !~ (
      '^imports/' || locked_owner_id::text || '/' || order_id_input::text ||
      '/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|jpeg|png|webp|pdf)$'
    ) then
    raise exception 'Ruta de comprobante inválida.' using errcode = '22023';
  end if;

  if credits_input > 0 then
    perform public.manage_credits(
      locked_owner_id,
      -credits_input,
      'purchase',
      'Pago de Orden de Importación #' || order_id_input::text,
      null::uuid
    );
  end if;

  update public.import_orders
  set
    status = 'Cotización Aprobada',
    payment_status = case when credits_input = quoted_total then 'paid' else 'verifying' end,
    payment_proof_path = proof_path_input,
    credits_used = credits_input
  where id = order_id_input
    and user_id = locked_owner_id
    and status = 'Cotizada';

  get diagnostics changed_count = row_count;
  if changed_count <> 1 then
    raise exception 'Orden de importación no disponible.' using errcode = '42501';
  end if;
end;
$function$;

create or replace function public.delete_import_item_atomic(
  item_id_input bigint,
  order_id_input bigint,
  user_id_input uuid
)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $function$
declare
  locked_owner_id uuid;
  locked_status text;
  changed_count integer;
begin
  if item_id_input is null or item_id_input <= 0
    or order_id_input is null or order_id_input <= 0
    or user_id_input is null then
    raise exception 'Artículo de importación inválido.' using errcode = '22023';
  end if;

  select io.user_id, io.status::text
    into locked_owner_id, locked_status
  from public.import_orders as io
  where io.id = order_id_input
  for update;

  if not found
    or locked_owner_id is distinct from user_id_input
    or locked_status not in ('Iniciada', 'Cotizada') then
    raise exception 'Orden de importación no editable.' using errcode = '42501';
  end if;

  delete from public.import_items
  where id = item_id_input
    and order_id = order_id_input;

  get diagnostics changed_count = row_count;
  if changed_count <> 1 then
    raise exception 'Artículo de importación no disponible.' using errcode = '42501';
  end if;
end;
$function$;

revoke all on function public.approve_import_quote_atomic(bigint, uuid, text, numeric)
  from public, anon, authenticated;
grant execute on function public.approve_import_quote_atomic(bigint, uuid, text, numeric)
  to service_role;

revoke all on function public.delete_import_item_atomic(bigint, bigint, uuid)
  from public, anon, authenticated;
grant execute on function public.delete_import_item_atomic(bigint, bigint, uuid)
  to service_role;

commit;
