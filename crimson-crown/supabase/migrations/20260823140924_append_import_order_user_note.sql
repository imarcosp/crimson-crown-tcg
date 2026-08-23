-- Permite al propietario agregar una nota a su orden en estado Iniciada sin
-- exponer una política UPDATE amplia sobre import_orders.
create or replace function public.append_import_order_user_note(
  p_order_id bigint,
  p_note text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_notes text;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  if p_order_id is null or btrim(coalesce(p_note, '')) = '' then
    raise exception 'order id and note are required' using errcode = '22023';
  end if;

  select user_notes
    into current_notes
    from public.import_orders
   where id = p_order_id
     and user_id = auth.uid()
     and status = 'Iniciada'
   for update;

  if not found then
    raise exception 'order not found or not editable' using errcode = '42501';
  end if;

  update public.import_orders
     set user_notes = case
       when btrim(coalesce(current_notes, '')) = '' then btrim(p_note)
       else current_notes || E'\n---\n[Agregado]: ' || btrim(p_note)
     end,
         updated_at = now()
   where id = p_order_id
     and user_id = auth.uid()
     and status = 'Iniciada';
end;
$$;

revoke all on function public.append_import_order_user_note(bigint, text) from public, anon;
grant execute on function public.append_import_order_user_note(bigint, text) to authenticated, service_role;
