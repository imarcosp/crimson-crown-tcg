begin;

alter table public.orders
  add column if not exists payment_proof_path text;

alter table public.import_orders
  add column if not exists payment_proof_path text;

alter table public.commission_payments
  add column if not exists proof_path text;

create or replace function public.submit_order_payment_proof_path(
  order_id_input uuid,
  proof_path_input text
)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $function$
declare
  order_owner_id uuid;
  order_status text;
begin
  select o.user_id, o.status
    into order_owner_id, order_status
  from public.orders as o
  where o.id = order_id_input
  for update;

  if not found or order_owner_id is null then
    raise exception 'Orden no disponible.' using errcode = '42501';
  end if;

  if order_status is null or order_status not in ('pending_payment', 'verifying_payment') then
    raise exception 'Orden no disponible.' using errcode = '42501';
  end if;

  if proof_path_input is null or octet_length(proof_path_input) > 256 then
    raise exception 'Ruta de comprobante inválida.' using errcode = '22023';
  end if;

  if proof_path_input !~ (
    '^orders/' || order_owner_id::text || '/' || order_id_input::text ||
    '/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|jpeg|png|webp|pdf)$'
  ) then
    raise exception 'Ruta de comprobante inválida.' using errcode = '22023';
  end if;

  update public.orders
  set status = 'verifying_payment', payment_proof_path = proof_path_input
  where id = order_id_input
    and user_id = order_owner_id
    and status in ('pending_payment', 'verifying_payment');

  if not found then
    raise exception 'Orden no disponible.' using errcode = '42501';
  end if;
end;
$function$;

revoke all on function public.submit_order_payment_proof_path(uuid, text)
  from public, anon, authenticated;
grant execute on function public.submit_order_payment_proof_path(uuid, text)
  to service_role;

commit;
