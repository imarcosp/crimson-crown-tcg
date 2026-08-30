\set ON_ERROR_STOP on

begin;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

create temporary table crimson_matrix_allocation_failure (
  force_failure boolean not null
) on commit drop;

insert into crimson_matrix_allocation_failure values (false);

create function pg_temp.fail_crimson_matrix_allocation()
returns trigger
language plpgsql
as $$
begin
  if (select force_failure from crimson_matrix_allocation_failure limit 1) then
    raise exception 'Fallo sintético posterior al INSERT del pago.' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger crimson_matrix_force_allocation_failure
before insert on public.commission_payment_allocations
for each row execute function pg_temp.fail_crimson_matrix_allocation();

do $$
declare
  v_user_id uuid;
  v_period_id uuid := gen_random_uuid();
  v_payment_id uuid;
  v_retry_payment_id uuid;
  v_created boolean;
  v_retry_created boolean;
  v_allocation_total numeric;
  v_unapplied numeric;
  v_reported_payment_id uuid;
  v_failed_payment_id uuid;
  v_confirmation_changed boolean;
  v_status text;
begin
  select id into v_user_id from public.profiles order by id limit 1;
  if v_user_id is null then
    raise exception 'La matriz necesita al menos un perfil local.';
  end if;

  if exists (select 1 from public.commission_periods where period_key = '2099-12') then
    raise exception 'El período reservado 2099-12 ya existe en la base local.';
  end if;

  insert into public.commission_periods (
    id,
    period_key,
    period_start,
    period_end,
    total_due_usd
  ) values (
    v_period_id,
    '2099-12',
    '2099-12-01T00:00:00Z',
    '2100-01-01T00:00:00Z',
    0
  );

  insert into public.commission_adjustments (
    period_id,
    direction,
    amount_usd,
    reason,
    created_by_user_id
  ) values (
    v_period_id,
    'debit',
    7.25,
    'Prueba transaccional local',
    v_user_id
  );

  select payment_id, created
  into v_payment_id, v_created
  from public.report_commission_payment_atomic(
    '11111111-1111-4111-8111-111111111111',
    v_period_id,
    v_user_id,
    true,
    'USD',
    7.25,
    null,
    7.25,
    'matrix-local',
    'atomic-create',
    'rollback al finalizar',
    'commissions/' || v_period_id::text || '/' || v_user_id::text || '/77777777-7777-4777-8777-777777777777.png',
    '2099-12-15T12:00:00Z'
  );

  if v_payment_id is null or v_created is not true then
    raise exception 'La creación atómica no devolvió el resultado esperado.';
  end if;

  select payment_id, created
  into v_retry_payment_id, v_retry_created
  from public.report_commission_payment_atomic(
    '11111111-1111-4111-8111-111111111111',
    v_period_id,
    v_user_id,
    true,
    'USD',
    7.25,
    null,
    7.25,
    'matrix-local',
    'atomic-create',
    'rollback al finalizar',
    'commissions/' || v_period_id::text || '/' || v_user_id::text || '/77777777-7777-4777-8777-777777777777.png',
    '2099-12-15T12:00:00Z'
  );

  if v_retry_payment_id is distinct from v_payment_id or v_retry_created is not false then
    raise exception 'El reintento exacto no fue idempotente.';
  end if;

  if (select count(*) from public.commission_payments where operation_key = '11111111-1111-4111-8111-111111111111') <> 1 then
    raise exception 'El reintento creó un pago duplicado.';
  end if;

  select coalesce(sum(amount_usd), 0)
  into v_allocation_total
  from public.commission_payment_allocations
  where payment_id = v_payment_id;

  select unapplied_usd
  into v_unapplied
  from public.commission_payments
  where id = v_payment_id;

  if v_allocation_total is distinct from 7.25::numeric or v_unapplied is distinct from 0::numeric then
    raise exception 'La asignación FIFO no quedó dentro de la misma transacción.';
  end if;

  begin
    perform *
    from public.report_commission_payment_atomic(
      '11111111-1111-4111-8111-111111111111',
      v_period_id,
      v_user_id,
      true,
      'USD',
      8.25,
      null,
      8.25,
      'matrix-local',
      'atomic-create',
      'payload conflictivo',
      null,
      '2099-12-15T12:00:00Z'
    );
    raise exception 'Una clave reutilizada con otro payload fue aceptada.';
  exception
    when unique_violation then null;
  end;

  insert into public.commission_adjustments (
    period_id, direction, amount_usd, reason, created_by_user_id
  ) values (
    v_period_id, 'debit', 5.50, 'Prueba de confirmación local', v_user_id
  );

  select payment_id
  into v_reported_payment_id
  from public.report_commission_payment_atomic(
    '44444444-4444-4444-8444-444444444444',
    v_period_id,
    v_user_id,
    false,
    'USD',
    5.50,
    null,
    5.50,
    'matrix-local',
    'atomic-confirm',
    'confirmación transaccional',
    null,
    '2099-12-16T12:00:00Z'
  );

  select changed
  into v_confirmation_changed
  from public.confirm_commission_payment_atomic(v_reported_payment_id, v_user_id);

  if v_confirmation_changed is not true then
    raise exception 'La confirmación atómica no informó el cambio.';
  end if;

  select changed
  into v_confirmation_changed
  from public.confirm_commission_payment_atomic(v_reported_payment_id, v_user_id);

  if v_confirmation_changed is not false then
    raise exception 'Reconfirmar no fue un no-op idempotente.';
  end if;

  select coalesce(sum(amount_usd), 0)
  into v_allocation_total
  from public.commission_payment_allocations
  where payment_id = v_reported_payment_id;

  if v_allocation_total is distinct from 5.50::numeric then
    raise exception 'Reconfirmar alteró las asignaciones existentes.';
  end if;

  insert into public.commission_adjustments (
    period_id, direction, amount_usd, reason, created_by_user_id
  ) values (
    v_period_id, 'debit', 2.25, 'Prueba de rollback de confirmación', v_user_id
  );

  select payment_id
  into v_failed_payment_id
  from public.report_commission_payment_atomic(
    '55555555-5555-4555-8555-555555555555',
    v_period_id,
    v_user_id,
    false,
    'USD',
    2.25,
    null,
    2.25,
    'matrix-local',
    'atomic-confirm-rollback',
    'debe continuar reportado',
    null,
    '2099-12-17T12:00:00Z'
  );

  update crimson_matrix_allocation_failure set force_failure = true;
  begin
    perform * from public.confirm_commission_payment_atomic(v_failed_payment_id, v_user_id);
    raise exception 'La confirmación debía fallar durante la asignación.';
  exception
    when check_violation then null;
  end;
  update crimson_matrix_allocation_failure set force_failure = false;

  select status into v_status
  from public.commission_payments
  where id = v_failed_payment_id;

  if v_status is distinct from 'reported'
     or exists (select 1 from public.commission_payment_allocations where payment_id = v_failed_payment_id) then
    raise exception 'El fallo de asignación dejó una confirmación parcial.';
  end if;

  insert into public.commission_adjustments (
    period_id, direction, amount_usd, reason, created_by_user_id
  ) values (
    v_period_id, 'debit', 3.75, 'Prueba de rollback de reporte', v_user_id
  );

  update crimson_matrix_allocation_failure set force_failure = true;
  begin
    perform *
    from public.report_commission_payment_atomic(
      '66666666-6666-4666-8666-666666666666',
      v_period_id,
      v_user_id,
      true,
      'USD',
      3.75,
      null,
      3.75,
      'matrix-local',
      'atomic-report-rollback',
      'debe revertir el INSERT del pago',
      null,
      '2099-12-18T12:00:00Z'
    );
    raise exception 'El reporte debía fallar durante la asignación.';
  exception
    when check_violation then null;
  end;
  update crimson_matrix_allocation_failure set force_failure = false;

  if exists (
    select 1 from public.commission_payments
    where operation_key = '66666666-6666-4666-8666-666666666666'
  ) then
    raise exception 'El fallo posterior al INSERT dejó un pago parcial.';
  end if;

  perform set_config('request.jwt.claims', '{"role":"authenticated"}', true);
  begin
    perform *
    from public.report_commission_payment_atomic(
      '22222222-2222-4222-8222-222222222222',
      v_period_id,
      v_user_id,
      false,
      'USD',
      1,
      null,
      1,
      'matrix-local',
      null,
      null,
      null,
      '2099-12-15T12:00:00Z'
    );
    raise exception 'authenticated pudo ejecutar el RPC de servicio.';
  exception
    when insufficient_privilege then null;
  end;
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

  begin
    perform *
    from public.report_commission_payment_atomic(
      '33333333-3333-4333-8333-333333333333',
      v_period_id,
      'ffffffff-ffff-4fff-8fff-ffffffffffff',
      false,
      'USD',
      1,
      null,
      1,
      'matrix-local',
      null,
      null,
      null,
      '2099-12-15T12:00:00Z'
    );
    raise exception 'La prueba de rollback no falló como se esperaba.';
  exception
    when foreign_key_violation then null;
  end;

  if exists (select 1 from public.commission_payments where operation_key = '33333333-3333-4333-8333-333333333333') then
    raise exception 'El fallo transaccional dejó un pago parcial.';
  end if;
end;
$$;

rollback;
