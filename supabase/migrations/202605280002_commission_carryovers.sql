begin;

alter table public.commission_payments
  add column if not exists unapplied_usd numeric(12,2) not null default 0;

create table if not exists public.commission_adjustments (
  id uuid primary key default gen_random_uuid(),
  period_id uuid not null references public.commission_periods(id) on delete cascade,
  direction text not null,
  amount_usd numeric(12,2) not null,
  reason text not null,
  notes text,
  created_by_user_id uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  constraint commission_adjustments_direction_chk check (direction in ('debit', 'credit')),
  constraint commission_adjustments_amount_chk check (amount_usd > 0)
);

alter table public.commission_adjustments enable row level security;

create index if not exists idx_commission_adjustments_period_id
  on public.commission_adjustments (period_id);

create table if not exists public.commission_payment_allocations (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.commission_payments(id) on delete cascade,
  period_id uuid not null references public.commission_periods(id) on delete cascade,
  amount_usd numeric(12,2) not null,
  created_at timestamptz not null default now(),
  constraint commission_payment_allocations_amount_chk check (amount_usd > 0)
);

alter table public.commission_payment_allocations enable row level security;

create index if not exists idx_commission_payment_allocations_payment_id
  on public.commission_payment_allocations (payment_id);

create index if not exists idx_commission_payment_allocations_period_id
  on public.commission_payment_allocations (period_id);

drop policy if exists "Commission adjustments readable by admins" on public.commission_adjustments;
create policy "Commission adjustments readable by admins"
on public.commission_adjustments
for select
to authenticated
using (public.is_commission_admin());

drop policy if exists "Commission allocations readable by admins" on public.commission_payment_allocations;
create policy "Commission allocations readable by admins"
on public.commission_payment_allocations
for select
to authenticated
using (public.is_commission_admin());

create or replace function public.recalculate_commission_period_status(p_period_id uuid)
returns void
language plpgsql
as $$
declare
  v_total_due numeric(12,2);
  v_locked_at timestamptz;
  v_adjustments_total numeric(12,2);
  v_confirmed_total numeric(12,2);
  v_effective_due numeric(12,2);
begin
  select
    cp.total_due_usd,
    cp.locked_at,
    coalesce(sum(
      case
        when adj.direction = 'debit' then adj.amount_usd
        when adj.direction = 'credit' then -adj.amount_usd
        else 0
      end
    ), 0)::numeric(12,2),
    coalesce((
      select sum(cpa.amount_usd)
      from public.commission_payment_allocations cpa
      where cpa.period_id = cp.id
    ), 0)::numeric(12,2)
  into v_total_due, v_locked_at, v_adjustments_total, v_confirmed_total
  from public.commission_periods cp
  left join public.commission_adjustments adj on adj.period_id = cp.id
  where cp.id = p_period_id
  group by cp.id;

  v_effective_due := coalesce(v_total_due, 0) + coalesce(v_adjustments_total, 0);

  update public.commission_periods
  set status = case
    when v_effective_due <= 0 then 'paid'
    when v_confirmed_total >= v_effective_due then 'paid'
    when v_confirmed_total > 0 then 'partially_paid'
    when v_locked_at is not null then 'issued'
    else 'open'
  end
  where id = p_period_id;
end;
$$;

create or replace function public.on_commission_adjustments_change()
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

drop trigger if exists trg_commission_adjustments_change on public.commission_adjustments;
create trigger trg_commission_adjustments_change
after insert or update or delete on public.commission_adjustments
for each row
execute function public.on_commission_adjustments_change();

create or replace function public.on_commission_allocations_change()
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

drop trigger if exists trg_commission_allocations_change on public.commission_payment_allocations;
create trigger trg_commission_allocations_change
after insert or update or delete on public.commission_payment_allocations
for each row
execute function public.on_commission_allocations_change();

commit;

notify pgrst, 'reload schema';
