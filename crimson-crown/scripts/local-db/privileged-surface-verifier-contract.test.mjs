import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

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
