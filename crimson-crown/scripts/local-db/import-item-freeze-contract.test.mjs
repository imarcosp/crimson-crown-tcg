import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const migrationsRoot = path.join(appRoot, 'supabase', 'migrations')
const migrationSuffix = '_freeze_approved_import_quote_items.sql'
const rlsFixMigrationSuffix = '_fix_import_item_guard_rls.sql'
const expectedContainer = 'supabase_db_crimson-crown'

async function loadMigration(suffix = migrationSuffix) {
  const matches = (await readdir(migrationsRoot))
    .filter((filename) => filename.endsWith(suffix))
    .sort()
  assert.equal(matches.length, 1, `migración esperada ${suffix}: ${matches.join(', ') || 'ninguna'}`)
  return { filename: matches[0], sql: await readFile(path.join(migrationsRoot, matches[0]), 'utf8') }
}

function transactionBody(sql) {
  const match = /^\s*begin\s*;([\s\S]*)commit\s*;\s*$/iu.exec(sql)
  assert.ok(match, 'la migración debe ser una sola transacción BEGIN/COMMIT')
  assert.doesNotMatch(match[1], /\b(?:begin|commit|rollback)\s*;/iu)
  return match[1]
}

function dockerCommand(args) {
  return spawnSync('docker', args, {
    cwd: appRoot,
    encoding: 'utf8',
    timeout: 120_000,
    windowsHide: true,
  })
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

function outputOf(result) {
  return `${result.stdout || ''}\n${result.stderr || ''}`.trim()
}

function assertExactLocalContainer() {
  const result = dockerCommand(['ps', '--filter', `name=^${expectedContainer}$`, '--format', '{{.Names}}'])
  assert.equal(result.status, 0, outputOf(result))
  assert.deepEqual(result.stdout.trim().split(/\r?\n/u).filter(Boolean), [expectedContainer])
}

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
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const result = dockerPsql(`select exists(select 1 from pg_stat_activity where application_name = '${applicationName}' and state = 'active');`)
    if (result.status === 0 && /\bt\b/u.test(result.stdout)) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`No apareció la sesión coordinada ${applicationName}.`)
}

function createFixture(marker, status = 'Cotizada') {
  const statusSql = status === null ? 'null' : `'${status}'`
  const result = dockerPsql(String.raw`
begin;
select id as owner_id, coalesce(credits::text, 'NULL') as original_credits
from public.profiles order by id limit 1 \gset
update public.profiles set credits = 100 where id = :'owner_id';
insert into public.import_orders(user_id, status, user_notes)
values (:'owner_id', ${statusSql}, '${marker}') returning id as order_id \gset
insert into public.import_items(id, order_id, product_name, quantity, platform, unit_price, tax_percent, shipping_cost, in_cart, is_available, is_delivered)
values (nextval('public.import_items_id_seq'), :'order_id', '${marker}', 1, 'Otro', 10, 0, 0, false, false, false)
returning id as item_id \gset
commit;
select 'FIXTURE|' || :'owner_id' || '|' || :'order_id' || '|' || :'item_id' || '|' || :'original_credits';
`)
  assert.equal(result.status, 0, outputOf(result))
  const match = result.stdout.match(/FIXTURE\|([0-9a-f-]+)\|([0-9]+)\|([0-9]+)\|(NULL|-?[0-9]+(?:\.[0-9]+)?)/u)
  assert.ok(match, outputOf(result))
  return { ownerId: match[1], orderId: match[2], itemId: match[3], originalCredits: match[4], marker }
}

function cleanupFixture(fixture) {
  const creditsLiteral = fixture.originalCredits === 'NULL' ? 'null' : fixture.originalCredits
  const result = dockerPsql(String.raw`
begin;
delete from public.credit_transactions
where user_id = '${fixture.ownerId}' and description = 'Pago de Orden de Importación #${fixture.orderId}';
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

const migrationPromise = loadMigration()
const rlsFixMigrationPromise = loadMigration(rlsFixMigrationSuffix)

test('registra el gate focalizado de congelamiento de ítems', async () => {
  const packageJson = JSON.parse(await readFile(path.join(appRoot, 'package.json'), 'utf8'))
  assert.equal(packageJson.scripts?.['test:import-item-freeze'], 'node --test scripts/local-db/import-item-freeze-contract.test.mjs')
})

test('define backstop interno y RPC service-role-only con lock padre primero', async () => {
  const { filename, sql } = await migrationPromise
  const { filename: fixFilename, sql: fixSql } = await rlsFixMigrationPromise
  const normalized = sql.toLowerCase().replace(/\s+/gu, ' ')
  const normalizedFix = fixSql.toLowerCase().replace(/\s+/gu, ' ')

  assert.match(filename, /^\d{14}_freeze_approved_import_quote_items\.sql$/u)
  assert.match(fixFilename, /^\d{14}_fix_import_item_guard_rls\.sql$/u)
  transactionBody(sql)
  transactionBody(fixSql)
  assert.doesNotMatch(sql, /security\s+definer/iu)
  assert.doesNotMatch(sql, /\b(?:payment_proof_url|truncate|alter\s+table)\b/iu)
  assert.match(sql, /create\s+or\s+replace\s+function\s+public\.guard_import_item_quote_mutation\s*\(\s*\)\s*returns\s+trigger/iu)
  assert.match(sql, /create\s+trigger\s+guard_import_item_quote_mutation[\s\S]*before\s+insert\s+or\s+update\s+or\s+delete[\s\S]*on\s+public\.import_items/iu)
  assert.match(sql, /create\s+or\s+replace\s+function\s+public\.admin_mutate_import_item_atomic\s*\(\s*order_id_input\s+bigint\s*,\s*item_id_input\s+bigint\s*,\s*operation_input\s+text\s*,\s*payload_input\s+jsonb\s*\)/iu)
  assert.match(sql, /create\s+or\s+replace\s+function\s+public\.reject_import_quote_atomic\s*\(\s*order_id_input\s+bigint\s*,\s*user_id_input\s+uuid\s*\)/iu)
  assert.equal((normalized.match(/security invoker set search_path = public, pg_temp/gu) ?? []).length >= 3, true)
  assert.match(sql, /locked_status\s+is\s+null/u)
  assert.match(sql, /protected_change[\s\S]*locked_status\s+not\s+in\s*\(\s*'Iniciada'\s*,\s*'En cotización'\s*,\s*'Cotizada'\s*\)/u)
  assert.match(sql, /to_jsonb\(new\)[\s\S]*'is_available'[\s\S]*'is_delivered'[\s\S]*'in_cart'/iu)
  assert.match(sql, /old\.order_id\s+is\s+distinct\s+from\s+new\.order_id/iu)
  assert.match(sql, /revoke\s+all\s+on\s+function\s+public\.guard_import_item_quote_mutation\(\)[\s\S]*from\s+public\s*,\s*anon\s*,\s*authenticated\s*,\s*service_role/iu)
  assert.match(fixSql, /create\s+or\s+replace\s+function\s+public\.guard_import_item_quote_mutation\s*\(\s*\)[\s\S]*security\s+definer[\s\S]*set\s+search_path\s*=\s*public\s*,\s*pg_temp/iu)
  assert.match(fixSql, /revoke\s+all\s+on\s+function\s+public\.guard_import_item_quote_mutation\(\)[\s\S]*from\s+public\s*,\s*anon\s*,\s*authenticated\s*,\s*service_role/iu)
  assert.match(normalizedFix, /payload_input \?& item_keys/u)
  assert.match(normalizedFix, /jsonb_typeof\(payload_input -> 'product_name'\) is distinct from 'string'/u)
  assert.match(normalizedFix, /payload_input \?& array\['field', 'value'\]::text\[\]/u)
  assert.match(normalizedFix, /flag_field is null or flag_field not in/u)

  for (const signature of [
    'public.admin_mutate_import_item_atomic(bigint, bigint, text, jsonb)',
    'public.reject_import_quote_atomic(bigint, uuid)',
  ]) {
    assert.ok(normalized.includes(`revoke all on function ${signature} from public, anon, authenticated;`))
    assert.ok(normalized.includes(`grant execute on function ${signature} to service_role;`))
  }
})

test('las cinco mutaciones admin y el rechazo cruzan Server Actions atómicas', async () => {
  const page = await readFile(path.join(appRoot, 'src', 'app', 'admin', 'imports', '[id]', 'page.tsx'), 'utf8')
  const action = await readFile(path.join(appRoot, 'src', 'app', 'actions', 'imports.ts'), 'utf8')

  assert.doesNotMatch(page, /\.from\(['"]import_items['"]\)\s*\.(?:insert|update|delete)\s*\(/u)
  assert.equal((page.match(/mutateAdminImportItemAction\s*\(/gu) ?? []).length, 5)
  assert.match(action, /isAdminEmail/u)
  assert.match(action, /\.rpc\(['"]admin_mutate_import_item_atomic['"]/u)
  assert.match(action, /\.rpc\(['"]reject_import_quote_atomic['"]/u)
  const rejectBlock = action.match(/export async function rejectImportQuoteAction[\s\S]*?\n\}/u)?.[0] ?? ''
  assert.doesNotMatch(rejectBlock, /\.from\(['"]import_orders['"]\)/u)
})

test('trigger/RPC permiten estados editables, congelan aprobados y cierran ACL sin cambiar filas', async () => {
  const { sql } = await migrationPromise
  const body = transactionBody(sql)
  const { sql: fixSql } = await rlsFixMigrationPromise
  const fixBody = transactionBody(fixSql)
  assertExactLocalContainer()
  const result = dockerPsql(String.raw`
begin;
create temp table legacy_before on commit drop as
select
  (select count(*) from public.import_orders) as order_count,
  (select count(*) from public.import_items) as item_count,
  (select md5(coalesce(jsonb_agg(to_jsonb(io) order by io.id)::text, '[]')) from public.import_orders io) as orders_hash,
  (select md5(coalesce(jsonb_agg(to_jsonb(ii) order by ii.id)::text, '[]')) from public.import_items ii) as items_hash;

${body}
${fixBody}

do $cases$
declare
  owner_id uuid;
  editable_order bigint;
  item_id bigint;
  inserted_id bigint;
  approved_order bigint;
  approved_item bigint;
  null_order bigint;
  null_item bigint;
  rejected boolean;
begin
  if (select order_count from legacy_before) <> (select count(*) from public.import_orders)
    or (select item_count from legacy_before) <> (select count(*) from public.import_items)
    or (select orders_hash from legacy_before) is distinct from
       (select md5(coalesce(jsonb_agg(to_jsonb(io) order by io.id)::text, '[]')) from public.import_orders io)
    or (select items_hash from legacy_before) is distinct from
       (select md5(coalesce(jsonb_agg(to_jsonb(ii) order by ii.id)::text, '[]')) from public.import_items ii) then
    raise exception 'La migración alteró filas existentes.';
  end if;

  if not (select prosecdef from pg_proc where oid = 'public.guard_import_item_quote_mutation()'::regprocedure)
    or has_function_privilege('public', 'public.guard_import_item_quote_mutation()', 'execute')
    or has_function_privilege('anon', 'public.guard_import_item_quote_mutation()', 'execute')
    or has_function_privilege('authenticated', 'public.guard_import_item_quote_mutation()', 'execute')
    or has_function_privilege('service_role', 'public.guard_import_item_quote_mutation()', 'execute') then
    raise exception 'Trigger expuesto o privilegiado.';
  end if;
  if has_function_privilege('anon', 'public.admin_mutate_import_item_atomic(bigint,bigint,text,jsonb)', 'execute')
    or has_function_privilege('authenticated', 'public.admin_mutate_import_item_atomic(bigint,bigint,text,jsonb)', 'execute')
    or not has_function_privilege('service_role', 'public.admin_mutate_import_item_atomic(bigint,bigint,text,jsonb)', 'execute')
    or has_function_privilege('anon', 'public.reject_import_quote_atomic(bigint,uuid)', 'execute')
    or has_function_privilege('authenticated', 'public.reject_import_quote_atomic(bigint,uuid)', 'execute')
    or not has_function_privilege('service_role', 'public.reject_import_quote_atomic(bigint,uuid)', 'execute') then
    raise exception 'ACL de RPC incorrecta.';
  end if;

  select id into owner_id from public.profiles order by id limit 1;
  insert into public.import_orders(user_id, status, user_notes)
  values (owner_id, 'Iniciada', 'freeze-contract-editable') returning id into editable_order;
  perform set_config('request.jwt.claim.role', 'service_role', true);
  set local role service_role;
  select public.admin_mutate_import_item_atomic(editable_order, null, 'insert',
    '{"product_name":"Nueva","image_url":"","quantity":2,"platform":"Otro","unit_price":3.50,"tax_percent":10,"shipping_cost":1,"set_name":"","collector_number":"","product_url":""}'::jsonb)
    into inserted_id;
  item_id := inserted_id;
  perform public.admin_mutate_import_item_atomic(editable_order, item_id, 'set-flag', '{"field":"in_cart","value":true}'::jsonb);
  perform public.admin_mutate_import_item_atomic(editable_order, item_id, 'update',
    '{"product_name":"Editada","image_url":"","quantity":1,"platform":"Otro","unit_price":4,"tax_percent":0,"shipping_cost":0,"set_name":"","collector_number":"","product_url":""}'::jsonb);
  if not exists (select 1 from public.import_items where id = item_id and product_name = 'Editada' and in_cart) then
    raise exception 'Mutaciones editables no persistieron.';
  end if;
  update public.import_orders set status = 'En cotización' where id = editable_order;
  perform public.admin_mutate_import_item_atomic(editable_order, item_id, 'set-flag', '{"field":"is_available","value":true}'::jsonb);
  update public.import_orders set status = 'Cotizada' where id = editable_order;
  perform public.admin_mutate_import_item_atomic(editable_order, item_id, 'set-flag', '{"field":"is_delivered","value":true}'::jsonb);

  reset role;
  insert into public.import_orders(user_id, status, user_notes)
  values (owner_id, 'Cotizada', 'freeze-contract-approved') returning id into approved_order;
  insert into public.import_items(id, order_id, product_name, quantity, unit_price, tax_percent, shipping_cost)
  values (nextval('public.import_items_id_seq'), approved_order, 'seed', 1, 1, 0, 0) returning id into approved_item;
  update public.import_orders set status = 'Cotización Aprobada' where id = approved_order;
  set local role service_role;
  foreach rejected in array array[false] loop end loop;
  rejected := false;
  begin insert into public.import_items(order_id, product_name) values (approved_order, 'blocked'); exception when others then rejected := true; end;
  if not rejected then raise exception 'INSERT post-aprobación permitido.'; end if;
  rejected := false;
  begin update public.import_items set product_name = 'blocked' where id = approved_item; exception when others then rejected := true; end;
  if not rejected then raise exception 'UPDATE post-aprobación permitido.'; end if;
  rejected := false;
  begin delete from public.import_items where id = approved_item; exception when others then rejected := true; end;
  if not rejected then raise exception 'DELETE post-aprobación permitido.'; end if;
  rejected := false;
  begin perform public.admin_mutate_import_item_atomic(approved_order, approved_item, 'delete', '{}'::jsonb); exception when others then rejected := true; end;
  if not rejected then raise exception 'RPC post-aprobación permitido.'; end if;
  reset role;

  insert into public.import_orders(user_id, status, user_notes)
  values (owner_id, null, 'freeze-contract-null') returning id into null_order;
  alter table public.import_items disable trigger guard_import_item_quote_mutation;
  insert into public.import_items(id, order_id, product_name, quantity, unit_price, tax_percent, shipping_cost)
  values (nextval('public.import_items_id_seq'), null_order, 'null-status', 1, 1, 0, 0) returning id into null_item;
  alter table public.import_items enable trigger guard_import_item_quote_mutation;
  set local role service_role;
  rejected := false;
  begin perform public.delete_import_item_atomic(null_item, null_order, owner_id); exception when others then rejected := true; end;
  if not rejected or not exists (select 1 from public.import_items where id = null_item) then
    raise exception 'delete_import_item_atomic aceptó status NULL.';
  end if;
end;
$cases$;
rollback;
`)
  assert.equal(result.status, 0, outputOf(result))
})

test('preserva el INSERT RLS del owner y rechaza owner ajeno y payloads parciales', async () => {
  const { sql } = await migrationPromise
  const { sql: fixSql } = await rlsFixMigrationPromise
  const body = transactionBody(sql)
  const fixBody = transactionBody(fixSql)
  assertExactLocalContainer()

  const result = dockerPsql(String.raw`
begin;
${body}
${fixBody}

select id as owner_id from public.profiles order by id limit 1 \gset
select id as foreign_id from public.profiles where id <> :'owner_id'::uuid order by id limit 1 \gset
insert into public.import_orders(user_id, status, user_notes)
values (:'owner_id', 'Iniciada', 'guard-rls-owner') returning id as owner_order_id \gset
insert into public.import_orders(user_id, status, user_notes)
values (:'foreign_id', 'Iniciada', 'guard-rls-foreign') returning id as foreign_order_id \gset
select set_config('codex.foreign_order_id', :'foreign_order_id', true);

select set_config('request.jwt.claim.sub', :'owner_id', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;
insert into public.import_items(order_id, product_name, quantity)
values (:'owner_order_id', 'owner-direct', 1)
returning id as owner_item_id \gset

do $foreign_denial$
declare
  rejected boolean := false;
  foreign_order_id bigint := current_setting('codex.foreign_order_id')::bigint;
begin
  begin
    insert into public.import_items(order_id, product_name, quantity)
    values (foreign_order_id, 'foreign-direct', 1);
  exception when insufficient_privilege then rejected := true;
  end;
  if not rejected then raise exception 'El owner insertó en una orden ajena.'; end if;
end;
$foreign_denial$;
reset role;

select set_config('request.jwt.claim.role', 'service_role', true);
set local role service_role;
do $invalid_payloads$
declare
  candidate jsonb;
  rejected boolean;
  before_count bigint;
  owner_order_id bigint;
  owner_item_id bigint;
begin
  select id into owner_order_id
  from public.import_orders where user_notes = 'guard-rls-owner';
  select id into owner_item_id
  from public.import_items where order_id = owner_order_id and product_name = 'owner-direct';
  select count(*) into before_count
  from public.import_items where order_id = owner_order_id;

  foreach candidate in array array[
    '{}'::jsonb,
    '{"product_name":"x","image_url":"","quantity":1,"platform":"Otro","unit_price":1,"tax_percent":0,"shipping_cost":0,"set_name":"","collector_number":""}'::jsonb,
    '{"product_name":null,"image_url":"","quantity":1,"platform":"Otro","unit_price":1,"tax_percent":0,"shipping_cost":0,"set_name":"","collector_number":"","product_url":""}'::jsonb,
    '{"product_name":"x","image_url":"","quantity":1,"platform":"Otro","unit_price":1,"tax_percent":0,"shipping_cost":0,"set_name":"","collector_number":"","product_url":"","extra":true}'::jsonb,
    '{"product_name":"x","image_url":"","quantity":1.5,"platform":"Otro","unit_price":1,"tax_percent":0,"shipping_cost":0,"set_name":"","collector_number":"","product_url":""}'::jsonb
  ] loop
    rejected := false;
    begin
      perform public.admin_mutate_import_item_atomic(
        owner_order_id, null, 'insert', candidate
      );
    exception when sqlstate '22023' then rejected := true;
    end;
    if not rejected then raise exception 'Payload parcial aceptado: %', candidate; end if;
  end loop;

  rejected := false;
  begin
    perform public.admin_mutate_import_item_atomic(
      owner_order_id, owner_item_id, 'set-flag', '{}'::jsonb
    );
  exception when sqlstate '22023' then rejected := true;
  end;
  if not rejected then raise exception 'set-flag vacío fue aceptado.'; end if;

  if (select count(*) from public.import_items where order_id = owner_order_id) <> before_count then
    raise exception 'Un payload inválido mutó artículos.';
  end if;
end;
$invalid_payloads$;
reset role;
rollback;
`)

  assert.equal(result.status, 0, outputOf(result))
  assert.match(result.stdout, /ROLLBACK/u)
})

test('insert/update/delete concurrentes con approve nunca dejan un snapshot aprobado inconsistente', async () => {
  await migrationPromise
  assertExactLocalContainer()
  for (const operation of ['insert', 'update', 'delete']) {
    const fixture = createFixture(`freeze-race-${operation}-${process.pid}-${Date.now()}`)
    const appName = `freeze-approve-${operation}-${process.pid}`
    const pathValue = `imports/${fixture.ownerId}/${fixture.orderId}/55555555-5555-4555-8555-555555555555.png`
    try {
      const approval = startPsql(String.raw`
begin;
select id from public.import_orders where id = ${fixture.orderId} for update;
select set_config('application_name', '${appName}', false);
select pg_sleep(1);
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select public.approve_import_quote_atomic(${fixture.orderId}, '${fixture.ownerId}', '${pathValue}', 0);
commit;
`)
      await waitForApplicationName(appName)
      const mutationSql = operation === 'insert'
        ? `insert into public.import_items(order_id, product_name, quantity, unit_price, tax_percent, shipping_cost) values (${fixture.orderId}, 'late', 1, 99, 0, 0);`
        : operation === 'update'
          ? `update public.import_items set unit_price = 99 where id = ${fixture.itemId};`
          : `delete from public.import_items where id = ${fixture.itemId};`
      const mutation = startPsql(String.raw`
begin;
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
${mutationSql}
commit;
`)
      const [approvalResult, mutationResult] = await Promise.all([approval, mutation])
      assert.ok(approvalResult.status === 0 || mutationResult.status === 0, 'al menos una transacción debe progresar')

      const state = dockerPsql(String.raw`
select status::text, payment_proof_path,
  (select count(*) from public.import_items where order_id = ${fixture.orderId}) as item_count,
  (select coalesce(max(unit_price), 0) from public.import_items where order_id = ${fixture.orderId}) as max_price
from public.import_orders where id = ${fixture.orderId};
`)
      assert.equal(state.status, 0, outputOf(state))
      if (/Cotización Aprobada/u.test(state.stdout)) {
        assert.notEqual(mutationResult.status, 0, `mutación ${operation} debía abortar al ganar approve`)
        assert.match(state.stdout, /Cotización Aprobada[\s\S]*55555555-5555-4555-8555-555555555555/u)
        assert.match(state.stdout, /\|\s*1\s*\|\s*10(?:\.0+)?/u)
      } else {
        assert.notEqual(approvalResult.status, 0, `approve debía abortar al ganar ${operation}`)
        assert.match(state.stdout, /Cotizada/u)
      }
    } finally {
      cleanupFixture(fixture)
    }
  }
})

test('approve y reject concurrentes permiten una sola transición completa', async () => {
  await migrationPromise
  assertExactLocalContainer()
  const fixture = createFixture(`freeze-reject-race-${process.pid}-${Date.now()}`)
  const pathValue = `imports/${fixture.ownerId}/${fixture.orderId}/66666666-6666-4666-8666-666666666666.png`
  try {
    const approval = startPsql(String.raw`
begin;
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select public.approve_import_quote_atomic(${fixture.orderId}, '${fixture.ownerId}', '${pathValue}', 1);
commit;
`)
    const rejection = startPsql(String.raw`
begin;
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select public.reject_import_quote_atomic(${fixture.orderId}, '${fixture.ownerId}');
commit;
`)
    const [approvalResult, rejectionResult] = await Promise.all([approval, rejection])
    assert.notEqual(approvalResult.status === 0, rejectionResult.status === 0, 'exactamente una transición debe ganar')
    const state = dockerPsql(String.raw`
select io.status::text || '|' || coalesce(io.payment_proof_path, 'NULL') || '|' ||
  coalesce(io.credits_used::text, 'NULL') || '|' || coalesce(io.payment_status, 'NULL') || '|' || p.credits::text
from public.import_orders io join public.profiles p on p.id = io.user_id where io.id = ${fixture.orderId};
`)
    assert.equal(state.status, 0, outputOf(state))
    if (approvalResult.status === 0) {
      assert.match(state.stdout, new RegExp(`Cotización Aprobada\\|${pathValue.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}\\|1(?:\\.0+)?\\|verifying\\|99(?:\\.0+)?`, 'u'))
    } else {
      assert.match(state.stdout, /Solo Cotización\|NULL\|(?:0(?:\.0+)?|NULL)\|(?:pending|NULL)\|100(?:\.0+)?/u)
    }
  } finally {
    cleanupFixture(fixture)
  }
})
