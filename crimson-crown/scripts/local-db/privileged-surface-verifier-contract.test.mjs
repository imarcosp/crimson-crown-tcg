import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expectPermissionDenied } from './security-matrix.mjs'

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const powershell = path.join(
  process.env.SystemRoot || 'C:\\Windows',
  'System32',
  'WindowsPowerShell',
  'v1.0',
  'powershell.exe',
)
const runner = path.join(appRoot, 'scripts', 'local-db', 'verify-privileged-surfaces.ps1')
const matrix = path.join(appRoot, 'scripts', 'local-db', 'security-matrix.mjs')
const inventoryPath = path.join(appRoot, 'docs', 'security', 'crimson-security-definer-inventory.json')
const verifierSqlPath = path.join(appRoot, 'scripts', 'local-db', 'verify-privileged-surfaces.sql')

function run(command, args, timeout = 120_000) {
  return spawnSync(command, args, {
    cwd: appRoot,
    encoding: 'utf8',
    timeout,
    windowsHide: true,
  })
}

function outputOf(result) {
  return `${result.stdout || ''}\n${result.stderr || ''}`.trim()
}

test('el runner verifica el catálogo local exacto', () => {
  const result = run(powershell, [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    runner,
  ])

  assert.equal(result.status, 0, outputOf(result))
  assert.match(result.stdout, /PRIVILEGED_SURFACES_OK/)
})

test('el runner rechaza cualquier parámetro de contenedor o remoto', () => {
  const result = run(powershell, [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    runner,
    '-Container',
    'supabase_db_foreign-project',
  ])

  assert.notEqual(result.status, 0)
  assert.match(outputOf(result), /no acepta parametros/i)
  assert.doesNotMatch(outputOf(result), /PRIVILEGED_SURFACES_OK/)
})

test('la matriz Data API prueba denegaciones privilegiadas antes de ejecución', () => {
  const result = run(process.execPath, [matrix])
  assert.equal(result.status, 0, outputOf(result))

  const payload = JSON.parse(result.stdout)
  assert.equal(payload.privilegedCatalogVerified, true)
  assert.deepEqual(payload.privilegedRpcDenials, {
    functions: 18,
    probes: 36,
  })
  assert.deepEqual(payload.commissionAdmin, {
    anon: 'denied',
    standard: false,
    admin: true,
  })
})

test('el verificador detecta EXECUTE efectivo heredado y revierte la fixture', () => {
  const inventory = JSON.parse(readFileSync(inventoryPath, 'utf8'))
  const verifierSql = readFileSync(verifierSqlPath, 'utf8')
  const values = inventory
    .map(({ signature, allowedRoles }) => `('${signature}', array[${allowedRoles.map((role) => `'${role}'`).join(', ')}]::text[])`)
    .sort()
    .join(',\n  ')
  const payload = `
begin;
create role privileged_surface_inherited_probe nologin;
alter function public.assign_import_order_number() owner to privileged_surface_inherited_probe;
revoke execute on function public.assign_import_order_number() from supabase_admin;
grant privileged_surface_inherited_probe to anon;
create temp table expected_privileged_surfaces (
  signature text primary key,
  allowed_roles text[] not null
) on commit drop;
insert into expected_privileged_surfaces (signature, allowed_roles) values
  ${values};
${verifierSql}
rollback;
`

  const inheritedResult = spawnSync('docker', [
    'exec', '-i', 'supabase_db_crimson-crown',
    'psql', '-U', 'supabase_admin', '-d', 'postgres', '-X', '-v', 'ON_ERROR_STOP=1',
  ], {
    cwd: appRoot,
    encoding: 'utf8',
    input: payload,
    timeout: 120_000,
    windowsHide: true,
  })

  assert.notEqual(inheritedResult.status, 0, outputOf(inheritedResult))
  assert.match(outputOf(inheritedResult), /unexpected effective runtime privilege for anon on assign_import_order_number\(\)/i)

  const residue = run('docker', [
    'exec', 'supabase_db_crimson-crown',
    'psql', '-U', 'supabase_admin', '-d', 'postgres', '-X', '-Atc',
    "select rolname from pg_roles where rolname = 'privileged_surface_inherited_probe';",
  ])
  assert.equal(residue.status, 0, outputOf(residue))
  assert.equal(residue.stdout.trim(), '', 'la fixture de rol heredado debe quedar revertida')
})

test('42501 sólo acepta el objeto exacto de función o vista', () => {
  assert.doesNotThrow(() => expectPermissionDenied('RPC exacta', {
    error: { code: '42501', message: 'permission denied for function assign_import_order_number', details: null },
  }, { kind: 'function', name: 'assign_import_order_number', catalogVerified: true }))

  assert.doesNotThrow(() => expectPermissionDenied('vista exacta', {
    error: { code: '42501', message: 'permission denied for view admin_users', details: null },
  }, { kind: 'view', name: 'admin_users', catalogVerified: true }))

  for (const message of [
    'permission denied for table products',
    'permission denied for sequence orders_id_seq',
    'permission denied for relation import_orders',
    'permission denied for function another_function',
  ]) {
    assert.throws(() => expectPermissionDenied('error ajeno', {
      error: { code: '42501', message, details: null },
    }, { kind: 'function', name: 'assign_import_order_number', catalogVerified: true }))
  }
})

test('PGRST202 exige catálogo previo y forma exacta para la RPC oculta', () => {
  const exactHiddenError = {
    code: 'PGRST202',
    details: 'Searched for the function public.assign_import_order_number without parameters or with a single unnamed json/jsonb parameter, but no matches were found in the schema cache.',
    hint: null,
    message: 'Could not find the function public.assign_import_order_number without parameters in the schema cache',
  }

  assert.doesNotThrow(() => expectPermissionDenied('RPC oculta exacta', {
    error: exactHiddenError,
  }, { kind: 'function', name: 'assign_import_order_number', catalogVerified: true }))

  assert.throws(() => expectPermissionDenied('sin catálogo previo', {
    error: exactHiddenError,
  }, { kind: 'function', name: 'assign_import_order_number', catalogVerified: false }))

  assert.throws(() => expectPermissionDenied('PGRST genérico', {
    error: {
      ...exactHiddenError,
      details: 'A generic schema cache lookup failed.',
      message: 'assign_import_order_number was absent from the schema cache',
    },
  }, { kind: 'function', name: 'assign_import_order_number', catalogVerified: true }))

  assert.throws(() => expectPermissionDenied('RPC equivocada', {
    error: {
      ...exactHiddenError,
      details: exactHiddenError.details.replaceAll('assign_import_order_number', 'another_function'),
      message: exactHiddenError.message.replaceAll('assign_import_order_number', 'another_function'),
    },
  }, { kind: 'function', name: 'assign_import_order_number', catalogVerified: true }))
})
