import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const migrationsRoot = path.join(appRoot, 'supabase', 'migrations')
const migrationSuffix = '_harden_storage_buckets_and_policies.sql'
const expectedContainer = 'supabase_db_crimson-crown'
const previousMigration = '20260829232257_fix_import_item_guard_rls.sql'
const policyNames = Object.freeze([
  'Give users access to own folder 1ifhysk_0',
  'Give users access to own folder 1ifhysk_1',
  'Give users access to own folder 1ifhysk_2',
  'Give users access to own folder 1ifhysk_3',
  'Lectura pública de comprobantes',
  'Usuarios pueden subir comprobantes',
  'Admin gestiona banners',
  'Cualquiera ve banners',
  'Local authenticated uploads payment proofs',
  'Local authenticated uploads import images',
  'Local admins manage product and banner objects',
  'Local admins manage payment proof objects',
])

async function loadMigration() {
  const files = await readdir(migrationsRoot)
  const matches = files.filter((filename) => filename.endsWith(migrationSuffix)).sort()
  assert.equal(matches.length, 1, `migración esperada ${migrationSuffix}: ${matches.join(', ') || 'ninguna'}`)
  const filename = matches[0]
  assert.ok(filename > previousMigration, 'la migración de Storage debe ser posterior al último forward existente')
  return { filename, sql: await readFile(path.join(migrationsRoot, filename), 'utf8') }
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
    shell: false,
  })
}

function outputOf(result) {
  return `${result.stdout || ''}\n${result.stderr || ''}`.trim()
}

function assertExactLocalContainer() {
  const inspected = runDocker(['inspect', expectedContainer])
  assert.equal(inspected.status, 0, outputOf(inspected))
  const containers = JSON.parse(inspected.stdout)
  assert.equal(containers.length, 1)
  const container = containers[0]
  assert.equal(container.Name, `/${expectedContainer}`)
  assert.equal(container.State?.Running, true)
  assert.equal(container.Config?.Labels?.['com.docker.compose.project'], 'crimson-crown')
  assert.equal(container.Config?.Labels?.['com.supabase.cli.project'], 'crimson-crown')
  assert.equal(container.Config?.Labels?.['com.supabase.cli.workdir'], 'D:\\crimson-crown-tcg\\crimson-crown')
  assert.equal(container.HostConfig?.PortBindings?.['5432/tcp']?.[0]?.HostPort, '54622')
}

const migrationPromise = loadMigration()

test('registra el gate focalizado de la migración final de Storage', async () => {
  const packageJson = JSON.parse(await readFile(path.join(appRoot, 'package.json'), 'utf8'))
  assert.equal(
    packageJson.scripts?.['test:storage-migration-contract'],
    'node --test scripts/local-db/storage-hardening-migration-contract.test.mjs',
  )
})

test('hace upsert de tres buckets con privacidad, límite y MIME exactos', async () => {
  const { filename, sql } = await migrationPromise
  const normalized = sql.toLowerCase().replace(/\s+/gu, ' ')

  assert.match(filename, /^\d{14}_harden_storage_buckets_and_policies\.sql$/u)
  transactionBody(sql)
  for (const tuple of [
    /\(\s*'products'\s*,\s*'products'\s*,\s*true\s*,\s*5242880\s*,\s*array\['image\/jpeg', 'image\/png', 'image\/webp'\]::text\[\]\s*\)/u,
    /\(\s*'banners'\s*,\s*'banners'\s*,\s*true\s*,\s*5242880\s*,\s*array\['image\/jpeg', 'image\/png', 'image\/webp'\]::text\[\]\s*\)/u,
    /\(\s*'payment_proofs'\s*,\s*'payment_proofs'\s*,\s*false\s*,\s*5242880\s*,\s*array\['image\/jpeg', 'image\/png', 'image\/webp', 'application\/pdf'\]::text\[\]\s*\)/u,
  ]) {
    assert.match(normalized, tuple)
  }
  assert.match(
    normalized,
    /insert into storage\.buckets\s*\(\s*id\s*,\s*name\s*,\s*public\s*,\s*file_size_limit\s*,\s*allowed_mime_types\s*\)/u,
  )
  assert.match(normalized, /on conflict\s*\(\s*id\s*\)\s*do update\s+set/u)
  for (const assignment of [
    'name = excluded.name',
    'public = excluded.public',
    'file_size_limit = excluded.file_size_limit',
    'allowed_mime_types = excluded.allowed_mime_types',
  ]) {
    assert.ok(normalized.includes(assignment), `upsert incompleto: ${assignment}`)
  }
})

test('retira todas las policies legacy sin crear permisos browser', async () => {
  const { sql } = await migrationPromise
  assert.equal((sql.match(/drop\s+policy\s+if\s+exists/giu) ?? []).length, policyNames.length)
  for (const policyName of policyNames) {
    assert.ok(
      sql.includes(`drop policy if exists "${policyName}" on storage.objects;`),
      `falta retirar policy: ${policyName}`,
    )
  }
  assert.doesNotMatch(sql, /create\s+policy/iu)
  assert.doesNotMatch(sql, /grant\s+(?:insert|update|delete|select|all)[\s\S]*storage\.(?:objects|buckets)/iu)
  assert.doesNotMatch(sql, /\b(?:revoke|alter\s+role|drop\s+role)\b/iu)
})

test('preserva objetos, tablas y datos y documenta rollback compatible', async () => {
  const { sql } = await migrationPromise
  const normalized = sql.toLowerCase().replace(/\s+/gu, ' ')
  assert.equal((normalized.match(/insert into /gu) ?? []).length, 1)
  assert.match(normalized, /insert into storage\.buckets/u)
  assert.doesNotMatch(sql, /\b(?:delete\s+from|truncate|drop\s+table|drop\s+bucket|alter\s+table|update\s+storage\.objects)\b/iu)
  assert.match(sql, /rollback operacional compatible/iu)
  assert.match(sql, /no (?:borra|elimina)[\s\S]*(?:objeto|fila|dato)/iu)
})

test('aplica el estado final y revierte sin alterar objetos en el stack local exacto', async () => {
  const { sql } = await migrationPromise
  const body = transactionBody(sql)
  assertExactLocalContainer()

  const seedPolicies = policyNames.map((name, index) => {
    if (index % 4 === 0) return `create policy "${name}" on storage.objects for select to anon using (true);`
    if (index % 4 === 1) return `create policy "${name}" on storage.objects for insert to authenticated with check (true);`
    if (index % 4 === 2) return `create policy "${name}" on storage.objects for update to authenticated using (true) with check (true);`
    return `create policy "${name}" on storage.objects for delete to authenticated using (true);`
  }).join('\n')
  const dropPolicies = policyNames
    .map((name) => `drop policy if exists "${name}" on storage.objects;`)
    .join('\n')
  const policyNamesSql = `array[${policyNames.map((name) => `'${name.replaceAll("'", "''")}'`).join(', ')}]`

  const payload = String.raw`
begin;

create temp table storage_objects_before on commit drop as
select count(*) as row_count,
  md5(coalesce(jsonb_agg(to_jsonb(so) order by so.id)::text, '[]')) as row_hash
from storage.objects as so;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('products', 'products', false, 1, array['text/plain']::text[]),
  ('banners', 'banners', false, 2, array['application/pdf']::text[]),
  ('payment_proofs', 'payment_proofs', true, 3, array['text/plain']::text[])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

${dropPolicies}
${seedPolicies}

${body}

do $contract$
declare
  changed_objects integer;
  remaining_legacy integer;
  browser_writes integer;
  browser_selects integer;
begin
  if not exists (
    select 1 from storage.buckets
    where id = 'products' and name = 'products' and public
      and file_size_limit = 5242880
      and allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']::text[]
  ) then raise exception 'products no quedó exacto'; end if;

  if not exists (
    select 1 from storage.buckets
    where id = 'banners' and name = 'banners' and public
      and file_size_limit = 5242880
      and allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']::text[]
  ) then raise exception 'banners no quedó exacto'; end if;

  if not exists (
    select 1 from storage.buckets
    where id = 'payment_proofs' and name = 'payment_proofs' and not public
      and file_size_limit = 5242880
      and allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']::text[]
  ) then raise exception 'payment_proofs no quedó exacto'; end if;

  select count(*) into remaining_legacy
  from pg_policies
  where schemaname = 'storage' and tablename = 'objects'
    and policyname = any (${policyNamesSql}::text[]);
  if remaining_legacy <> 0 then raise exception 'quedaron policies legacy'; end if;

  select count(*) into browser_writes
  from pg_policies
  where schemaname = 'storage' and tablename = 'objects'
    and cmd in ('ALL', 'INSERT', 'UPDATE', 'DELETE')
    and roles && array['public', 'anon', 'authenticated']::name[];
  if browser_writes <> 0 then raise exception 'quedaron escrituras browser'; end if;

  select count(*) into browser_selects
  from pg_policies
  where schemaname = 'storage' and tablename = 'objects'
    and cmd in ('ALL', 'SELECT')
    and roles && array['public', 'anon', 'authenticated']::name[];
  if browser_selects <> 0 then raise exception 'quedaron lecturas browser por policy'; end if;

  with after_state as (
    select count(*) as row_count,
      md5(coalesce(jsonb_agg(to_jsonb(so) order by so.id)::text, '[]')) as row_hash
    from storage.objects as so
  )
  select count(*) into changed_objects
  from storage_objects_before before_state cross join after_state
  where before_state.row_count is distinct from after_state.row_count
     or before_state.row_hash is distinct from after_state.row_hash;
  if changed_objects <> 0 then raise exception 'la migración alteró objetos'; end if;
end;
$contract$;

rollback;
`

  const result = runDocker([
    'exec', '-i', expectedContainer,
    'psql', '-U', 'supabase_admin', '-d', 'postgres', '-X', '-v', 'ON_ERROR_STOP=1',
  ], payload)
  assert.equal(result.status, 0, outputOf(result))
  assert.match(result.stdout, /ROLLBACK/u)
})
