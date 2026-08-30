import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import { test } from 'node:test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const migrationsRoot = path.join(appRoot, 'supabase', 'migrations')
const suffix = '_reconcile_legacy_schema_safely.sql'

function loadMigration() {
  const matches = fs.readdirSync(migrationsRoot).filter((name) => name.endsWith(suffix))
  assert.equal(matches.length, 1, `debe existir exactamente una migración ${suffix}`)
  return fs.readFileSync(path.join(migrationsRoot, matches[0]), 'utf8')
}

function runLocalSql(sql) {
  const result = spawnSync(
    'docker',
    ['exec', '-i', 'supabase_db_crimson-crown', 'psql', '-U', 'supabase_admin', '-d', 'postgres', '-X', '-v', 'ON_ERROR_STOP=1'],
    { cwd: appRoot, input: sql, encoding: 'utf8', timeout: 120_000, windowsHide: true },
  )
  assert.equal(result.status, 0, `${result.stdout || ''}\n${result.stderr || ''}`)
  return result.stdout
}

test('el forward reconcilia el legado sin reescribir filas ni validar el historial retenido', () => {
  const migration = loadMigration()

  assert.doesNotMatch(migration, /\bdelete\s+from\s+public\./iu)
  assert.doesNotMatch(migration, /\bupdate\s+public\./iu)
  assert.doesNotMatch(migration, /alter\s+column\s+color_identity\s+type/iu)
  assert.doesNotMatch(migration, /validate\s+constraint\s+commission_periods_start_period_chk/iu)
  assert.match(migration, /^begin;$/imu)
  assert.match(migration, /^commit;$/imu)

  const verification = `
create temp table reconciliation_before as
select jsonb_build_object(
  'orders', (select jsonb_build_object('count', count(*), 'digest', md5(coalesce(string_agg(to_jsonb(row_value)::text, '|' order by id), ''))) from public.orders row_value),
  'profiles', (select jsonb_build_object('count', count(*), 'digest', md5(coalesce(string_agg(to_jsonb(row_value)::text, '|' order by id), ''))) from public.profiles row_value),
  'products', (select jsonb_build_object('count', count(*), 'digest', md5(coalesce(string_agg(to_jsonb(row_value)::text, '|' order by id), ''))) from public.products row_value),
  'movements', (select jsonb_build_object('count', count(*), 'digest', md5(coalesce(string_agg(to_jsonb(row_value)::text, '|' order by id), ''))) from public.inventory_stock_movements row_value),
  'pre_start_periods', (select count(*) from public.commission_periods where period_start < timestamptz '2026-06-01 00:00:00+00')
) as snapshot;

${migration}

do $verify$
declare
  before_snapshot jsonb;
  after_snapshot jsonb;
begin
  select snapshot into before_snapshot from reconciliation_before;
  select jsonb_build_object(
    'orders', (select jsonb_build_object('count', count(*), 'digest', md5(coalesce(string_agg(to_jsonb(row_value)::text, '|' order by id), ''))) from public.orders row_value),
    'profiles', (select jsonb_build_object('count', count(*), 'digest', md5(coalesce(string_agg(to_jsonb(row_value)::text, '|' order by id), ''))) from public.profiles row_value),
    'products', (select jsonb_build_object('count', count(*), 'digest', md5(coalesce(string_agg(to_jsonb(row_value)::text, '|' order by id), ''))) from public.products row_value),
    'movements', (select jsonb_build_object('count', count(*), 'digest', md5(coalesce(string_agg(to_jsonb(row_value)::text, '|' order by id), ''))) from public.inventory_stock_movements row_value),
    'pre_start_periods', (select count(*) from public.commission_periods where period_start < timestamptz '2026-06-01 00:00:00+00')
  ) into after_snapshot;

  if before_snapshot is distinct from after_snapshot then
    raise exception 'business row snapshot changed';
  end if;
  if (before_snapshot ->> 'pre_start_periods')::integer <> 9 then
    raise exception 'fixture must prove exactly nine retained legacy periods';
  end if;
  if (select column_default from information_schema.columns where table_schema='public' and table_name='products' and column_name='tcg') <> '''Magic''::text' then
    raise exception 'products.tcg default is not reconciled';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='buylist_orders' and column_name='manual_quote_notes' and data_type='text' and is_nullable='YES') then
    raise exception 'manual quote notes missing';
  end if;
  if (select udt_name from information_schema.columns where table_schema='public' and table_name='external_prices' and column_name='color_identity') <> 'jsonb' then
    raise exception 'color_identity must remain jsonb';
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.commission_periods'::regclass
      and conname='commission_periods_start_period_chk'
      and not convalidated
  ) then
    raise exception 'non-validating commission guard missing';
  end if;
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('normalize_text','search_orders_v2','search_imports_v2')
  ) then
    raise exception 'retired search RPC remains exposed';
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='external_prices' and policyname='Admins manage external prices' and roles='{authenticated}' and cmd='ALL' and qual ~ 'is_admin' and with_check ~ 'is_admin') then
    raise exception 'external price admin policy missing';
  end if;
  if exists (select 1 from pg_policies where schemaname='public' and tablename='external_prices' and policyname='Service role updates') then
    raise exception 'unsafe external price policy remains';
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='import_orders' and policyname='Admins manage all import orders' and roles='{authenticated}' and cmd='ALL' and qual ~ 'is_admin' and with_check ~ 'is_admin') then
    raise exception 'import order admin policy missing';
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='import_items' and policyname='Admins manage all import items' and roles='{authenticated}' and cmd='ALL' and qual ~ 'is_admin' and with_check ~ 'is_admin') then
    raise exception 'import item admin policy missing';
  end if;
  if exists (select 1 from pg_policies where schemaname='public' and tablename='price_history' and cmd in ('INSERT','UPDATE','DELETE','ALL')) then
    raise exception 'price history browser write policy remains';
  end if;
  if has_table_privilege('anon', 'public.price_history', 'INSERT') or has_table_privilege('authenticated', 'public.price_history', 'INSERT') then
    raise exception 'price history browser insert grant remains';
  end if;
  if exists (
    select 1
    from unnest(array[
      'manage_credits(uuid,numeric,text,text,uuid)', 'transfer_credits(text,numeric,text)',
      'restore_stock(uuid)', 'approve_buylist_transaction(uuid,numeric)',
      'user_accept_buylist_offer(uuid)', 'decrement_stock(integer,uuid)',
      'update_profile_details(text,text,text)', 'submit_order_payment_proof(uuid,text)',
      'place_order_atomic(jsonb,text,text,jsonb,boolean,text,text,text)',
      'restore_order_inventory_atomic(uuid,text)', 'cancel_order_atomic(uuid,boolean,boolean)',
      'refund_order_atomic(uuid,boolean,numeric)', 'remove_order_item_atomic(uuid,integer,boolean)',
      'release_expired_orders_atomic(integer,text)'
    ]) signature
    join pg_proc routine on routine.oid = to_regprocedure('public.' || signature)
    where not (coalesce(routine.proconfig, '{}') @> array['search_path=public, pg_temp'])
      or has_function_privilege('public', routine.oid, 'EXECUTE')
      or has_function_privilege('anon', routine.oid, 'EXECUTE')
      or not has_function_privilege('authenticated', routine.oid, 'EXECUTE')
  ) then
    raise exception 'runtime function grant/search path contract failed';
  end if;
end
$verify$;
`

  const output = runLocalSql(verification)
  assert.match(output, /COMMIT/u)
})
