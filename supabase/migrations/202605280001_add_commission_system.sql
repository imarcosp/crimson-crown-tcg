alter table public.orders
  add column if not exists commission_eligible_at timestamptz,
  add column if not exists commission_eligible_source text;

alter table public.import_orders
  add column if not exists commission_eligible_at timestamptz,
  add column if not exists commission_eligible_source text;

create index if not exists idx_orders_commission_eligible_at
  on public.orders (commission_eligible_at);

create index if not exists idx_import_orders_commission_eligible_at
  on public.import_orders (commission_eligible_at);

create table if not exists public.commission_periods (
  id uuid primary key default gen_random_uuid(),
  period_key text not null unique,
  period_start timestamptz not null,
  period_end timestamptz not null,
  fixed_fee_usd numeric(12,2) not null default 100.00,
  sales_base_usd numeric(12,2) not null default 0,
  sales_commission_usd numeric(12,2) not null default 0,
  imports_base_usd numeric(12,2) not null default 0,
  imports_commission_usd numeric(12,2) not null default 0,
  total_due_usd numeric(12,2) not null default 0,
  status text not null default 'open',
  notes text,
  generated_at timestamptz not null default now(),
  last_refreshed_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by_user_id uuid references public.profiles(id),
  constraint commission_periods_period_key_format_chk check (period_key ~ '^[0-9]{4}-[0-9]{2}$'),
  constraint commission_periods_status_chk check (status in ('open', 'issued', 'partially_paid', 'paid'))
);

alter table public.commission_periods enable row level security;

create table if not exists public.commission_period_lines (
  id uuid primary key default gen_random_uuid(),
  period_id uuid not null references public.commission_periods(id) on delete cascade,
  line_type text not null,
  source_id text,
  source_label text not null,
  source_status text,
  source_created_at timestamptz,
  source_eligible_at timestamptz,
  base_amount_usd numeric(12,2) not null default 0,
  commission_rate numeric(6,4) not null default 0,
  commission_amount_usd numeric(12,2) not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint commission_period_lines_type_chk check (line_type in ('fixed_fee', 'stock_order', 'import_order'))
);

alter table public.commission_period_lines enable row level security;

create index if not exists idx_commission_period_lines_period_id
  on public.commission_period_lines (period_id);

create index if not exists idx_commission_period_lines_type
  on public.commission_period_lines (line_type);

create table if not exists public.commission_payments (
  id uuid primary key default gen_random_uuid(),
  period_id uuid not null references public.commission_periods(id) on delete cascade,
  reported_by_user_id uuid not null references public.profiles(id),
  reviewed_by_user_id uuid references public.profiles(id),
  status text not null default 'reported',
  currency text not null,
  amount numeric(12,2) not null,
  fx_rate_ars numeric(12,2),
  amount_usd numeric(12,2) not null,
  payment_method text not null,
  reference text,
  notes text,
  proof_url text,
  rejection_reason text,
  paid_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  reviewed_at timestamptz,
  constraint commission_payments_status_chk check (status in ('reported', 'confirmed', 'rejected')),
  constraint commission_payments_currency_chk check (currency in ('USD', 'ARS')),
  constraint commission_payments_amount_chk check (amount >= 0 and amount_usd >= 0),
  constraint commission_payments_ars_fx_chk check (
    (currency = 'USD' and fx_rate_ars is null)
    or (currency = 'ARS' and fx_rate_ars is not null and fx_rate_ars > 0)
  )
);

alter table public.commission_payments enable row level security;

create index if not exists idx_commission_payments_period_id
  on public.commission_payments (period_id);

create index if not exists idx_commission_payments_status
  on public.commission_payments (status);

create or replace function public.is_commission_admin()
returns boolean
language sql
stable
as $$
  select coalesce(auth.jwt() ->> 'email', '') in (
    'mjperchezabala@gmail.com',
    'crimsoncrownimports@gmail.com'
  );
$$;

create or replace function public.is_commission_owner()
returns boolean
language sql
stable
as $$
  select coalesce(auth.jwt() ->> 'email', '') = 'mjperchezabala@gmail.com';
$$;

create or replace function public.calculate_import_order_total(p_order_id bigint)
returns numeric
language sql
stable
as $$
  select coalesce(
    round(
      sum(
        (
          (coalesce(ii.unit_price, 0) * (1 + coalesce(ii.tax_percent, 0) / 100.0))
          + coalesce(ii.shipping_cost, 0)
        ) * coalesce(ii.quantity, 1)
      )::numeric,
      2
    ),
    0
  )
  from public.import_items ii
  where ii.order_id = p_order_id;
$$;

create or replace function public.set_order_commission_eligible()
returns trigger
language plpgsql
as $$
begin
  if new.commission_eligible_at is not null then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.status in ('paid', 'shipped', 'completed') then
      new.commission_eligible_at := now();
      new.commission_eligible_source := 'status:' || new.status;
    end if;
    return new;
  end if;

  if coalesce(old.status, '') not in ('paid', 'shipped', 'completed')
     and new.status in ('paid', 'shipped', 'completed') then
    new.commission_eligible_at := now();
    new.commission_eligible_source := 'status:' || new.status;
  end if;

  return new;
end;
$$;

create or replace function public.set_import_order_commission_eligible()
returns trigger
language plpgsql
as $$
declare
  new_is_eligible boolean;
  old_is_eligible boolean := false;
begin
  if new.commission_eligible_at is not null then
    return new;
  end if;

  new_is_eligible := (
    coalesce(new.payment_status, '') = 'paid'
    or new.status in ('Enviada', 'Parcialmente Disponible', 'Disponible', 'Parcialmente Completada', 'Completada')
  );

  if tg_op = 'INSERT' then
    if new_is_eligible then
      new.commission_eligible_at := now();
      if coalesce(new.payment_status, '') = 'paid' then
        new.commission_eligible_source := 'payment_status:paid';
      else
        new.commission_eligible_source := 'status:' || new.status;
      end if;
    end if;
    return new;
  end if;

  old_is_eligible := (
    coalesce(old.payment_status, '') = 'paid'
    or old.status in ('Enviada', 'Parcialmente Disponible', 'Disponible', 'Parcialmente Completada', 'Completada')
  );

  if not old_is_eligible and new_is_eligible then
    new.commission_eligible_at := now();
    if coalesce(new.payment_status, '') = 'paid' and coalesce(old.payment_status, '') <> 'paid' then
      new.commission_eligible_source := 'payment_status:paid';
    else
      new.commission_eligible_source := 'status:' || new.status;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_orders_set_commission_eligible on public.orders;
create trigger trg_orders_set_commission_eligible
before insert or update on public.orders
for each row
execute function public.set_order_commission_eligible();

drop trigger if exists trg_import_orders_set_commission_eligible on public.import_orders;
create trigger trg_import_orders_set_commission_eligible
before insert or update on public.import_orders
for each row
execute function public.set_import_order_commission_eligible();

create or replace function public.recalculate_commission_period_status(p_period_id uuid)
returns void
language plpgsql
as $$
declare
  v_total_due numeric(12,2);
  v_confirmed_total numeric(12,2);
  v_locked_at timestamptz;
begin
  select
    cp.total_due_usd,
    cp.locked_at,
    coalesce(sum(case when pay.status = 'confirmed' then pay.amount_usd else 0 end), 0)::numeric(12,2)
  into v_total_due, v_locked_at, v_confirmed_total
  from public.commission_periods cp
  left join public.commission_payments pay on pay.period_id = cp.id
  where cp.id = p_period_id
  group by cp.id;

  update public.commission_periods
  set status = case
    when coalesce(v_total_due, 0) <= 0 then 'open'
    when v_confirmed_total >= v_total_due then 'paid'
    when v_confirmed_total > 0 then 'partially_paid'
    when v_locked_at is not null then 'issued'
    else 'open'
  end
  where id = p_period_id;
end;
$$;

create or replace function public.refresh_commission_period(
  p_period_key text,
  p_fixed_fee_usd numeric default 100.00,
  p_commission_rate numeric default 0.03,
  p_force boolean default false
)
returns uuid
language plpgsql
as $$
declare
  v_first_day date;
  v_period_start timestamptz;
  v_next_period_start timestamptz;
  v_period_end timestamptz;
  v_period_id uuid;
  v_locked_at timestamptz;
  v_sales_base numeric(12,2) := 0;
  v_sales_commission numeric(12,2) := 0;
  v_imports_base numeric(12,2) := 0;
  v_imports_commission numeric(12,2) := 0;
begin
  if p_period_key !~ '^[0-9]{4}-[0-9]{2}$' then
    raise exception 'period_key inválido. Usa formato YYYY-MM';
  end if;

  v_first_day := to_date(p_period_key || '-01', 'YYYY-MM-DD');
  v_period_start := (v_first_day::timestamp at time zone 'America/Argentina/Buenos_Aires');
  v_next_period_start := ((v_first_day + interval '1 month')::timestamp at time zone 'America/Argentina/Buenos_Aires');
  v_period_end := v_next_period_start - interval '1 second';

  select cp.id, cp.locked_at
  into v_period_id, v_locked_at
  from public.commission_periods cp
  where cp.period_key = p_period_key;

  if v_period_id is not null and v_locked_at is not null and not p_force then
    perform public.recalculate_commission_period_status(v_period_id);
    return v_period_id;
  end if;

  insert into public.commission_periods (
    period_key,
    period_start,
    period_end,
    fixed_fee_usd,
    generated_at,
    last_refreshed_at
  )
  values (
    p_period_key,
    v_period_start,
    v_period_end,
    round(coalesce(p_fixed_fee_usd, 100.00)::numeric, 2),
    now(),
    now()
  )
  on conflict (period_key) do update
  set
    period_start = excluded.period_start,
    period_end = excluded.period_end,
    fixed_fee_usd = excluded.fixed_fee_usd,
    last_refreshed_at = now()
  returning id into v_period_id;

  delete from public.commission_period_lines
  where period_id = v_period_id;

  insert into public.commission_period_lines (
    period_id,
    line_type,
    source_label,
    base_amount_usd,
    commission_rate,
    commission_amount_usd,
    metadata
  )
  values (
    v_period_id,
    'fixed_fee',
    'Costo mensual de la web',
    round(coalesce(p_fixed_fee_usd, 100.00)::numeric, 2),
    0,
    round(coalesce(p_fixed_fee_usd, 100.00)::numeric, 2),
    jsonb_build_object('kind', 'fixed_fee')
  );

  insert into public.commission_period_lines (
    period_id,
    line_type,
    source_id,
    source_label,
    source_status,
    source_created_at,
    source_eligible_at,
    base_amount_usd,
    commission_rate,
    commission_amount_usd,
    metadata
  )
  select
    v_period_id,
    'stock_order',
    o.id::text,
    'Orden #' || left(o.id::text, 8),
    o.status,
    o.created_at,
    o.commission_eligible_at,
    round(coalesce(o.total_amount, 0)::numeric, 2),
    p_commission_rate,
    round((coalesce(o.total_amount, 0) * p_commission_rate)::numeric, 2),
    jsonb_build_object(
      'payment_method', o.payment_method,
      'credits_used', coalesce(o.credits_used, 0),
      'discount_amount', coalesce(o.discount_amount, 0)
    )
  from public.orders o
  where o.commission_eligible_at >= v_period_start
    and o.commission_eligible_at < v_next_period_start
    and o.status in ('paid', 'shipped', 'completed')
    and coalesce(o.total_amount, 0) > 0;

  insert into public.commission_period_lines (
    period_id,
    line_type,
    source_id,
    source_label,
    source_status,
    source_created_at,
    source_eligible_at,
    base_amount_usd,
    commission_rate,
    commission_amount_usd,
    metadata
  )
  select
    v_period_id,
    'import_order',
    io.id::text,
    'Importación #' || coalesce(nullif(io.order_number, ''), io.id::text),
    io.status,
    io.created_at,
    io.commission_eligible_at,
    round(t.total_real::numeric, 2),
    p_commission_rate,
    round((t.total_real * p_commission_rate)::numeric, 2),
    jsonb_build_object(
      'payment_status', io.payment_status,
      'credits_used', coalesce(io.credits_used, 0)
    )
  from public.import_orders io
  cross join lateral (
    select public.calculate_import_order_total(io.id) as total_real
  ) t
  where io.commission_eligible_at >= v_period_start
    and io.commission_eligible_at < v_next_period_start
    and (
      coalesce(io.payment_status, '') = 'paid'
      or io.status in ('Enviada', 'Parcialmente Disponible', 'Disponible', 'Parcialmente Completada', 'Completada')
    )
    and t.total_real > 0;

  select
    coalesce(sum(case when cpl.line_type = 'stock_order' then cpl.base_amount_usd else 0 end), 0)::numeric(12,2),
    coalesce(sum(case when cpl.line_type = 'stock_order' then cpl.commission_amount_usd else 0 end), 0)::numeric(12,2),
    coalesce(sum(case when cpl.line_type = 'import_order' then cpl.base_amount_usd else 0 end), 0)::numeric(12,2),
    coalesce(sum(case when cpl.line_type = 'import_order' then cpl.commission_amount_usd else 0 end), 0)::numeric(12,2)
  into
    v_sales_base,
    v_sales_commission,
    v_imports_base,
    v_imports_commission
  from public.commission_period_lines cpl
  where cpl.period_id = v_period_id;

  update public.commission_periods
  set
    sales_base_usd = v_sales_base,
    sales_commission_usd = v_sales_commission,
    imports_base_usd = v_imports_base,
    imports_commission_usd = v_imports_commission,
    total_due_usd = round(
      coalesce(p_fixed_fee_usd, 100.00)::numeric
      + v_sales_commission
      + v_imports_commission,
      2
    ),
    last_refreshed_at = now()
  where id = v_period_id;

  perform public.recalculate_commission_period_status(v_period_id);

  return v_period_id;
end;
$$;

create or replace function public.on_commission_payment_change()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    perform public.recalculate_commission_period_status(old.period_id);
    return old;
  end if;

  perform public.recalculate_commission_period_status(new.period_id);
  return new;
end;
$$;

drop trigger if exists trg_commission_payments_change on public.commission_payments;
create trigger trg_commission_payments_change
after insert or update or delete on public.commission_payments
for each row
execute function public.on_commission_payment_change();

drop policy if exists "Commission periods readable by admins" on public.commission_periods;
create policy "Commission periods readable by admins"
on public.commission_periods
for select
to authenticated
using (public.is_commission_admin());

drop policy if exists "Commission period lines readable by admins" on public.commission_period_lines;
create policy "Commission period lines readable by admins"
on public.commission_period_lines
for select
to authenticated
using (public.is_commission_admin());

drop policy if exists "Commission payments readable by admins" on public.commission_payments;
create policy "Commission payments readable by admins"
on public.commission_payments
for select
to authenticated
using (public.is_commission_admin());
