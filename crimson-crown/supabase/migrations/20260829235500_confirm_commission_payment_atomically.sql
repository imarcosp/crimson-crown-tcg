begin;

create or replace function public.allocate_commission_payment_fifo_locked(
  payment_id_input uuid
)
returns numeric
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_payment public.commission_payments%rowtype;
  v_period_key text;
  v_remaining numeric(12,2);
  v_applied numeric(12,2);
  v_balance record;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'Acceso denegado.' using errcode = '42501';
  end if;

  if payment_id_input is null then
    raise exception 'Pago de comisión inválido.' using errcode = '22023';
  end if;

  -- Every FIFO writer must take this lock before reading outstanding balances.
  perform pg_advisory_xact_lock(hashtextextended('commission-payment-allocation-fifo', 0));

  select pay.*
  into v_payment
  from public.commission_payments pay
  where pay.id = payment_id_input
  for update of pay;

  if not found or v_payment.status is distinct from 'confirmed'
     or v_payment.amount_usd < 0 then
    raise exception 'Pago de comisión inválido.' using errcode = '22023';
  end if;

  select cp.period_key
  into v_period_key
  from public.commission_periods cp
  where cp.id = v_payment.period_id;

  if not found or v_period_key < '2026-06' then
    raise exception 'Período de comisión inválido.' using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.commission_payment_allocations cpa
    where cpa.payment_id = payment_id_input
  ) then
    raise exception 'El pago ya tiene asignaciones.' using errcode = '23505';
  end if;

  v_remaining := round(v_payment.amount_usd, 2);

  for v_balance in
    with adjustment_totals as (
      select
        ca.period_id,
        coalesce(sum(case when ca.direction = 'debit' then ca.amount_usd else -ca.amount_usd end), 0) as amount_usd
      from public.commission_adjustments ca
      group by ca.period_id
    ), allocation_totals as (
      select cpa.period_id, coalesce(sum(cpa.amount_usd), 0) as amount_usd
      from public.commission_payment_allocations cpa
      group by cpa.period_id
    )
    select
      cp.id,
      round(
        coalesce(cp.total_due_usd, 0) +
        coalesce(adj.amount_usd, 0) -
        coalesce(alloc.amount_usd, 0),
        2
      ) as outstanding_usd
    from public.commission_periods cp
    left join adjustment_totals adj on adj.period_id = cp.id
    left join allocation_totals alloc on alloc.period_id = cp.id
    where cp.period_key >= '2026-06'
      and cp.period_key <= v_period_key
    order by cp.period_key, cp.id
  loop
    exit when v_remaining <= 0;
    continue when v_balance.outstanding_usd <= 0;
    v_applied := least(v_balance.outstanding_usd, v_remaining);
    continue when v_applied <= 0;

    insert into public.commission_payment_allocations (payment_id, period_id, amount_usd)
    values (payment_id_input, v_balance.id, v_applied);

    v_remaining := round(v_remaining - v_applied, 2);
  end loop;

  update public.commission_payments
  set unapplied_usd = v_remaining,
      updated_at = clock_timestamp()
  where id = payment_id_input;

  return v_remaining;
end;
$$;

revoke all on function public.allocate_commission_payment_fifo_locked(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.report_commission_payment_atomic(
  operation_key_input uuid,
  period_id_input uuid,
  reported_by_user_id_input uuid,
  is_owner_input boolean,
  currency_input text,
  amount_input numeric,
  fx_rate_ars_input numeric,
  amount_usd_input numeric,
  payment_method_input text,
  reference_input text,
  notes_input text,
  proof_path_input text,
  paid_at_input timestamptz
)
returns table(payment_id uuid, period_id uuid, created boolean)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing public.commission_payments%rowtype;
  v_period_key text;
  v_status text := case when is_owner_input then 'confirmed' else 'reported' end;
  v_amount numeric(12,2) := round(amount_input, 2);
  v_amount_usd numeric(12,2) := round(amount_usd_input, 2);
  v_fx_rate numeric(12,2) := case when fx_rate_ars_input is null then null else round(fx_rate_ars_input, 2) end;
  v_payment_method text := btrim(payment_method_input);
  v_reference text := nullif(btrim(reference_input), '');
  v_notes text := nullif(btrim(notes_input), '');
  v_inserted_id uuid;
  v_reviewed_at timestamptz := case when is_owner_input then clock_timestamp() else null end;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'Acceso denegado.' using errcode = '42501';
  end if;

  if operation_key_input is null
     or period_id_input is null
     or reported_by_user_id_input is null
     or is_owner_input is null
     or currency_input is null
     or amount_input is null
     or amount_usd_input is null
     or payment_method_input is null
     or currency_input not in ('USD', 'ARS')
     or v_amount <= 0
     or v_amount_usd <= 0
     or v_payment_method = ''
     or length(v_payment_method) > 200
     or length(coalesce(v_reference, '')) > 500
     or length(coalesce(v_notes, '')) > 2000
     or paid_at_input is null
     or (currency_input = 'USD' and v_fx_rate is not null)
     or (currency_input = 'ARS' and coalesce(v_fx_rate, 0) <= 0)
     or (
       proof_path_input is not null
       and (
         length(proof_path_input) > 256
         or proof_path_input !~ (
           '^commissions/' || period_id_input::text || '/' || reported_by_user_id_input::text ||
           '/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\\.(jpg|jpeg|png|webp|pdf)$'
         )
       )
     ) then
    raise exception 'Pago de comisión inválido.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(operation_key_input::text, 0));

  select *
  into v_existing
  from public.commission_payments
  where operation_key = operation_key_input;

  if found then
    if v_existing.period_id is distinct from period_id_input
       or v_existing.reported_by_user_id is distinct from reported_by_user_id_input
       or v_existing.reviewed_by_user_id is distinct from (case when is_owner_input then reported_by_user_id_input else null end)
       or v_existing.status is distinct from v_status
       or v_existing.currency is distinct from currency_input
       or v_existing.amount is distinct from v_amount
       or v_existing.fx_rate_ars is distinct from v_fx_rate
       or v_existing.amount_usd is distinct from v_amount_usd
       or v_existing.payment_method is distinct from v_payment_method
       or v_existing.reference is distinct from v_reference
       or v_existing.notes is distinct from v_notes
       or v_existing.proof_path is distinct from proof_path_input
       or v_existing.paid_at is distinct from paid_at_input then
      raise exception 'Clave de operación en conflicto.' using errcode = '23505';
    end if;

    payment_id := v_existing.id;
    period_id := v_existing.period_id;
    created := false;
    return next;
    return;
  end if;

  select cp.period_key
  into v_period_key
  from public.commission_periods cp
  where cp.id = period_id_input;

  if not found or v_period_key < '2026-06' then
    raise exception 'Período de comisión inválido.' using errcode = '22023';
  end if;

  insert into public.commission_payments (
    operation_key,
    period_id,
    reported_by_user_id,
    reviewed_by_user_id,
    status,
    currency,
    amount,
    fx_rate_ars,
    amount_usd,
    payment_method,
    reference,
    notes,
    proof_path,
    paid_at,
    unapplied_usd,
    reviewed_at,
    updated_at
  ) values (
    operation_key_input,
    period_id_input,
    reported_by_user_id_input,
    case when is_owner_input then reported_by_user_id_input else null end,
    v_status,
    currency_input,
    v_amount,
    v_fx_rate,
    v_amount_usd,
    v_payment_method,
    v_reference,
    v_notes,
    proof_path_input,
    paid_at_input,
    case when is_owner_input then v_amount_usd else 0 end,
    v_reviewed_at,
    clock_timestamp()
  )
  returning id into v_inserted_id;

  if is_owner_input then
    perform public.allocate_commission_payment_fifo_locked(v_inserted_id);
  end if;

  payment_id := v_inserted_id;
  period_id := period_id_input;
  created := true;
  return next;
end;
$$;

revoke all on function public.report_commission_payment_atomic(
  uuid, uuid, uuid, boolean, text, numeric, numeric, numeric, text, text, text, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.report_commission_payment_atomic(
  uuid, uuid, uuid, boolean, text, numeric, numeric, numeric, text, text, text, text, timestamptz
) to service_role;

create or replace function public.confirm_commission_payment_atomic(
  payment_id_input uuid,
  reviewer_id_input uuid
)
returns table(payment_id uuid, changed boolean)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_payment public.commission_payments%rowtype;
  v_period_key text;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'Acceso denegado.' using errcode = '42501';
  end if;

  if payment_id_input is null or reviewer_id_input is null then
    raise exception 'Pago de comisión inválido.' using errcode = '22023';
  end if;

  select *
  into v_payment
  from public.commission_payments pay
  where pay.id = payment_id_input
  for update;

  if not found then
    raise exception 'Pago de comisión inexistente.' using errcode = 'P0002';
  end if;

  if v_payment.status = 'confirmed' then
    payment_id := v_payment.id;
    changed := false;
    return next;
    return;
  end if;

  if v_payment.status is distinct from 'reported' then
    raise exception 'El pago no está pendiente de confirmación.' using errcode = '22023';
  end if;

  select cp.period_key
  into v_period_key
  from public.commission_periods cp
  where cp.id = v_payment.period_id;

  if not found or v_period_key < '2026-06' then
    raise exception 'Período de comisión inválido.' using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.commission_payment_allocations cpa
    where cpa.payment_id = payment_id_input
  ) then
    raise exception 'Un pago reportado no puede tener asignaciones.' using errcode = '23514';
  end if;

  update public.commission_payments
  set status = 'confirmed',
      reviewed_by_user_id = reviewer_id_input,
      reviewed_at = clock_timestamp(),
      rejection_reason = null,
      unapplied_usd = amount_usd,
      updated_at = clock_timestamp()
  where id = payment_id_input;

  perform public.allocate_commission_payment_fifo_locked(payment_id_input);

  payment_id := payment_id_input;
  changed := true;
  return next;
end;
$$;

revoke all on function public.confirm_commission_payment_atomic(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.confirm_commission_payment_atomic(uuid, uuid)
  to service_role;

commit;
