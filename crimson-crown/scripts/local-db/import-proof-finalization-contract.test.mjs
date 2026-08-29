import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const migrationsRoot = path.join(appRoot, 'supabase', 'migrations')
const migrationSuffix = '_finalize_import_quotes_atomically.sql'
const expectedContainer = 'supabase_db_crimson-crown'

async function loadMigration() {
  const matches = (await readdir(migrationsRoot))
    .filter((filename) => filename.endsWith(migrationSuffix))
    .sort()
  assert.equal(
    matches.length,
    1,
    `se esperaba exactamente una migración ${migrationSuffix}; encontradas: ${matches.join(', ') || 'ninguna'}`,
  )
  return { filename: matches[0], sql: await readFile(path.join(migrationsRoot, matches[0]), 'utf8') }
}

function transactionBody(sql) {
  const match = /^\s*begin\s*;([\s\S]*)commit\s*;\s*$/iu.exec(sql)
  assert.ok(match, 'la migración debe contener una sola transacción BEGIN/COMMIT')
  assert.doesNotMatch(match[1], /\b(?:begin|commit|rollback)\s*;/iu)
  return match[1]
}

function dockerPsql(input) {
  return spawnSync('docker', [
    'exec', '-i', expectedContainer,
    'psql', '-U', 'supabase_admin', '-d', 'postgres', '-X', '-v', 'ON_ERROR_STOP=1',
  ], {
    cwd: appRoot,
    encoding: 'utf8',
    input,
    timeout: 120_000,
    windowsHide: true,
  })
}

function dockerCommand(args) {
  return spawnSync('docker', args, {
    cwd: appRoot,
    encoding: 'utf8',
    timeout: 120_000,
    windowsHide: true,
  })
}

function outputOf(result) {
  return `${result.stdout || ''}\n${result.stderr || ''}`.trim()
}

function assertExactLocalContainer() {
  const result = dockerCommand(['ps', '--filter', `name=^${expectedContainer}$`, '--format', '{{.Names}}'])
  assert.equal(result.status, 0, outputOf(result))
  assert.deepEqual(result.stdout.trim().split(/\r?\n/u).filter(Boolean), [expectedContainer])
}

const migrationPromise = loadMigration()

test('registra un comando focalizado para el contrato atómico de importaciones', async () => {
  const packageJson = JSON.parse(await readFile(path.join(appRoot, 'package.json'), 'utf8'))
  assert.equal(
    packageJson.scripts?.['test:atomic-import-proof'],
    'node --test scripts/local-db/import-proof-finalization-contract.test.mjs',
  )
})

test('define dos RPC invoker service-role-only con locks en orden estable', async () => {
  const { filename, sql } = await migrationPromise
  const normalized = sql.toLowerCase().replace(/\s+/gu, ' ')

  assert.match(filename, /^\d{14}_finalize_import_quotes_atomically\.sql$/u)
  transactionBody(sql)
  assert.doesNotMatch(sql, /security\s+definer/iu)
  assert.doesNotMatch(sql, /\b(?:payment_proof_url|drop|truncate|alter\s+table)\b/iu)
  assert.match(sql, /create\s+or\s+replace\s+function\s+public\.approve_import_quote_atomic\s*\(\s*order_id_input\s+bigint\s*,\s*user_id_input\s+uuid\s*,\s*proof_path_input\s+text\s*,\s*credits_input\s+numeric\s*\)/iu)
  assert.match(sql, /create\s+or\s+replace\s+function\s+public\.delete_import_item_atomic\s*\(\s*item_id_input\s+bigint\s*,\s*order_id_input\s+bigint\s*,\s*user_id_input\s+uuid\s*\)/iu)
  assert.equal((normalized.match(/security invoker set search_path = public, pg_temp/gu) ?? []).length, 2)

  for (const signature of [
    'public.approve_import_quote_atomic(bigint, uuid, text, numeric)',
    'public.delete_import_item_atomic(bigint, bigint, uuid)',
  ]) {
    assert.ok(normalized.includes(`revoke all on function ${signature} from public, anon, authenticated;`))
    assert.ok(normalized.includes(`grant execute on function ${signature} to service_role;`))
  }

  assert.match(sql, /from\s+public\.import_orders[\s\S]*for\s+update/iu)
  assert.match(sql, /from\s+public\.profiles[\s\S]*for\s+update/iu)
  assert.match(sql, /from\s+public\.import_items[\s\S]*order\s+by[\s\S]*for\s+update/iu)
  assert.match(sql, /perform\s+public\.manage_credits\s*\(/iu)
  assert.match(sql, /update\s+public\.import_orders[\s\S]*payment_proof_path\s*=\s*proof_path_input/iu)
  assert.match(sql, /delete\s+from\s+public\.import_items[\s\S]*id\s*=\s*item_id_input[\s\S]*order_id\s*=\s*order_id_input/iu)
  assert.match(sql, /status\s+not\s+in\s*\(\s*'Iniciada'\s*,\s*'Cotizada'\s*\)/u)
})

test('las Server Actions delegan las mutaciones de negocio a los RPC atómicos', async () => {
  const source = await readFile(path.join(appRoot, 'src', 'app', 'actions', 'imports.ts'), 'utf8')
  const deleteBlock = source.match(/export async function deleteImportItemAction[\s\S]*?\n\}\n\nexport async function rejectImportQuoteAction/u)?.[0] ?? ''
  const approveBlock = source.match(/export async function approveImportQuoteAction[\s\S]*$/u)?.[0] ?? ''

  assert.match(source, /\.rpc\(['"]approve_import_quote_atomic['"]/u)
  assert.match(source, /\.rpc\(['"]delete_import_item_atomic['"]/u)
  assert.doesNotMatch(approveBlock, /\.rpc\(['"]manage_credits['"]/u)
  assert.doesNotMatch(deleteBlock, /\.from\(['"]import_items['"]\)[\s\S]*?\.delete\s*\(/u)
  assert.doesNotMatch(approveBlock, /\.from\(['"]import_orders['"]\)[\s\S]*?\.update\s*\(/u)
})

test('ACL, rollback, precisión, rutas y filas legacy se preservan en el local exacto', async () => {
  const { sql } = await migrationPromise
  const body = transactionBody(sql)
  assertExactLocalContainer()

  const payload = String.raw`
begin;

create temp table legacy_before on commit drop as
select
  (select count(*) from public.import_orders) as order_count,
  (select count(*) from public.import_items) as item_count,
  (select md5(coalesce(jsonb_agg(jsonb_build_array(id::text, payment_proof_url) order by id)::text, '[]')) from public.import_orders) as url_hash,
  md5(pg_get_functiondef('public.manage_credits(uuid,numeric,text,text,uuid)'::regprocedure)) as credits_function_hash;

${body}

do $catalog$
begin
  if (select prosecdef from pg_proc where oid = 'public.approve_import_quote_atomic(bigint,uuid,text,numeric)'::regprocedure)
    or (select prosecdef from pg_proc where oid = 'public.delete_import_item_atomic(bigint,bigint,uuid)'::regprocedure) then
    raise exception 'Los RPC nuevos no pueden ser SECURITY DEFINER.';
  end if;
  if has_function_privilege('anon', 'public.approve_import_quote_atomic(bigint,uuid,text,numeric)', 'execute')
    or has_function_privilege('authenticated', 'public.approve_import_quote_atomic(bigint,uuid,text,numeric)', 'execute')
    or not has_function_privilege('service_role', 'public.approve_import_quote_atomic(bigint,uuid,text,numeric)', 'execute')
    or has_function_privilege('anon', 'public.delete_import_item_atomic(bigint,bigint,uuid)', 'execute')
    or has_function_privilege('authenticated', 'public.delete_import_item_atomic(bigint,bigint,uuid)', 'execute')
    or not has_function_privilege('service_role', 'public.delete_import_item_atomic(bigint,bigint,uuid)', 'execute') then
    raise exception 'ACL efectiva incorrecta.';
  end if;
  if (select credits_function_hash from legacy_before)
      is distinct from md5(pg_get_functiondef('public.manage_credits(uuid,numeric,text,text,uuid)'::regprocedure)) then
    raise exception 'manage_credits fue alterada.';
  end if;
  if (select order_count from legacy_before) <> (select count(*) from public.import_orders)
    or (select item_count from legacy_before) <> (select count(*) from public.import_items)
    or (select url_hash from legacy_before) is distinct from
       (select md5(coalesce(jsonb_agg(jsonb_build_array(id::text, payment_proof_url) order by id)::text, '[]')) from public.import_orders) then
    raise exception 'La migración alteró filas o URLs legacy.';
  end if;
end;
$catalog$;

set local role anon;
select public.approve_import_quote_atomic(1, '11111111-1111-4111-8111-111111111111', null, 0);
reset role;
rollback;
`

  const denied = dockerPsql(payload)
  assert.notEqual(denied.status, 0, 'anon no debe alcanzar el cuerpo del RPC')
  assert.match(outputOf(denied), /permission denied for function approve_import_quote_atomic/u)

  const behaviorPayload = String.raw`
begin;
${body}

do $cases$
declare
  owner_id uuid;
  original_credits numeric;
  target_order bigint;
  target_item bigint;
  target_path text;
  before_transactions bigint;
  after_first_credits numeric;
  rejected boolean;
  empty_order bigint;
  zero_order bigint;
  full_order bigint;
  fail_order bigint;
  fail_item bigint;
begin
  select id, coalesce(credits, 0) into owner_id, original_credits
  from public.profiles order by id limit 1 for update;
  if not found then raise exception 'Falta perfil fixture local.'; end if;
  perform set_config('request.jwt.claim.role', 'service_role', true);
  update public.profiles set credits = 100 where id = owner_id;

  insert into public.import_orders(user_id, status, user_notes)
  values (owner_id, 'Cotizada', 'atomic-proof-main') returning id into target_order;
  target_item := nextval('public.import_items_id_seq');
  insert into public.import_items(id, order_id, product_name, quantity, unit_price, tax_percent, shipping_cost)
  values (target_item, target_order, 'fixture', 2, 5, 10, 0.5);
  target_path := 'imports/' || owner_id::text || '/' || target_order::text || '/11111111-1111-4111-8111-111111111111.png';
  select count(*) into before_transactions from public.credit_transactions where user_id = owner_id;

  perform public.approve_import_quote_atomic(target_order, owner_id, target_path, 2.00);
  if not exists (
    select 1 from public.import_orders where id = target_order
      and status = 'Cotización Aprobada' and payment_status = 'verifying'
      and payment_proof_path = target_path and credits_used = 2.00
      and payment_proof_url is null
  ) then raise exception 'Finalización parcial incorrecta.'; end if;
  select credits into after_first_credits from public.profiles where id = owner_id;
  if after_first_credits <> 98 then raise exception 'Débito inicial incorrecto.'; end if;

  rejected := false;
  begin
    perform public.approve_import_quote_atomic(target_order, owner_id, target_path, 2.00);
  exception when others then
    rejected := true;
  end;
  if not rejected then raise exception 'El segundo submit fue aceptado.'; end if;
  if (select credits from public.profiles where id = owner_id) <> after_first_credits
    or (select count(*) from public.credit_transactions where user_id = owner_id) <> before_transactions + 1 then
    raise exception 'El segundo submit debitó créditos.';
  end if;

  insert into public.import_orders(user_id, status, user_notes)
  values (owner_id, 'Cotizada', 'atomic-proof-full') returning id into full_order;
  insert into public.import_items(id, order_id, product_name, quantity, unit_price, tax_percent, shipping_cost)
  values (nextval('public.import_items_id_seq'), full_order, 'fixture', 1, 10.005, 0, 0);
  perform public.approve_import_quote_atomic(full_order, owner_id, null, 10.01);
  if not exists (select 1 from public.import_orders where id = full_order and payment_status = 'paid' and payment_proof_path is null) then
    raise exception 'Pago total con precisión decimal incorrecto.';
  end if;

  insert into public.import_orders(user_id, status, user_notes)
  values (owner_id, 'Cotizada', 'atomic-proof-empty') returning id into empty_order;
  rejected := false;
  begin
    perform public.approve_import_quote_atomic(empty_order, owner_id, null, 0);
  exception when others then rejected := true; end;
  if not rejected then raise exception 'Orden vacía aprobada.'; end if;

  insert into public.import_orders(user_id, status, user_notes)
  values (owner_id, 'Cotizada', 'atomic-proof-zero') returning id into zero_order;
  insert into public.import_items(id, order_id, product_name, quantity, unit_price, tax_percent, shipping_cost)
  values (nextval('public.import_items_id_seq'), zero_order, 'fixture', 1, 0, 0, 0);
  rejected := false;
  begin
    perform public.approve_import_quote_atomic(zero_order, owner_id, null, 0);
  exception when others then rejected := true; end;
  if not rejected then raise exception 'Total cero aprobado.'; end if;

  rejected := false;
  begin
    perform public.approve_import_quote_atomic(full_order, owner_id,
      'imports/' || owner_id::text || '/' || full_order::text || '/AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA.png', 0);
  exception when others then rejected := true; end;
  if not rejected then raise exception 'Ruta no canónica aceptada.'; end if;

  insert into public.import_orders(user_id, status, user_notes)
  values (owner_id, 'Cotizada', 'atomic-proof-fail') returning id into fail_order;
  fail_item := nextval('public.import_items_id_seq');
  insert into public.import_items(id, order_id, product_name, quantity, unit_price, tax_percent, shipping_cost)
  values (fail_item, fail_order, 'fixture', 1, 10, 0, 0);
  execute 'create function public.codex_fail_atomic_import_update() returns trigger language plpgsql as $fn$ begin if old.user_notes = ''atomic-proof-fail'' then raise exception ''injected update failure''; end if; return new; end; $fn$';
  execute 'create trigger codex_fail_atomic_import_update before update on public.import_orders for each row execute function public.codex_fail_atomic_import_update()';
  select count(*) into before_transactions from public.credit_transactions where user_id = owner_id;
  select credits into original_credits from public.profiles where id = owner_id;
  rejected := false;
  begin
    perform public.approve_import_quote_atomic(fail_order, owner_id,
      'imports/' || owner_id::text || '/' || fail_order::text || '/22222222-2222-4222-8222-222222222222.png', 1);
  exception when others then rejected := true; end;
  if not rejected then raise exception 'Fallo inyectado no abortó.'; end if;
  if (select credits from public.profiles where id = owner_id) <> original_credits
    or (select count(*) from public.credit_transactions where user_id = owner_id) <> before_transactions
    or not exists (select 1 from public.import_orders where id = fail_order and status = 'Cotizada') then
    raise exception 'El fallo de UPDATE no hizo rollback total.';
  end if;
end;
$cases$;

rollback;
`

  const result = dockerPsql(behaviorPayload)
  assert.equal(result.status, 0, outputOf(result))
  assert.match(result.stdout, /ROLLBACK/u)
})

function startPsql(input) {
  const child = spawn('docker', [
    'exec', '-i', expectedContainer,
    'psql', '-U', 'supabase_admin', '-d', 'postgres', '-X', '-v', 'ON_ERROR_STOP=1',
  ], { cwd: appRoot, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
  let stdout = ''
  let stderr = ''
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', (chunk) => { stdout += chunk })
  child.stderr.on('data', (chunk) => { stderr += chunk })
  child.stdin.end(input)
  return new Promise((resolve) => child.on('close', (status) => resolve({ status, stdout, stderr })))
}

async function waitForApplicationName(applicationName) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const result = dockerPsql(`select exists(select 1 from pg_stat_activity where application_name = '${applicationName}' and state = 'active');`)
    if (result.status === 0 && /\bt\b/u.test(result.stdout)) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`No apareció la sesión coordinada ${applicationName}.`)
}

function createCommittedFixture(marker) {
  const result = dockerPsql(String.raw`
begin;
select id as owner_id, coalesce(credits::text, 'NULL') as original_credits
from public.profiles order by id limit 1 \gset
update public.profiles set credits = 100 where id = :'owner_id';
insert into public.import_orders(user_id, status, user_notes)
values (:'owner_id', 'Cotizada', '${marker}') returning id as order_id \gset
insert into public.import_items(id, order_id, product_name, quantity, unit_price, tax_percent, shipping_cost)
values (nextval('public.import_items_id_seq'), :'order_id', '${marker}', 1, 10, 0, 0)
returning id as item_id \gset
commit;
select 'FIXTURE|' || :'owner_id' || '|' || :'order_id' || '|' || :'item_id' || '|' || :'original_credits';
`)
  assert.equal(result.status, 0, outputOf(result))
  const match = result.stdout.match(/FIXTURE\|([0-9a-f-]+)\|([0-9]+)\|([0-9]+)\|(NULL|-?[0-9]+(?:\.[0-9]+)?)/u)
  assert.ok(match, outputOf(result))
  return {
    ownerId: match[1],
    orderId: match[2],
    itemId: match[3],
    originalCredits: match[4],
    marker,
  }
}

function cleanupFixture(fixture) {
  const creditsLiteral = fixture.originalCredits === 'NULL' ? 'null' : fixture.originalCredits
  const result = dockerPsql(`
begin;
delete from public.credit_transactions
where user_id = '${fixture.ownerId}'
  and description = 'Pago de Orden de Importación #${fixture.orderId}';
update public.import_orders
set status = 'Cotizada'
where id = ${fixture.orderId} and user_notes = '${fixture.marker}';
delete from public.import_items where order_id = ${fixture.orderId};
delete from public.import_orders where id = ${fixture.orderId} and user_notes = '${fixture.marker}';
update public.profiles set credits = ${creditsLiteral} where id = '${fixture.ownerId}';
commit;
`)
  assert.equal(result.status, 0, outputOf(result))
}

test('serializa submits concurrentes y débita como máximo una vez', async () => {
  await migrationPromise
  assertExactLocalContainer()
  const marker = `atomic-submit-${process.pid}-${Date.now()}`
  const fixture = createCommittedFixture(marker)
  const appName = `atomic-submit-ready-${process.pid}`
  const pathValue = `imports/${fixture.ownerId}/${fixture.orderId}/33333333-3333-4333-8333-333333333333.png`

  try {
    const first = startPsql(`
begin;
select id from public.import_orders where id = ${fixture.orderId} for update;
select set_config('application_name', '${appName}', false);
select pg_sleep(2);
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select public.approve_import_quote_atomic(${fixture.orderId}, '${fixture.ownerId}', '${pathValue}', 1);
commit;
`)
    await waitForApplicationName(appName)
    const second = startPsql(`
begin;
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select public.approve_import_quote_atomic(${fixture.orderId}, '${fixture.ownerId}', '${pathValue}', 1);
commit;
`)
    const [firstResult, secondResult] = await Promise.all([first, second])
    assert.equal(firstResult.status, 0, outputOf(firstResult))
    assert.notEqual(secondResult.status, 0, 'el submit concurrente debía fallar tras esperar el lock')

    const state = dockerPsql(`
select io.status::text || '|' || io.payment_proof_path || '|' || p.credits::text || '|' ||
  (select count(*) from public.credit_transactions ct
   where ct.user_id = '${fixture.ownerId}'
     and ct.description = 'Pago de Orden de Importación #${fixture.orderId}')::text
from public.import_orders io
join public.profiles p on p.id = io.user_id
where io.id = ${fixture.orderId};
`)
    assert.equal(state.status, 0, outputOf(state))
    assert.match(
      state.stdout,
      new RegExp(`Cotización Aprobada\\|${pathValue.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}\\|99(?:\\.0+)?\\|1`, 'u'),
    )
  } finally {
    cleanupFixture(fixture)
  }
})

test('serializa delete contra finalize y nunca aprueba una orden vacía', async () => {
  await migrationPromise
  assertExactLocalContainer()
  const marker = `atomic-delete-${process.pid}-${Date.now()}`
  const fixture = createCommittedFixture(marker)
  const appName = `atomic-delete-ready-${process.pid}`
  const pathValue = `imports/${fixture.ownerId}/${fixture.orderId}/44444444-4444-4444-8444-444444444444.png`

  try {
    const deletion = startPsql(`
begin;
select id from public.import_orders where id = ${fixture.orderId} for update;
select set_config('application_name', '${appName}', false);
select pg_sleep(2);
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select public.delete_import_item_atomic(${fixture.itemId}, ${fixture.orderId}, '${fixture.ownerId}');
commit;
`)
    await waitForApplicationName(appName)
    const finalization = startPsql(`
begin;
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select public.approve_import_quote_atomic(${fixture.orderId}, '${fixture.ownerId}', '${pathValue}', 0);
commit;
`)
    const [deleteResult, finalizeResult] = await Promise.all([deletion, finalization])
    assert.equal(deleteResult.status, 0, outputOf(deleteResult))
    assert.notEqual(finalizeResult.status, 0, 'finalize debía observar la orden vacía después del delete')

    const state = dockerPsql(`select status::text || '|' || coalesce(payment_proof_path, 'NULL') || '|' || (select count(*) from public.import_items where order_id = ${fixture.orderId}) from public.import_orders where id = ${fixture.orderId};`)
    assert.equal(state.status, 0, outputOf(state))
    assert.match(state.stdout, /Cotizada\|NULL\|0/u)
  } finally {
    cleanupFixture(fixture)
  }
})
