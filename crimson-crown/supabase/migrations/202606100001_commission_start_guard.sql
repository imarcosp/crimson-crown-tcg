begin;

create table if not exists public.commission_periods_pre_start_backup_20260610 as
select *
from public.commission_periods
with no data;

create table if not exists public.commission_period_lines_pre_start_backup_20260610 as
select cpl.*
from public.commission_period_lines cpl
with no data;

create table if not exists public.commission_payments_pre_start_backup_20260610 as
select *
from public.commission_payments
with no data;

create table if not exists public.commission_adjustments_pre_start_backup_20260610 as
select *
from public.commission_adjustments
with no data;

create table if not exists public.commission_payment_allocations_pre_start_backup_20260610 as
select *
from public.commission_payment_allocations
with no data;

delete from public.commission_payment_allocations_pre_start_backup_20260610;
insert into public.commission_payment_allocations_pre_start_backup_20260610
select cpa.*
from public.commission_payment_allocations cpa
join public.commission_periods cp on cp.id = cpa.period_id
where cp.period_key < '2026-06';

delete from public.commission_adjustments_pre_start_backup_20260610;
insert into public.commission_adjustments_pre_start_backup_20260610
select adj.*
from public.commission_adjustments adj
join public.commission_periods cp on cp.id = adj.period_id
where cp.period_key < '2026-06';

delete from public.commission_payments_pre_start_backup_20260610;
insert into public.commission_payments_pre_start_backup_20260610
select pay.*
from public.commission_payments pay
join public.commission_periods cp on cp.id = pay.period_id
where cp.period_key < '2026-06';

delete from public.commission_period_lines_pre_start_backup_20260610;
insert into public.commission_period_lines_pre_start_backup_20260610
select cpl.*
from public.commission_period_lines cpl
join public.commission_periods cp on cp.id = cpl.period_id
where cp.period_key < '2026-06';

delete from public.commission_periods_pre_start_backup_20260610;
insert into public.commission_periods_pre_start_backup_20260610
select *
from public.commission_periods
where period_key < '2026-06';

delete from public.commission_periods
where period_key < '2026-06';

alter table public.commission_periods
drop constraint if exists commission_periods_start_period_chk;

alter table public.commission_periods
add constraint commission_periods_start_period_chk
check (period_key >= '2026-06');

commit;

notify pgrst, 'reload schema';
