begin;

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
    if target_user_id is distinct from auth.uid() or amount_change >= 0 then
      raise exception 'Sin permiso.' using errcode = '42501';
    end if;
  end if;

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

revoke all on function public.manage_credits(uuid, numeric, text, text, uuid) from public, anon, authenticated;
grant execute on function public.manage_credits(uuid, numeric, text, text, uuid) to authenticated, service_role;

commit;
