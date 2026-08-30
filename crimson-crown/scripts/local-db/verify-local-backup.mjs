import { execFileSync, spawnSync } from 'node:child_process'
import { readFile, realpath } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

import { LOCAL_DB_CONTAINER, sha256 } from '../lib/local-operations.mjs'
import {
  buildDefaultArtifactRoot,
  validateArtifactRoot,
} from './verify-artifact-location.mjs'

function readBackupArgument(argv) {
  const index = argv.indexOf('--backup')
  if (index < 0 || !argv[index + 1] || argv.length !== 2) {
    throw new Error('Uso: node scripts/local-db/verify-local-backup.mjs --backup <ruta-externa.dump>')
  }
  return path.win32.resolve(argv[index + 1])
}

function assertBackupLocation(backupPath, artifactRoot) {
  const rawRoot = path.win32.join(artifactRoot, 'raw')
  const relative = path.win32.relative(rawRoot, backupPath)
  if (
    path.win32.extname(backupPath).toLowerCase() !== '.dump'
    || relative === ''
    || relative === '..'
    || relative.startsWith(`..${path.win32.sep}`)
    || path.win32.isAbsolute(relative)
  ) {
    throw new Error('El backup debe ser un archivo .dump dentro del directorio externo raw de Crimson.')
  }
}

function runDocker(args, options = {}) {
  return execFileSync('docker', ['exec', LOCAL_DB_CONTAINER, ...args], {
    encoding: 'utf8',
    windowsHide: true,
    ...options,
  }).trim()
}

async function main() {
  const workspaceRoot = process.cwd()
  const gitRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
    cwd: workspaceRoot,
    encoding: 'utf8',
    windowsHide: true,
  }).trim()
  const artifactRoot = validateArtifactRoot(
    process.env.CRIMSON_LOCAL_ARTIFACT_ROOT ?? buildDefaultArtifactRoot(process.env.LOCALAPPDATA),
    { gitRoot, userProfile: process.env.USERPROFILE, workspaceRoot },
  )
  const backupPath = readBackupArgument(process.argv.slice(2))
  const physicalArtifactRoot = await realpath(artifactRoot)
  const physicalBackupPath = await realpath(backupPath)
  assertBackupLocation(physicalBackupPath, physicalArtifactRoot)

  const backup = await readFile(physicalBackupPath)
  const sidecar = await readFile(`${physicalBackupPath}.sha256`, 'utf8')
  const expectedHash = sidecar.trim().split(/\s+/u)[0]
  const actualHash = sha256(backup)
  if (actualHash !== expectedHash) throw new Error('El hash SHA-256 del backup no coincide con su sidecar.')

  const verificationDatabase = `crimson_restore_verify_${process.pid}`
  try {
    runDocker(['createdb', '-U', 'postgres', '--template=template0', '--encoding=UTF8', verificationDatabase])
    const restore = spawnSync('docker', [
      'exec', '-i', '-e', 'PGPASSWORD=postgres', LOCAL_DB_CONTAINER,
      'pg_restore', '-U', 'supabase_admin', '-d', verificationDatabase,
      '--no-owner', '--no-privileges', '--exit-on-error',
    ], { input: backup, encoding: null, maxBuffer: 512 * 1024 * 1024, windowsHide: true })
    if (restore.status !== 0) {
      const diagnostic = restore.stderr
        ?.toString('utf8')
        .split(/\r?\n/u)
        .filter((line) => /^pg_restore:/iu.test(line))
        .join(' ')
        .slice(-4000) || 'sin diagnóstico'
      throw new Error(`pg_restore de verificación falló con código ${restore.status ?? 'desconocido'}: ${diagnostic}`)
    }

    const evidence = runDocker([
      'psql', '-U', 'postgres', '-d', verificationDatabase, '-AtX', '-v', 'ON_ERROR_STOP=1', '-c',
      "select jsonb_build_object('public_tables', (select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE'), 'products', (select count(*) from public.products), 'orders', (select count(*) from public.orders), 'profiles', (select count(*) from public.profiles));",
    ])
    console.log(`Backup verificado en base temporal local: ${evidence}`)
    console.log(`SHA-256 verificado: ${actualHash}`)
  } finally {
    try {
      runDocker(['psql', '-U', 'postgres', '-d', 'postgres', '-AtX', '-c', `select pg_terminate_backend(pid) from pg_stat_activity where datname = '${verificationDatabase}';`])
    } catch {
      // La base puede no haberse creado; dropdb sigue siendo idempotente.
    }
    runDocker(['dropdb', '-U', 'postgres', '--if-exists', verificationDatabase])
  }
}

main().catch((error) => {
  console.error(`No se pudo verificar el backup local: ${error?.message ?? 'error desconocido'}`)
  process.exitCode = 1
})
