import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const migrationsRoot = path.join(appRoot, 'supabase', 'migrations')
const migrationSuffix = '_add_payment_proof_paths.sql'
const expectedContainer = 'supabase_db_crimson-crown'
const packagePath = path.join(appRoot, 'package.json')

async function loadMigration() {
  const matches = (await readdir(migrationsRoot))
    .filter((filename) => filename.endsWith(migrationSuffix))
    .sort()

  assert.equal(
    matches.length,
    1,
    `se esperaba exactamente una migración ${migrationSuffix}; encontradas: ${matches.join(', ') || 'ninguna'}`,
  )

  return {
    filename: matches[0],
    sql: await readFile(path.join(migrationsRoot, matches[0]), 'utf8'),
  }
}

function transactionBody(sql) {
  const match = /^\s*begin\s*;([\s\S]*)commit\s*;\s*$/iu.exec(sql)
  assert.ok(match, 'la migración debe contener una sola transacción BEGIN/COMMIT')
  assert.doesNotMatch(match[1], /\b(?:begin|commit|rollback)\s*;/iu)
  return match[1]
}

function runDocker(args, input) {
  return spawnSync('docker', args, {
    cwd: appRoot,
    encoding: 'utf8',
    input,
    timeout: 120_000,
    windowsHide: true,
  })
}

function outputOf(result) {
  return `${result.stdout || ''}\n${result.stderr || ''}`.trim()
}

function assertExactLocalContainer() {
  const result = runDocker([
    'ps',
    '--filter', `name=^${expectedContainer}$`,
    '--format', '{{.Names}}',
  ])
  assert.equal(result.status, 0, outputOf(result))
  assert.deepEqual(result.stdout.trim().split(/\r?\n/u).filter(Boolean), [expectedContainer])
}

const migrationPromise = loadMigration()

test('registra un comando focalizado para el contrato de proof paths', async () => {
  const packageJson = JSON.parse(await readFile(packagePath, 'utf8'))
  assert.equal(
    packageJson.scripts?.['test:payment-proof-paths'],
    'node --test scripts/local-db/payment-proof-paths-contract.test.mjs',
  )
})

test('define sólo columnas nullable y preserva todas las superficies legacy', async () => {
  const { filename, sql } = await migrationPromise
  const normalized = sql.toLowerCase().replace(/\s+/gu, ' ')

  assert.match(filename, /^\d{14}_add_payment_proof_paths\.sql$/u)
  for (const fragment of [
    'alter table public.orders add column if not exists payment_proof_path text;',
    'alter table public.import_orders add column if not exists payment_proof_path text;',
    'alter table public.commission_payments add column if not exists proof_path text;',
  ]) {
    assert.ok(normalized.includes(fragment), `falta: ${fragment}`)
  }

  assert.doesNotMatch(sql, /\b(?:payment_proof_url|proof_url)\b/iu)
  assert.doesNotMatch(sql, /\b(?:drop|rename|truncate|delete)\b/iu)
  assert.doesNotMatch(
    sql,
    /add\s+column(?:\s+if\s+not\s+exists)?\s+(?:payment_proof_path|proof_path)\s+text\s+(?:not\s+null|default)\b/iu,
  )
  transactionBody(sql)
})

test('crea un RPC invoker de dos argumentos ejecutable sólo por service_role', async () => {
  const { sql } = await migrationPromise
  const normalized = sql.toLowerCase().replace(/\s+/gu, ' ')

  assert.match(
    sql,
    /create\s+or\s+replace\s+function\s+public\.submit_order_payment_proof_path\s*\(\s*order_id_input\s+uuid\s*,\s*proof_path_input\s+text\s*\)/iu,
  )
  assert.match(normalized, /security invoker set search_path = public, pg_temp/u)
  assert.doesNotMatch(sql, /security\s+definer/iu)
  assert.doesNotMatch(sql, /auth\.(?:uid|role)\s*\(/iu)
  assert.ok(normalized.includes(
    'revoke all on function public.submit_order_payment_proof_path(uuid, text) from public, anon, authenticated;',
  ))
  assert.ok(normalized.includes(
    'grant execute on function public.submit_order_payment_proof_path(uuid, text) to service_role;',
  ))
  assert.doesNotMatch(
    normalized,
    /grant execute on function public\.submit_order_payment_proof_path\(uuid, text\) to (?:public|anon|authenticated)(?:\s|,|;)/u,
  )
})

test('valida owner, estado y ruta canónica RFC antes de actualizar dos campos exactos', async () => {
  const { sql } = await migrationPromise
  const normalized = sql.toLowerCase().replace(/\s+/gu, ' ')

  assert.match(sql, /select\s+o\.user_id\s*,\s*o\.status[\s\S]*from\s+public\.orders\s+as\s+o[\s\S]*where\s+o\.id\s*=\s*order_id_input[\s\S]*for\s+update/iu)
  assert.match(sql, /octet_length\s*\(\s*proof_path_input\s*\)\s*>\s*256/iu)
  assert.match(sql, /\[1-8\]\[0-9a-f\]\{3\}/u)
  assert.match(sql, /\[89ab\]\[0-9a-f\]\{3\}/u)
  assert.match(sql, /\(jpg\|jpeg\|png\|webp\|pdf\)/u)
  assert.ok(normalized.includes("set status = 'verifying_payment', payment_proof_path = proof_path_input"))
  assert.ok(normalized.includes("and status in ('pending_payment', 'verifying_payment')"))
})

test('la migración y el RPC preservan datos legacy y hacen cumplir roles/rutas en local', async () => {
  const { sql } = await migrationPromise
  const body = transactionBody(sql)
  assertExactLocalContainer()

  const payload = String.raw`
begin;

create temp table payment_proof_legacy_before (
  table_name text primary key,
  row_count bigint not null,
  legacy_hash text not null
) on commit drop;

insert into payment_proof_legacy_before (table_name, row_count, legacy_hash)
select 'orders', count(*), md5(coalesce(jsonb_agg(jsonb_build_array(id::text, payment_proof_url) order by id::text)::text, '[]'))
from public.orders
union all
select 'import_orders', count(*), md5(coalesce(jsonb_agg(jsonb_build_array(id::text, payment_proof_url) order by id)::text, '[]'))
from public.import_orders
union all
select 'commission_payments', count(*), md5(coalesce(jsonb_agg(jsonb_build_array(id::text, proof_url) order by id::text)::text, '[]'))
from public.commission_payments;

create temp table payment_proof_legacy_function_before on commit drop as
select md5(pg_get_functiondef('public.submit_order_payment_proof(uuid,text)'::regprocedure)) as definition_hash;

${body}

do $assert_migration$
declare
  changed_count integer;
begin
  if (
    select count(*)
    from information_schema.columns
    where table_schema = 'public'
      and ((table_name = 'orders' and column_name = 'payment_proof_path')
        or (table_name = 'import_orders' and column_name = 'payment_proof_path')
        or (table_name = 'commission_payments' and column_name = 'proof_path'))
      and is_nullable = 'YES'
      and column_default is null
  ) <> 3 then
    raise exception 'Las columnas nuevas deben ser tres, nullable y sin default.';
  end if;

  with after_state as (
    select 'orders'::text as table_name, count(*) as row_count,
      md5(coalesce(jsonb_agg(jsonb_build_array(id::text, payment_proof_url) order by id::text)::text, '[]')) as legacy_hash
    from public.orders
    union all
    select 'import_orders', count(*),
      md5(coalesce(jsonb_agg(jsonb_build_array(id::text, payment_proof_url) order by id)::text, '[]'))
    from public.import_orders
    union all
    select 'commission_payments', count(*),
      md5(coalesce(jsonb_agg(jsonb_build_array(id::text, proof_url) order by id::text)::text, '[]'))
    from public.commission_payments
  )
  select count(*) into changed_count
  from payment_proof_legacy_before as before_state
  full join after_state using (table_name)
  where before_state.row_count is distinct from after_state.row_count
     or before_state.legacy_hash is distinct from after_state.legacy_hash;

  if changed_count <> 0 then
    raise exception 'La migración alteró filas o comprobantes legacy.';
  end if;

  if (select definition_hash from payment_proof_legacy_function_before)
      is distinct from md5(pg_get_functiondef('public.submit_order_payment_proof(uuid,text)'::regprocedure)) then
    raise exception 'La función legacy fue alterada.';
  end if;

  if (select prosecdef from pg_proc where oid = 'public.submit_order_payment_proof_path(uuid,text)'::regprocedure) then
    raise exception 'La RPC nueva no puede ser SECURITY DEFINER.';
  end if;
  if has_function_privilege('anon', 'public.submit_order_payment_proof_path(uuid,text)', 'execute')
    or has_function_privilege('authenticated', 'public.submit_order_payment_proof_path(uuid,text)', 'execute')
    or not has_function_privilege('service_role', 'public.submit_order_payment_proof_path(uuid,text)', 'execute') then
    raise exception 'ACL incorrecta para la RPC nueva.';
  end if;
end;
$assert_migration$;

set local role anon;
do $anon_denial$
declare denied boolean := false;
begin
  begin
    perform public.submit_order_payment_proof_path(
      '00000000-0000-4000-8000-000000000001'::uuid,
      'body-must-not-run'
    );
  exception when insufficient_privilege then
    if sqlerrm <> 'permission denied for function submit_order_payment_proof_path' then
      raise;
    end if;
    denied := true;
  end;
  if not denied then raise exception 'anon alcanzó el cuerpo de la RPC.'; end if;
end;
$anon_denial$;
reset role;

set local role authenticated;
do $authenticated_denial$
declare denied boolean := false;
begin
  begin
    perform public.submit_order_payment_proof_path(
      '00000000-0000-4000-8000-000000000001'::uuid,
      'body-must-not-run'
    );
  exception when insufficient_privilege then
    if sqlerrm <> 'permission denied for function submit_order_payment_proof_path' then
      raise;
    end if;
    denied := true;
  end;
  if not denied then raise exception 'authenticated alcanzó el cuerpo de la RPC.'; end if;
end;
$authenticated_denial$;
reset role;

set local role service_role;
do $service_role_cases$
declare
  target_id uuid;
  target_owner uuid;
  original_legacy_url text;
  first_path text;
  second_path text;
  invalid_id uuid;
  invalid_owner uuid;
  invalid_status text;
  invalid_path_before text;
  candidate text;
  rejected boolean;
begin
  select id, user_id, payment_proof_url
    into target_id, target_owner, original_legacy_url
  from public.orders
  where status = 'pending_payment'
  order by id
  limit 1;
  if not found then raise exception 'Falta una orden pending_payment para la fixture local.'; end if;

  first_path := 'orders/' || target_owner::text || '/' || target_id::text ||
    '/11111111-1111-4111-8111-111111111111.png';
  perform public.submit_order_payment_proof_path(target_id, first_path);
  if not exists (
    select 1 from public.orders
    where id = target_id
      and user_id = target_owner
      and status = 'verifying_payment'
      and payment_proof_path = first_path
      and payment_proof_url is not distinct from original_legacy_url
  ) then
    raise exception 'La actualización canónica no produjo el estado exacto.';
  end if;

  second_path := 'orders/' || target_owner::text || '/' || target_id::text ||
    '/22222222-2222-4222-8222-222222222222.pdf';
  perform public.submit_order_payment_proof_path(target_id, second_path);
  if (select payment_proof_path from public.orders where id = target_id) <> second_path then
    raise exception 'verifying_payment no aceptó un reemplazo canónico.';
  end if;

  foreach candidate in array array[
    'orders/11111111-1111-4111-8111-111111111111/' || target_id::text || '/33333333-3333-4333-8333-333333333333.png',
    'orders/' || target_owner::text || '/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333.png',
    'orders/' || target_owner::text || '/' || target_id::text || '/AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA.png',
    'orders/' || target_owner::text || '/' || target_id::text || '/00000000-0000-0000-0000-000000000000.png',
    'orders/' || target_owner::text || '/' || target_id::text || '/33333333-3333-4333-7333-333333333333.png',
    'orders/' || target_owner::text || '/' || target_id::text || '/33333333-3333-4333-8333-333333333333.exe',
    'orders/' || target_owner::text || '/' || target_id::text || '/33333333-3333-4333-8333-333333333333.png.exe',
    'orders/' || target_owner::text || '/' || target_id::text || '/../33333333-3333-4333-8333-333333333333.png',
    'orders/' || repeat('a', 300)
  ] loop
    rejected := false;
    begin
      perform public.submit_order_payment_proof_path(target_id, candidate);
    exception when sqlstate '22023' then
      rejected := true;
    end;
    if not rejected then raise exception 'Ruta inválida aceptada: %', candidate; end if;
  end loop;

  rejected := false;
  begin
    perform public.submit_order_payment_proof_path(target_id, null);
  exception when sqlstate '22023' then
    rejected := true;
  end;
  if not rejected then raise exception 'La ruta NULL fue aceptada.'; end if;

  select id, user_id, status, payment_proof_path
    into invalid_id, invalid_owner, invalid_status, invalid_path_before
  from public.orders
  where status not in ('pending_payment', 'verifying_payment')
  order by id
  limit 1;
  if not found then raise exception 'Falta una orden de estado inválido para la fixture local.'; end if;

  rejected := false;
  begin
    perform public.submit_order_payment_proof_path(
      invalid_id,
      'orders/' || invalid_owner::text || '/' || invalid_id::text ||
        '/44444444-4444-4444-8444-444444444444.jpeg'
    );
  exception when sqlstate '42501' then
    rejected := true;
  end;
  if not rejected then raise exception 'Una orden de estado inválido fue actualizada.'; end if;
  if not exists (
    select 1 from public.orders
    where id = invalid_id
      and status is not distinct from invalid_status
      and payment_proof_path is not distinct from invalid_path_before
  ) then
    raise exception 'El caso de estado inválido mutó la orden.';
  end if;
end;
$service_role_cases$;
reset role;

rollback;
`

  const result = runDocker([
    'exec', '-i', expectedContainer,
    'psql', '-U', 'supabase_admin', '-d', 'postgres', '-X', '-v', 'ON_ERROR_STOP=1',
  ], payload)

  assert.equal(result.status, 0, outputOf(result))
  assert.match(result.stdout, /ROLLBACK/u)
})
